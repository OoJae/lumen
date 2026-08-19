import { describe, expect, it } from 'vitest';

import { ZG_MAINNET, ZG_TESTNET, type StorageReceipt, type ZgNetworkKey } from '@lumen/shared';

import {
  foreignPointerNotice,
  isDirty,
  pendingChanges,
  syncStatus,
  unsavedChangeNotice,
  type SyncStatus,
} from './saveStatus';

function receipt(network: ZgNetworkKey, turnCount = 5): StorageReceipt {
  return {
    seq: 2,
    rootHash: '0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e79f0e',
    txHash: '0xtx',
    paddedBytes: 4096,
    turnCount,
    savedAt: '2026-08-01T00:00:00.000Z',
    network,
  };
}

describe('syncStatus', () => {
  it('short-circuits when locked or empty', () => {
    expect(syncStatus({ unlocked: false, turnCount: 5, receipt: null, foreign: null })).toBe('locked');
    expect(syncStatus({ unlocked: true, turnCount: 0, receipt: null, foreign: null })).toBe('empty');
  });

  it('reports saved only when the active-network receipt matches the turn count', () => {
    expect(
      syncStatus({ unlocked: true, turnCount: 5, receipt: receipt('mainnet', 5), foreign: null }),
    ).toBe('saved');
    expect(
      syncStatus({ unlocked: true, turnCount: 7, receipt: receipt('mainnet', 5), foreign: null }),
    ).toBe('stale');
  });

  it('calls a snapshot that exists only on the other network exactly that', () => {
    const status = syncStatus({
      unlocked: true,
      turnCount: 5,
      receipt: null,
      foreign: receipt('testnet', 5),
    });
    expect(status).toBe('foreign-only');
    expect(isDirty(status)).toBe(true); // it must still prompt a save here
  });

  it('reports unsaved when nothing exists anywhere', () => {
    expect(syncStatus({ unlocked: true, turnCount: 3, receipt: null, foreign: null })).toBe('unsaved');
  });

  it('THE INVARIANT: no active-network receipt can ever read as saved', () => {
    // This is the bug that would have told a user their journal was on mainnet
    // when the root only existed on testnet. Exhaustive over the inputs that
    // could plausibly reach it.
    for (const unlocked of [true, false]) {
      for (const turnCount of [0, 1, 5, 999]) {
        for (const foreign of [null, receipt('testnet', 5), receipt('mainnet', 999)]) {
          const status = syncStatus({ unlocked, turnCount, receipt: null, foreign });
          expect(status).not.toBe('saved');
          expect(status).not.toBe('stale');
        }
      }
    }
  });

  it('isDirty covers exactly the states that need a save', () => {
    const dirty: SyncStatus[] = ['unsaved', 'foreign-only', 'stale'];
    const clean: SyncStatus[] = ['locked', 'empty', 'saved'];
    for (const s of dirty) expect(isDirty(s)).toBe(true);
    for (const s of clean) expect(isDirty(s)).toBe(false);
  });
});

describe('foreignPointerNotice', () => {
  it('names both networks, the entry count, and the reassurance', () => {
    const notice = foreignPointerNotice(ZG_MAINNET, receipt('testnet', 5), 5);
    expect(notice).toContain('0G testnet');
    expect(notice).toContain('0G mainnet');
    expect(notice).toContain('5 entries');
    expect(notice).toContain('safe and encrypted on this device');
    expect(notice).toContain('One Save to 0G anchors them here');
  });

  it('never implies the journal is saved on the ACTIVE network', () => {
    const notice = foreignPointerNotice(ZG_MAINNET, receipt('testnet'), 5).toLowerCase();
    // The words that would make it a lie.
    expect(notice).not.toContain('backed up');
    expect(notice).not.toContain('synced');
    expect(notice).toContain('nothing is anchored for this wallet yet');
  });

  it('singularizes one entry and handles an empty device', () => {
    expect(foreignPointerNotice(ZG_MAINNET, receipt('testnet', 1), 1)).toContain('1 entry');
    expect(foreignPointerNotice(ZG_MAINNET, receipt('testnet', 3), 0)).toContain(
      'this device holds no entries to save',
    );
  });

  it('works in the mirror direction (testnet build, mainnet snapshot)', () => {
    const notice = foreignPointerNotice(ZG_TESTNET, receipt('mainnet', 2), 2);
    expect(notice).toContain('Your last snapshot is on 0G mainnet');
    expect(notice).toContain("You're on 0G testnet now");
  });
});

