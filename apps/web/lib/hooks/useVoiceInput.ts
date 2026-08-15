'use client';

/**
 * Voice capture (Wave 2). MediaRecorder → in-memory blob → POST /api/transcribe
 * → transcript handed to the composer for review. Audio exists only in memory,
 * is capped at 25s (under Whisper's ~30s window), and is discarded the moment
 * the request settles. Mic permission is requested lazily on first use.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { TranscribeResponse } from '@lumen/shared';

export type VoiceState = 'idle' | 'recording' | 'transcribing' | 'error';

export interface VoiceInput {
  state: VoiceState;
  secondsLeft: number;
  error: string | null;
  start(): Promise<void>;
  stop(): void;
}

export const MAX_RECORD_SECONDS = 25;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const type of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

export function useVoiceInput(onTranscript: (text: string) => void): VoiceInput {
  const [state, setState] = useState<VoiceState>('idle');
  const [secondsLeft, setSecondsLeft] = useState(MAX_RECORD_SECONDS);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state === 'recording') recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (recorderRef.current) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      recorder.onstop = async () => {
        const type = recorder.mimeType || mimeType || 'audio/webm';
        cleanup();
        const blob = new globalThis.Blob(chunks, { type });
        if (blob.size === 0) {
          setState('idle');
          return;
        }
        setState('transcribing');
        try {
          const form = new FormData();
          const ext = type.includes('mp4') ? 'mp4' : 'webm';
          form.append('file', new File([blob], `entry.${ext}`, { type }));
          const res = await fetch('/api/transcribe', { method: 'POST', body: form });
          const body = (await res.json()) as TranscribeResponse & { error?: string };
          if (!res.ok) throw new Error(body.error ?? `Transcription failed (${res.status})`);
          if (body.text) onTranscriptRef.current(body.text);
          setState('idle');
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Transcription failed');
          setState('error');
        }
      };

      setSecondsLeft(MAX_RECORD_SECONDS);
      setState('recording');
      recorder.start();

      const startedAt = Date.now();
      timerRef.current = setInterval(() => {
        const left = MAX_RECORD_SECONDS - Math.floor((Date.now() - startedAt) / 1000);
        setSecondsLeft(Math.max(0, left));
        if (left <= 0) stop();
      }, 250);
    } catch (err) {
      cleanup();
      setError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone access was declined.'
          : err instanceof Error
            ? err.message
            : 'Could not start recording',
      );
      setState('error');
    }
  }, [cleanup, stop]);

  return { state, secondsLeft, error, start, stop };
}
