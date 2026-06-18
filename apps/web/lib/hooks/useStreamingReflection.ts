'use client';

import { useCallback, useRef, useState } from 'react';
import type { AttestationInfo, ChatMessage } from '@lumen/shared';

export type ReflectionStatus = 'idle' | 'streaming' | 'done' | 'error';

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

/**
 * Consumes the /api/reflect SSE stream: accumulates token deltas into `text`
 * and hydrates `attestation` when the final `attestation` event arrives.
 * Buffers partial frames so a JSON payload split across chunks never breaks.
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

    let accumulated = '';
    let finalAttestation: AttestationInfo | null = null;

    try {
      const res = await fetch('/api/reflect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`Reflection request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
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
            continue; // ignore malformed frame
          }

          if (event === 'attestation') {
            finalAttestation = parsed as AttestationInfo;
            setAttestation(finalAttestation);
          } else if (event === 'error') {
            sawError = true;
            setError((parsed as { message?: string }).message ?? 'Inference failed');
            setStatus('error');
          } else if (event === 'done') {
            // terminal marker; loop will end on reader close
          } else {
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
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
      setError((e as Error).message);
      setStatus('error');
      return null;
    }
  }, []);

  return { text, attestation, status, error, reflect, reset };
}
