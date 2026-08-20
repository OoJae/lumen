/**
 * Sealing — committing what you've written to 0G, in two signatures.
 *
 * A seal is `toZg()` (upload the encrypted snapshot to 0G Storage) followed by
 * `anchorMemoryRoot` (point your companion at it on 0G Chain). Two different
 * contracts on two different layers; there is no batching primitive, so there
 * is no honest way to make it one wallet prompt. The product names them as two
 * rather than disguising them.
 *
 * EVERY decision lives here, pure, because the hooks above cannot be tested in
 * this repo (node-env vitest, no @testing-library/react). What is left in
 * useSeal is a `useState`, two async handlers and a `useMemo` over `sealPhase`.
 *
 * The anti-busywork problem is the reason this module is shaped the way it is.
 * `toZg()` will happily mint a fresh root from unchanged text — a new `seq` and
 * `createdAt` change the plaintext, so the ciphertext and the merkle root
 * change too. The app can therefore manufacture a transaction at any moment,
 * which is exactly the trap for a project judged partly on on-chain activity.
 * So `sealPlan` takes NO turn counts and NO elapsed time: the gate is purely
 * structural, and the nudge is a function OF the plan, which means no clock and
 * no counter can ever un-block it. That separation is what lets the archive
 * print "Lumen will never ask you to seal a week you didn't write in" as a fact.
 */
import type { StorageReceipt } from '@lumen/shared';

import { sameRoot } from './anchorHistory';
import { TYPICAL_ANCHOR_COST, type CompanionAction, type CompanionState } from './companion';
import { pendingChanges } from '../storage/saveStatus';
import { TYPICAL_SAVE_COST } from '../storage/saveErrorCopy';

// ─── The gate ───────────────────────────────────────────────────────────────

export type SealBlockedReason =
  | 'busy'
  | 'no-wallet'
  | 'locked'
  | 'unsupported'
  | 'checking'
  | 'unreadable'
  /** No companion yet and nothing saved to mint one from. */
  | 'no-companion'
  /** The mint ceremony anchors in a single transaction and owns that consent. */
  | 'mint-first'
  /** A companion exists but this device holds nothing to seal. */
  | 'nothing-local'
  /** Lumen cannot tell which root is newer, so it must not pick one. */
  | 'diverged'
  /** THE anti-busywork branch. */
  | 'nothing-new'
  | 'wrong-chain';

export interface SealPlanInput {
  companionState: CompanionState;
  /** memory.save.dirty */
  dirty: boolean;
  /** memory.save.receipt !== null — ACTIVE network only. */
  hasReceipt: boolean;
  /** useChainGuard().blocked */
  guardBlocked: boolean;
  /** A save is in flight, a companion tx is in flight, or a run is already open. */
  busy: boolean;
}

export type SealPlan =
  | { kind: 'save-then-anchor'; steps: 2; blocked: null }
  | { kind: 'anchor-only'; steps: 1; blocked: null }
  | { kind: 'blocked'; steps: 0; blocked: SealBlockedReason };

const SAVE_THEN_ANCHOR: SealPlan = { kind: 'save-then-anchor', steps: 2, blocked: null };
const ANCHOR_ONLY: SealPlan = { kind: 'anchor-only', steps: 1, blocked: null };

function blocked(reason: SealBlockedReason): SealPlan {
  return { kind: 'blocked', steps: 0, blocked: reason };
}

/**
 * Is there work, and how many signatures does it take?
 *
 * Evaluation order is the honesty guarantee, the same convention
 * `companionState` follows. Note `nothing-new` is decided BEFORE `guardBlocked`
 * so Lumen never asks anyone to switch networks for a no-op.
 */
