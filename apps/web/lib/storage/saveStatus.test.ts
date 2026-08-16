import { describe, expect, it } from 'vitest';

import { ZG_MAINNET, ZG_TESTNET, type StorageReceipt, type ZgNetworkKey } from '@lumen/shared';

import { foreignPointerNotice, isDirty, syncStatus, type SyncStatus } from './saveStatus';

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
