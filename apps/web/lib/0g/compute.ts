/**
 * 0G Compute — inference gateway abstraction (SERVER-ONLY).
 *
 * This is the single seam the whole app calls for inference. Wave 1 uses the
 * hosted, OpenAI-compatible Router in private trust mode. Wave 3 swaps the
 * internals to the wallet-signed Direct SDK (@0glabs/0g-serving-broker) — which
 * unlocks broker.inference.processResponse() cryptographic verification — with
 * NO change to callers or the AttestationInfo contract.
 *
 * ⚠️ Do NOT import this from a client component: it reads the API key from env
 *    and pulls in the `openai` SDK.
 */
import OpenAI from 'openai';
import {
  ROUTER_BASE_URL,
  DEFAULT_MODEL_ID,
  PRIVATE_MODE_HEADER,
  PRIVATE_MODE_VALUE,
  PROOF_HEADER,
  type ChatMessage,
  type AttestationInfo,
} from '@lumen/shared';
import { buildLiveAttestation, buildDemoAttestation } from './attestation';

export interface ReflectResult {
  /** Token deltas as they stream from the enclave. */
  tokens: AsyncIterable<string>;
  /** Provenance/attestation for this response (resolved from response headers). */
  attestation: AttestationInfo;
}

function activeModel(override?: string): string {
  return override || process.env.ZG_COMPUTE_MODEL || DEFAULT_MODEL_ID;
}

/**
 * Real Sealed Inference via the 0G Compute Router (private mode).
 * Reads the per-request proof reference (ZG-Res-Key) from the response headers.
 */
export async function reflectStream(
  messages: ChatMessage[],
  opts?: { model?: string },
): Promise<ReflectResult> {
  const model = activeModel(opts?.model);
  const client = new OpenAI({
    apiKey: process.env.ZG_COMPUTE_API_KEY,
    baseURL: process.env.ZG_ROUTER_BASE_URL || ROUTER_BASE_URL,
  });

  // `.withResponse()` exposes the raw Response so we can read the ZG-Res-Key
  // proof header alongside the token stream.
  const { data: stream, response } = await client.chat.completions
    .create(
      {
        model,
        // 0G Router is OpenAI-compatible; ChatMessage maps directly.
        messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        stream: true,
      },
      {
        headers: { [PRIVATE_MODE_HEADER]: PRIVATE_MODE_VALUE },
      },
    )
    .withResponse();

  const chatId =
    response.headers.get(PROOF_HEADER) ??
    response.headers.get(PROOF_HEADER.toLowerCase()) ??
    undefined;

  const attestation = buildLiveAttestation(model, chatId ?? undefined);

  async function* tokens(): AsyncIterable<string> {
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) yield delta;
    }
  }

  return { tokens: tokens(), attestation };
}

/**
 * Demo fallback when no API key is configured — a clearly-labeled MOCK so the
 * core loop is always clickable. Honest by construction: the attestation says
 * "Demo — not live TEE".
 */
export function reflectDemo(messages: ChatMessage[], opts?: { model?: string }): ReflectResult {
  const model = activeModel(opts?.model);
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const reflection = composeDemoReflection(lastUser);

  async function* tokens(): AsyncIterable<string> {
    // Stream word-by-word with a gentle cadence so the UX mirrors real streaming.
    const parts = reflection.match(/\S+\s*/g) ?? [reflection];
    for (const part of parts) {
      await delay(28);
      yield part;
    }
  }

  return { tokens: tokens(), attestation: buildDemoAttestation(model) };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function composeDemoReflection(entry: string): string {
  const trimmed = entry.trim();
  const firstWords = trimmed.split(/\s+/).slice(0, 4).join(' ');
  const opener = firstWords
    ? `You started with "${firstWords}…", and there's something honest in that.`
    : `Thank you for taking a moment to write.`;
  return (
    `${opener} I'm holding what you wrote privately — in a real session it would be ` +
    `processed inside a sealed hardware enclave, unreadable even to the people who run ` +
    `the model. What feels most true about this for you right now, and what would change ` +
    `if you let yourself believe it?`
  );
}