export function sealPlan(input: SealPlanInput): SealPlan {
  const { companionState: state, dirty, hasReceipt, guardBlocked, busy } = input;

  if (busy) return blocked('busy');

  switch (state) {
    case 'no-wallet':
      return blocked('no-wallet');
    case 'locked':
      return blocked('locked');
    case 'unsupported':
      return blocked('unsupported');
    case 'checking':
      return blocked('checking');
    case 'unreadable':
      return blocked('unreadable');
    case 'minting':
    case 'anchoring':
      return blocked('busy');
    case 'nothing-to-mint':
      return blocked('no-companion');
    case 'mintable':
      return blocked('mint-first');
    case 'anchor-only':
      return blocked('nothing-local');
    case 'diverged':
      return blocked('diverged');
    default:
      break;
  }

  // Remaining: 'unanchored' | 'synced' | 'ahead'.
  let work: SealPlan;
  if (dirty) {
    work = SAVE_THEN_ANCHOR;
  } else if (state === 'ahead' || (state === 'unanchored' && hasReceipt)) {
    // A snapshot exists that the companion is not pointing at yet.
    work = ANCHOR_ONLY;
  } else {
    work = blocked('nothing-new');
  }

  if (work.kind === 'blocked') return work;
  return guardBlocked ? blocked('wrong-chain') : work;
}

/**
 * Copy for a blocked gate — deliberately silent for almost every reason.
 *
 * Every other blocked reason already has its own surface: `mintable` shows the
 * mint invitation, `diverged` shows the diverged notice, `unreadable` shows a
 * retry chip. Speaking again here would be nagging. The one exception is a
 * chain switch, which is a real action the user can take toward real work.
 */
export function sealBlockedNotice(
  reason: SealBlockedReason,
  ctx: { networkLabel: string },
): string | null {
  return reason === 'wrong-chain' ? `Switch to ${ctx.networkLabel} to seal.` : null;
}

// ─── How much is unsealed ───────────────────────────────────────────────────

export interface UnsealedInput {
  companionState: CompanionState;
  /** memory.turns.length */
  turnCount: number;
  /** memory.deletions.length */
  deletionCount: number;
  receipt: StorageReceipt | null;
}

export type UnsealedCount =
  | { known: true; entries: number; deletions: number; basis: 'anchored-receipt' | 'never-sealed' }
  | { known: false; reason: 'no-anchor-baseline' | 'unreadable' | 'diverged' };

/**
 * A tagged union rather than a number, because there are states where a number
 * would be a guess.
 *
 * The important one is `'ahead'`: the anchored root is the receipt's PREVIOUS
 * snapshot, whose turnCount this device no longer holds — the pointer was
 * overwritten by the newer save. We know the root and the seq, which are facts;
 * we do not know how many entries were in it. The copy degrades to naming the
 * root instead of inventing a count.
 */
export function unsealedEntries(input: UnsealedInput): UnsealedCount {
  const { companionState: state, turnCount, deletionCount, receipt } = input;

  switch (state) {
    case 'synced':
      if (!receipt) return { known: false, reason: 'unreadable' };
      // The receipt IS the anchored snapshot here, so pendingChanges gives
      // exactly the unsealed delta — including a delete-plus-add, which a bare
      // turnCount comparison cannot see.
      {
        const changed = pendingChanges(turnCount, deletionCount, receipt);
        return {
          known: true,
          entries: changed.added,
          deletions: changed.deleted,
          basis: 'anchored-receipt',
        };
      }
    case 'unanchored':
    case 'mintable':
    case 'nothing-to-mint':
      // Nothing has ever been sealed, so everything on this device is unsealed.
      return { known: true, entries: turnCount, deletions: deletionCount, basis: 'never-sealed' };
    case 'ahead':
    case 'anchor-only':
      return { known: false, reason: 'no-anchor-baseline' };
    case 'diverged':
      return { known: false, reason: 'diverged' };
    default:
      return { known: false, reason: 'unreadable' };
  }
}

// ─── The nudge ──────────────────────────────────────────────────────────────

export type NudgeTier = 'none' | 'strip' | 'raised';

/** Volume, not time — a statement about your writing, not about a calendar. */
export const RAISE_AT_ENTRIES = 5;
/** Long enough that it never reads as a daily habit tracker. */
export const RAISE_AT_DAYS = 14;

