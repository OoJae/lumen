import { describe, expect, it } from 'vitest';

import type { StorageReceipt } from '@lumen/shared';

import type { CompanionState } from './companion';
import {
  anchorPreflight,
  RAISE_AT_DAYS,
  RAISE_AT_ENTRIES,
  sealBlockedNotice,
  sealCost,
  sealNudge,
  sealPhase,
  sealPlan,
  sealPrimaryAction,
  unsealedEntries,
  type SealPhase,
  type SealPlan,
  type SealPlanInput,
  type SealRun,
  type UnsealedCount,
} from './seal';

/** Every state in the union. The size assertion below makes adding one to
 *  CompanionState fail this file until the table is updated. */
const ALL_STATES: CompanionState[] = [
  'no-wallet',
  'locked',
  'unsupported',
  'checking',
  'unreadable',
  'nothing-to-mint',
  'mintable',
  'minting',
  'unanchored',
  'synced',
  'ahead',
  'diverged',
  'anchor-only',
  'anchoring',
];

const ROOT_A = '0x94f51264d5288f3359020eb37be3008445f0ca61591a414c46d814bdf6fd4e5d';
const ROOT_B = '0x1caeee295b94a8f28c09a19e32c243fa238f684476289f63bc06f1c2546eb6a2';

function plan(over: Partial<SealPlanInput> = {}): SealPlan {
  return sealPlan({
    companionState: 'synced',
    dirty: false,
    hasReceipt: true,
    guardBlocked: false,
    busy: false,
    ...over,
  });
}

function receipt(over: Partial<StorageReceipt> = {}): StorageReceipt {
  return {
    seq: 3,
    rootHash: ROOT_A,
    txHash: '0xtx',
    paddedBytes: 8192,
    turnCount: 5,
    savedAt: '2026-08-19T12:00:00.000Z',
    network: 'mainnet',
    deletionCount: 0,
    ...over,
  };
}

describe('the union is fully enumerated', () => {
  it('covers all 14 companion states', () => {
    expect(new Set(ALL_STATES).size).toBe(14);
  });
});

describe('sealPlan — the gate', () => {
  it('blocks every non-working state, whatever else is true', () => {
    const expected: Partial<Record<CompanionState, string>> = {
      'no-wallet': 'no-wallet',
      locked: 'locked',
      unsupported: 'unsupported',
      checking: 'checking',
      unreadable: 'unreadable',
      minting: 'busy',
      anchoring: 'busy',
      'nothing-to-mint': 'no-companion',
      mintable: 'mint-first',
      'anchor-only': 'nothing-local',
      diverged: 'diverged',
    };
    for (const [state, reason] of Object.entries(expected)) {
      for (const dirty of [false, true]) {
        for (const hasReceipt of [false, true]) {
          const p = plan({ companionState: state as CompanionState, dirty, hasReceipt });
          expect(p.kind, `${state} dirty=${dirty}`).toBe('blocked');
          expect(p.blocked, `${state} dirty=${dirty}`).toBe(reason);
        }
      }
    }
  });

  it('offers two signatures when there is something to save', () => {
    for (const state of ['synced', 'ahead', 'unanchored'] as CompanionState[]) {
      const p = plan({ companionState: state, dirty: true });
      expect(p.kind, state).toBe('save-then-anchor');
      expect(p.steps).toBe(2);
    }
  });

  it('offers one signature when a snapshot exists that the chain has not caught up to', () => {
    expect(plan({ companionState: 'ahead', dirty: false }).kind).toBe('anchor-only');
    expect(plan({ companionState: 'unanchored', dirty: false, hasReceipt: true }).kind).toBe(
      'anchor-only',
    );
  });

  it('blocks a synced, clean journal — the anti-busywork branch', () => {
    const p = plan({ companionState: 'synced', dirty: false });
    expect(p.kind).toBe('blocked');
    expect(p.blocked).toBe('nothing-new');
  });

  it('blocks unanchored with nothing saved and nothing new', () => {
    expect(plan({ companionState: 'unanchored', dirty: false, hasReceipt: false }).blocked).toBe(
      'nothing-new',
    );
  });

  it('blocks everything while busy, including states that would otherwise work', () => {
    for (const state of ALL_STATES) {
      expect(plan({ companionState: state, dirty: true, busy: true }).blocked).toBe('busy');
    }
  });

  it('never asks for a chain switch when there is nothing to do', () => {
    // Being on the wrong network is irrelevant if the answer is "no work".
    const p = plan({ companionState: 'synced', dirty: false, guardBlocked: true });
    expect(p.blocked).toBe('nothing-new');
    expect(p.blocked).not.toBe('wrong-chain');
  });

  it('asks for a chain switch only when real work exists', () => {
    expect(plan({ companionState: 'synced', dirty: true, guardBlocked: true }).blocked).toBe(
      'wrong-chain',
    );
  });
});

