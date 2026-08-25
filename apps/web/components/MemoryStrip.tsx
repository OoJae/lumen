'use client';

import { useState } from 'react';

import { shortRoot, TYPICAL_ANCHOR_COST } from '@/lib/0g/companion';
import { activeNetwork } from '@/lib/0g/network';
import type { Companion } from '@/lib/hooks/useCompanion';
import type { Seal } from '@/lib/hooks/useSeal';
import type { JournalMemory } from '@/lib/hooks/useJournalMemory';
import { useChainGuard } from '@/lib/hooks/useChainGuard';
import { insufficientFundsRemedy } from '@/lib/storage/saveErrorCopy';
import { refusalMessage } from '@/lib/crypto/unlockCopy';
import { emptiedNotice, restoreSkippedNotice } from '@/lib/storage/deleteCopy';
import { persistFailureNotice, undecryptableNotice } from '@/lib/crypto/unlockCopy';
import { foreignPointerNotice, pendingChanges, unsavedChangeNotice } from '@/lib/storage/saveStatus';
import { FundingRemedy } from './FundingRemedy';
import { CalendarIcon, CloudCheckIcon, CompanionIcon, KeyIcon, LockIcon } from './icons';
import { MintCompanionSheet } from './MintCompanionSheet';
import { OnboardingSheet } from './OnboardingSheet';
import { RecoveryKeyModal } from './RecoveryKeyModal';
import { StorageReceiptViewer } from './StorageReceiptViewer';

type OpenModal = 'onboarding' | 'receipt' | 'recovery' | 'mint' | null;

/**
 * The memory state surface under the composer: converts "Save & own", shows
 * the locked banner, and (unlocked) the honest sync chip + Save-to-0G action.
 */