export interface SealNudgeInput {
  plan: SealPlan;
  unsealed: UnsealedCount;
  /** From the on-chain anchor history. null = Lumen has not read the chain. */
  daysSinceLastSeal: number | null;
  /** null = unknown. */
  everSealed: boolean | null;
  /** Session-only. */
  dismissed: boolean;
}

export interface SealNudge {
  tier: NudgeTier;
  /** '' when tier is 'none'. */
  headline: string;
  detail: string | null;
}

const NO_NUDGE: SealNudge = { tier: 'none', headline: '', detail: null };

function entriesWord(n: number): string {
  return `${n} ${n === 1 ? 'entry' : 'entries'}`;
}

/**
 * Whether to invite a seal, and how loudly.
 *
 * The first line is the whole anti-busywork guarantee: a blocked plan produces
 * no nudge, at any elapsed time, with any counts. Escalation depends on unsealed
 * WORK, and work implies an unblocked plan, so the tier can never rise on its
 * own as time passes.
 */
export function sealNudge(input: SealNudgeInput): SealNudge {
  const { plan, unsealed, daysSinceLastSeal, everSealed, dismissed } = input;
  if (plan.kind === 'blocked' || dismissed) return NO_NUDGE;

  const byVolume = unsealed.known && unsealed.entries >= RAISE_AT_ENTRIES;
  const byTime = daysSinceLastSeal !== null && daysSinceLastSeal >= RAISE_AT_DAYS;
  const tier: NudgeTier = byVolume || byTime ? 'raised' : 'strip';

  let headline: string;
  if (!unsealed.known) {
    // No baseline for a count. Say the true thing instead of a made-up number.
    headline = 'Your latest save isn’t sealed yet.';
  } else if (unsealed.entries === 0 && unsealed.deletions > 0 && unsealed.basis === 'anchored-receipt') {
    // Only on the anchored-receipt basis. On 'never-sealed' there IS no sealed
    // snapshot for them to be in, and `deletions` is this device's all-time
    // count rather than a delta — the sentence would be false twice over.
    headline = `${entriesWord(unsealed.deletions)} you deleted ${unsealed.deletions === 1 ? 'is' : 'are'} still in your sealed snapshot.`;
  } else if (everSealed === false) {
    // The one superlative this product permits anywhere is "first".
    headline = `Nothing here is sealed yet — ${entriesWord(unsealed.entries)}.`;
  } else {
    headline = `${entriesWord(unsealed.entries)} ${unsealed.entries === 1 ? 'isn’t' : 'aren’t'} sealed yet.`;
  }

  // Only speak about time when there is a real on-chain number for it. A
  // receipt's savedAt is this device's clock, not a seal time.
  const detail = byTime
    ? `Your last seal was ${daysSinceLastSeal} days ago.`
    : plan.kind === 'save-then-anchor'
      ? 'Sealing takes two signatures — one to upload, one to point your companion at it.'
      : 'One signature finishes it.';

  return { tier, headline, detail };
}

// ─── What it costs ──────────────────────────────────────────────────────────

export interface SealCostLine {
  label: string;
  /** Typical measured cost, as a decimal string. Never summed. */
  typical: string;
  what: string;
}

export interface SealCost {
  lines: SealCostLine[];
  deferral: string;
}

const DEFERRAL = 'Your wallet shows the exact amount before you sign — each time.';

/**
 * One line per signature, and deliberately NO total.
 *
 * Two typicals added together reads as a quote, and neither figure is a quote —
 * they are measured medians. `lines.length === plan.steps` is also the second
 * half of "named as two, not disguised": the cost display cannot claim fewer
 * transactions than the plan takes.
 */