describe('sealBlockedNotice', () => {
  it('speaks only for wrong-chain — every other reason has its own surface', () => {
    const ctx = { networkLabel: '0G mainnet' };
    expect(sealBlockedNotice('wrong-chain', ctx)).toBe('Switch to 0G mainnet to seal.');
    for (const reason of [
      'busy',
      'no-wallet',
      'locked',
      'unsupported',
      'checking',
      'unreadable',
      'no-companion',
      'mint-first',
      'nothing-local',
      'diverged',
      'nothing-new',
    ] as const) {
      expect(sealBlockedNotice(reason, ctx), reason).toBeNull();
    }
  });
});

describe('unsealedEntries', () => {
  it('counts the delta against the anchored receipt when synced', () => {
    const u = unsealedEntries({
      companionState: 'synced',
      turnCount: 8,
      deletionCount: 0,
      receipt: receipt({ turnCount: 5 }),
    });
    expect(u).toEqual({ known: true, entries: 3, deletions: 0, basis: 'anchored-receipt' });
  });

  it('sees a delete-plus-add that a bare turn count cannot', () => {
    // 5 → 4 → 5: the count matches while the content differs.
    const u = unsealedEntries({
      companionState: 'synced',
      turnCount: 5,
      deletionCount: 1,
      receipt: receipt({ turnCount: 5, deletionCount: 0 }),
    });
    expect(u).toEqual({ known: true, entries: 1, deletions: 1, basis: 'anchored-receipt' });
  });

  it('treats everything as unsealed when nothing ever was', () => {
    for (const state of ['unanchored', 'mintable', 'nothing-to-mint'] as CompanionState[]) {
      const u = unsealedEntries({ companionState: state, turnCount: 4, deletionCount: 0, receipt: null });
      expect(u, state).toEqual({ known: true, entries: 4, deletions: 0, basis: 'never-sealed' });
    }
  });

  it('refuses to guess when ahead — the anchored snapshot is one we no longer hold', () => {
    const u = unsealedEntries({
      companionState: 'ahead',
      turnCount: 9,
      deletionCount: 0,
      receipt: receipt(),
    });
    expect(u).toEqual({ known: false, reason: 'no-anchor-baseline' });
  });

  it('refuses to guess when diverged', () => {
    expect(
      unsealedEntries({ companionState: 'diverged', turnCount: 9, deletionCount: 0, receipt: receipt() }),
    ).toEqual({ known: false, reason: 'diverged' });
  });

  it('is unknown for every state where the chain has not been read', () => {
    for (const state of ['checking', 'unreadable', 'locked', 'no-wallet', 'unsupported'] as CompanionState[]) {
      const u = unsealedEntries({ companionState: state, turnCount: 3, deletionCount: 0, receipt: receipt() });
      expect(u.known, state).toBe(false);
    }
  });
});

// ─── The invariants. These are the module's reason for existing. ────────────

const EVERY_UNSEALED: UnsealedCount[] = [
  { known: true, entries: 0, deletions: 0, basis: 'anchored-receipt' },
  { known: true, entries: 1, deletions: 0, basis: 'anchored-receipt' },
  { known: true, entries: 99, deletions: 3, basis: 'never-sealed' },
  { known: false, reason: 'no-anchor-baseline' },
  { known: false, reason: 'unreadable' },
  { known: false, reason: 'diverged' },
];
const EVERY_DAYS = [null, 0, 1, 2, 3, 7, 13, 14, 15, 30, 90, 365, 3650];
const EVERY_EVER: (boolean | null)[] = [true, false, null];

