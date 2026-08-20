'use client';

import { useEffect, useState } from 'react';

import { useModalFocus } from '@/lib/hooks/useModalFocus';

import { sameRoot, shortRoot } from '@/lib/0g/companion';
import { activeNetwork } from '@/lib/0g/network';
import type { Companion } from '@/lib/hooks/useCompanion';
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
  companion,
  onClose,
}: {
  memory: JournalMemory;
  companion: Companion;
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

  const panelRef = useModalFocus<HTMLDivElement>();

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
        ref={panelRef}
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
          <Field label="Network" value={activeNetwork().label} />
          <Field label="Memory root" value={receipt.rootHash} mono />
          {receipt.txHash ? <Field label="Storage tx" value={receipt.txHash} mono /> : null}
          <Field label="Snapshot #" value={String(receipt.seq)} />
          <Field label="Size (padded)" value={`${(receipt.paddedBytes / 1024).toFixed(1)} KiB`} />
          <Field label="Saved" value={new Date(receipt.savedAt).toLocaleString()} />
        </div>

        <AnchorSection companion={companion} receiptRoot={receipt.rootHash} />

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
              href={`${activeNetwork().explorerUrl}/tx/${receipt.txHash}`}
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

/** The on-chain half of the receipt: what the companion actually points at. */
function AnchorSection({
  companion,
  receiptRoot,
}: {
  companion: Companion;
  receiptRoot: string;
}) {
  const net = activeNetwork();
  const { state, tokenId, onChainRoot, anchorCount } = companion;

  if (state === 'unreadable') {
    return (
      <div className="mt-4 rounded-xl border border-border bg-canvas/40 px-3 py-2 text-xs text-muted">
        Couldn&apos;t reach {net.label} to check the anchor.{' '}
        <button type="button" onClick={() => void companion.refetch()} className="underline">
          Retry
        </button>
      </div>
    );
  }

  if (tokenId === null) {
    return (
      <p className="mt-4 rounded-xl border border-border bg-canvas/40 px-3 py-2 text-xs text-muted">
        Not minted yet — mint your companion from the strip below to anchor this root on-chain.
      </p>
    );
  }

  const matches = sameRoot(onChainRoot, receiptRoot);

  return (
    <>
      <div className="mt-4 rounded-xl border border-border bg-canvas/50 px-4 py-1">
        <Field label="Companion" value={`#${tokenId}`} />
        {companion.address && <Field label="Contract" value={companion.address} mono />}
        <Field label="Anchored root" value={onChainRoot ?? 'none yet'} mono={Boolean(onChainRoot)} />
        {/* Precisely true: anchorCount excludes the root minted with. */}
        <Field label="Anchors since mint" value={String(anchorCount ?? 0)} />
        <Field
          label="This receipt"
          value={matches ? 'Matches the anchored root ✓' : 'Different root — not anchored'}
        />
      </div>

      {companion.explorerContractUrl && (
        <p className="mt-2 text-xs">
          <a
            href={companion.explorerContractUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted underline hover:text-ink"
          >
            View contract ↗
          </a>
          {companion.tx.explorerTxUrl && (
            <>
              {' · '}
              <a
                href={companion.tx.explorerTxUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted underline hover:text-ink"
              >
                View last tx ↗
              </a>
            </>
          )}
        </p>
      )}

      <p className="mt-3 rounded-xl border border-border bg-canvas/40 p-3 text-xs leading-relaxed text-muted">
        <span className="mb-1 block font-medium text-ink">
          What the anchor proves — and what it doesn&apos;t
        </span>
        <b className="font-medium text-ink">Proves:</b> this wallet — and only the owner may
        anchor — published this exact root to LumenCompanion on {net.label} at a specific block.
        Every event names the root it replaced, so the whole history replays from the log with no
        gaps and nothing can be inserted or reordered. Lumen anchors through the contract&apos;s
        compare-and-swap call, so two of your devices can&apos;t silently clobber each other.{' '}
        <b className="font-medium text-ink">Doesn&apos;t prove:</b> that this is your newest
        snapshot. You can save without anchoring, and you can anchor an older root — the contract
        has no idea which is newer. A rollback becomes publicly <em>visible</em>; it does not become
        impossible. It also doesn&apos;t prove the snapshot is still retrievable — that&apos;s what
        &quot;Verify on 0G&quot; checks.
      </p>
    </>
  );
}
