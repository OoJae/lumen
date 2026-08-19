/**
 * Renders MemoryLibrary for real.
 *
 * The library is gated behind an unlocked wallet, so it cannot be reached in a
 * headless browser without signing — which would leave the flagship feature
 * covered only by the pure search tests. Server-rendering it here exercises the
 * grouping, the empty states and, most importantly, the honesty copy that
 * separates "contains your words" from a model's guess.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MemoryLibrary } from '../../components/MemoryLibrary';
import type { JournalMemory } from '../hooks/useJournalMemory';
import type { RecallableTurn } from './recall';

function turn(
  id: string,
  entry: string,
  createdAt: string,
  embedding?: number[],
  reflection = `reflection for ${id}`,
): RecallableTurn {
  return { id, entry, reflection, attestation: null, createdAt, embedding };
}

/** Dates are relative to now: the component reads the real clock for "On This
 *  Day", so fixed dates would make these tests behave differently depending on
 *  when they run. Everything here is recent enough that nothing resurfaces. */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

const TURNS: RecallableTurn[] = [
  turn('a', 'I felt anxious about work again.', daysAgo(8), [1, 0, 0]),
  turn('b', 'A calm morning by the river.', daysAgo(4), [0, 1, 0]),
  turn('c', 'Work was fine. I slept badly.', daysAgo(1)),
];

function memoryWith(turns: RecallableTurn[]): JournalMemory {
  return {
    keyState: 'unlocked',
    wallet: '0xb5609c73784aa81de2ebe01ccc04eb7ea4ce1a52',
    turns,
    lockedCount: 0,
  } as unknown as JournalMemory;
}

function render(turns: RecallableTurn[] = TURNS): string {
  return renderToStaticMarkup(
    createElement(MemoryLibrary, { memory: memoryWith(turns), onClose: () => {} }),
  );
}

describe('MemoryLibrary renders', () => {
  it('lists every entry, newest first, when not searching', () => {
    const html = render();
    expect(html).toContain('Everything');
    // Compare positions WITHIN the list: an entry can also appear above it in
    // the resurfacing card, which would otherwise confound the ordering check.
    const list = html.slice(html.indexOf('Everything'));
    expect(list).toContain('I felt anxious about work again.');
    expect(list.indexOf('Work was fine')).toBeLessThan(list.indexOf('I felt anxious'));
  });

  it('surfaces a past entry when the journal is old enough to have one', () => {
    const withHistory = [turn('old', 'The very first thing I wrote.', daysAgo(40)), ...TURNS];
    const html = render(withHistory);
    expect(html).toContain('Where you started');
    expect(html).toContain('The very first thing I wrote.');
  });

  it('surfaces nothing when the journal is too young to have a past', () => {
    expect(render([turn('x', 'today', daysAgo(0))])).not.toContain('Where you started');
  });

  it('reports the entry count', () => {
    expect(render()).toContain('3 entries, searched on this device');
    expect(render([TURNS[0]!])).toContain('1 entry, searched on this device');
  });

  it('says nothing is here without implying anything was lost', () => {
    const html = render([]);
    expect(html).toContain('Nothing here yet');
    expect(html).not.toMatch(/error|failed|missing/i);
  });

  it('states plainly that searching is local', () => {
    expect(render()).toContain('Searching happens in this browser');
    expect(render()).toContain('never sent anywhere to be indexed');
  });

  it('reports how much of the history is ready for semantic search', () => {
    // Two of three turns carry vectors — the footer must not imply all of it
    // is searchable by meaning yet.
    expect(render()).toContain('2 of 3 entries are ready for it so far');
  });

  it('does not claim readiness it cannot have', () => {
    const html = render();
    expect(html).not.toMatch(/all entries (are )?ready/i);
  });

  it('is a labelled modal dialog', () => {
    const html = render();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Your journal"');
  });

  it('offers both export formats and warns the file is plaintext', () => {
    const html = render();
    expect(html).toContain('Take it with you');
    expect(html).toContain('Markdown');
    expect(html).toContain('JSON');
    expect(html).toContain('the way you would a paper journal');
    expect(html).toContain('re-verified later');
  });

  it('offers no export for an empty journal', () => {
    expect(render([])).not.toContain('Take it with you');
  });

  it('offers a delete affordance only when the caller supplies one', () => {
    const withDelete = renderToStaticMarkup(
      createElement(MemoryLibrary, {
        memory: memoryWith(TURNS),
        onClose: () => {},
        onDelete: () => {},
      }),
    );
    expect(withDelete).toContain('Delete the entry from');
    expect(render()).not.toContain('Delete the entry from');
  });
});

describe('export failures are visible, not silent', () => {
  it('renders no error banner when nothing has failed', () => {
    expect(render()).not.toContain("Couldn't build the export");
  });

  it('survives an entry whose vector contains a non-finite number', () => {
    // canonicalJson throws on non-finite numbers. Stripping embeddings removes
    // the likeliest source, but the handler must never be the thing that fails
    // silently — an unguarded throw in onClick downloads nothing and says nothing.
    const poisoned = { ...turn('bad', 'entry', daysAgo(1)), embedding: [Number.NaN, 1, 2] };
    expect(() => render([poisoned])).not.toThrow();
  });
});
