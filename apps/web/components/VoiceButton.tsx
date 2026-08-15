'use client';

import { useVoiceInput } from '@/lib/hooks/useVoiceInput';
import { MicIcon } from './icons';

/**
 * Mic affordance in the composer. Renders ONLY when the deployment has a real
 * Whisper key (no mock transcription, ever). The transcript lands in the
 * textarea for review — the user, not the mic, decides what gets reflected on.
 */
export function VoiceButton({ onTranscript }: { onTranscript: (text: string) => void }) {
  const { state, secondsLeft, error, start, stop } = useVoiceInput(onTranscript);

  if (state === 'recording') {
    return (
      <button
        type="button"
        onClick={stop}
        aria-label="Stop recording"
        className="inline-flex items-center gap-1.5 rounded-full border border-red-400/60 px-2.5 py-1 text-xs font-medium text-red-500 transition-colors hover:border-red-400"
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden />
        {secondsLeft}s — tap to stop
      </button>
    );
  }

  if (state === 'transcribing') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
        <MicIcon width={13} height={13} className="animate-pulse" />
        Transcribing in 0G TEE…
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => void start()}
        aria-label="Dictate your entry (transcribed privately by 0G Whisper)"
        title="Dictate — transcribed by Whisper inside a 0G TEE. Audio passes through Lumen's gateway for this call only; it is never stored."
        className="grid h-7 w-7 place-items-center rounded-full border border-border text-muted transition-colors hover:border-accent/50 hover:text-ink"
      >
        <MicIcon width={14} height={14} />
      </button>
      {state === 'error' && error && (
        <span className="max-w-[180px] truncate text-xs text-caution" title={error}>
          {error}
        </span>
      )}
    </span>
  );
}
