'use client';

import { useCallback, useRef, useState } from 'react';
import type { AttestationInfo, ChatMessage } from '@lumen/shared';

import { OpenAiSseAccumulator } from '@/lib/0g/openaiSse';
import { verifyAndBuildAttestation } from '@/lib/0g/verifyReflection';

export type ReflectionStatus = 'idle' | 'streaming' | 'verifying' | 'done' | 'error';

export interface ReflectionResult {
  text: string;
  attestation: AttestationInfo | null;
}

export interface UseStreamingReflection {
  text: string;
  attestation: AttestationInfo | null;
  status: ReflectionStatus;
  error: string | null;
  /** Resolves with the final reflection (or null on error/abort). */
  reflect: (messages: ChatMessage[]) => Promise<ReflectionResult | null>;
  reset: () => void;
}

const STREAM_FORMAT_HEADER = 'x-lumen-stream';
const FORMAT_PROVIDER_RAW = 'zg-openai-v1';

/**
 * Consumes /api/reflect. Two wire formats:
 *
 *  - `zg-openai-v1` — the provider's own bytes, relayed untouched. We keep every
 *    byte, then verify the enclave signature over them IN THE BROWSER before the
 *    turn is persisted. This is the Wave 3 headline: a reflection is
 *    cryptographically verified for every user, wallet or not.
 *  - `lumen-v1` — Lumen's own SSE shape, served ONLY when no Compute credential
 *    is configured (local dev), carrying a clearly-labelled demo attestation.
 */
export function useStreamingReflection(): UseStreamingReflection {
  const [text, setText] = useState('');
  const [attestation, setAttestation] = useState<AttestationInfo | null>(null);
  const [status, setStatus] = useState<ReflectionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setText('');
    setAttestation(null);
    setStatus('idle');
    setError(null);
  }, []);

  const reflect = useCallback(async (messages: ChatMessage[]): Promise<ReflectionResult | null> => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setText('');
    setAttestation(null);
    setError(null);
    setStatus('streaming');

    try {
      const res = await fetch('/api/reflect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
        signal: ac.signal,
      });
      if (!res.ok) {
        // The gateway answers a provider outage with plain-text prose, not a
        // fabricated reflection. Show what it actually said.
        const detail = (await res.text().catch(() => '')).trim();
        throw new Error(detail || `Reflection request failed (${res.status})`);
      }
      if (!res.body) throw new Error('The reflection response had no body');

      const isRawProvider = res.headers.get(STREAM_FORMAT_HEADER) === FORMAT_PROVIDER_RAW;
      return isRawProvider
        ? await consumeProviderStream(res, ac, { setText, setAttestation, setStatus })
        : await consumeLumenStream(res, { setText, setAttestation, setStatus, setError });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
      setError((e as Error).message);
      setStatus('error');
      return null;
    }
  }, []);

  return { text, attestation, status, error, reflect, reset };
}

interface Setters {
  setText: (v: string) => void;
  setAttestation: (v: AttestationInfo | null) => void;
  setStatus: (v: ReflectionStatus) => void;
  setError?: (v: string | null) => void;
}

/** Raw provider bytes → display text + browser-side verification. */
async function consumeProviderStream(
  res: Response,
  ac: AbortController,
  { setText, setAttestation, setStatus }: Setters,
): Promise<ReflectionResult | null> {
  const acc = new OpenAiSseAccumulator();
  const reader = res.body!.getReader();
  let accumulated = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (ac.signal.aborted) return null;
    for (const delta of acc.push(value)) {
      accumulated += delta;
      setText(accumulated);
    }
  }

  if (!accumulated) throw new Error('The provider returned an empty reflection');

  // Verify eagerly: provider signatures expire, so this cannot wait for a click.
  setStatus('verifying');
  const attestation = await verifyAndBuildAttestation({
    rawBytes: acc.rawBytes(),
    chatId: res.headers.get('zg-res-key') ?? acc.chatId,
    model: res.headers.get('x-lumen-model') ?? 'glm-5.1',
    path: 'gateway',
    providerUrl: res.headers.get('x-lumen-provider-url'),
    providerAddress: res.headers.get('x-lumen-provider'),
  });

  setAttestation(attestation);
  setStatus('done');
  return { text: accumulated, attestation };
}

/** Lumen's own SSE shape (local-dev demo only). */
async function consumeLumenStream(
  res: Response,
  { setText, setAttestation, setStatus, setError }: Setters,
): Promise<ReflectionResult | null> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';
  let finalAttestation: AttestationInfo | null = null;
  let sawError = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? ''; // keep any trailing partial frame

    for (const frame of frames) {
      if (!frame.trim()) continue;
      let event: string | null = null;
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }

      if (event === 'attestation') {
        finalAttestation = parsed as AttestationInfo;
        setAttestation(finalAttestation);
      } else if (event === 'error') {
        sawError = true;
        setError?.((parsed as { message?: string }).message ?? 'Inference failed');
        setStatus('error');
      } else if (event !== 'done') {
        const token = (parsed as { token?: string }).token;
        if (token) {
          accumulated += token;
          setText(accumulated);
        }
      }
    }
  }

  if (sawError) return null;
  setStatus('done');
  return { text: accumulated, attestation: finalAttestation };
}