export function sealCost(plan: SealPlan, symbol: string): SealCost {
  const upload: SealCostLine = {
    label: 'Upload to 0G Storage',
    typical: TYPICAL_SAVE_COST,
    what: `typically about ${TYPICAL_SAVE_COST} ${symbol}`,
  };
  const anchor: SealCostLine = {
    label: 'Point your companion on 0G Chain',
    typical: TYPICAL_ANCHOR_COST,
    what: `typically about ${TYPICAL_ANCHOR_COST} ${symbol}`,
  };

  if (plan.kind === 'save-then-anchor') return { lines: [upload, anchor], deferral: DEFERRAL };
  if (plan.kind === 'anchor-only') return { lines: [anchor], deferral: DEFERRAL };
  return { lines: [], deferral: DEFERRAL };
}

// ─── Preflight: turn a silent no-op into a named reason ──────────────────────

export interface AnchorPreflightInput {
  /** companion.address !== null */
  contractConfigured: boolean;
  /** companion.tokenId !== null — strictly stronger than useCompanion's own
   *  `hasToken`, because it also requires reads.status === 'ok'. */
  tokenIdKnown: boolean;
  /** memory.save.receipt?.rootHash ?? null */
  receiptRoot: string | null;
  /** The root step 1 actually produced, from the resolved promise. */
  savedRoot: string | null;
  guardBlocked: boolean;
}

export type AnchorPreflight =
  | { ok: true }
  | {
      ok: false;
      reason: 'no-contract' | 'no-token' | 'no-receipt' | 'root-moved' | 'wrong-chain';
      message: string;
    };

/**
 * Mirrors `useCompanion.anchor()`'s guard (`!contract || !receipt || !hasToken`),
 * which returns SILENTLY — no state change, no failure recorded. A user who
 * clicked and saw nothing happen would have no idea why. Checking the same
 * conditions here, with the stronger public fields, makes that unreachable.
 */
export function anchorPreflight(input: AnchorPreflightInput): AnchorPreflight {
  if (!input.contractConfigured) {
    return {
      ok: false,
      reason: 'no-contract',
      message: 'No Lumen companion contract is configured for this network.',
    };
  }
  if (!input.tokenIdKnown) {
    return {
      ok: false,
      reason: 'no-token',
      message:
        "Lumen can't confirm this wallet owns a companion right now, so it won't send a transaction that would fail.",
    };
  }
  if (!input.receiptRoot) {
    return {
      ok: false,
      reason: 'no-receipt',
      message:
        "Lumen can't see a saved snapshot on this device, so there is nothing to point your companion at.",
    };
  }
  if (input.savedRoot && !sameRoot(input.receiptRoot, input.savedRoot)) {
    return {
      ok: false,
      reason: 'root-moved',
      message:
        'Your saved snapshot changed since this seal started, so Lumen stopped rather than anchor the wrong one.',
    };
  }
  if (input.guardBlocked) {
    return { ok: false, reason: 'wrong-chain', message: 'Your wallet is on a different network.' };
  }
  return { ok: true };
}

// ─── The run, and the phase reducer ─────────────────────────────────────────

export type SealStep =
  | 'save'
  | 'save-failed'
  | 'armed'
  /**
   * The click happened; the transaction does not exist yet.
   *
   * `useCompanion.anchor()` awaits a fresh `rootRead.refetch()` — a real RPC
   * round-trip, with retries — BEFORE `send()` touches tx state. Without this
   * step the reducer looked at whatever the LAST action left behind and
   * reported 'unavailable': every anchor flashed "Lumen stopped here — nothing
   * was lost" while the wallet prompt was still being prepared, and left the
   * button live for a second click that would send a second transaction.
   */
  | 'submitting'
  | 'anchor';

export interface SealRun {
  /** FROZEN at start. The moment step 1 succeeds the LIVE plan becomes
   *  anchor-only, and a sheet reading it would claim "one signature" straight
   *  after the user had already given one. */
  plan: SealPlan;
  /** The run belongs to this wallet; a switch invalidates it. */
  wallet: string | null;
  step: SealStep;
  /** From the RESOLVED promise of toZg(), never from a closure. */
  savedRoot: string | null;
  savedAt: string | null;
  seq: number | null;
}

export type SealPhase =
  | 'idle'
  | 'saving'
  | 'save-failed'
  | 'armed'
  | 'anchoring'
  | 'sealed'
  | 'already-sealed'
  | 'anchor-failed'
  | 'unavailable';

