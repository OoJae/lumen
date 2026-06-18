/**
 * The Lumen gateway (Wave 1) — a thin Next.js Route Handler that holds the 0G
 * Compute API key and proxies inference to the Router in private trust mode,
 * streaming tokens back as Server-Sent Events with a final attestation event.
 *
 * Honest threat model (docs/privacy-model.md): this gateway is technically in the
 * plaintext path for the inference CALL in Waves 1–2. It holds no long-term
 * plaintext and logs no entry/reflection content. Wave 3 moves to the wallet-
 * signed Direct SDK so the gateway leaves the plaintext path entirely.
 */
import type { NextRequest } from 'next/server';
import { reflectStream, reflectDemo } from '@/lib/0g/compute';
import { isComputeLive } from '@/lib/0g/env';
import { LUMEN_SYSTEM_PROMPT } from '@/lib/prompts';
import type { ChatMessage } from '@lumen/shared';

export const runtime = 'nodejs'; // async generators + openai SDK need the Node runtime
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();

function sse(event: string | null, data: unknown): Uint8Array {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return encoder.encode(`${event ? `event: ${event}\n` : ''}data: ${payload}\n\n`);
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

  const live = isComputeLive();
  const withSystem: ChatMessage[] = [
    { role: 'system', content: LUMEN_SYSTEM_PROMPT },
    ...messages,
  ];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const { tokens, attestation } = live
          ? await reflectStream(withSystem)
          : reflectDemo(messages);

        for await (const token of tokens) {
          controller.enqueue(sse(null, { token }));
        }
        controller.enqueue(sse('attestation', attestation));
        controller.enqueue(sse('done', { ok: true }));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Inference failed';
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
    },
  });
}
