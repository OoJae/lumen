'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import { parseAddress } from '@/lib/0g/address';

/**
 * Paste an address, read that companion's whole story.
 *
 * Validation happens here rather than at the destination so a typo gets a
 * sentence instead of a page saying "no companion here" — which is the same
 * thing a *valid* address with no companion says, and confusing the two would
 * make the proof page look broken when it was working.
 *
 * `parseAddress` is the same parser the server route uses, so the two can never
 * disagree about what counts as an address — imported from its leaf module so a
 * text input does not pull viem and the RPC client into this page.
 */
export function AddressLookup() {
  const router = useRouter();
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const address = parseAddress(value.trim());
    if (!address) {
      setError("That is not a wallet address — they are 42 characters and start with 0x.");
      return;
    }
    setError(null);
    router.push(`/companion/${address}`);
  }

  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor={inputId} className="sr-only">
        Wallet address
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id={inputId}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          placeholder="0x…"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="min-w-0 flex-1 rounded-full border border-border bg-surface/50 px-4 py-2.5 font-mono text-sm text-ink outline-none transition-colors placeholder:text-muted/50 focus:border-accent/45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
        <button
          type="submit"
          className="shrink-0 rounded-full border border-accent/40 bg-accent-soft px-5 py-2.5 text-sm font-medium text-accent transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Read it
        </button>
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-3 text-xs leading-relaxed text-caution">
          {error}
        </p>
      )}
    </form>
  );
}