export interface SealPhaseInput {
  run: SealRun | null;
  /** memory.save.receipt?.rootHash ?? null, from the CURRENT render. */
  receiptRoot: string | null;
  walletNow: string | null;
  tx: {
    phase: 'idle' | 'signing' | 'pending' | 'confirmed' | 'reverted' | 'lost' | 'failed';
    action: CompanionAction | null;
    anchoredRoot: string | null;
    failure: { kind: string; code: string } | null;
  };
}

/**
 * Derive the phase. The anchor half is read out of `companion.tx` rather than
 * mirrored into local state — useCompanion owns that machine, and a mirror is a
 * second source of truth that can disagree with the chain.
 */
export function sealPhase(input: SealPhaseInput): SealPhase {
  const { run, receiptRoot, walletNow, tx } = input;
  if (!run) return 'idle';
  if (run.wallet !== walletNow) return 'unavailable';

  if (run.step === 'save') return 'saving';
  if (run.step === 'save-failed') return 'save-failed';

  // Between the click and send(). No tx to read yet, and that is expected.
  if (run.step === 'submitting') return 'anchoring';

  if (run.step === 'armed') {
    // The armed state is only meaningful while the receipt still matches what
    // step 1 produced. If another save landed underneath, say so.
    if (run.savedRoot && !sameRoot(receiptRoot, run.savedRoot)) return 'unavailable';
    return 'armed';
  }

  // run.step === 'anchor'
  if (tx.action !== 'anchor') return 'unavailable';

  switch (tx.phase) {
    case 'signing':
    case 'pending':
      return 'anchoring';
    case 'confirmed':
      // Never claim a seal we cannot match to the root we saved.
      return run.savedRoot && !sameRoot(tx.anchoredRoot, run.savedRoot) ? 'unavailable' : 'sealed';
    case 'reverted':
    case 'lost':
    case 'failed':
      return tx.failure?.code === 'SameRoot' ? 'already-sealed' : 'anchor-failed';
    case 'idle':
      // A user rejection lands here WITH a failure — useCompanion sets phase
      // 'idle' for 'rejected' rather than 'failed'. Reading this as "back to
      // idle" would silently lose the rejection.
      if (tx.failure) {
        return tx.failure.code === 'SameRoot' ? 'already-sealed' : 'anchor-failed';
      }
      return 'unavailable';
    default:
      return 'unavailable';
  }
}

export type SealAction = 'save' | 'anchor' | 'switch-chain' | 'close' | 'none';

/**
 * The primary button for a phase.
 *
 * This is where "never re-upload on retry" becomes machine-checkable: `'save'`
 * is returned ONLY from `idle` and `save-failed` — never from any phase
 * reachable after step 1 succeeded. A second upload would cost another fee and
 * produce a third root, adding a pointless link to a chain whose entire value
 * is that it is legible.
 */
export function sealPrimaryAction(
  phase: SealPhase,
  plan: SealPlan,
  guardBlocked: boolean,
): SealAction {
  switch (phase) {
    case 'idle':
      // 'wrong-chain' is the one blocked reason with a real action behind it —
      // the same reason sealBlockedNotice speaks for it and stays silent for
      // every other. Returning 'none' here left the sheet with no button at all.
      if (plan.kind === 'blocked') return plan.blocked === 'wrong-chain' ? 'switch-chain' : 'none';
      if (guardBlocked) return 'switch-chain';
      return plan.kind === 'save-then-anchor' ? 'save' : 'anchor';
    case 'save-failed':
      return guardBlocked ? 'switch-chain' : 'save';
    case 'armed':
      return guardBlocked ? 'switch-chain' : 'anchor';
    case 'anchor-failed':
      return guardBlocked ? 'switch-chain' : 'anchor';
    case 'saving':
    case 'anchoring':
      return 'none';
    case 'sealed':
    case 'already-sealed':
    case 'unavailable':
      return 'close';
    default:
      return 'none';
  }
}
