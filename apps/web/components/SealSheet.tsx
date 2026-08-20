'use client';

import { useEffect } from 'react';

import { useModalFocus } from '@/lib/hooks/useModalFocus';

import { shortRoot } from '@/lib/0g/anchorHistory';
import type { SealAction, SealCost, SealPhase, SealPlan, UnsealedCount } from '@/lib/0g/seal';
import type { FundingRemedy as Remedy } from '@/lib/storage/saveErrorCopy';
import { FundingRemedy } from './FundingRemedy';
import { CloudCheckIcon, CloseIcon, CompanionIcon } from './icons';

/**
 * The seal ceremony.
 *
 * PRESENTATIONAL ONLY — plain props, no wagmi hooks, no context. That is a hard
 * requirement, not a preference: it is what lets this be render-tested under
 * node-env vitest. (MintCompanionSheet calls useChainGuard internally, which is
 * exactly why it has no render test.)
 *
 * The copy names the two signatures instead of smoothing them over. Two
 * separate contracts on two separate layers genuinely cannot be one prompt, and
 * a product whose whole claim is that its claims are checkable does not get to
 * be vague about the one part the user physically feels.
 */

export interface SealSheetProps {
  networkLabel: string;
  phase: SealPhase;
  plan: SealPlan;
  primaryAction: SealAction;
  cost: SealCost;
  unsealed: UnsealedCount;
  /** The root step 1 produced, once it has. */
  savedRoot: string | null;
  savedSeq: number | null;
  /** Explorer link for the anchor transaction, when there is one. */
  txUrl: string | null;
  /** Why the anchor cannot proceed, when it cannot. */
  preflightMessage: string | null;
  /** memory.save.error — step 1's failure. */
  saveErrorMessage: string | null;
  saveFundingRemedy: Remedy | null;
  /** companion.tx.failure — step 2's failure. */
  anchorErrorMessage: string | null;
  anchorFundingRemedy: Remedy | null;
  onPrimary: () => void;
  onClose: () => void;
}

