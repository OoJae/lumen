'use client';

import { useState } from 'react';

import type { FundingRemedy as Remedy } from '@/lib/storage/saveErrorCopy';

/**
 * Renders an "out of gas money" remedy consistently.
 *
 * Extracted deliberately: this is the third surface that needs it (save, mint,
 * anchor), and the copies had already diverged — one dropped the faucet link,
 * leaving testnet users with a sentence that ends "…grab some at" and nothing
 * after it. One renderer means every path shows the link when there is one and
 * the address when there isn't.
 */
export function FundingRemedy({ remedy }: { remedy: Remedy }) {
  const [copied, setCopied] = useState(false);

  return (
    <>
      {remedy.text}
      {remedy.link && (
        <>
          {' '}
          <a
            href={remedy.link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {remedy.link.label}
          </a>
          .
        </>
      )}
      {remedy.address && (
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(remedy.address!).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            });
          }}
          className="ml-1.5 rounded border border-caution/40 px-1.5 py-0.5 font-mono text-[11px] hover:border-caution"
        >
          {copied ? 'copied ✓' : remedy.address}
        </button>
      )}
    </>
  );
}
