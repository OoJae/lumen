import { describe, expect, it } from 'vitest';

import type { RecallableTurn } from './recall';
import {
  queryTerms,
  searchTurns,
  snippet,
  textScore,
  SEARCH_MIN_SEMANTIC_SCORE,
} from './search';

function turn(
  id: string,
  entry: string,
  reflection = '',
  createdAt = '2026-08-01T10:00:00.000Z',
  embedding?: number[],
): RecallableTurn {
  return { id, entry, reflection, attestation: null, createdAt, embedding };
}

const CORPUS: RecallableTurn[] = [
  turn('a', 'I felt anxious about work again today.', 'Work anxiety is worth naming.', '2026-08-01T10:00:00.000Z', [1, 0, 0]),
  turn('b', 'A calm morning by the river.', 'Rest matters.', '2026-08-05T10:00:00.000Z', [0, 1, 0]),
  turn('c', 'Work was fine. I slept badly.', 'Sleep first.', '2026-08-09T10:00:00.000Z', [0, 0, 1]),
];

describe('queryTerms', () => {
  it('lowercases, splits and strips surrounding punctuation', () => {
    expect(queryTerms('  Anxious, about   WORK! ')).toEqual(['anxious', 'about', 'work']);
  });

  it('de-duplicates repeated terms', () => {
    expect(queryTerms('work work work')).toEqual(['work']);
  });

  it('keeps intra-word punctuation and non-Latin scripts', () => {
    expect(queryTerms("don't 東京")).toEqual(["don't", '東京']);
  });

  it('is empty for whitespace or punctuation alone', () => {
    expect(queryTerms('   ')).toEqual([]);
    expect(queryTerms('!!! ...')).toEqual([]);
  });
});

describe('textScore', () => {
  it('scores a whole-phrase match 1', () => {
    expect(textScore(['anxious', 'about', 'work'], 'anxious about work', 'I felt anxious about work')).toBe(1);
  });

  it('scores scattered terms as a fraction', () => {
    expect(textScore(['anxious', 'work'], 'anxious work', 'work was fine but I was not anxious')).toBe(1);
    expect(textScore(['anxious', 'sleep'], 'anxious sleep', 'I slept badly')).toBe(0);
    expect(textScore(['work', 'river'], 'work river', 'work was fine')).toBe(0.5);
  });

  it('is case-insensitive', () => {
    expect(textScore(['work'], 'work', 'WORK was fine')).toBe(1);
  });

  it('is 0 with no terms', () => {
    expect(textScore([], '', 'anything')).toBe(0);
  });
});