function Step({
  n,
  label,
  what,
  done,
  active,
}: {
  n: number;
  label: string;
  what: string;
  done: boolean;
  active: boolean;
}) {
  return (
    <li className="flex gap-3">
      <span
        className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs ${
          done
            ? 'bg-accent text-[#fffdf8]'
            : active
              ? 'bg-accent-soft text-accent'
              : 'border border-border text-muted'
        }`}
      >
        {done ? '✓' : n}
      </span>
      <span>
        <b className="font-medium text-ink">{label}</b>
        <span className="block text-xs text-muted">{what}</span>
      </span>
    </li>
  );
}

function headline(phase: SealPhase, unsealed: UnsealedCount): string {
  switch (phase) {
    case 'saving':
      return 'Uploading your snapshot…';
    case 'armed':
      return 'One signature to go';
    case 'anchoring':
      return 'Pointing your companion…';
    case 'sealed':
      return 'Sealed';
    case 'already-sealed':
      return 'Already sealed';
    case 'save-failed':
      return 'The upload didn’t happen';
    case 'anchor-failed':
      return 'The chain step didn’t happen';
    case 'unavailable':
      return 'Lumen stopped here';
    default:
      if (unsealed.known && unsealed.entries > 0) {
        return `Seal ${unsealed.entries} ${unsealed.entries === 1 ? 'entry' : 'entries'}`;
      }
      return 'Seal your journal';
  }
}

export function SealSheet(props: SealSheetProps) {
  const {
    networkLabel,
    phase,
    plan,
    primaryAction,
    cost,
    unsealed,
    savedRoot,
    savedSeq,
    txUrl,
    preflightMessage,
    saveErrorMessage,
    saveFundingRemedy,
    anchorErrorMessage,
    anchorFundingRemedy,
    onPrimary,
    onClose,
  } = props;

  const busy = phase === 'saving' || phase === 'anchoring';

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const twoStep = plan.kind === 'save-then-anchor';
  const uploadDone = phase !== 'idle' && phase !== 'saving' && phase !== 'save-failed';
  /**
   * What is still to pay. Once the upload has succeeded its line must go: it sat
   * directly above the banner saying "That fee is spent", quoting a charge that
   * had already happened as though it were still owed.
   */
  const remainingCost = uploadDone ? cost.lines.slice(-1) : cost.lines;
  const terminal = phase === 'sealed' || phase === 'already-sealed';

  const primaryLabel =
    primaryAction === 'switch-chain'
      ? `Switch to ${networkLabel}`
      : primaryAction === 'close'
        ? 'Done'
        : primaryAction === 'save'
          ? twoStep
            ? 'Start — upload to 0G Storage'
            : 'Seal'
          : primaryAction === 'anchor'
            ? phase === 'anchor-failed'
              ? 'Try the chain step again'
              : 'Point your companion'
            : '';

  const panelRef = useModalFocus<HTMLDivElement>();

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={busy ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Seal your journal"
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-border bg-surface p-6 shadow-2xl sm:rounded-3xl"
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft text-accent">
              {terminal ? <CloudCheckIcon /> : <CompanionIcon />}
            </span>
            <div>
              <p className="font-serif text-lg leading-tight text-ink">{headline(phase, unsealed)}</p>
              <p className="text-xs text-muted">
                {plan.steps === 2
                  ? 'Two signatures'
                  : plan.steps === 1
                    ? 'One signature'
                    : 'On ' + networkLabel}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted hover:text-ink disabled:opacity-50"
          >
            <CloseIcon />
          </button>
        </div>

        {!terminal && phase !== 'unavailable' && (
          <ol className="space-y-3 text-sm leading-relaxed text-muted">
            {twoStep && (
              <Step
                n={1}
                label="Upload the encrypted snapshot to 0G Storage"
                what="Your wallet pays the storage fee. The bytes are encrypted on this device first — Lumen never sees them."
                done={uploadDone}
                active={phase === 'saving' || phase === 'idle' || phase === 'save-failed'}
              />
            )}
            <Step
              n={twoStep ? 2 : 1}
              label="Point your companion at it on 0G Chain"
              what="A second, cheaper signature that moves the on-chain pointer to this snapshot."
              // This list only renders before the terminal phases, so step 2 is
              // never done here — the 'sealed' state replaces the list entirely.
              done={false}
              active={phase === 'armed' || phase === 'anchoring' || phase === 'anchor-failed'}
            />
          </ol>
        )}

        {twoStep && !terminal && phase !== 'unavailable' && (
          <p className="mt-3 rounded-xl border border-border bg-canvas/40 p-3 text-xs leading-relaxed text-muted">
            Your wallet asks twice because 0G Storage and 0G Chain are two separate transactions.
            Lumen has no way to make that one prompt, and won&apos;t pretend otherwise.
          </p>
        )}

        {remainingCost.length > 0 && !terminal && phase !== 'unavailable' && (
          <div className="mt-3 rounded-xl border border-border bg-canvas/50 px-4 py-2">
            {remainingCost.map((line) => (
              <div
                key={line.label}
                className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2 last:border-0"
              >
                <span className="text-xs text-muted">{line.label}</span>
                <span className="text-right text-xs text-ink">{line.what}</span>
              </div>
            ))}
            <p className="py-2 text-[11px] leading-relaxed text-muted">{cost.deferral}</p>
          </div>
        )}

        {/* Step 1 succeeded. Say so plainly, and say what it means for a retry. */}
        {savedRoot && (phase === 'armed' || phase === 'anchoring' || phase === 'anchor-failed') && (
          <p className="mt-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-xs leading-relaxed text-ink">
            Your snapshot is on 0G Storage — <span className="font-mono">{shortRoot(savedRoot)}</span>
            {savedSeq !== null && `, snapshot #${savedSeq}`}. That fee is spent and Lumen will not
            upload it a second time; sealing again signs only the chain transaction.
          </p>
        )}

        {phase === 'sealed' && (
          <p className="text-sm leading-relaxed text-muted">
            Your companion now points at{' '}
            <span className="font-mono text-xs text-ink">{savedRoot ? shortRoot(savedRoot) : '—'}</span>
            . That commitment is a transaction in a block — nobody can back-date it or move it,
            and it reveals nothing about what you wrote.
          </p>
        )}

        {phase === 'already-sealed' && (
          <p className="text-sm leading-relaxed text-muted">
            Your companion already points at this snapshot, so there was nothing to send and nothing
            was spent.
          </p>
        )}

        {phase === 'unavailable' && (
          <p className="text-sm leading-relaxed text-muted">
            {preflightMessage ??
              'Lumen can’t confirm the state of this seal, so it won’t send a transaction it can’t stand behind. Nothing was lost.'}
          </p>
        )}

        {saveErrorMessage && phase === 'save-failed' && (
          <p className="mt-3 text-sm text-caution">
            {saveFundingRemedy ? <FundingRemedy remedy={saveFundingRemedy} /> : saveErrorMessage}
          </p>
        )}

        {anchorErrorMessage && phase === 'anchor-failed' && (
          <p className="mt-3 text-sm text-caution">
            {anchorFundingRemedy ? (
              <>
                Your snapshot is already on 0G Storage and that fee is spent — only the chain step
                needs funding. <FundingRemedy remedy={anchorFundingRemedy} />
              </>
            ) : (
              anchorErrorMessage
            )}
          </p>
        )}

        {preflightMessage && (phase === 'armed' || phase === 'anchor-failed') && (
          // Also in 'anchor-failed': the retry button renders there, and
          // seal.anchor() returns silently when preflight fails — the exact
          // silent no-op anchorPreflight was written to make impossible.
          <p className="mt-3 text-sm text-caution">{preflightMessage}</p>
        )}

        {primaryAction !== 'none' && (
          <button
            type="button"
            onClick={onPrimary}
            disabled={busy}
            className={`mt-5 w-full rounded-full px-4 py-2.5 text-sm font-medium disabled:opacity-50 ${
              primaryAction === 'switch-chain'
                ? 'border border-caution/50 bg-caution/10 text-caution hover:border-caution'
                : 'bg-accent text-[#fffdf8] hover:opacity-90'
            }`}
          >
            {primaryLabel}
          </button>
        )}

        {busy && (
          <p className="mt-3 text-center text-xs text-muted">
            {phase === 'saving' ? 'Confirm the upload in your wallet…' : 'Confirm in your wallet…'}
          </p>
        )}

        {txUrl && (phase === 'anchoring' || phase === 'sealed' || phase === 'anchor-failed') && (
          <p className="mt-2 text-center text-xs text-muted">
            <a href={txUrl} target="_blank" rel="noopener noreferrer" className="underline">
              View tx ↗
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