describe('deletions change what "saved" may claim', () => {
  const saved: StorageReceipt = {
    seq: 1,
    rootHash: '0xroot',
    txHash: '0xtx',
    paddedBytes: 4096,
    turnCount: 5,
    savedAt: '2026-08-19T10:00:00.000Z',
    network: 'mainnet',
  };

  it('is stale after a delete-plus-add, which turnCount alone cannot see', () => {
    // 5 → 4 → 5: the count matches the receipt while the content differs.
    expect(
      syncStatus({ unlocked: true, turnCount: 5, deletionCount: 1, receipt: saved, foreign: null }),
    ).toBe('stale');
  });

  it('is emptied — NOT saved — when the last entry is deleted', () => {
    const status = syncStatus({
      unlocked: true,
      turnCount: 0,
      deletionCount: 5,
      receipt: saved,
      foreign: null,
    });
    expect(status).toBe('emptied');
    expect(isDirty(status)).toBe(true);
  });

  it('still reads saved when a genuinely empty journal was saved empty', () => {
    expect(
      syncStatus({
        unlocked: true,
        turnCount: 0,
        deletionCount: 0,
        receipt: { ...saved, turnCount: 0 },
        foreign: null,
      }),
    ).toBe('saved');
  });

  it('treats a pre-deletion receipt as zero deletions', () => {
    expect(
      syncStatus({ unlocked: true, turnCount: 5, deletionCount: 0, receipt: saved, foreign: null }),
    ).toBe('saved');
    expect(
      syncStatus({ unlocked: true, turnCount: 5, deletionCount: 1, receipt: saved, foreign: null }),
    ).toBe('stale');
  });

  it('never reads saved without an active-network receipt, whatever the deletions', () => {
    for (const turnCount of [0, 3]) {
      for (const deletionCount of [0, 2]) {
        for (const foreign of [null, saved]) {
          const status = syncStatus({ unlocked: true, turnCount, deletionCount, receipt: null, foreign });
          expect(status).not.toBe('saved');
          expect(status).not.toBe('emptied');
        }
      }
    }
  });
});

describe('pendingChanges', () => {
  const saved: StorageReceipt = {
    seq: 1, rootHash: '0xr', txHash: '0xt', paddedBytes: 4096,
    turnCount: 5, savedAt: '2026-08-19T10:00:00.000Z', network: 'mainnet', deletionCount: 0,
  };

  it('separates additions from deletions', () => {
    expect(pendingChanges(6, 1, saved)).toEqual({ added: 2, deleted: 1 });
  });

  it('reports a pure deletion as no additions', () => {
    expect(pendingChanges(4, 1, saved)).toEqual({ added: 0, deleted: 1 });
  });

  it('counts everything as added when nothing was ever saved', () => {
    expect(pendingChanges(3, 0, null)).toEqual({ added: 3, deleted: 0 });
  });

  it('never goes negative after a restore left fewer turns than the receipt', () => {
    expect(pendingChanges(2, 0, saved)).toEqual({ added: 0, deleted: 0 });
  });
});

describe('unsavedChangeNotice', () => {
  it('never says "new entries" for a pure deletion', () => {
    const notice = unsavedChangeNotice({ added: 0, deleted: 2 })!;
    expect(notice).toBe('2 entries deleted, not yet saved');
    expect(notice).not.toContain('new');
  });

  it('names both when both happened', () => {
    expect(unsavedChangeNotice({ added: 1, deleted: 2 })).toBe(
      '1 entry added and 2 deleted, not yet saved',
    );
  });

  it('is null when nothing changed', () => {
    expect(unsavedChangeNotice({ added: 0, deleted: 0 })).toBeNull();
  });

  it('pluralises correctly at one', () => {
    expect(unsavedChangeNotice({ added: 1, deleted: 0 })).toBe('1 entry not yet saved');
    expect(unsavedChangeNotice({ added: 0, deleted: 1 })).toBe('1 entry deleted, not yet saved');
  });
});
