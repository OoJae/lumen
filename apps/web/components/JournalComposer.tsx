'use client';

import { useRef, useState, type KeyboardEvent, type FormEvent } from 'react';
import { ArrowRightIcon } from './icons';

export function JournalComposer({
  onSubmit,
  disabled = false,
  placeholder = 'Write something…',
}: {
  onSubmit: (entry: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue('');
    if (ref.current) ref.current.style.height = 'auto';
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
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
        disabled={disabled}
        aria-label="Journal entry"
        className="writing w-full resize-none bg-transparent text-ink outline-none placeholder:text-muted/70 disabled:opacity-60"
      />
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-muted">
          <kbd className="rounded border border-border px-1 py-0.5 text-[10px]">⌘</kbd>
          <span className="mx-0.5">+</span>
          <kbd className="rounded border border-border px-1 py-0.5 text-[10px]">↵</kbd>
          <span className="ml-1.5">to reflect</span>
        </span>
        <button
          type="button"
          onClick={submit}
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
