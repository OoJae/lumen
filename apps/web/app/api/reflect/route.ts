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
 * content, and wallet-connected users bypass it entirely via browser-direct
 * inference. Demo mode keeps Lumen's own SSE shape and is clearly labeled.
 */
import type { NextRequest } from 'next/server';
import {
  activeModelId,
  activeProviderUrl,
  reflectDemo,
  reflectRawResponse,
} from '@/lib/0g/compute';
import { isComputeLive } from '@/lib/0g/env';
import { LUMEN_SYSTEM_PROMPT } from '@/lib/prompts';
import { foldSystemMessages } from '@/lib/memory/systemMerge';
import { CHAT_PROVIDER_ADDRESS, PROOF_HEADER } from '@lumen/shared';
import type { ChatMessage } from '@lumen/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const encoder = new TextEncoder();

/** Tells the client which wire format to expect (and therefore which parser and
 *  which trust story applies). */
const STREAM_FORMAT_HEADER = 'X-Lumen-Stream';
const FORMAT_PROVIDER_RAW = 'zg-openai-v1';
const FORMAT_LUMEN_DEMO = 'lumen-v1';

function sse(event: string | null, data: unknown): Uint8Array {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return encoder.encode(`${event ? `event: ${event}\n` : ''}data: ${payload}\n\n`);
}

function demoStream(messages: ChatMessage[], reason: 'no-key' | 'live-unavailable'): Response {
  const result = reflectDemo(messages, { reason });
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

  if (!isComputeLive()) return demoStream(messages, 'no-key');

  const withSystem = foldSystemMessages(messages, LUMEN_SYSTEM_PROMPT);

  let raw;
  try {
    raw = await reflectRawResponse(withSystem);
  } catch {
    // Provider unreachable/timed out — a labeled mock beats a hung UI.
    return demoStream(messages, 'live-unavailable');
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