describe('snippet', () => {
  it('returns short text unchanged', () => {
    expect(snippet('A calm morning.', ['calm'])).toBe('A calm morning.');
  });

  it('centres on the first matching term and ellipsises both sides', () => {
    const text = `${'x '.repeat(120)}needle${' y'.repeat(120)}`;
    const out = snippet(text, ['needle']);
    expect(out).toContain('needle');
    expect(out.startsWith('…')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
  });

  it('falls back to the opening when no term matches', () => {
    const out = snippet('z'.repeat(500), ['needle']);
    expect(out.startsWith('z')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
  });

  it('collapses whitespace', () => {
    expect(snippet('a\n\n  b\tc', ['a'])).toBe('a b c');
  });
});

describe('searchTurns — literal', () => {
  it('finds entries containing the query; equal scores fall back to newest first', () => {
    const r = searchTurns('work', CORPUS, null);
    expect(r.exact.map((h) => h.turn.id)).toEqual(['c', 'a']);
  });

  it('searches the reflection as well as the entry', () => {
    const r = searchTurns('rest', CORPUS, null);
    expect(r.exact.map((h) => h.turn.id)).toEqual(['b']);
    expect(r.exact[0]!.field).toBe('reflection');
  });

  it('reports when a term appears in both halves', () => {
    const r = searchTurns('work', CORPUS, null);
    expect(r.exact.find((h) => h.turn.id === 'a')!.field).toBe('both');
  });

  it('prefers an excerpt from what the user wrote', () => {
    const r = searchTurns('anxious', CORPUS, null);
    expect(r.exact[0]!.snippet).toContain('I felt anxious about work');
  });

  it('returns nothing for an empty query rather than everything', () => {
    const r = searchTurns('   ', CORPUS, null);
    expect(r.exact).toEqual([]);
    expect(r.related).toEqual([]);
  });

  it('honours the limit', () => {
    const r = searchTurns('work', CORPUS, null, { limit: 1 });
    expect(r.exact).toHaveLength(1);
  });
});

describe('searchTurns — semantic', () => {
  it('works with no query vector, and says semantic is unavailable', () => {
    const r = searchTurns('work', CORPUS, null);
    expect(r.semanticAvailable).toBe(false);
    expect(r.related).toEqual([]);
    // The literal half is unaffected — this is the graceful-degradation promise.
    expect(r.exact.length).toBeGreaterThan(0);
  });

  it('offers related entries when a query vector is supplied', () => {
    const r = searchTurns('river', CORPUS, [0, 1, 0]);
    expect(r.semanticAvailable).toBe(true);
    // 'b' matches literally, so it must not also appear as "related".
    expect(r.exact.map((h) => h.turn.id)).toEqual(['b']);
    expect(r.related.map((h) => h.turn.id)).not.toContain('b');
  });

  it('never lists the same entry in both groups', () => {
    const r = searchTurns('work', CORPUS, [1, 0, 0]);
    const exactIds = new Set(r.exact.map((h) => h.turn.id));
    for (const hit of r.related) expect(exactIds.has(hit.turn.id)).toBe(false);
  });

  it('applies the cosine floor', () => {
    const orthogonal = searchTurns('nothing-matches-literally', CORPUS, [0, 0, 0.0001]);
    for (const hit of orthogonal.related) {
      expect(hit.score).toBeGreaterThanOrEqual(SEARCH_MIN_SEMANTIC_SCORE);
    }
  });

  it('skips turns with no embedding rather than ranking them 0', () => {
    const mixed = [...CORPUS, turn('d', 'unrelated text', '', '2026-08-10T10:00:00.000Z')];
    const r = searchTurns('zzzz', mixed, [1, 0, 0]);
    expect(r.related.map((h) => h.turn.id)).not.toContain('d');
  });

  it('searches the FULL history, including the newest entries recall holds back', () => {
    // recallRelevant excludes the newest MAX_CONTEXT_TURNS (6). Search must not.
    const many = Array.from({ length: 10 }, (_, i) =>
      turn(`t${i}`, `entry ${i} mentions kestrel`, '', `2026-08-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`),
    );
    const r = searchTurns('kestrel', many, null);
    expect(r.exact).toHaveLength(10);
    expect(r.exact.map((h) => h.turn.id)).toContain('t9');
  });
});

describe('literal results rank by strength, not just date', () => {
  const PHRASE = turn(
    'gold',
    'I am anxious about work and cannot sleep.',
    '',
    '2026-08-01T10:00:00.000Z',
  );
  const WEAK = turn('weak', 'Thinking about the party this weekend.', '', '2026-08-10T10:00:00.000Z');

  it('puts an exact phrase match above a newer one-word match', () => {
    // textScore is an OR, so "about" alone scores 1/3 and used to win on date.
    const r = searchTurns('anxious about work', [WEAK, PHRASE], null);
    expect(r.exact.map((h) => h.turn.id)).toEqual(['gold', 'weak']);
    expect(r.exact[0]!.score).toBe(1);
    expect(r.exact[1]!.score).toBeCloseTo(1 / 3);
  });

  it('breaks ties on recency', () => {
    const older = turn('older', 'work', '', '2026-08-01T10:00:00.000Z');
    const newer = turn('newer', 'work', '', '2026-08-10T10:00:00.000Z');
    expect(searchTurns('work', [older, newer], null).exact.map((h) => h.turn.id)).toEqual([
      'newer',
      'older',
    ]);
  });

  it('does not let the limit cut the strongest match', () => {
    const r = searchTurns('anxious about work', [WEAK, PHRASE], null, { limit: 1 });
    expect(r.exact.map((h) => h.turn.id)).toEqual(['gold']);
  });
});
