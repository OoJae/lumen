/**
 * The Lumen gateway.
 *
 * Wave 3 changed what this is: when inference is live, the route no longer
 * re-frames the provider's stream — it pipes the provider's bytes through
 * VERBATIM. That is what lets the browser verify the enclave signature over
 * the exact bytes it received, even on a gateway-relayed response. Any
 * re-serialization here would break the hash and silently downgrade every
 * user's proof.
 *
 * Honest threat model: for the duration of the call this gateway still sees
 * plaintext (it holds the Compute credential). It keeps no entries and logs no
 * content, and because it relays raw bytes the browser can still prove the
 * enclave signed exactly what it displayed — a gateway that tampered would be
 * caught by every user. Browser-direct inference (removing the gateway from the
 * plaintext path entirely) is Wave 4 work and is NOT implemented; nothing here
 * bypasses this route today.
 *
 * There is exactly one mock path, and production refuses to serve it. With no
 * Compute credential configured, local dev streams a clearly-labeled demo;
 * a production deploy in the same state answers 503. When a credential IS
 * configured, a provider failure returns an honest error. Lumen never
 * fabricates a reflection and lets you believe something read you.
 */
import type { NextRequest } from 'next/server';
import {
  activeModelId,
  activeProviderUrl,
  reflectDemo,
  reflectRawResponse,
} from '@/lib/0g/compute';
import { isComputeLive, mayServeDemo } from '@/lib/0g/env';
import { clientKey, createRateLimiter } from '@/lib/0g/rateLimit';
import { LUMEN_SYSTEM_PROMPT } from '@/lib/prompts';
import { foldSystemMessages } from '@/lib/memory/systemMerge';
import { CHAT_PROVIDER_ADDRESS, PROOF_HEADER } from '@lumen/shared';
import type { ChatMessage } from '@lumen/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const encoder = new TextEncoder();

/**
 * This route spends the 0G Compute credential on every call and is reachable by
 * anyone, with no account and no auth. Without a limit one script drains it,
 * and the first person to find out is whoever opens the demo next.
 *
 * ~20 reflections in a burst, one per 6s sustained — far above a human writing
 * a journal, far below a useful drain rate.
 */
const limiter = createRateLimiter({ burst: 20, refillPerSecond: 1 / 6 });

/** A journal entry is prose, not a payload. These caps are generous for a
 *  person and hostile to anyone using the route as free inference. */
const MAX_MESSAGES = 40;
const MAX_TOTAL_CHARS = 60_000;

/** Tells the client which wire format to expect (and therefore which parser and
 *  which trust story applies). */
const STREAM_FORMAT_HEADER = 'X-Lumen-Stream';
const FORMAT_PROVIDER_RAW = 'zg-openai-v1';
const FORMAT_LUMEN_DEMO = 'lumen-v1';

function sse(event: string | null, data: unknown): Uint8Array {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return encoder.encode(`${event ? `event: ${event}\n` : ''}data: ${payload}\n\n`);
}

/** Local-dev only: no Compute credential configured. Unreachable in production
 *  because `mayServeDemo()` refuses there — not because we assume the
 *  credential is always present. It once was exactly that assumption. */
function demoStream(messages: ChatMessage[]): Response {
  const result = reflectDemo(messages);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const token of result.tokens) {
          controller.enqueue(sse(null, { token }));
        }
        controller.enqueue(sse('attestation', result.finalize()));
        controller.enqueue(sse('done', { ok: true }));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Inference interrupted';
        controller.enqueue(sse('error', { message }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      [STREAM_FORMAT_HEADER]: FORMAT_LUMEN_DEMO,
    },
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const limit = limiter(clientKey(req.headers));
  if (!limit.allowed) {
    return new Response(
      'Too many reflections from this address in a short time. Wait a moment and try again.',
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  let messages: ChatMessage[] = [];
  try {
    const body = (await req.json()) as { messages?: ChatMessage[] };
    messages = Array.isArray(body?.messages) ? body.messages : [];
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }
  if (messages.length === 0) {
    return new Response('`messages` is required', { status: 400 });
  }
  if (messages.length > MAX_MESSAGES) {
    return new Response(`At most ${MAX_MESSAGES} messages per reflection`, { status: 413 });
  }
  const totalChars = messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0), 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    return new Response('That reflection is too long to send', { status: 413 });
  }

  if (!isComputeLive()) {
    // The one mock in this codebase, and it is now genuinely unreachable in
    // production rather than merely documented as such. See lib/0g/env.ts.
    if (!mayServeDemo()) {
      // Plain text, like every other error branch on this route (429/400/413/502).
      // useStreamingReflection reads failures with res.text() — its own comment
      // says "the gateway answers ... with plain-text prose" — so a JSON body
      // rendered a literal {"error":"..."} blob into the UI.
      return new Response(
        'Lumen is not configured for inference right now. No reflection was generated — ' +
          'nothing was invented in its place.',
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return demoStream(messages);
  }

  const withSystem = foldSystemMessages(messages, LUMEN_SYSTEM_PROMPT);

  let raw;
  try {
    raw = await reflectRawResponse(withSystem);
  } catch {
    // Deliberately NOT a mock. A journaling app that invents a reflection when
    // the enclave is unreachable is lying to someone who just wrote something
    // true. Fail visibly instead; the entry is already safe on the client.
    return new Response(
      'The 0G Compute provider could not be reached, so there is no verified reflection to show. Your entry is still in the box — try again in a moment.',
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Pipe the provider's body through untouched. no-transform is load-bearing:
  // any compression rewrite downstream would change the bytes the client hashes.
  const headers = new Headers({
    'Content-Type': raw.response.headers.get('Content-Type') ?? 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    [STREAM_FORMAT_HEADER]: FORMAT_PROVIDER_RAW,
    'X-Lumen-Model': raw.model || activeModelId(),
  });
  if (raw.chatId) headers.set(PROOF_HEADER, raw.chatId);
  headers.set('X-Lumen-Provider', raw.providerAddress ?? CHAT_PROVIDER_ADDRESS);
  const providerUrl = activeProviderUrl();
  // The client fetches the enclave signature straight from the provider.
  if (providerUrl) headers.set('X-Lumen-Provider-Url', providerUrl);

  return new Response(raw.response.body, { headers });
}
