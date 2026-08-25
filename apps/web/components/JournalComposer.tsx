'use client';

import { useRef, useState, type KeyboardEvent, type FormEvent } from 'react';
import { ArrowRightIcon } from './icons';
import { VoiceButton } from './VoiceButton';

export function JournalComposer({
  onSubmit,
  disabled = false,
  voiceLive = false,
  placeholder = 'Write something…',
}: {
  /** Resolves true when the entry was accepted and may be cleared. Resolving
   *  false (or throwing) keeps the words in the box — see submit(). */
  onSubmit: (entry: string) => boolean | Promise<boolean>;
  disabled?: boolean;
  voiceLive?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  function appendTranscript(text: string) {
    setValue((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text));
    ref.current?.focus();
  }

  /**
   * Clear ONLY once the entry is safely somewhere else.
   *
   * This used to clear immediately, while `addTurn` runs only after a
   * successful reflection — so if the provider was unreachable, the words the
   * person had just written were gone from the box and stored nowhere. In a
   * journal that is the worst possible failure, and it was happening behind an
   * error message that claimed the entry had been saved locally.
   */
  async function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    let accepted = false;
    try {
      accepted = await onSubmit(trimmed);
    } catch {
      accepted = false;
    }
    if (!accepted) return;
    setValue('');
    if (ref.current) ref.current.style.height = 'auto';
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  }

  function autoGrow(e: FormEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 360)}px`;
    setValue(el.value);
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-[0_1px_0_rgba(0,0,0,0.02)] transition-colors focus-within:border-accent/45">
      <textarea
        ref={ref}
        value={value}
        onChange={autoGrow}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={3}
        // readOnly, NOT disabled. Disabling a focused element blurs it to
        // <body>, and nothing here refocuses it — so submitting with the
        // keyboard threw focus away for the entire several-second round trip.
        // readOnly keeps the caret where the writer left it; the submit button
        // below still carries the real `disabled`.
        readOnly={disabled}
        aria-busy={disabled}
        aria-label="Journal entry"
        className={`writing w-full resize-none bg-transparent text-ink outline-none placeholder:text-muted/70 ${disabled ? 'opacity-60' : ''}`}
      />
      <div className="mt-3 flex items-center justify-between">
        <span className="flex items-center gap-2.5">
          {voiceLive && <VoiceButton onTranscript={appendTranscript} />}
          <span className="text-xs text-muted">
            <kbd className="rounded border border-border px-1 py-0.5 text-[10px]">⌘</kbd>
            <span className="mx-0.5">+</span>
            <kbd className="rounded border border-border px-1 py-0.5 text-[10px]">↵</kbd>
            <span className="ml-1.5">to reflect</span>
          </span>
        </span>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={disabled || value.trim().length === 0}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-[#fffdf8] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {disabled ? 'Reflecting…' : 'Reflect'}
          {!disabled && <ArrowRightIcon width={15} height={15} />}
        </button>
      </div>
    </div>
  );
}