describe('INVARIANT: a blocked plan never nudges, at any elapsed time', () => {
  it('says nothing for a synced, clean journal however long it has been', () => {
    const blockedPlan = plan({ companionState: 'synced', dirty: false });
    expect(blockedPlan.blocked).toBe('nothing-new');
    for (const daysSinceLastSeal of EVERY_DAYS) {
      for (const everSealed of EVERY_EVER) {
        for (const unsealed of EVERY_UNSEALED) {
          const n = sealNudge({
            plan: blockedPlan,
            unsealed,
            daysSinceLastSeal,
            everSealed,
            dismissed: false,
          });
          expect(n.tier, `days=${daysSinceLastSeal}`).toBe('none');
          expect(n.headline).toBe('');
          expect(n.detail).toBeNull();
        }
      }
    }
  });

  it('holds for EVERY blocked plan across the whole input space', () => {
    for (const state of ALL_STATES) {
      for (const dirty of [false, true]) {
        for (const hasReceipt of [false, true]) {
          for (const guardBlocked of [false, true]) {
            for (const busy of [false, true]) {
              const p = sealPlan({ companionState: state, dirty, hasReceipt, guardBlocked, busy });
              if (p.kind !== 'blocked') continue;
              for (const daysSinceLastSeal of EVERY_DAYS) {
                for (const unsealed of EVERY_UNSEALED) {
                  expect(
                    sealNudge({ plan: p, unsealed, daysSinceLastSeal, everSealed: true, dismissed: false })
                      .tier,
                    `${state} ${p.blocked}`,
                  ).toBe('none');
                }
              }
            }
          }
        }
      }
    }
  });

  it('a dismissal silences an unblocked plan too', () => {
    const working = plan({ companionState: 'synced', dirty: true });
    expect(
      sealNudge({
        plan: working,
        unsealed: { known: true, entries: 50, deletions: 0, basis: 'anchored-receipt' },
        daysSinceLastSeal: 400,
        everSealed: true,
        dismissed: true,
      }).tier,
    ).toBe('none');
  });
});

describe('sealNudge — escalation is about volume, never about failure', () => {
  const working = plan({ companionState: 'synced', dirty: true });

  function nudge(unsealed: UnsealedCount, days: number | null = null, everSealed: boolean | null = true) {
    return sealNudge({ plan: working, unsealed, daysSinceLastSeal: days, everSealed, dismissed: false });
  }

  it('stays quiet in the strip for a small amount of work', () => {
    expect(nudge({ known: true, entries: 1, deletions: 0, basis: 'anchored-receipt' }).tier).toBe('strip');
  });

  it('raises at the entry threshold', () => {
    expect(
      nudge({ known: true, entries: RAISE_AT_ENTRIES - 1, deletions: 0, basis: 'anchored-receipt' }).tier,
    ).toBe('strip');
    expect(
      nudge({ known: true, entries: RAISE_AT_ENTRIES, deletions: 0, basis: 'anchored-receipt' }).tier,
    ).toBe('raised');
  });

  it('raises at the day threshold', () => {
    const small: UnsealedCount = { known: true, entries: 1, deletions: 0, basis: 'anchored-receipt' };
    expect(nudge(small, RAISE_AT_DAYS - 1).tier).toBe('strip');
    expect(nudge(small, RAISE_AT_DAYS).tier).toBe('raised');
  });

  it('names the count when it has one', () => {
    expect(nudge({ known: true, entries: 3, deletions: 0, basis: 'anchored-receipt' }).headline).toBe(
      '3 entries aren’t sealed yet.',
    );
    expect(nudge({ known: true, entries: 1, deletions: 0, basis: 'anchored-receipt' }).headline).toBe(
      '1 entry isn’t sealed yet.',
    );
  });

  it('uses the one permitted superlative only for a first seal', () => {
    const first = nudge({ known: true, entries: 2, deletions: 0, basis: 'never-sealed' }, null, false);
    expect(first.headline).toContain('Nothing here is sealed yet');
    const later = nudge({ known: true, entries: 2, deletions: 0, basis: 'anchored-receipt' }, null, true);
    expect(later.headline).not.toContain('Nothing here is sealed yet');
  });

  it('speaks about deletions when that is the only change', () => {
    const n = nudge({ known: true, entries: 0, deletions: 2, basis: 'anchored-receipt' });
    expect(n.headline).toContain('2 entries you deleted');
    expect(n.headline).toContain('still in your sealed snapshot');
  });
});

