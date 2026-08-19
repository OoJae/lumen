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
  WHISPER_MODEL_ID,
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

/** Where live inference goes: the Direct provider proxy if configured, else the
 *  hosted Router. Exported so the gateway can report the provider it used. */
export function activeProviderUrl(): string | null {
  return process.env.ZG_PROVIDER_URL?.replace(/\/+$/, '') ?? null;
}

export function activeModelId(override?: string): string {
  return activeModel(override);
}

export interface RawReflectResponse {
  /** The provider's untouched response — stream it to the client verbatim so
   *  the browser can hash exactly what the enclave signed. */
  response: Response;
  model: string;
  chatId: string | null;
  providerAddress: string | null;
}

/**
 * Live Sealed Inference as a RAW passthrough (Wave 3).
 *
 * Deliberately a plain fetch rather than the OpenAI SDK: the SDK parses chunks
 * into objects, and re-serializing them would change the bytes. Per-request
 * verification hashes the response body, so the gateway must forward the
 * provider's bytes untouched or the proof cannot be checked client-side.
 */
export async function reflectRawResponse(
  messages: ChatMessage[],
  opts?: { model?: string; signal?: AbortSignal },
): Promise<RawReflectResponse> {
  const model = activeModel(opts?.model);
  const base = inferenceBaseURL().replace(/\/+$/, '');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
  opts?.signal?.addEventListener('abort', () => controller.abort(), { once: true });

  let response: Response;
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.ZG_COMPUTE_API_KEY ?? ''}`,
        [PRIVATE_MODE_HEADER]: PRIVATE_MODE_VALUE,
      },
      body: JSON.stringify({ model, messages, stream: true }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok || !response.body) {
    throw new Error(`provider responded ${response.status}`);
  }

  return {
    response,
    model,
    chatId: response.headers.get(PROOF_HEADER) ?? response.headers.get(PROOF_HEADER.toLowerCase()),
    providerAddress: response.headers.get('Provider') ?? response.headers.get('provider'),
  };
}

/**
 * Demo fallback — a clearly-labeled MOCK, reachable ONLY when no Compute
 * credential is configured (local dev). It is deliberately not a failure
 * fallback: when a credential is present and the provider is unreachable, the
 * gateway returns an error rather than inventing a reflection.
 */
export function reflectDemo(messages: ChatMessage[], opts?: { model?: string }): ReflectResult {
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
    finalize: () => buildDemoAttestation(model),
  };
}

/** Voice can't ride the chat credential: an `app-sk-` is locked to ONE provider
 *  (ours serves GLM-5.1, not whisper), so transcription uses its own Router
 *  `sk-` key. Abort window is wider than chat's — whisper processes a clip. */
const TRANSCRIBE_TIMEOUT_MS = 45_000;

/**
 * Whisper transcription on 0G (TeeML) — the ONLY place that knows how Lumen
 * talks to 0G for audio, mirroring reflectStream for chat. W3's Direct-SDK /
 * wallet-signed migration edits this seam, not the route.
 */
export async function transcribeAudio(file: File): Promise<string> {
  const client = new OpenAI({
    apiKey: process.env.ZG_VOICE_API_KEY,
    baseURL: process.env.ZG_VOICE_BASE_URL || ROUTER_BASE_URL,
    timeout: TRANSCRIBE_TIMEOUT_MS,
    maxRetries: 0,
  });
  const result = await client.audio.transcriptions.create(
    {
      file,
      model: process.env.ZG_VOICE_MODEL || WHISPER_MODEL_ID,
      response_format: 'json',
    },
    { headers: { [PRIVATE_MODE_HEADER]: PRIVATE_MODE_VALUE } },
  );
  return typeof result.text === 'string' ? result.text.trim() : '';
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
