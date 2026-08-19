'use client';

import { useEffect } from 'react';

import { shortRoot, TYPICAL_MINT_COST } from '@/lib/0g/companion';
import { activeNetwork } from '@/lib/0g/network';
import type { Companion } from '@/lib/hooks/useCompanion';
import type { JournalMemory } from '@/lib/hooks/useJournalMemory';
import { useChainGuard } from '@/lib/hooks/useChainGuard';
import { insufficientFundsRemedy } from '@/lib/storage/saveErrorCopy';
import { FundingRemedy } from './FundingRemedy';
import { CloseIcon, CompanionIcon } from './icons';

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

function Beat({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
        {icon}
      </span>
      <span>{children}</span>
    </li>
  );
}

/**
 * The mint ceremony. One transaction both creates the companion and anchors the
 * root that was just saved — so the on-chain pointer is correct from the very
 * first block, and there is no second popup.
 */
export function MintCompanionSheet({
  memory,
  companion,
  onClose,
}: {
  memory: JournalMemory;
  companion: Companion;
  onClose: () => void;
}) {
  const net = activeNetwork();
  const guard = useChainGuard();
  const receipt = memory.save.receipt;
  const { tx } = companion;

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

  const busy = tx.phase === 'signing' || tx.phase === 'pending';
  const done = tx.phase === 'confirmed' && tx.mintedTokenId !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={busy ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Mint your companion"
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-border bg-surface p-6 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Closing while a mint is in flight is allowed — the chip keeps
            reporting it — but the parent must not reset the tx state. */}
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft text-accent">
              <CompanionIcon />
            </span>
            <div>
              <p className="font-serif text-lg leading-tight text-ink">
                {done ? 'Your companion is minted' : 'Mint your companion'}
              </p>
              <p className="text-xs text-muted">One transaction on {net.label}</p>
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

        {done ? (
          <>
            <p className="text-sm leading-relaxed text-muted">
              <span className="font-medium text-ink">Companion #{String(tx.mintedTokenId)}</span> is
              yours, minted on {net.label} and anchored to{' '}
              <span className="font-mono text-xs text-ink">
                {receipt ? shortRoot(receipt.rootHash) : '—'}
              </span>
              . Anyone can verify that at{' '}
              <span className="font-mono text-xs">lumen/companion/{memory.wallet?.slice(0, 6)}…</span>{' '}
              without a wallet — and see nothing you wrote.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {tx.explorerTxUrl && (
                <a
                  href={tx.explorerTxUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-border px-3.5 py-1.5 text-xs font-medium text-muted hover:border-accent/40 hover:text-ink"
                >
                  View tx ↗
                </a>
              )}
              {companion.explorerContractUrl && (
                <a
                  href={companion.explorerContractUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-border px-3.5 py-1.5 text-xs font-medium text-muted hover:border-accent/40 hover:text-ink"
                >
                  View contract ↗
                </a>
              )}
              <a
                href={`/companion/${memory.wallet}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-border px-3.5 py-1.5 text-xs font-medium text-muted hover:border-accent/40 hover:text-ink"
              >
                Public proof ↗
              </a>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full bg-accent px-3.5 py-1.5 text-xs font-medium text-[#fffdf8] hover:opacity-90"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <ol className="space-y-3 text-sm leading-relaxed text-muted">
              <Beat icon={<CompanionIcon width={14} height={14} />}>
                <b className="font-medium text-ink">It holds a pointer, not your words.</b> The
                token stores one 32-byte value: the 0G Storage root of the snapshot you just saved.
                Your entries stay encrypted under a key only your wallet derives — the chain
                can&apos;t read them, and neither can Lumen.
              </Beat>
              <Beat icon={<CompanionIcon width={14} height={14} />}>
                <b className="font-medium text-ink">One transaction does both.</b> Minting creates
                your companion <em>and</em> anchors this root to it at the same time. No second
                wallet popup.
              </Beat>
              <Beat icon={<CompanionIcon width={14} height={14} />}>
                <b className="font-medium text-ink">Not transferable yet — and the contract says
                so.</b> An ERC-7857 transfer has to re-encrypt your memory to the new owner through
                a TEE oracle. None is live, so LumenCompanion makes transfers revert instead of
                pretending. Your companion stays with this wallet.
              </Beat>
            </ol>

            <div className="mt-4 rounded-xl border border-border bg-canvas/50 px-4 py-1">
              <Field label="Network" value={net.label} />
              {companion.address && <Field label="Contract" value={companion.address} mono />}
              {receipt && <Field label="Anchoring root" value={receipt.rootHash} mono />}
              {receipt && (
                <Field
                  label="Snapshot"
                  value={`#${receipt.seq} · ${receipt.turnCount} ${receipt.turnCount === 1 ? 'entry' : 'entries'}`}
                />
              )}
              <Field
                label="Cost"
                value={`typically about ${TYPICAL_MINT_COST} ${net.nativeCurrency.symbol} in gas — your wallet shows the exact amount before you sign`}
              />
            </div>

            <p className="mt-3 text-xs leading-relaxed text-muted">
              Companions are per-network, like root hashes. This creates a companion on {net.label}{' '}
              only.
            </p>

            {guard.blocked ? (
              <button
                type="button"
                onClick={() => void guard.switchToExpected()}
                disabled={guard.status === 'switching'}
                className="mt-4 w-full rounded-full border border-caution/50 bg-caution/10 px-4 py-2.5 text-sm font-medium text-caution hover:border-caution disabled:opacity-50"
              >
                {guard.status === 'switching'
                  ? 'Check your wallet…'
                  : `Switch to ${net.label} to mint`}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void companion.mint()}
                disabled={busy || !receipt}
                className="mt-4 w-full rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-[#fffdf8] hover:opacity-90 disabled:opacity-50"
              >
                {tx.phase === 'signing'
                  ? 'Confirm in wallet…'
                  : tx.phase === 'pending'
                    ? 'Minting…'
                    : 'Mint companion'}
              </button>
            )}

            {tx.phase === 'pending' && tx.explorerTxUrl && (
              <p className="mt-2 text-center text-xs text-muted">
                <a href={tx.explorerTxUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  View tx ↗
                </a>
              </p>
            )}

            {tx.failure && (
              <p className="mt-3 text-sm text-caution">
                {tx.failure.funding ? (
                  <FundingRemedy
                    remedy={insufficientFundsRemedy(net, memory.wallet, {
                      cost: TYPICAL_MINT_COST,
                      what: 'mint',
                      retry: 'mint again',
                    })}
                  />
                ) : (
                  tx.failure.message
                )}
              </p>
            )}
            {tx.phase === 'reverted' && tx.explorerTxUrl && (
              <p className="mt-2 text-xs text-caution">
                <a href={tx.explorerTxUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  View the failed tx ↗
                </a>
              </p>
            )}

            <p className="mt-4 rounded-xl border border-border bg-canvas/40 p-3 text-xs leading-relaxed text-muted">
              <span className="mb-1 block font-medium text-ink">
                What this puts on a public chain — honestly
              </span>
              Your address, the time you minted, one 32-byte root hash, and a fixed public label
              that is byte-for-byte identical for every Lumen companion. Anyone can then see that
              this wallet owns a Lumen companion and which snapshot it points at. Nobody can read
              the snapshot. Anchoring proves you committed to this root at this time — it does not
              prove the root is your newest one. One companion per wallet is permanent, so if you
              want that link kept separate from your main address, mint from a dedicated wallet.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
