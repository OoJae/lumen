import { describe, expect, it } from 'vitest';

import type { StorageReceipt } from '@lumen/shared';

import {
  deleteCopy,
  deletedNotSavedNotice,
  emptiedNotice,
  restoreSkippedNotice,
  type DeleteCopyInput,
} from './deleteCopy';

const ROOT = '0x94f51264d5288f3359020eb37be3008445f0ca61591a414c46d814bdf6fd4e5d';

function receipt(over: Partial<StorageReceipt> = {}): StorageReceipt {
  return {
    seq: 2,
    rootHash: ROOT,
    txHash: '0xtx',
    paddedBytes: 8192,
    turnCount: 5,
    savedAt: '2026-08-12T10:00:00.000Z',
    network: 'mainnet',
    ...over,
  };
}

const BRANCHES: DeleteCopyInput[] = [
  // A: nothing ever saved
  { receipt: null, foreign: null, anchoredRoot: null, networkLabel: '0G mainnet' },
  // B: saved, not anchored
  { receipt: receipt(), foreign: null, anchoredRoot: null, networkLabel: '0G mainnet' },
  // C: saved and anchored
  { receipt: receipt(), foreign: null, anchoredRoot: ROOT, networkLabel: '0G mainnet' },
  // D: snapshot only on the other network
  {
    receipt: null,
    foreign: receipt({ network: 'testnet' }),
    anchoredRoot: null,
    networkLabel: '0G mainnet',
  },
];

function allText(input: DeleteCopyInput): string {
  const c = deleteCopy(input);
  return [c.title, c.removed, c.notRemoved, c.anchored, c.otherDevices, c.finality]
    .filter(Boolean)
    .join(' ');
}

describe('delete copy never overclaims', () => {
  const BANNED =
    /\b(permanently|forever|everywhere|erased|wiped|scrubbed|unrecoverable|irreversibly)\b/i;

  it('uses no absolute-erasure language in any branch', () => {
    for (const branch of BRANCHES) {
      const text = allText(branch);
      expect(text, text.slice(0, 120)).not.toMatch(BANNED);
    }
  });

  it('never claims anything is removed from 0G', () => {
    for (const branch of BRANCHES) {
      const text = allText(branch).toLowerCase();
      expect(text).not.toContain('deleted from 0g');
      expect(text).not.toContain('removed from 0g');
      expect(text).not.toContain('erase');
    }
  });

  it('discloses the tombstone in every branch — it is not optional', () => {
    for (const branch of BRANCHES) {
      expect(allText(branch)).toContain('marker');
    }
  });

  it('always says what other devices do', () => {
    for (const branch of BRANCHES) {
      expect(deleteCopy(branch).otherDevices).toContain('until they restore');
    }
  });

  it('always ends on the finality line', () => {
    for (const branch of BRANCHES) {
      expect(deleteCopy(branch).finality).toBe('This cannot be undone.');
    }
  });

  it('does not default to the destructive action', () => {
    const c = deleteCopy(BRANCHES[0]!);
    expect(c.cancel).toBe('Keep it');
    expect(c.confirm).toBe('Delete entry');
  });
});

describe('delete copy is accurate per branch', () => {
  it('says nothing has left the device when nothing has', () => {
    const c = deleteCopy(BRANCHES[0]!);
    expect(c.notRemoved).toContain('never left this device');
    expect(c.anchored).toBeNull();
  });

  it('names the snapshot, its size and its root when one exists', () => {
    const c = deleteCopy(BRANCHES[1]!);
    expect(c.notRemoved).toContain('0x94f51264…f6fd4e5d');
    expect(c.notRemoved).toContain('5 entries');
    expect(c.notRemoved).toContain('2026-08-12');
  });

  it('hedges correctly about whether THIS entry was in that snapshot', () => {
    // Lumen cannot know without downloading and decrypting it, so the sentence
    // must be conditional rather than confidently wrong in either direction.
    expect(deleteCopy(BRANCHES[1]!).notRemoved).toContain('if this entry was in it, it still is');
  });

  it('states that nobody can unpublish it, including us', () => {
    expect(deleteCopy(BRANCHES[1]!).notRemoved).toContain('including us');
  });

  it('adds the on-chain consequence only when anchored', () => {
    expect(deleteCopy(BRANCHES[1]!).anchored).toBeNull();
    const anchored = deleteCopy(BRANCHES[2]!).anchored!;
    expect(anchored).toContain('anchor history');
    expect(anchored).toContain('0G mainnet');
  });

  it('names the OTHER network when the only snapshot lives there', () => {
    const c = deleteCopy(BRANCHES[3]!);
    expect(c.notRemoved).toContain('testnet');
    expect(c.anchored).toBeNull();
  });
});

describe('post-delete notices', () => {
  it('says what the last snapshot still holds', () => {
    const notice = deletedNotSavedNotice(2, receipt(), false)!;
    expect(notice).toContain('2 entries you deleted are still in your last snapshot');
    expect(notice).toContain('the old snapshot stays where it is');
  });

  it('adds the anchor step only when anchored', () => {
    expect(deletedNotSavedNotice(1, receipt(), false)).not.toContain('anchor');
    expect(deletedNotSavedNotice(1, receipt(), true)).toContain('Then anchor it');
  });

  it('is null with nothing deleted or nothing saved', () => {
    expect(deletedNotSavedNotice(0, receipt(), false)).toBeNull();
    expect(deletedNotSavedNotice(2, null, false)).toBeNull();
  });

  it('pluralises the single case', () => {
    expect(deletedNotSavedNotice(1, receipt(), false)).toContain('1 entry you deleted is still');
  });

  it('says the device is empty without claiming the snapshot is', () => {
    const notice = emptiedNotice(receipt());
    expect(notice).toContain('Nothing is on this device now');
    expect(notice).toContain('still holds 5 entries');
    expect(notice).not.toMatch(/\b(permanently|erased)\b/i);
  });

  it('reports entries a restore deliberately skipped', () => {
    expect(restoreSkippedNotice(4, 1)).toBe('Restored 4 entries. 1 entry you deleted was not restored.');
    expect(restoreSkippedNotice(4, 0)).toBeNull();
  });
});
