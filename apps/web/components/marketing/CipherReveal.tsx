'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { encryptString } from '@/lib/crypto/encrypt';

/**
 * The signature moment: the light passes over your sentence and leaves
 * ciphertext behind.
 *
 * The ciphertext is REAL — your sentence through the same `encryptString` the
 * journal uses, AES-GCM, in this browser. lib/crypto/encrypt.ts has zero imports
 * (pure WebCrypto), which is what lets it run in a route group carrying no
 * wallet stack at all.
 *
 * WHY THE SUBSTITUTION IS IN PLACE, CHARACTER FOR CHARACTER. The first version
 * crossfaded two stacked layers, and they could never align: base64 of an
 * AES-GCM blob is about 1.5x the length of the prose, so one wrapped to two
 * lines while the other sat on one, and the "wipe" was two different paragraphs
 * overlapping. Replacing each character position instead keeps one line, one
 * box, one crisp boundary — and the characters really are the ciphertext's.
 *
 * HONESTY, and this is the one place this page could cheat. The key is a
 * throwaway from `crypto.subtle.generateKey`, NOT wallet-derived, and the
 * substitution shows the first N characters of the blob rather than all of it.
 * The caption says both. A landing page for a product whose moat is provable
 * privacy does not get to fudge its own hero.
 *
 * Accessibility: the plaintext is always the accessible text. The transformed
 * line is aria-hidden — it is an argument, not information.
 */

const FALLBACK = 'I keep thinking about the thing I did not say.';
const MAX = 96;

export function CipherReveal({ progress, reduced }: { progress: number; reduced: boolean }) {
  const [text, setText] = useState('');
  const [blob, setBlob] = useState<{ iv: string; ciphertext: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const inputId = useId();
  const keyRef = useRef<CryptoKey | null>(null);

  const sentence = (text.trim() || FALLBACK).slice(0, MAX);

  // Trailing edge — a fresh AES-GCM run per keystroke is wasted work, and the
  // ciphertext only has to be right by the time the light reaches it.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          keyRef.current ??= await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt'],
          );
          const result = await encryptString(keyRef.current, sentence);
          if (!cancelled) setBlob({ iv: result.iv, ciphertext: result.ciphertext });
        } catch {
          // No WebCrypto — an insecure origin, or a locked-down browser. Say so
          // rather than showing scrambled characters and calling them proof.
          if (!cancelled) setFailed(true);
        }
      })();
    }, 140);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sentence]);

  /** The stored form, cut to the same character count so the swap is in place. */
  const cipherLine = useMemo(() => {
    if (!blob) return '';
    const body = (blob.iv + blob.ciphertext).replace(/=+$/, '');
    // Cycle rather than pad: every character shown is a real ciphertext
    // character, never filler invented to make the line long enough.
    let out = '';
    while (out.length < sentence.length) out += body;
    return out.slice(0, sentence.length);
  }, [blob, sentence.length]);

  /**
   * Pinned to 0 under reduced motion. `useScrollScene` reports progress 1 there
   * (scene resolved), and feeding that straight in would replace the whole
   * sentence — turning an accessibility accommodation into the one state where
   * the page is unreadable. Reduced motion shows both, stacked.
   */
  const sweeping = !failed && !reduced && cipherLine.length > 0;
  const sweep = sweeping ? Math.min(1, Math.max(0, (progress - 0.16) / 0.46)) : 0;
  const cut = Math.round(sweep * sentence.length);

  return (
    <div className="w-full max-w-xl">
      <label
        htmlFor={inputId}
        className="mb-2.5 block text-[11px] uppercase tracking-[0.14em] text-muted"
      >
        Write one true sentence
      </label>

      {/* Serif, because this is you writing. */}
      <input
        id={inputId}
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX))}
        placeholder={FALLBACK}
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-xl border border-border bg-surface/50 px-4 py-3 font-serif text-[1.05rem] text-ink outline-none transition-colors placeholder:text-muted/50 focus:border-accent/45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      />

      <p className="mb-2.5 mt-8 text-[11px] uppercase tracking-[0.14em] text-muted">
        What gets stored
      </p>

      {/* Mono for BOTH halves — identical advance widths are what make the
          boundary crisp instead of jittering as the swap moves. It also reads
          correctly: this line is the record, not the writing. */}
      <p
        className="min-h-[3.5rem] break-all font-mono text-[0.9rem] leading-[1.7]"
        aria-hidden="true"
      >
        {sweeping ? (
          <>
            <span className="text-accent">{cipherLine.slice(0, cut)}</span>
            <span className="text-ink/85">{sentence.slice(cut)}</span>
          </>
        ) : (
          /* No sweep to watch, so show the finished thing rather than the
             starting state. Cutting to `cut` here left the plaintext sitting
             under a caption describing an encryption that never visibly
             happened — the accommodation quietly turning the claim false. */
          <span className="text-accent">{blob ? blob.iv + blob.ciphertext : sentence}</span>
        )}
      </p>

      {/* The accessible text. Always the sentence, never the base64. */}
      <p className="sr-only">{sentence}</p>

      <p className="mt-6 text-xs leading-relaxed text-muted">
        {failed ? (
          <>
            This browser would not give the page a cipher, so nothing above was encrypted — and it
            says so rather than showing you scrambled characters and calling them proof.
          </>
        ) : (
          <>
            Those are real bytes: your sentence through AES-GCM, in this browser, just now.{' '}
            {sweeping ? (
              <>
                It is shown character for character so you can watch it happen, which means you
                are seeing the first {sentence.length} characters of the blob rather than all of
                it.
              </>
            ) : (
              <>That is the whole blob — initialisation vector and ciphertext.</>
            )}{' '}
            The key is a throwaway for this demo. In the journal it comes from one wallet
            signature, it never leaves your device, and Lumen never receives it.
          </>
        )}
      </p>
    </div>
  );
}
