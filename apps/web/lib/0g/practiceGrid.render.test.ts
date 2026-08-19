/**
 * Renders PracticeGrid for real and asserts the visual rules hold in the actual
 * output.
 *
 * This exists because the pure calendar tests can only prove the DATA is right.
 * The rules that matter here — nothing red, no cells outside the record, one
 * flat colour for sealed days regardless of how many times you sealed — live in
 * the JSX, and the live companion happens to have all its activity on a single
 * UTC day, so the grid branch never renders against production data.
 *
 * `.ts` not `.tsx` on purpose: vitest's include glob is `lib/**\/*.test.ts`, and
 * createElement avoids needing JSX in the test itself. The component is still
 * transformed on import, so a JSX or import error fails here.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PracticeGrid } from '../../components/PracticeGrid';
import { buildPracticeCalendar, type PracticeCalendarInput } from './practice';

const TODAY = '2026-08-19';

function render(days: string[], over: Partial<PracticeCalendarInput> = {}): string {
  const calendar = buildPracticeCalendar({ practiceDays: days, today: TODAY, ...over });
  return renderToStaticMarkup(createElement(PracticeGrid, { calendar }));
}

const GRID_DAYS = ['2026-07-06', '2026-07-20', '2026-08-17', '2026-08-18', '2026-08-19'];

describe('PracticeGrid renders', () => {
  it('renders the empty state without throwing', () => {
    const html = render([]);
    expect(html).toContain('Nothing sealed yet');
  });

  it('renders the sparse state as named days, not a grid', () => {
    const html = render(['2026-08-19'], { mintDay: '2026-08-19' });
    expect(html).toContain('The record starts here');
    expect(html).toContain('19 August 2026');
    expect(html).toContain('companion minted');
    expect(html).not.toContain('role="img"');
  });

  it('renders the grid once there are enough sealed days', () => {
    const html = render(GRID_DAYS);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="5 sealed days, from 6 July 2026 to 19 August 2026."');
    expect(html).toContain('title="19 August 2026 · sealed"');
    expect(html).toContain('title="18 August 2026 · sealed"');
  });

  it('renders exactly 7 cells per column', () => {
    const html = render(GRID_DAYS);
    const columns = html.split('flex shrink-0 flex-col').length - 1;
    const titles = (html.match(/title="/g) ?? []).length;
    expect(columns).toBeGreaterThan(0);
    expect(titles).toBe(columns * 7);
  });

  it('never emits a red or caution class', () => {
    for (const days of [[], ['2026-08-19'], GRID_DAYS]) {
      const html = render(days);
      expect(html).not.toMatch(/text-red|bg-red|border-red|caution/);
    }
  });

  it('gives sealed days one flat colour — no intensity ramp for sealing twice', () => {
    const once = render(GRID_DAYS, { seqsByDay: { '2026-08-19': [1] } });
    const twice = render(GRID_DAYS, { seqsByDay: { '2026-08-19': [1, 2, 3, 4] } });
    // The only permitted difference is the hover text.
    expect(twice).toContain('title="19 August 2026 · sealed 4 times"');
    expect(once.replace(/title="[^"]*"/g, '')).toBe(twice.replace(/title="[^"]*"/g, ''));
  });

  it('marks the mint day with a ring rather than a different colour', () => {
    const html = render(GRID_DAYS, { mintDay: '2026-07-06' });
    expect(html).toContain('ring-accent-strong');
    expect(html).toContain('title="6 July 2026 · companion minted"');
  });

  it('says so when the strip is truncated', () => {
    const html = render(['2026-01-05', ...GRID_DAYS], { maxWeeks: 3 });
    expect(html).toContain('Showing the most recent 3 weeks');
  });

  it('does not claim truncation when the whole record fits', () => {
    expect(render(GRID_DAYS, { maxWeeks: 52 })).not.toContain('Showing the most recent');
  });

  it('renders no cell before the first seal or after today outside column bounds', () => {
    const html = render(GRID_DAYS);
    // before-start / future cells are transparent and carry a "no seal" title;
    // what must never appear is a SEALED cell dated outside the record.
    expect(html).not.toContain('title="20 August 2026 · sealed"');
    expect(html).not.toContain('title="5 July 2026 · sealed"');
  });
});