export function MemoryStrip({
  memory,
  companion,
  seal,
  onOpenArchive,
}: {
  memory: JournalMemory;
  /** Owned by Journal and passed down, so ONE place holds the in-flight write
   *  state. Two useCompanion instances would mean two tx state machines. */
  companion: Companion;
  /** Also owned by Journal — the run has to outlive the sheet. */
  seal: Seal;
  onOpenArchive: () => void;
}) {
  const [open, setOpen] = useState<OpenModal>(null);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const { keyState, turns, lockedCount, save } = memory;
  const undecryptable = undecryptableNotice(memory.undecryptableCount);
  const persistFailure = persistFailureNotice(memory.persistFailureCount);
  const net = activeNetwork();
  const guard = useChainGuard();

  const modal = (
    <>
      {open === 'onboarding' && (
        <OnboardingSheet
          memory={memory}
          onClose={() => setOpen(null)}
          onExportKey={() => setOpen('recovery')}
        />
      )}
      {open === 'receipt' && (
        <StorageReceiptViewer
          memory={memory}
          companion={companion}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'recovery' && <RecoveryKeyModal memory={memory} onClose={() => setOpen(null)} />}
      {open === 'mint' && (
        <MintCompanionSheet
          memory={memory}
          companion={companion}
          onClose={() => {
            setOpen(null);
            // Closing mid-flight is fine — the chip keeps reporting it — but
            // resetting would cancel the receipt wait and re-offer a mint that
            // is already on its way, which then reverts AlreadyHasCompanion.
            const inFlight =
              companion.tx.phase === 'signing' || companion.tx.phase === 'pending';
            if (!inFlight) companion.reset();
          }}
        />
      )}
    </>
  );

  if (keyState === 'no-wallet') {
    if (turns.length === 0) return modal;
    return (
      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-accent/25 bg-accent-soft/40 px-4 py-3">
        <p className="text-sm text-ink">
          Keep this? Save your journal to 0G — encrypted on this device with a key only your
          wallet holds.
        </p>
        <button
          type="button"
          onClick={() => setOpen('onboarding')}
          className="shrink-0 rounded-full bg-accent px-3.5 py-1.5 text-sm font-medium text-[#fffdf8] hover:opacity-90"
        >
          Save &amp; own
        </button>
        {modal}
      </div>
    );
  }

  if (keyState === 'locked' || keyState === 'unlocking') {
    return (
      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3">
        <p className="flex items-center gap-2 text-sm text-muted">
          <LockIcon width={14} height={14} className="shrink-0" />
          {lockedCount > 0
            ? `${lockedCount} encrypted ${lockedCount === 1 ? 'entry' : 'entries'} on this device — sign to unlock.`
            : 'Sign to unlock your private memory on this device.'}
        </p>
        <button
          type="button"
          onClick={() => setOpen('onboarding')}
          disabled={keyState === 'unlocking'}
          className="shrink-0 rounded-full border border-accent/40 bg-accent-soft px-3.5 py-1.5 text-sm font-medium text-accent hover:border-accent disabled:opacity-50"
        >
          {keyState === 'unlocking' ? 'Check your wallet…' : 'Unlock'}
        </button>
        {modal}
      </div>
    );
  }

  if (keyState === 'mismatch') {
    return (
      <div className="mt-4 rounded-xl border border-caution/40 bg-caution/5 px-4 py-3">
        <p className="text-sm text-caution">
          {/* "Your data is intact" used to be hardcoded here. On the
              signature-mismatch-kcv path — the only one reachable on a device
              holding no ciphertext — that claim is simply false, which is why
              refusalMessage has a branch for it that carefully does not make it. */}
          {memory.keyRefusal
            ? refusalMessage(memory.keyRefusal)
            : 'This wallet signed differently than when your journal was encrypted (some smart-account wallets do). Unlock with your recovery key.'}
        </p>
        <button
          type="button"
          onClick={() => setOpen('onboarding')}
          className="mt-2 rounded-full border border-caution/50 px-3.5 py-1.5 text-sm font-medium text-caution hover:border-caution"
        >
          Use recovery key
        </button>
        {modal}
      </div>
    );
  }

  // unlocked
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2.5">
      {/* An unproven key, entries this key cannot open, and writes that failed —
          each is a thing the strip used to say nothing about while claiming
          "Encrypted on this device". */}
      {memory.keyNotice && (
        <div
          className={`w-full rounded-xl border px-3 py-2 text-xs leading-relaxed ${
            memory.keyNotice.tone === 'caution'
              ? 'border-caution/40 bg-caution/10 text-caution'
              : 'border-border bg-canvas/40 text-muted'
          }`}
        >
          <span className="block font-medium text-ink">{memory.keyNotice.title}</span>
          {memory.keyNotice.body}
          {/* The notice computes the one thing that turns an unproven key into a
              proven one, and this used to drop it on the floor — the same defect
              as the flag that chooses the notice. Both actions already have
              buttons elsewhere in the strip; this puts the right one where the
              sentence that asks for it is. */}
          {/* No inline button for 'restore': CompanionBlock already renders a
              dedicated restore panel — with its own progress and error surface —
              a few rows below, and a second entry point would fork that state.
              'export-key' has no such neighbour; its button is at the bottom of
              the strip, far from the sentence asking for it. */}
          {memory.keyNotice.action === 'export-key' && (
            <button
              type="button"
              onClick={() => setOpen('recovery')}
              className="mt-2 block rounded-full border border-border px-3 py-1 text-xs font-medium text-ink hover:border-accent/40"
            >
              Export your recovery key
            </button>
          )}
        </div>
      )}
      {undecryptable && (
        <p className="w-full rounded-xl border border-border bg-canvas/40 px-3 py-2 text-xs leading-relaxed text-muted">
          {undecryptable}
        </p>
      )}
      {persistFailure && (
        <p className="w-full rounded-xl border border-caution/40 bg-caution/10 px-3 py-2 text-xs leading-relaxed text-caution">
          {persistFailure}
        </p>
      )}

      <SyncChip memory={memory} onOpenReceipt={() => setOpen('receipt')} />
      {save.dirty &&
        (guard.blocked ? (
          // Pre-empt the failure rather than letting the user hit a wall: a
          // wrong-chain save can burn a fee on the wrong network.
          <button
            type="button"
            onClick={() => void guard.switchToExpected()}
            disabled={guard.status === 'switching'}
            className="inline-flex items-center gap-1.5 rounded-full border border-caution/50 bg-caution/10 px-3.5 py-1.5 text-xs font-medium text-caution hover:border-caution disabled:opacity-50"
          >
            {guard.status === 'switching'
              ? 'Check your wallet…'
              : `Switch to ${net.label} to save`}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void save.toZg().catch(() => {})}
            // Also disabled during a seal run: a save here would charge a second
            // upload fee and move the receipt off run.savedRoot, voiding the fee
            // already spent on step 1.
            disabled={save.state === 'saving' || seal.resumable || seal.plan.blocked === 'busy'}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-xs font-medium text-[#fffdf8] hover:opacity-90 disabled:opacity-50"
          >
            <CloudCheckIcon width={13} height={13} />
            {save.state === 'saving' ? 'Confirm in wallet…' : 'Save to 0G'}
          </button>
        ))}

      <CompanionChip
        companion={companion}
        onOpenReceipt={save.receipt ? () => setOpen('receipt') : null}
      />

      {companion.tokenId !== null && (
        <button
          type="button"
          onClick={onOpenArchive}
          title="The days this wallet sealed a snapshot, read from the chain. A record, not a score."
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted hover:border-accent/40 hover:text-ink"
        >
          <CalendarIcon width={13} height={13} />
          Archive
        </button>
      )}

      {/* The share surface. A companion nobody can check is just a claim — this
          link is the page where a stranger verifies it without a wallet. */}
      {companion.tokenId !== null && memory.wallet && (
        <a
          href={`/companion/${memory.wallet}`}
          target="_blank"
          rel="noopener noreferrer"
          title="A public page where anyone can verify this companion — no wallet needed. It shows the pointer, never your words."
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted hover:border-accent/40 hover:text-ink"
        >
          Public proof ↗
        </a>
      )}

      <CompanionBlock
        memory={memory}
        companion={companion}
        guard={guard}
        seal={seal}
        onMint={() => setOpen('mint')}
      />

      {/* This wallet's only snapshot is on the other network. Say exactly that —
          never let the chip or this notice imply it is anchored here. */}
      {save.foreignReceipt && (
        <p className="w-full rounded-xl border border-border bg-canvas/40 px-3 py-2 text-xs leading-relaxed text-muted">
          {foreignPointerNotice(net, save.foreignReceipt, turns.length)}
        </p>
      )}
      <button
        type="button"
        onClick={() => setOpen('recovery')}
        title="Export your recovery key"
        className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs text-muted hover:border-accent/40 hover:text-ink"
      >
        <KeyIcon width={12} height={12} />
        Recovery key
      </button>
      {save.state === 'error' && save.error && (
        <span className="w-full text-xs text-caution">
          {save.error.kind === 'insufficient-funds' ? (
            (() => {
              const remedy = insufficientFundsRemedy(net, memory.wallet);
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
                          setCopiedAddress(true);
                          setTimeout(() => setCopiedAddress(false), 1600);
                        });
                      }}
                      className="ml-1.5 rounded border border-caution/40 px-1.5 py-0.5 font-mono text-[11px] hover:border-caution"
                    >
                      {copiedAddress ? 'copied ✓' : remedy.address}
                    </button>
                  )}
                </>
              );
            })()
          ) : save.error.kind === 'wrong-chain' ? (
            <>
              {save.error.message}{' '}
              <button
                type="button"
                onClick={() => void guard.switchToExpected()}
                className="underline"
              >
                Switch to {net.label}
              </button>
            </>
          ) : (
            save.error.message
          )}
        </span>
      )}
      {modal}
    </div>
  );
}

