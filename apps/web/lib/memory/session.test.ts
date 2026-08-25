import { describe, expect, it } from 'vitest';

import type { JournalTurn } from '@lumen/shared';

import { buildContextWithRecall, contextFootprint, MAX_CONTEXT_TURNS } from './session';

const long = (topic: string) =>
  [
    'Woke up late and the light was strange.',
    `I keep thinking about ${topic} and what I should have said.`,
    'Then I did the washing up and listened to the radio.',
    'The car needs its tyres looked at before winter.',
    'Someone at work asked if I was alright and I said yes.',
  ].join(' ');


describe('the recall block is excerpted before it leaves the device', () => {
  // The measurable claim behind the privacy-model change: a routine reflection
  // used to forward up to four WHOLE earlier entries. Recall selects by
  // whole-entry similarity, so a long entry travels because one paragraph of it
  // matches. This asserts the payload actually shrank.

  const recalled: JournalTurn[] = [
    { id: 'r1', entry: long('my father'), reflection: '', createdAt: '2026-01-04T09:00:00.000Z', attestation: null },
    { id: 'r2', entry: long('the house'), reflection: '', createdAt: '2026-02-04T09:00:00.000Z', attestation: null },
  ];

  const newEntry = 'Thinking about my father and the house again tonight.';

  function recallBlock(messages: ReturnType<typeof buildContextWithRecall>): string {
    return messages.find((m) => m.role === 'system' && m.content.includes('Excerpts'))?.content ?? '';
  }

  it('sends less than half the journal text the whole entries would have', () => {
    // Measure the CONTENT, not the fixed instruction wrapped around it —
    // otherwise the preamble's own length flatters or damns the comparison
    // depending on how chatty it happens to be.
    const whole = recalled.reduce((n, t) => n + t.entry.length, 0);
    const block = recallBlock(buildContextWithRecall([], recalled, newEntry));
    const content = block.split('\n\n').slice(1).join('\n\n');
    expect(content.length).toBeGreaterThan(0);
    expect(content.length).toBeLessThan(whole / 2);
  });

  it('withholds more than it sends', () => {
    const whole = recalled.reduce((n, t) => n + t.entry.length, 0);
    expect(contextFootprint([], recalled, newEntry).charsWithheld).toBeGreaterThan(whole / 2);
  });

  it('keeps the relevant sentence and drops the unrelated ones', () => {
    const block = recallBlock(buildContextWithRecall([], recalled, newEntry));
    expect(block).toContain('my father');
    expect(block).toContain('the house');
    expect(block).not.toContain('tyres');
    expect(block).not.toContain('washing up');
  });

  it('tells the model the gaps are deliberate, so it does not fill them in', () => {
    // A model shown an ellipsis with no explanation will happily speculate
    // about what was removed — which would defeat the point out loud.
    const block = recallBlock(buildContextWithRecall([], recalled, newEntry));
    expect(block).toContain('withheld');
    expect(block).toContain('do not ask about');
  });

  it('still dates each excerpt', () => {
    expect(recallBlock(buildContextWithRecall([], recalled, newEntry))).toContain('[2026-01-04]');
  });

  it('contextFootprint reports what was actually sent', () => {
    const f = contextFootprint([], recalled, newEntry);
    expect(f.recalledEntries).toBe(2);
    expect(f.charsWithheld).toBeGreaterThan(0);
    expect(f.sessionTurns).toBe(0);
  });

  it('caps sessionTurns at the window, not the journal size', () => {
    const many: JournalTurn[] = Array.from({ length: 50 }, (_, i) => ({
      id: `t${i}`,
      entry: 'x',
      reflection: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      attestation: null,
    }));
    expect(contextFootprint(many, [], 'q').sessionTurns).toBe(MAX_CONTEXT_TURNS);
  });
});
