'use client';

import { useEffect, useState } from 'react';
import { ZG_TESTNET } from '@lumen/shared';

import type { JournalMemory, ProofResult } from '@/lib/hooks/useJournalMemory';
import { CloseIcon, CloudCheckIcon } from './icons';

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-2 last:border-0">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <span className={`text-right text-sm text-ink ${mono ? 'break-all font-mono text-xs' : ''}`}>
        {value}
      </span>
    </div>
  );
}

/**
 * The storage receipt, plus the two judge-facing ownership proofs:
 * "Verify on 0G" (is the ciphertext really retrievable from the network?) and
 * "Prove I own it" (download it fresh and decrypt it right here).
 */
export function StorageReceiptViewer({
  memory,
  onClose,
}: {
  memory: JournalMemory;
  onClose: () => void;
}) {
  const receipt = memory.save.receipt;
  const [copied, setCopied] = useState(false);
  const [verify, setVerify] = useState<'idle' | 'checking' | 'found' | 'missing'>('idle');
  const [proof, setProof] = useState<ProofResult | 'working' | Error | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  if (!receipt) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="0G storage receipt"
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-border bg-surface p-6 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft text-accent">
              <CloudCheckIcon />
            </span>
            <div>
              <p className="font-serif text-lg leading-tight text-ink">Saved on 0G Storage</p>
              <p className="text-xs text-muted">Encrypted on your device · uploaded by your wallet</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full text-muted hover:text-ink"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="rounded-xl border border-border bg-canvas/50 px-4 py-1">
          <Field label="Memory root" value={receipt.rootHash} mono />
          {receipt.txHash ? <Field label="Storage tx" value={receipt.txHash} mono /> : null}
          <Field label="Snapshot #" value={String(receipt.seq)} />
          <Field label="Size (padded)" value={`${(receipt.paddedBytes / 1024).toFixed(1)} KiB`} />
          <Field label="Saved" value={new Date(receipt.savedAt).toLocaleString()} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(receipt.rootHash).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              });
            }}
            className="rounded-full border border-border px-3.5 py-1.5 text-xs font-medium text-muted hover:border-accent/40 hover:text-ink"
          >
            {copied ? 'Copied ✓' : 'Copy root hash'}
          </button>
          <button
            type="button"
            onClick={() => {
              setVerify('checking');
              memory
                .verifyOnZg()
                .then((found) => setVerify(found ? 'found' : 'missing'))
                .catch(() => setVerify('missing'));
            }}
            className="rounded-full border border-border px-3.5 py-1.5 text-xs font-medium text-muted hover:border-accent/40 hover:text-ink"
          >
            {verify === 'checking' ? 'Checking…' : 'Verify on 0G'}
          </button>
          <button
            type="button"
            onClick={() => {
              setProof('working');
              memory
                .proveOwnership()
                .then(setProof)
                .catch((err: Error) => setProof(err));
            }}
            className="rounded-full border border-accent/40 bg-accent-soft px-3.5 py-1.5 text-xs font-medium text-accent hover:border-accent"
          >
            {proof === 'working' ? 'Downloading…' : 'Prove I own it'}
          </button>
          {receipt.txHash && (
            <a
              href={`${ZG_TESTNET.explorerUrl}/tx/${receipt.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-border px-3.5 py-1.5 text-xs font-medium text-muted hover:border-accent/40 hover:text-ink"
            >
              View tx ↗
            </a>
          )}
        </div>

        {verify === 'found' && (
          <p className="mt-3 text-sm text-accent">
            The storage network is serving this root hash right now. ✓
          </p>
        )}
        {verify === 'missing' && (
          <p className="mt-3 text-sm text-caution">
            The indexer couldn&apos;t locate this root just now — finality can take a moment;
            try again shortly.
          </p>
        )}
        {proof !== null && proof !== 'working' && !(proof instanceof Error) && (
          <p className="mt-3 text-sm text-accent">
            Downloaded fresh from 0G and decrypted on this device: {proof.turnCount}{' '}
            {proof.turnCount === 1 ? 'entry' : 'entries'}, saved{' '}
            {new Date(proof.savedAt).toLocaleString()}. Only your key could do that. ✓
          </p>
        )}
        {proof instanceof Error && <p className="mt-3 text-sm text-caution">{proof.message}</p>}

        <p className="mt-4 rounded-xl border border-border bg-canvas/40 p-3 text-xs leading-relaxed text-muted">
          <span className="mb-1 block font-medium text-ink">What this means — honestly</span>
          This snapshot was encrypted on your device with a key only your wallet can derive, then
          uploaded and paid for by your wallet — Lumen never touched it and cannot read it. What
          is public: your address saved <em>something</em> of this (padded) size at this time.
          The content is not.
        </p>
      </div>
    </div>
  );
}