function SyncChip({
  memory,
  onOpenReceipt,
}: {
  memory: JournalMemory;
  onOpenReceipt: () => void;
}) {
  const { save, turns, deletions } = memory;

  // Two helpers written to stop this chip telling a specific untruth, neither
  // of which it called. `unsavedChangeNotice` exists so a change that is purely
  // a deletion does not read as "new entries not yet saved" — the chip
  // hardcoded that exact string. `emptiedNotice` speaks for the 'emptied'
  // status, which syncStatus computes for the worst lie available here: the
  // device holds nothing, the snapshot still holds entries, and the chip says
  // the clean "Saved to 0G".
  const changes = pendingChanges(turns.length, deletions.length, save.receipt);
  const pending = unsavedChangeNotice(changes);

  if (save.state === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
        Saving to 0G…
      </span>
    );
  }
  if (save.receipt) {
    const short = `${save.receipt.rootHash.slice(0, 8)}…${save.receipt.rootHash.slice(-4)}`;
    return (
      <button
        type="button"
        onClick={onOpenReceipt}
        title={
          save.status === 'emptied' && save.receipt
            ? emptiedNotice(save.receipt)
            : 'View your 0G storage receipt'
        }
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
          save.dirty
            ? 'border-border text-muted hover:border-accent/40'
            : 'border-accent/40 bg-accent-soft text-accent'
        }`}
      >
        <CloudCheckIcon width={13} height={13} />
        {save.status === 'emptied'
          ? `On 0G: ${short} (this device is empty)`
          : save.dirty
            ? `On 0G: ${short}${pending ? ` (${pending})` : ''}`
            : `Saved to 0G · ${short}`}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted">
      <LockIcon width={12} height={12} />
      {turns.length > 0 ? 'Encrypted on this device' : 'Unlocked — write to begin'}
    </span>
  );
}

/** Names a token only in states where a read actually returned one. */
function CompanionChip({
  companion,
  onOpenReceipt,
}: {
  companion: Companion;
  /** null when there is no local receipt to show — the chip then isn't a button. */
  onOpenReceipt: (() => void) | null;
}) {
  const { state, tokenId, onChainRoot } = companion;

  if (state === 'minting' || state === 'anchoring') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
        {state === 'minting' ? 'Minting your companion…' : 'Updating your anchor…'}
      </span>
    );
  }

  if (state === 'unreadable') {
    return (
      <button
        type="button"
        onClick={() => void companion.refetch()}
        className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted hover:border-accent/40 hover:text-ink"
      >
        <CompanionIcon width={12} height={12} />
        Companion · couldn&apos;t check just now
      </button>
    );
  }

  if (tokenId === null) return null;

  const label =
    state === 'synced'
      ? `Companion #${tokenId} · anchored`
      : state === 'unanchored'
        ? `Companion #${tokenId} · no root anchored yet`
        : `Companion #${tokenId} · points at ${onChainRoot ? shortRoot(onChainRoot) : '—'}`;

  const title =
    state === 'synced'
      ? 'Your companion points at your latest saved snapshot.'
      : state === 'anchor-only'
        ? 'Your companion points at a snapshot that is not on this device yet.'
        : state === 'unanchored'
          ? 'Your companion has never pointed at a snapshot.'
          : 'Your companion points at a different snapshot than your latest save.';

  const className = `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs ${
    state === 'synced' ? 'border-accent/40 bg-accent-soft text-accent' : 'border-border text-muted'
  }`;

  // With no local receipt there is no receipt viewer to open, so render plain
  // text rather than a button that silently does nothing.
  if (!onOpenReceipt) {
    return (
      <span title={title} className={className}>
        <CompanionIcon width={13} height={13} />
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpenReceipt}
      title={title}
      className={`${className} transition-colors hover:border-accent/40`}
    >
      <CompanionIcon width={13} height={13} />
      {label}
    </button>
  );
}

