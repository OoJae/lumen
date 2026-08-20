'use client';

import { useMemo, useState } from 'react';

import {
  anchorPreflight,
  sealCost,
  sealNudge,
  sealPhase,
  sealPlan,
  sealPrimaryAction,
  unsealedEntries,
  type AnchorPreflight,
  type SealAction,
  type SealCost,
  type SealNudge,
  type SealPhase,
  type SealPlan,
  type SealRun,
  type UnsealedCount,
} from '@/lib/0g/seal';
import { activeNetwork } from '@/lib/0g/network';
import type { Companion } from './useCompanion';
import type { JournalMemory } from './useJournalMemory';
import { useAnchorArchive, type AnchorArchive } from './useAnchorArchive';
import { useChainGuard } from './useChainGuard';

/**
 * The seal — one action, two signatures, resumable.
 *
 * Every decision lives in lib/0g/seal.ts; this is the shell that holds one
 * `SealRun` and calls two async functions. That split is not stylistic: there
 * is no @testing-library/react in this repo, so a decision inside a hook is a
 * decision nothing can test.
 *
 * THE HAZARD THIS IS BUILT AROUND. `useCompanion(memory)` closes over the
 * `memory` object from the render that created it, and `anchor()` reads
 * `memory.save.receipt`. `useJournalMemory` updates its receipt ref by render
 * assignment. So this is wrong, and quietly so:
 *
 *     await memory.save.toZg();
 *     await companion.anchor();     // anchors the PREVIOUS root, or no-ops
 *
 * The fix is structural. `save()` records the root from the RESOLVED promise
 * into `run.savedRoot`, and the phase only becomes `'armed'` when the receipt
 * rendered in the current pass matches it. The anchor affordance is not
 * rendered before then, so the `companion.anchor` bound to its onClick always
 * comes from a render that already has the fresh receipt. The stale closure
 * isn't guarded against — it is unrepresentable.
 *
 * The handlers below are deliberately NOT wrapped in useCallback for the same
 * reason: a memoised handler is a closure from an older render.
 */
export interface Seal {
  /** Live gate — recomputed every render. The sheet uses the FROZEN one. */
  plan: SealPlan;
  /** The plan this run committed to, or the live one when idle. */
  activePlan: SealPlan;
  phase: SealPhase;
  primaryAction: SealAction;
  cost: SealCost;
  unsealed: UnsealedCount;
  nudge: SealNudge;
  preflight: AnchorPreflight;
  archive: AnchorArchive;
  run: SealRun | null;
  /** Open the sheet without starting anything — the user sees the two-signature
   *  disclosure and the cost before any wallet prompt. */
  open: boolean;
  begin(): void;
  close(): void;
  /** Step 1. Only reachable from 'idle' and 'save-failed'. */
  save(): Promise<void>;
  /** Step 2. Only reachable once the fresh receipt is in the rendered tree. */
  anchor(): Promise<void>;
  switchChain(): Promise<void>;
  dismissNudge(): void;
}

export function useSeal(memory: JournalMemory, companion: Companion): Seal {
  const net = activeNetwork();
  const guard = useChainGuard();
  const archive = useAnchorArchive(companion);

  const [run, setRun] = useState<SealRun | null>(null);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const receiptRoot = memory.save.receipt?.rootHash ?? null;
  const txInFlight = companion.tx.phase === 'signing' || companion.tx.phase === 'pending';
  const busy = memory.save.state === 'saving' || txInFlight || run !== null;

  const plan = sealPlan({
    companionState: companion.state,
    dirty: memory.save.dirty,
    hasReceipt: memory.save.receipt !== null,
    guardBlocked: guard.blocked,
    busy,
  });

  // The run's plan is FROZEN at start. The instant step 1 succeeds, `dirty`
  // flips false and the live plan collapses to anchor-only — a sheet reading it
  // would claim "one signature" immediately after the user gave one.
  const activePlan = run?.plan ?? plan;

  const phase = sealPhase({
    run,
    receiptRoot,
    walletNow: memory.wallet,
    tx: {
      phase: companion.tx.phase,
      action: companion.tx.action,
      anchoredRoot: companion.tx.anchoredRoot,
      failure: companion.tx.failure
        ? { kind: companion.tx.failure.kind, code: companion.tx.failure.code }
        : null,
    },
  });

  const preflight = anchorPreflight({
    contractConfigured: companion.address !== null,
    tokenIdKnown: companion.tokenId !== null,
    receiptRoot,
    savedRoot: run?.savedRoot ?? null,
    guardBlocked: guard.blocked,
  });

  const unsealed = unsealedEntries({
    companionState: companion.state,
    turnCount: memory.turns.length,
    deletionCount: memory.deletions.length,
    receipt: memory.save.receipt,
  });

  const nudge = sealNudge({
    plan,
    unsealed,
    daysSinceLastSeal: archive.daysSinceLastSeal,
    everSealed: archive.everSealed,
    dismissed,
  });

  const cost = useMemo(() => sealCost(activePlan, net.nativeCurrency.symbol), [activePlan, net]);
  const primaryAction = sealPrimaryAction(phase, activePlan, guard.blocked);

  function begin() {
    setOpen(true);
  }

  function close() {
    setOpen(false);
    // Keep the run while a signature is in flight or a step is still owed —
    // closing the sheet must not lose the fact that step 1 already cost money.
    if (phase === 'sealed' || phase === 'already-sealed' || phase === 'idle') {
      setRun(null);
    }
  }

  async function save(): Promise<void> {
    if (plan.kind === 'blocked') return;
    const frozen = plan;
    const wallet = memory.wallet;
    setRun({ plan: frozen, wallet, step: 'save', savedRoot: null, savedAt: null, seq: null });
    try {
      const receipt = await memory.save.toZg();
      // The root comes from the RESOLVED promise, never from a closure over
      // `memory.save.receipt`, which is a render behind at this point.
      setRun((prev) =>
        prev
          ? {
              ...prev,
              step: 'armed',
              savedRoot: receipt.rootHash,
              savedAt: receipt.savedAt,
              seq: receipt.seq,
            }
          : prev,
      );
    } catch {
      // toZg already recorded a structured error on memory.save.error and
      // re-threw; the sheet renders that rather than a second message.
      setRun((prev) => (prev ? { ...prev, step: 'save-failed' } : prev));
    }
  }

  async function anchor(): Promise<void> {
    // Mirrors useCompanion.anchor()'s guard, which returns SILENTLY — a user
    // who clicked and saw nothing happen would have no idea why.
    if (!preflight.ok) return;
    setRun((prev) =>
      prev
        ? { ...prev, step: 'anchor' }
        : {
            plan: activePlan,
            wallet: memory.wallet,
            step: 'anchor',
            // A one-step run anchors what is already on this device.
            savedRoot: receiptRoot,
            savedAt: memory.save.receipt?.savedAt ?? null,
            seq: memory.save.receipt?.seq ?? null,
          },
    );
    await companion.anchor();
    void archive.refetch();
  }

  async function switchChain(): Promise<void> {
    await guard.switchToExpected();
  }

  return {
    plan,
    activePlan,
    phase,
    primaryAction,
    cost,
    unsealed,
    nudge,
    preflight,
    archive,
    run,
    open,
    begin,
    close,
    save,
    anchor,
    switchChain,
    dismissNudge: () => setDismissed(true),
  };
}
