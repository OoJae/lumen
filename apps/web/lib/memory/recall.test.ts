import { describe, expect, it } from 'vitest';

import type { JournalTurn } from '@lumen/shared';

import { buildContext, buildContextWithRecall, MAX_CONTEXT_TURNS } from './session';
import { cosineSimilarity, rankBySimilarity } from './vectorMath';

function turn(id: string, entry: string, reflection = `r:${entry}`): JournalTurn {
  return { id, entry, reflection, attestation: null, createdAt: `2026-08-0${id.length % 9 || 1}T00:00:00.000Z` };
}

describe('cosineSimilarity', () => {
  it('is 1 for identical direction, 0 for orthogonal, -1 for opposite', () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 5])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1);
  });

  it('returns 0 for mismatched lengths and zero vectors', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

describe('rankBySimilarity', () => {
  const items = [
    { id: 'a', vec: [1, 0] as number[] | undefined },
    { id: 'b', vec: [0.9, 0.1] as number[] | undefined },
    { id: 'c', vec: [0, 1] as number[] | undefined },
    { id: 'd', vec: undefined },
  ];

  it('orders by score, caps at k, applies minScore, skips vectorless items', () => {
    const ranked = rankBySimilarity([1, 0], items, (i) => i.vec, 2, 0.35);
    expect(ranked.map((r) => r.item.id)).toEqual(['a', 'b']);
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);

    const all = rankBySimilarity([1, 0], items, (i) => i.vec, 10, 0.35);
    expect(all.map((r) => r.item.id)).toEqual(['a', 'b']); // 'c' below minScore, 'd' skipped
  });

  it('handles k=0 and empty input', () => {
    expect(rankBySimilarity([1, 0], items, (i) => i.vec, 0, 0)).toEqual([]);
    expect(rankBySimilarity([1, 0], [], () => undefined, 4, 0)).toEqual([]);
  });
});

describe('buildContextWithRecall', () => {
  const turns = Array.from({ length: 3 }, (_, i) => turn(`t${i}`, `entry ${i}`));

  it('returns plain session context when nothing was recalled', () => {
    const withRecall = buildContextWithRecall(turns, [], 'new entry');
    expect(withRecall).toEqual(buildContext(turns, 'new entry'));
    expect(withRecall.at(-1)).toEqual({ role: 'user', content: 'new entry' });
  });

  it('prepends exactly one system block containing the recalled entries', () => {
    const recalled = [turn('r1', 'the argument with my brother')];
    const messages = buildContextWithRecall(turns, recalled, 'new entry');
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain('the argument with my brother');
    expect(messages.filter((m) => m.role === 'system')).toHaveLength(1);
    expect(messages.slice(1)).toEqual(buildContext(turns, 'new entry'));
  });

  it('session window still caps at MAX_CONTEXT_TURNS', () => {
    const many = Array.from({ length: MAX_CONTEXT_TURNS + 4 }, (_, i) => turn(`t${i}`, `e${i}`));
    const messages = buildContextWithRecall(many, [], 'new');
    // each windowed turn contributes user+assistant, plus the new entry
    expect(messages).toHaveLength(MAX_CONTEXT_TURNS * 2 + 1);
    expect(messages[0]!.content).toBe(`e${4}`); // oldest turns dropped
  });
});