/** The full-width companion notices: mint invitation, drift, restore-from-anchor. */
function CompanionBlock({
  memory,
  companion,
  guard,
  seal,
  onMint,
}: {
  memory: JournalMemory;
  companion: Companion;
  guard: ReturnType<typeof useChainGuard>;
  seal: Seal;
  onMint: () => void;
}) {
  const net = activeNetwork();
  const [restored, setRestored] = useState<number | null>(null);
  const [skippedDeleted, setSkippedDeleted] = useState(0);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const { state, tokenId, onChainRoot, tx } = companion;

  // companionFailure deliberately leaves `message` empty for funding failures so
  // the shared remedy (one faucet rule, link included) renders instead of the
  // blank line an empty message would produce.
  const txNotice =
    tx.failure && tx.phase !== 'idle' ? (
      <p className="w-full text-xs text-caution">
        {tx.failure.funding ? (
          <FundingRemedy
            remedy={insufficientFundsRemedy(net, memory.wallet, {
              cost: TYPICAL_ANCHOR_COST,
              what: 'anchor',
              retry: 'anchor again',
            })}
          />
        ) : (
          tx.failure.message
        )}
        {tx.explorerTxUrl && (tx.phase === 'reverted' || tx.phase === 'lost') && (
          <>
            {' '}
            <a
              href={tx.explorerTxUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              View tx ↗
            </a>
          </>
        )}
      </p>
    ) : null;

  /**
   * Routed through the seal gate rather than calling `companion.anchor()`
   * directly — which fixed a real bug. This button used to render enabled while
   * a save was in flight and while a previous tx was still pending: clicking it
   * mid-save anchored the PREVIOUS receipt for a real fee, and clicking twice
   * sent a second anchor that reverted. `sealPlan` reports `busy` in both
   * cases, so the button now disables itself.
   */
  const sealBlocked = seal.plan.kind === 'blocked';

  /**
   * 'diverged' keeps a DIRECT anchor, not the seal gate.
   *
   * sealPlan blocks 'diverged' on purpose — Lumen must not decide which root is
   * newer — but routing this button through the gate removed the user's only
   * way out of the fork and left a permanently greyed button with nothing
   * explaining it. Deciding is the user's to make; Lumen just must not make it
   * for them. Disabled only while something is actually in flight.
   */
  const divergedAnchor = guard.blocked ? (
    <button
      type="button"
      onClick={() => void guard.switchToExpected()}
      disabled={guard.status === 'switching'}
      className="shrink-0 rounded-full border border-caution/50 bg-caution/10 px-3.5 py-1.5 text-xs font-medium text-caution hover:border-caution disabled:opacity-50"
    >
      {guard.status === 'switching' ? 'Check your wallet…' : `Switch to ${net.label} to anchor`}
    </button>
  ) : (
    <button
      type="button"
      onClick={() => void companion.anchor()}
      disabled={seal.plan.blocked === 'busy'}
      title="Anchors the snapshot on this device. Lumen can't tell which root is newer, so this is your call."
      className="shrink-0 rounded-full bg-accent px-3.5 py-1.5 text-xs font-medium text-[#fffdf8] hover:opacity-90 disabled:opacity-50"
    >
      Anchor this device&apos;s save
    </button>
  );
  const sealInvite = (
    <button
      type="button"
      onClick={seal.begin}
      className="shrink-0 rounded-full bg-accent px-3.5 py-1.5 text-xs font-medium text-[#fffdf8] hover:opacity-90"
    >
      {seal.plan.steps === 2 ? 'Seal — 2 signatures' : 'Seal'}
    </button>
  );

  /** A run that already cost money must always have a way back to the sheet. */
  const resumeInvite = seal.resumable ? (
    <button
      type="button"
      onClick={seal.begin}
      className="shrink-0 rounded-full bg-accent px-3.5 py-1.5 text-xs font-medium text-[#fffdf8] hover:opacity-90"
    >
      Finish sealing
    </button>
  ) : null;
  const anchorAction = guard.blocked ? (
    <button
      type="button"
      onClick={() => void guard.switchToExpected()}
      disabled={guard.status === 'switching'}
      className="shrink-0 rounded-full border border-caution/50 bg-caution/10 px-3.5 py-1.5 text-xs font-medium text-caution hover:border-caution disabled:opacity-50"
    >
      {guard.status === 'switching' ? 'Check your wallet…' : `Switch to ${net.label} to anchor`}
    </button>
  ) : (
    <button
      type="button"
      onClick={seal.begin}
      disabled={sealBlocked}
      className="shrink-0 rounded-full bg-accent px-3.5 py-1.5 text-xs font-medium text-[#fffdf8] hover:opacity-90 disabled:opacity-50"
    >
      {seal.plan.blocked === 'busy' ? 'Working…' : 'Seal this save'}
    </button>
  );

  async function restoreFromAnchor() {
    if (!onChainRoot) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      const result = await memory.restoreFromRoot(onChainRoot);
      setRestored(result.restored);
      setSkippedDeleted(result.skippedDeleted);
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : 'Restore failed');
    } finally {
      setRestoring(false);
    }
  }

  const restoreButton = (
    <button
      type="button"
      onClick={() => void restoreFromAnchor()}
      disabled={restoring}
      className="shrink-0 rounded-full border border-accent/40 bg-accent-soft px-3.5 py-1.5 text-xs font-medium text-accent hover:border-accent disabled:opacity-50"
    >
      {restoring ? 'Downloading…' : 'Restore from your anchor'}
    </button>
  );

  function shell(body: React.ReactNode, action?: React.ReactNode) {
    return (
      <div className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-canvas/40 px-3 py-2">
        <p className="flex-1 text-xs leading-relaxed text-muted">{body}</p>
        {action}
        {restored !== null && (
          <p className="w-full text-xs text-accent">
            Restored {restored} {restored === 1 ? 'entry' : 'entries'} from your anchored snapshot. ✓
          </p>
        )}
        {restoreError && <p className="w-full text-xs text-caution">{restoreError}</p>}
        {txNotice}
      </div>
    );
  }

  switch (state) {
    case 'mintable':
      return (
        <div className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/25 bg-accent-soft/40 px-3 py-2">
          <p className="flex-1 text-xs leading-relaxed text-ink">
            Your journal is saved on 0G. Mint your companion to hold that pointer on-chain — one
            transaction, and the token never holds your words.
          </p>
          {guard.blocked ? (
            <button
              type="button"
              onClick={() => void guard.switchToExpected()}
              className="shrink-0 rounded-full border border-caution/50 bg-caution/10 px-3.5 py-1.5 text-xs font-medium text-caution hover:border-caution"
            >
              Switch to {net.label} to mint
            </button>
          ) : (
            <button
              type="button"
              onClick={onMint}
              className="shrink-0 rounded-full bg-accent px-3.5 py-1.5 text-xs font-medium text-[#fffdf8] hover:opacity-90"
            >
              Mint companion
            </button>
          )}
        </div>
      );

    case 'ahead':
      return shell(
        <>
          Your companion is anchored to the snapshot before this one. One transaction moves it to
          your latest save ({memory.save.receipt ? shortRoot(memory.save.receipt.rootHash) : '—'}) —
          typically about {TYPICAL_ANCHOR_COST} {net.nativeCurrency.symbol}.
        </>,
        anchorAction,
      );

    case 'diverged':
      return shell(
        <>
          Your companion points at {onChainRoot ? shortRoot(onChainRoot) : '—'}. Your latest save on
          this device is{' '}
          {memory.save.receipt ? shortRoot(memory.save.receipt.rootHash) : '—'}. Lumen can&apos;t
          tell which one is newer — it can only show you both.
        </>,
        <span className="flex shrink-0 gap-2">
          {divergedAnchor}
          {restoreButton}
        </span>,
      );

    case 'anchor-only':
      return shell(
        <>
          This wallet owns Companion #{String(tokenId)}, and it points at{' '}
          {onChainRoot ? shortRoot(onChainRoot) : '—'} on {net.label}. Nothing is saved on this
          device yet — restore it here and it decrypts with the key you just unlocked.
        </>,
        restoreButton,
      );

    case 'unanchored':
      return shell(
        memory.save.receipt ? (
          <>Your companion exists but has never pointed at a snapshot.</>
        ) : (
          <>
            Your companion exists but has never pointed at a snapshot. Save to 0G first, then
            anchor it.
          </>
        ),
        memory.save.receipt ? anchorAction : undefined,
      );

    case 'unreadable':
      return shell(
        <>
          Couldn&apos;t reach {net.label} to check your companion just now, so Lumen isn&apos;t
          going to guess.
        </>,
        <button
          type="button"
          onClick={() => void companion.refetch()}
          className="shrink-0 rounded-full border border-border px-3.5 py-1.5 text-xs font-medium text-muted hover:border-accent/40 hover:text-ink"
        >
          Retry
        </button>,
      );

    default:
      // synced / checking / minting / anchoring / nothing-to-mint / locked …
      // A successful restore lands here (the state advances to `synced`), so the
      // confirmation has to survive the transition instead of unmounting with
      // the branch that started it.
      if (restored !== null) {
        return shell(
          <>
            Your companion and this device are pointing at the same snapshot again.
            {skippedDeleted > 0 && ` ${restoreSkippedNotice(restored, skippedDeleted)}`}
          </>,
        );
      }
      // The strip-tier seal invite. This branch covers 'synced', where the block
      // otherwise renders nothing at all — and 'synced' with unsaved entries is
      // exactly the state where sealing is worth offering. `sealNudge` returns
      // 'none' for every blocked plan, so a clean journal still shows nothing.
      if (resumeInvite) {
        return shell(
          <>A seal you started isn&apos;t finished. Reopen it to see where it got to.</>,
          resumeInvite,
        );
      }
      // 'strip' only. 'raised' has its own banner in Journal, immediately below
      // this component, and admitting it here printed the same headline twice.
      if (seal.nudge.tier === 'strip' && seal.plan.kind !== 'blocked') {
        return shell(<>{seal.nudge.headline}</>, sealInvite);
      }
      return txNotice ? (
        <div className="flex w-full flex-wrap items-center gap-3 rounded-xl border border-border bg-canvas/40 px-3 py-2">
          {txNotice}
        </div>
      ) : null;
  }
}
