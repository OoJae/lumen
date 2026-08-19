import { describe, expect, it } from 'vitest';

import type { DeletedTurnV1 } from '@lumen/shared';

import {
  backfillCandidates,
  mergeRestored,
  mergeTombstones,
  orphanVectorIds,
  sanitizeTombstones,
  tombstoneIdSet,
  withoutDeleted,
} from './deletions';

function marker(id: string, deletedAt = '2026-08-19T10:00:00.000Z'): DeletedTurnV1 {
  return { id, deletedAt };
}

function turn(id: string, createdAt = '2026-08-01T10:00:00.000Z') {
  return { id, createdAt, entry: `entry ${id}` };
}

describe('mergeTombstones', () => {
  it('unions by id', () => {
    expect(mergeTombstones([marker('a')], [marker('b')]).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('keeps the EARLIEST deletedAt so a merge never moves the date forward', () => {
    const merged = mergeTombstones(
      [marker('a', '2026-08-19T10:00:00.000Z')],
      [marker('a', '2026-08-01T10:00:00.000Z')],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.deletedAt).toBe('2026-08-01T10:00:00.000Z');
  });

  it('is order-independent — two devices must produce identical bytes', () => {
    // This is the root-hash determinism guarantee, not a style preference:
    // canonicalJson sorts object keys but not array order.
    const a = [marker('z'), marker('a')];
    const b = [marker('m')];
    expect(mergeTombstones(a, b)).toEqual(mergeTombstones(b, a));
  });

  it('sorts by id', () => {
    expect(mergeTombstones([marker('c'), marker('a')], [marker('b')]).map((m) => m.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('is idempotent', () => {
    const a = [marker('a'), marker('b')];
    expect(mergeTombstones(a, a)).toEqual(mergeTombstones(a, []));
  });

  it('handles empty inputs', () => {
    expect(mergeTombstones([], [])).toEqual([]);
  });
});

describe('sanitizeTombstones', () => {
  it('returns [] for anything that is not an array', () => {
    for (const bad of [undefined, null, 'x', 42, {}]) expect(sanitizeTombstones(bad)).toEqual([]);
  });

  it('drops malformed markers instead of throwing', () => {
    const out = sanitizeTombstones([
      marker('good'),
      null,
      'nope',
      { id: '', deletedAt: 'x' },
      { id: '   ', deletedAt: 'x' },
      { id: 'no-date' },
      { id: 'bad-date', deletedAt: 5 },
      { deletedAt: '2026-01-01' },
    ]);
    expect(out.map((m) => m.id)).toEqual(['good']);
  });

  it('de-duplicates and sorts', () => {
    const out = sanitizeTombstones([marker('b'), marker('a'), marker('b')]);
    expect(out.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('accepts what JSON.parse actually produces', () => {
    // The only real source is a decrypted snapshot, i.e. JSON.parse output —
    // plain data, no getters, no prototypes. Guarding beyond that would be
    // defending against a caller that cannot exist.
    expect(sanitizeTombstones(JSON.parse('[{"id":"a","deletedAt":"t"}]'))).toEqual([
      { id: 'a', deletedAt: 't' },
    ]);
  });
});

describe('withoutDeleted', () => {
  it('removes exactly the tombstoned ids', () => {
    const kept = withoutDeleted([turn('a'), turn('b'), turn('c')], new Set(['b']));
    expect(kept.map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('is a no-op with no deletions', () => {
    const items = [turn('a')];
    expect(withoutDeleted(items, new Set())).toEqual(items);
  });
});

describe('backfillCandidates', () => {
  it('skips turns already stored', () => {
    expect(backfillCandidates([turn('a')], new Set(['a']), new Set())).toEqual([]);
  });

  it('skips DELETED turns — this is the resurrection bug, isolated', () => {
    // hydrate() writes React state back into IndexedDB. Without this filter a
    // turn deleted from the store while another tab still holds it in state is
    // re-persisted at the next unlock, and the delete silently undoes itself.
    expect(backfillCandidates([turn('a')], new Set(), new Set(['a']))).toEqual([]);
  });

  it('includes a genuinely new session turn', () => {
    expect(backfillCandidates([turn('a')], new Set(), new Set()).map((t) => t.id)).toEqual(['a']);
  });
});

describe('mergeRestored', () => {
  it('adds incoming turns the device does not have', () => {
    const r = mergeRestored([turn('a')], [turn('b')], new Set());
    expect(r.merged.map((t) => t.id)).toEqual(['a', 'b']);
    expect(r.added).toBe(1);
  });

  it('does not duplicate a turn the device already has', () => {
    const r = mergeRestored([turn('a')], [turn('a')], new Set());
    expect(r.merged).toHaveLength(1);
    expect(r.added).toBe(0);
  });

  it('skips incoming turns this device deleted, and counts them', () => {
    const r = mergeRestored([], [turn('a'), turn('b')], new Set(['a']));
    expect(r.merged.map((t) => t.id)).toEqual(['b']);
    expect(r.skippedDeleted).toBe(1);
  });

  it('DROPS a locally-held turn the incoming snapshot says was deleted', () => {
    // The cross-device case: device B still has the entry, device A deleted it,
    // and B is restoring a snapshot written after that delete.
    const r = mergeRestored([turn('a'), turn('b')], [turn('b')], new Set(['a']));
    expect(r.merged.map((t) => t.id)).toEqual(['b']);
  });

  it('orders the result by createdAt', () => {
    const r = mergeRestored(
      [turn('late', '2026-08-09T00:00:00.000Z')],
      [turn('early', '2026-08-01T00:00:00.000Z')],
      new Set(),
    );
    expect(r.merged.map((t) => t.id)).toEqual(['early', 'late']);
  });

  it('INVARIANT: no deleted id ever appears in the merged result', () => {
    const ids = ['a', 'b', 'c', 'd'];
    for (let mask = 0; mask < 16; mask++) {
      const deleted = new Set(ids.filter((_, i) => mask & (1 << i)));
      for (let localMask = 0; localMask < 16; localMask++) {
        const local = ids.filter((_, i) => localMask & (1 << i)).map((id) => turn(id));
        const incoming = ids.map((id) => turn(id));
        const r = mergeRestored(local, incoming, deleted);
        for (const t of r.merged) expect(deleted.has(t.id)).toBe(false);
        expect(backfillCandidates(local, new Set(), deleted).every((t) => !deleted.has(t.id))).toBe(
          true,
        );
      }
    }
  });
});

describe('orphanVectorIds', () => {
  it('finds vectors whose turn is gone', () => {
    expect(orphanVectorIds(['a', 'b'], ['a'])).toEqual(['b']);
  });

  it('does not report a turn that merely lacks a vector', () => {
    expect(orphanVectorIds(['a'], ['a', 'b'])).toEqual([]);
  });

  it('handles empty inputs', () => {
    expect(orphanVectorIds([], [])).toEqual([]);
  });
});

describe('tombstoneIdSet', () => {
  it('collects ids', () => {
    expect([...tombstoneIdSet([marker('a'), marker('b')])].sort()).toEqual(['a', 'b']);
  });
});
