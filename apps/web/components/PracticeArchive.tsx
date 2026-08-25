'use client';

import { useEffect } from 'react';

import { useModalFocus } from '@/lib/hooks/useModalFocus';

import { shortRoot, utcDay, type AnchorLink } from '@/lib/0g/anchorHistory';
import { longDate, practiceSummary } from '@/lib/0g/practice';
import type { AnchorArchive } from '@/lib/hooks/useAnchorArchive';
import { CloseIcon } from './icons';
import { PracticeGrid } from './PracticeGrid';

/**
 * Your own practice record, read from the chain in this browser.
 *
 * It uses the SAME reader and the SAME renderer as the public proof page
 * (`readAnchorLogs` → `buildAnchorChain` → `PracticeGrid`), which is what makes
 * the closing line honest: this is not Lumen's summary of your history, it is
 * the history, assembled the way a stranger would assemble it.
 *
 * A modal rather than a permanent panel, deliberately. A record you consult is
 * not a score you are shown, and putting a grid next to the composer would turn
 * the writing surface into a tracker — which is the streak failure mode wearing
 * different clothes.
 */
export function PracticeArchive({
  archive,
  networkLabel,
  explorerUrl,
  proofUrl,
  onClose,
}: {
  archive: AnchorArchive;
  networkLabel: string;
  explorerUrl: string;
  /** The public page for this companion — the same record, shareable. */
  proofUrl: string | null;
  onClose: () => void;
}) {
  // Refetch on open. The hook lives in Journal with a 60s staleTime, so without
  // this the modal could show an hour-old cache under a header claiming it was
  // read just now — an easy claim to make true rather than soften.
  const refetch = archive.refetch;
  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const { status, chain, calendar } = archive;
  // Newest first: the log is a record you scan backwards from now.
  const links: AnchorLink[] = chain ? [...chain.links].reverse() : [];

  const panelRef = useModalFocus<HTMLDivElement>();

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Your practice archive"
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-border bg-surface shadow-2xl sm:rounded-3xl"
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-6 pb-4 pt-6">
          <div>
            <p className="font-serif text-lg leading-tight text-ink">Your practice archive</p>
            <p className="text-xs text-muted">
              {status === 'loading' ? `Reading from ${networkLabel}…` : `Read from ${networkLabel}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted hover:text-ink"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {status === 'loading' && (
            <p className="text-sm text-muted">Reading your history from {networkLabel}…</p>
          )}

          {status === 'error' && (
            <div className="text-sm leading-relaxed text-muted">
              <p>
                {archive.partial
                  ? `Lumen could only read part of your history from ${networkLabel} — the contract reports more seals than the logs returned. Rather than show you a record it knows is incomplete, it's showing you nothing.`
                  : `Couldn't reach ${networkLabel} to read your archive just now, so Lumen isn't going to guess.`}
              </p>
              <button
                type="button"
                onClick={archive.refetch}
                className="mt-3 rounded-full border border-border px-3.5 py-1.5 text-xs font-medium text-muted hover:border-accent/40 hover:text-ink"
              >
                Retry
              </button>
            </div>
          )}

          {status === 'idle' && (
            <p className="text-sm leading-relaxed text-muted">
              Mint a companion and seal a snapshot, and the days you did it will appear here.
            </p>
          )}

          {status === 'ok' && calendar && (
            <>
              <PracticeGrid calendar={calendar} />
              {chain && chain.links.length > 0 && (
                <p
                  className={`mt-3 rounded-xl border px-4 py-2 text-xs leading-relaxed ${
                    chain.intact
                      ? 'border-accent/40 bg-accent-soft text-ink'
                      : 'border-caution/40 bg-caution/10 text-caution'
                  }`}
                >
                  {chain.intact ? (
                    <>
                      <b>Chain intact.</b> Every seal continues the previous root.
                    </>
                  ) : (
                    <>
                      <b>Chain broken at seal #{chain.brokenAtSeq}.</b> That anchor does not
                      continue the previous root.
                    </>
                  )}
                </p>
              )}
              <p className="mt-3 text-sm text-ink">{practiceSummary(calendar)}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                This is a record, not a score. Lumen doesn&apos;t count consecutive days,
                doesn&apos;t notice when you stop, and will never ask you to seal a week you
                didn&apos;t write in.
              </p>

              {links.length > 0 && (
                <section className="mt-6">
                  <h3 className="text-xs uppercase tracking-wide text-muted">Every seal</h3>
                  <ol className="mt-1">
                    {links.map((link) => (
                      <li
                        key={`${link.seq}-${link.txHash}`}
                        className="flex items-baseline justify-between gap-3 border-b border-border/60 py-2 last:border-0"
                      >
                        <span className="text-sm text-ink">
                          {link.timestamp > 0 ? longDate(utcDay(link.timestamp)) : 'date unread'}
                          <span className="ml-2 text-xs text-muted">#{link.seq}</span>
                        </span>
                        <a
                          href={`${explorerUrl}/tx/${link.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 font-mono text-xs text-muted underline hover:text-ink"
                        >
                          {shortRoot(link.newRoot)} ↗
                        </a>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              <section className="mt-6 rounded-xl border border-border bg-canvas/40 p-4 text-xs leading-relaxed text-muted">
                <p className="mb-1 font-medium text-ink">
                  What a sealed day proves — and what it doesn&apos;t
                </p>
                <p>
                  <b className="text-ink">Proves:</b> on each amber day this wallet signed a
                  transaction on {networkLabel} committing to one encrypted snapshot root, and that
                  transaction sits in a block with a timestamp the network agreed on. You cannot add
                  a day to this record later, and you cannot move one.
                </p>
                <p className="mt-2">
                  <b className="text-ink">Doesn&apos;t prove you wrote that day.</b> It proves you
                  sealed. You might have written for a week and sealed once. A blank day means no
                  seal — not no writing.
                </p>
                <p className="mt-2">
                  <b className="text-ink">Doesn&apos;t cover what you&apos;ve written since.</b>{' '}
                  Entries after your last seal exist only encrypted in this browser. They&apos;re on
                  no chain, and Lumen has no copy.
                </p>
                <p className="mt-2">
                  <b className="text-ink">Doesn&apos;t reveal a word of it.</b> Every seal publishes
                  32 bytes: a root hash of ciphertext. The key never leaves your device.
                </p>
              </section>
            </>
          )}
        </div>

        {proofUrl && (
          <div className="border-t border-border px-6 py-3">
            <a
              href={proofUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted hover:border-accent/40 hover:text-ink"
            >
              Public proof ↗
            </a>
            <span className="ml-2 text-[11px] text-muted">
              The same logs, the same reducer, the same grid — read there by a server instead of
              this browser. Anyone can open it, no wallet needed.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