describe('INVARIANT: no number, and no clock, when we do not have one', () => {
  const working = plan({ companionState: 'synced', dirty: true });

  it('never mentions time when days-since is unknown', () => {
    for (const unsealed of EVERY_UNSEALED) {
      for (const everSealed of EVERY_EVER) {
        const n = sealNudge({
          plan: working,
          unsealed,
          daysSinceLastSeal: null,
          everSealed,
          dismissed: false,
        });
        const text = `${n.headline} ${n.detail ?? ''}`;
        expect(text, text).not.toMatch(/\b(day|days|week|weeks|since|ago)\b/i);
      }
    }
  });

  it('never states a bare count when the count is unknown', () => {
    for (const unsealed of EVERY_UNSEALED.filter((u) => !u.known)) {
      const n = sealNudge({
        plan: working,
        unsealed,
        daysSinceLastSeal: null,
        everSealed: true,
        dismissed: false,
      });
      expect(n.headline, n.headline).not.toMatch(/\b\d+\b/);
      expect(n.headline).toBe('Your latest save isn’t sealed yet.');
    }
  });
});

describe('INVARIANT: no streak, shame or daily-nag language', () => {
  const BANNED =
    /\b(streak|in a row|consecutive|missed|falling behind|owe|failed to|don'?t break|don’t break|keep it going|keep it up|every ?day|daily|goal|target|on track)\b/i;

  it('holds across every nudge the module can produce', () => {
    for (const state of ALL_STATES) {
      for (const dirty of [false, true]) {
        for (const hasReceipt of [false, true]) {
          const p = sealPlan({ companionState: state, dirty, hasReceipt, guardBlocked: false, busy: false });
          for (const unsealed of EVERY_UNSEALED) {
            for (const days of EVERY_DAYS) {
              for (const everSealed of EVERY_EVER) {
                const n = sealNudge({ plan: p, unsealed, daysSinceLastSeal: days, everSealed, dismissed: false });
                const text = `${n.headline} ${n.detail ?? ''}`;
                expect(text, text).not.toMatch(BANNED);
                expect(text, text).not.toMatch(/\p{Extended_Pictographic}/u);
              }
            }
          }
        }
      }
    }
  });
});

describe('INVARIANT: cost is named per signature and never totalled', () => {
  it('has exactly one line per step and always defers to the wallet', () => {
    for (const p of [plan({ dirty: true }), plan({ companionState: 'ahead', dirty: false })]) {
      const cost = sealCost(p, '0G');
      expect(cost.lines).toHaveLength(p.steps);
      expect(cost.deferral.toLowerCase()).toContain('your wallet shows the exact amount before you sign');
      for (const line of cost.lines) expect(line.typical).toMatch(/^\d+\.\d{3,5}$/);
    }
  });

  it('never presents a total or an equals sign', () => {
    for (const p of [plan({ dirty: true }), plan({ companionState: 'ahead', dirty: false }), plan()]) {
      const cost = sealCost(p, '0G');
      const text = [...cost.lines.map((l) => `${l.label} ${l.what}`), cost.deferral].join(' ');
      expect(text).not.toMatch(/\btotal\b|\ball in\b|=/i);
      // The sum of the two typicals must not appear as a figure.
      expect(text).not.toContain('0.00144');
    }
  });

  it('names both layers for a two-step plan', () => {
    const cost = sealCost(plan({ dirty: true }), '0G');
    expect(cost.lines[0]!.label).toMatch(/0G Storage/);
    expect(cost.lines[1]!.label).toMatch(/0G Chain/);
    expect(cost.lines[0]!.label).not.toBe(cost.lines[1]!.label);
  });

  it('shows only the anchor for a one-step plan', () => {
    const cost = sealCost(plan({ companionState: 'ahead', dirty: false }), '0G');
    expect(cost.lines).toHaveLength(1);
    expect(cost.lines[0]!.label).toMatch(/0G Chain/);
  });
});

describe('anchorPreflight — the silent no-op, named', () => {
  const ok = {
    contractConfigured: true,
    tokenIdKnown: true,
    receiptRoot: ROOT_A,
    savedRoot: ROOT_A,
    guardBlocked: false,
  };

  it('passes when everything holds', () => {
    expect(anchorPreflight(ok)).toEqual({ ok: true });
  });

  it('names each missing precondition', () => {
    // These mirror useCompanion.anchor()'s guard, which returns SILENTLY.
    expect(anchorPreflight({ ...ok, contractConfigured: false })).toMatchObject({ reason: 'no-contract' });
    expect(anchorPreflight({ ...ok, tokenIdKnown: false })).toMatchObject({ reason: 'no-token' });
    expect(anchorPreflight({ ...ok, receiptRoot: null })).toMatchObject({ reason: 'no-receipt' });
    expect(anchorPreflight({ ...ok, guardBlocked: true })).toMatchObject({ reason: 'wrong-chain' });
  });

  it('stops when the saved root moved underneath the run', () => {
    const out = anchorPreflight({ ...ok, receiptRoot: ROOT_B });
    expect(out).toMatchObject({ ok: false, reason: 'root-moved' });
  });

  it('compares roots case- and prefix-insensitively', () => {
    expect(anchorPreflight({ ...ok, receiptRoot: ROOT_A.toUpperCase().replace('0X', '0x') }).ok).toBe(true);
    expect(anchorPreflight({ ...ok, receiptRoot: ROOT_A.slice(2) }).ok).toBe(true);
  });

  it('never reports root-moved before a save has produced one', () => {
    expect(anchorPreflight({ ...ok, savedRoot: null, receiptRoot: ROOT_B }).ok).toBe(true);
  });
});

// ─── The phase reducer ──────────────────────────────────────────────────────

function run(over: Partial<SealRun> = {}): SealRun {
  return {
    plan: plan({ dirty: true }),
    wallet: '0xabc',
    step: 'anchor',
    savedRoot: ROOT_A,
    savedAt: '2026-08-19T12:00:00.000Z',
    seq: 4,
    ...over,
  };
}

function tx(over: Partial<SealPhaseTx> = {}): SealPhaseTx {
  return { phase: 'idle', action: 'anchor', anchoredRoot: null, failure: null, ...over };
}
type SealPhaseTx = Parameters<typeof sealPhase>[0]['tx'];

function phaseOf(overRun: Partial<SealRun>, overTx: Partial<SealPhaseTx> = {}, receiptRoot = ROOT_A): SealPhase {
  return sealPhase({ run: run(overRun), receiptRoot, walletNow: '0xabc', tx: tx(overTx) });
}

describe('sealPhase', () => {
  it('is idle with no run', () => {
    expect(sealPhase({ run: null, receiptRoot: null, walletNow: null, tx: tx() })).toBe('idle');
  });

  it('follows the run through step 1', () => {
    expect(phaseOf({ step: 'save' })).toBe('saving');
    expect(phaseOf({ step: 'save-failed' })).toBe('save-failed');
  });

  it('is armed once the fresh receipt matches what step 1 produced', () => {
    expect(phaseOf({ step: 'armed' }, {}, ROOT_A)).toBe('armed');
  });

  it('goes unavailable if another save landed underneath the run', () => {
    expect(phaseOf({ step: 'armed' }, {}, ROOT_B)).toBe('unavailable');
  });

  it('tracks the anchor transaction', () => {
    expect(phaseOf({}, { phase: 'signing' })).toBe('anchoring');
    expect(phaseOf({}, { phase: 'pending' })).toBe('anchoring');
    expect(phaseOf({}, { phase: 'confirmed', anchoredRoot: ROOT_A })).toBe('sealed');
  });

  it('reads a user rejection correctly — phase idle WITH a failure', () => {
    // useCompanion sets phase 'idle' (not 'failed') for a rejection. A naive
    // reducer reads that as "nothing happened" and loses the rejection.
    expect(phaseOf({}, { phase: 'idle', failure: { kind: 'rejected', code: 'rejected' } })).toBe(
      'anchor-failed',
    );
  });

  it('treats a pre-empted SameRoot as already sealed, not as a failure', () => {
    expect(phaseOf({}, { phase: 'idle', failure: { kind: 'revert', code: 'SameRoot' } })).toBe(
      'already-sealed',
    );
    expect(phaseOf({}, { phase: 'failed', failure: { kind: 'revert', code: 'SameRoot' } })).toBe(
      'already-sealed',
    );
  });

  it('maps the terminal failure phases', () => {
    for (const phase of ['reverted', 'lost', 'failed'] as const) {
      expect(phaseOf({}, { phase, failure: { kind: 'unknown', code: 'unknown' } }), phase).toBe(
        'anchor-failed',
      );
    }
  });

  it('never claims a seal for a root it cannot match', () => {
    expect(phaseOf({}, { phase: 'confirmed', anchoredRoot: ROOT_B })).toBe('unavailable');
  });

  it('goes unavailable when the tx belongs to a mint, not this seal', () => {
    expect(phaseOf({}, { phase: 'confirmed', action: 'mint', anchoredRoot: ROOT_A })).toBe('unavailable');
  });

  it('goes unavailable when the tx was reset out from under it', () => {
    expect(phaseOf({}, { phase: 'idle', failure: null })).toBe('unavailable');
  });

  it('discards the run when the wallet changed', () => {
    for (const step of ['save', 'save-failed', 'armed', 'anchor'] as const) {
      expect(
        sealPhase({ run: run({ step }), receiptRoot: ROOT_A, walletNow: '0xother', tx: tx() }),
        step,
      ).toBe('unavailable');
    }
  });
});

describe('INVARIANT: never re-upload once step 1 has succeeded', () => {
  const AFTER_STEP_ONE: SealPhase[] = [
    'armed',
    'anchoring',
    'sealed',
    'already-sealed',
    'anchor-failed',
    'unavailable',
  ];

  it('sealPrimaryAction never offers a save from any post-upload phase', () => {
    for (const phase of AFTER_STEP_ONE) {
      for (const p of [plan({ dirty: true }), plan({ companionState: 'ahead', dirty: false })]) {
        for (const guardBlocked of [false, true]) {
          expect(sealPrimaryAction(phase, p, guardBlocked), `${phase} ${p.kind}`).not.toBe('save');
        }
      }
    }
  });

  it('offers a save only from idle and save-failed', () => {
    const p = plan({ dirty: true });
    expect(sealPrimaryAction('idle', p, false)).toBe('save');
    expect(sealPrimaryAction('save-failed', p, false)).toBe('save');
  });

  it('offers the anchor directly for a one-step plan', () => {
    expect(sealPrimaryAction('idle', plan({ companionState: 'ahead', dirty: false }), false)).toBe('anchor');
  });

  it('routes to a chain switch instead of an action when the guard blocks', () => {
    for (const phase of ['idle', 'save-failed', 'armed', 'anchor-failed'] as SealPhase[]) {
      expect(sealPrimaryAction(phase, plan({ dirty: true }), true), phase).toBe('switch-chain');
    }
  });

  it('offers nothing while a signature is in flight', () => {
    expect(sealPrimaryAction('saving', plan({ dirty: true }), false)).toBe('none');
    expect(sealPrimaryAction('anchoring', plan({ dirty: true }), false)).toBe('none');
  });

  it('offers nothing at all for a blocked plan', () => {
    expect(sealPrimaryAction('idle', plan({ companionState: 'synced', dirty: false }), false)).toBe('none');
  });
});

describe('the submitting step — no transaction exists yet', () => {
  it('reads as anchoring, not as a failure', () => {
    // useCompanion.anchor() awaits an RPC read BEFORE send() touches tx state.
    // Without this step the reducer looked at the previous action's tx and
    // reported 'unavailable', so every anchor flashed "Lumen stopped here —
    // nothing was lost" while the wallet prompt was still being prepared.
    expect(phaseOf({ step: 'submitting' }, { phase: 'idle', action: null })).toBe('anchoring');
    expect(phaseOf({ step: 'submitting' }, { phase: 'confirmed', action: 'mint' })).toBe('anchoring');
    expect(
      phaseOf({ step: 'submitting' }, { phase: 'confirmed', action: 'anchor', anchoredRoot: ROOT_B }),
    ).toBe('anchoring');
  });

  it('offers no primary action while submitting, so a second click cannot fire', () => {
    expect(sealPrimaryAction('anchoring', plan({ dirty: true }), false)).toBe('none');
  });

  it('still discards a submitting run whose wallet changed', () => {
    expect(
      sealPhase({
        run: run({ step: 'submitting' }),
        receiptRoot: ROOT_A,
        walletNow: '0xother',
        tx: tx(),
      }),
    ).toBe('unavailable');
  });
});

describe('the deletion headline only claims a snapshot that exists', () => {
  const working = plan({ companionState: 'synced', dirty: true });

  it('speaks of a sealed snapshot on the anchored-receipt basis', () => {
    const n = sealNudge({
      plan: working,
      unsealed: { known: true, entries: 0, deletions: 2, basis: 'anchored-receipt' },
      daysSinceLastSeal: null,
      everSealed: true,
      dismissed: false,
    });
    expect(n.headline).toContain('still in your sealed snapshot');
  });

  it('does NOT when nothing has ever been sealed', () => {
    // On 'never-sealed' there is no sealed snapshot for them to be in, and
    // `deletions` is the device's all-time count rather than a delta.
    const n = sealNudge({
      plan: working,
      unsealed: { known: true, entries: 0, deletions: 2, basis: 'never-sealed' },
      daysSinceLastSeal: null,
      everSealed: false,
      dismissed: false,
    });
    expect(n.headline).not.toContain('sealed snapshot');
  });
});
