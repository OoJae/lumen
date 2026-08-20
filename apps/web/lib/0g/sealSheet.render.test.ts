/**
 * Renders SealSheet for real and asserts the honesty rules in the output.
 *
 * The reducer tests in seal.test.ts prove the DECISIONS are right. These prove
 * the rendered markup keeps them — that the two signatures are actually named,
 * that no branch quotes a total, and above all that the failure branch after a
 * successful upload offers no way to upload again.
 *
 * `.ts` not `.tsx` so it sits inside vitest's `lib/**\/*.test.ts` include;
 * createElement avoids needing JSX here. SealSheet takes plain props and calls
 * no wagmi hooks, which is what makes this possible at all.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SealSheet, type SealSheetProps } from '../../components/SealSheet';
import { sealCost, sealPlan, sealPrimaryAction, type SealPhase, type SealPlan } from './seal';

const ROOT = '0x94f51264d5288f3359020eb37be3008445f0ca61591a414c46d814bdf6fd4e5d';

const TWO_STEP: SealPlan = sealPlan({
  companionState: 'synced',
  dirty: true,
  hasReceipt: true,
  guardBlocked: false,
  busy: false,
});
const ONE_STEP: SealPlan = sealPlan({
  companionState: 'ahead',
  dirty: false,
  hasReceipt: true,
  guardBlocked: false,
  busy: false,
});

function render(over: Partial<SealSheetProps> = {}): string {
  const plan = over.plan ?? TWO_STEP;
  const phase: SealPhase = over.phase ?? 'idle';
  const props: SealSheetProps = {
    networkLabel: '0G mainnet',
    phase,
    plan,
    primaryAction: sealPrimaryAction(phase, plan, false),
    cost: sealCost(plan, '0G'),
    unsealed: { known: true, entries: 3, deletions: 0, basis: 'anchored-receipt' },
    savedRoot: null,
    savedSeq: null,
    txUrl: null,
    preflightMessage: null,
    saveErrorMessage: null,
    saveFundingRemedy: null,
    anchorErrorMessage: null,
    anchorFundingRemedy: null,
    onPrimary: () => {},
    onClose: () => {},
    ...over,
  };
  return renderToStaticMarkup(createElement(SealSheet, props));
}

const ALL_PHASES: SealPhase[] = [
  'idle',
  'saving',
  'save-failed',
  'armed',
  'anchoring',
  'sealed',
  'already-sealed',
  'anchor-failed',
  'unavailable',
];

describe('the two signatures are named, not disguised', () => {
  it('says two signatures and names both layers for a two-step plan', () => {
    const html = render({ plan: TWO_STEP });
    expect(html).toContain('Two signatures');
    expect(html).toContain('0G Storage');
    expect(html).toContain('0G Chain');
    expect(html).toContain('two separate transactions');
    expect(html).toContain('won&#x27;t pretend otherwise');
  });

  it('states the limit as Lumen\'s, not as a fact about the world', () => {
    // The storage submit and the anchor are both ordinary EVM transactions from
    // the same wallet to the same chain, so batching them is possible in
    // principle (EIP-5792, a smart account, a multicall wrapper). What is true
    // is that LUMEN cannot do it — claiming nobody could was an overclaim.
    const html = render({ plan: TWO_STEP });
    expect(html).not.toContain('There is no way to do it in one');
    expect(html).toContain('Lumen has no way to make that one prompt');
  });

  it('says one signature for a one-step plan and does not mention an upload step', () => {
    const html = render({ plan: ONE_STEP });
    expect(html).toContain('One signature');
    expect(html).not.toContain('Upload the encrypted snapshot');
    expect(html).not.toContain('two separate transactions');
  });

  it('renders one cost line per signature', () => {
    const two = render({ plan: TWO_STEP });
    const one = render({ plan: ONE_STEP });
    expect((two.match(/typically about/g) ?? []).length).toBe(2);
    expect((one.match(/typically about/g) ?? []).length).toBe(1);
  });
});

describe('INVARIANT: never offer a re-upload once step 1 has succeeded', () => {
  const AFTER_UPLOAD: SealPhase[] = ['armed', 'anchoring', 'anchor-failed', 'sealed', 'already-sealed'];

  it('renders no save or upload affordance in any post-upload phase', () => {
    for (const phase of AFTER_UPLOAD) {
      const plan = TWO_STEP;
      const html = render({
        phase,
        plan,
        savedRoot: ROOT,
        savedSeq: 4,
        anchorErrorMessage: phase === 'anchor-failed' ? 'The transaction was rejected.' : null,
      });
      // The button label is the only thing that could start step 1 again.
      expect(html, phase).not.toContain('Start — upload to 0G Storage');
      expect(html, phase).not.toMatch(/>Save to 0G</);
      expect(html, phase).not.toMatch(/>Save again</);
    }
  });

  it('states the rule to the user on a step-2 failure', () => {
    const html = render({
      phase: 'anchor-failed',
      savedRoot: ROOT,
      savedSeq: 4,
      anchorErrorMessage: 'The transaction was rejected.',
    });
    expect(html).toContain('will not upload it a second time');
    expect(html).toContain('sealing again signs only the chain transaction');
  });

  it('names the root that was already paid for', () => {
    const html = render({ phase: 'armed', savedRoot: ROOT, savedSeq: 4 });
    expect(html).toContain('0x94f51264…f6fd4e5d');
    expect(html).toContain('snapshot #4');
    expect(html).toContain('That fee is spent');
  });
});

describe('INVARIANT: no branch quotes a total', () => {
  it('never sums the two typicals or uses total language', () => {
    for (const phase of ALL_PHASES) {
      for (const plan of [TWO_STEP, ONE_STEP]) {
        const html = render({ phase, plan, savedRoot: ROOT, savedSeq: 4 });
        expect(html, phase).not.toContain('0.00144');
        expect(html, phase).not.toMatch(/\btotal\b|\ball in\b/i);
      }
    }
  });

  it('always defers the exact amount to the wallet wherever a cost is shown', () => {
    for (const plan of [TWO_STEP, ONE_STEP]) {
      const html = render({ plan });
      expect(html).toContain('Your wallet shows the exact amount before you sign');
    }
  });
});

describe('INVARIANT: no streak, shame or nagging language anywhere', () => {
  const BANNED =
    /\b(streak|in a row|consecutive|missed|falling behind|owe|failed to|keep it up|every ?day|daily|goal|on track)\b/i;

  it('holds for every phase and both plans', () => {
    for (const phase of ALL_PHASES) {
      for (const plan of [TWO_STEP, ONE_STEP]) {
        const html = render({
          phase,
          plan,
          savedRoot: ROOT,
          savedSeq: 4,
          saveErrorMessage: 'Save cancelled — nothing was sent.',
          anchorErrorMessage: 'The transaction was rejected.',
        });
        expect(html, `${phase}/${plan.kind}`).not.toMatch(BANNED);
      }
    }
  });
});

describe('terminal and failure branches', () => {
  it('names the root and claims only what happened when sealed', () => {
    const html = render({ phase: 'sealed', savedRoot: ROOT, txUrl: 'https://chainscan.0g.ai/tx/0xabc' });
    expect(html).toContain('Sealed');
    expect(html).toContain('0x94f51264…f6fd4e5d');
    expect(html).toContain('reveals nothing about what you wrote');
    expect(html).toContain('View tx ↗');
  });

  it('treats an already-sealed pointer as calm, not as an error', () => {
    const html = render({ phase: 'already-sealed', savedRoot: ROOT });
    expect(html).toContain('already points at this snapshot');
    expect(html).toContain('nothing was spent');
    expect(html).not.toMatch(/text-caution|error|failed/i);
  });

  it('claims nothing when it cannot confirm the outcome', () => {
    const html = render({ phase: 'unavailable' });
    expect(html).toMatch(/can’t confirm|can&#x2019;t confirm/);
    expect(html).toContain('Nothing was lost');
    expect(html).not.toContain('Sealed');
  });

  it('shows step 1 as the retry target when the upload itself failed', () => {
    const html = render({
      phase: 'save-failed',
      saveErrorMessage: 'Save cancelled — nothing was sent.',
    });
    expect(html).toContain('Save cancelled — nothing was sent.');
    expect(html).toContain('Start — upload to 0G Storage');
  });

  it('offers a chain switch instead of an action when the wallet is on the wrong network', () => {
    const plan = sealPlan({
      companionState: 'synced',
      dirty: true,
      hasReceipt: true,
      guardBlocked: true,
      busy: false,
    });
    const html = render({ phase: 'idle', plan, primaryAction: sealPrimaryAction('idle', plan, true) });
    expect(html).toContain('Switch to 0G mainnet');
  });

  it('is a labelled modal dialog', () => {
    const html = render();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Seal your journal"');
  });

  it('names the count in the headline when it has one, and not when it does not', () => {
    expect(render()).toContain('Seal 3 entries');
    expect(render({ unsealed: { known: false, reason: 'no-anchor-baseline' } })).toContain(
      'Seal your journal',
    );
  });
});
