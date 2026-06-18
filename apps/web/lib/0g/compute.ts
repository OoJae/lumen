/**
 * 0G Compute — inference gateway abstraction (SERVER-ONLY).
 *
 * Supports two live paths + a demo fallback, all behind one tiny seam:
 *  - DIRECT path (Wave 1, validated): a wallet-signed `app-sk-` token from the 0G
 *    compute CLI, sent as a Bearer to the provider's own endpoint
 *    `${ZG_PROVIDER_URL}/v1/proxy/chat/completions` (OpenAI-compatible). The
 *    provider runs the model inside a TEE (e.g. GLM-5.1 / TeeML). No wallet key
 *    needed at request time — the signature is baked into the token. The provider
 *    URL is discovered once (read-only) and baked into env, so no SDK/on-chain
 *    call happens at runtime.
 *  - ROUTER path: a dashboard `sk-` key against the hosted Router
 *    (`ZG_ROUTER_BASE_URL`), which load-balances across healthy providers.
 *    Selected automatically when `ZG_PROVIDER_URL` is unset.
 *  - DEMO: no token → a clearly-labeled mock so the loop is always clickable. The
 *    route also falls back to demo (labeled "live unavailable") if a live call
 *    times out, so a provider outage never hangs the UI.
 *
 * Wave 3 swaps the DIRECT internals to the full broker SDK (per-request
 * `processResponse` crypto-verification) with no caller change.
 *
 * ⚠️ Do NOT import this from a client component (reads the token from env).
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

/** Abort a live call that produces no response within this window (ms). */
const LIVE_TIMEOUT_MS = 22_000;

export interface ReflectResult {
  /** Token deltas as they stream from the enclave. */
  tokens: AsyncIterable<string>;
  /** Attestation for this response — call AFTER the stream is drained (the proof
   *  reference may only be known once the first chunk/headers arrive). */
  finalize: () => AttestationInfo;
}

function activeModel(override?: string): string {
  return override || process.env.ZG_COMPUTE_MODEL || DEFAULT_MODEL_ID;
}

/** Base URL for the OpenAI-compatible client: provider /v1/proxy if a Direct
 *  provider is configured, else the hosted Router. */
function inferenceBaseURL(): string {
  const providerUrl = process.env.ZG_PROVIDER_URL?.replace(/\/+$/, '');
  if (providerUrl) return `${providerUrl}/v1/proxy`;
  return process.env.ZG_ROUTER_BASE_URL || ROUTER_BASE_URL;
}

/** Real Sealed Inference (Direct provider or Router), in private trust mode. */
export async function reflectStream(
  messages: ChatMessage[],
  opts?: { model?: string },
): Promise<ReflectResult> {
  const model = activeModel(opts?.model);
  const client = new OpenAI({
    apiKey: process.env.ZG_COMPUTE_API_KEY,
    baseURL: inferenceBaseURL(),
    timeout: LIVE_TIMEOUT_MS,
    maxRetries: 0,
  });

  const { data: stream, response } = await client.chat.completions
    .create(
      {
        model,
        messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        stream: true,
      },
      { headers: { [PRIVATE_MODE_HEADER]: PRIVATE_MODE_VALUE } },
    )
    .withResponse();

  // Proof reference: the ZG-Res-Key header if present, else the streamed
  // completion id (the chatID used for Direct-path TEE verification in W3).
  let chatId =
    response.headers.get(PROOF_HEADER) ??
    response.headers.get(PROOF_HEADER.toLowerCase()) ??
    undefined;

  async function* tokens(): AsyncIterable<string> {
    for await (const chunk of stream) {
      if (!chatId && chunk.id) chatId = chunk.id;
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) yield delta;
    }
  }

  return {
    tokens: tokens(),
    finalize: () => buildLiveAttestation(model, chatId ?? undefined),
  };
}

/**
 * Demo fallback — a clearly-labeled MOCK. `reason: 'live-unavailable'` marks the
 * case where a real provider was configured but unreachable (e.g. outage), so the
 * attestation note stays honest about why this isn't a live TEE response.
 */
export function reflectDemo(
  messages: ChatMessage[],
  opts?: { model?: string; reason?: 'no-key' | 'live-unavailable' },
): ReflectResult {
  const model = activeModel(opts?.model);
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const reflection = composeDemoReflection(lastUser);

  async function* tokens(): AsyncIterable<string> {
    const parts = reflection.match(/\S+\s*/g) ?? [reflection];
    for (const part of parts) {
      await delay(26);
      yield part;
    }
  }

  return {
    tokens: tokens(),
    finalize: () => buildDemoAttestation(model, opts?.reason ?? 'no-key'),
  };
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
    `${opener} I'm holding what you wrote privately — in a live session it would be ` +
    `processed inside a sealed hardware enclave (TEE), unreadable even to the people who ` +
    `run the model. What feels most true about this for you right now, and what would ` +
    `change if you let yourself believe it?`
  );
}
