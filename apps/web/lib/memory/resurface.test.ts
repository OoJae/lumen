import { describe, expect, it } from 'vitest';

import type { JournalTurn } from '@lumen/shared';

import { resurface } from './resurface';

function turn(id: string, day: string): JournalTurn {
  return {
    id,
    entry: `entry ${id}`,
    reflection: `reflection ${id}`,
    attestation: null,
    createdAt: `${day}T12:00:00.000Z`,
  };
}

const TODAY = '2026-08-19';

describe('resurface', () => {
  it('shows nothing for an empty journal', () => {
    expect(resurface([], TODAY)).toBeNull();
  });

  it('shows nothing for a journal too young to have a past', () => {
    const young = [turn('a', '2026-08-18'), turn('b', '2026-08-19')];
    expect(resurface(young, TODAY)).toBeNull();
  });

  it('finds the same calendar day a year ago', () => {
    const r = resurface([turn('old', '2025-08-19'), turn('new', '2026-08-18')], TODAY);
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('a-year-ago');
    expect(r!.label).toBe('A year ago today');
    expect(r!.turn.id).toBe('old');
  });

  it('pluralises multiple years correctly', () => {
    const r = resurface([turn('old', '2023-08-19')], TODAY);
    expect(r!.kind).toBe('on-this-day');
    expect(r!.label).toBe('3 years ago today');
  });

  it('collects other entries from the same day in past years', () => {
    const r = resurface(
      [turn('y1', '2025-08-19'), turn('y2', '2024-08-19'), turn('other', '2025-01-01')],
      TODAY,
    );
    expect(r!.turn.id).toBe('y1'); // most recent match leads
    expect(r!.also.map((t) => t.id)).toEqual(['y2']);
  });

  it('does not treat today as "on this day"', () => {
    const r = resurface([turn('today', '2026-08-19'), turn('old', '2026-06-20')], TODAY);
    expect(r!.turn.id).not.toBe('today');
  });

  it('falls back to an entry roughly a month ago', () => {
    const r = resurface([turn('m', '2026-07-20'), turn('recent', '2026-08-18')], TODAY);
    expect(r!.kind).toBe('months-ago');
    expect(r!.label).toBe('A month ago');
    expect(r!.turn.id).toBe('m');
  });

  it('prefers the largest true month label', () => {
    const r = resurface(
      [turn('one', '2026-07-20'), turn('six', '2026-02-20'), turn('recent', '2026-08-18')],
      TODAY,
    );
    expect(r!.label).toBe('6 months ago');
    expect(r!.turn.id).toBe('six');
  });

  it('tolerates a few days either side of the month mark', () => {
    expect(resurface([turn('m', '2026-07-22')], TODAY)!.kind).toBe('months-ago');
    // Eight days off is not "a month ago" — and with nothing else old enough
    // and the journal under the first-entry age, nothing is shown.
    expect(resurface([turn('m', '2026-08-12')], TODAY)).toBeNull();
  });

  it('falls back to the first entry once the journal is genuinely old', () => {
    const r = resurface([turn('first', '2026-07-01'), turn('recent', '2026-08-15')], TODAY, {
      minAgeDaysForFirst: 14,
    });
    // 2026-07-01 is 49 days back — not within any ±3-day month window (30/60),
    // so this exercises the first-entry branch.
    expect(r!.kind).toBe('first-entry');
    expect(r!.label).toBe('Where you started');
    expect(r!.turn.id).toBe('first');
  });

  it('never surfaces the first entry while it is still recent', () => {
    const r = resurface([turn('first', '2026-08-13')], TODAY, { minAgeDaysForFirst: 14 });
    expect(r).toBeNull();
  });

  it('prefers on-this-day over a month-ago match', () => {
    const r = resurface([turn('year', '2025-08-19'), turn('month', '2026-07-20')], TODAY);
    expect(r!.kind).toBe('a-year-ago');
  });

  it('never exhorts, guilts or counts', () => {
    const banned = /streak|missed|keep|should|don't forget|don’t forget|goal|\d+\s*\/\s*\d+/i;
    const cases = [
      [turn('a', '2025-08-19')],
      [turn('a', '2026-07-20')],
      [turn('a', '2026-07-01'), turn('b', '2026-08-15')],
    ];
    for (const turns of cases) {
      const r = resurface(turns, TODAY);
      if (r) expect(r.label, r.label).not.toMatch(banned);
    }
  });
});
