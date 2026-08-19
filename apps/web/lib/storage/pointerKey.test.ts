import { describe, expect, it } from 'vitest';

import type { StorageReceipt } from '@lumen/shared';

import { isStorageReceipt, LEGACY_POINTER_KEY, pointerKey, stampNetwork } from './pointerKey';

const WAVE2_RECEIPT = {
  seq: 3,
  rootHash: '0xabc123',
  txHash: '0xdef456',
  paddedBytes: 4096,
  turnCount: 5,
  savedAt: '2026-08-01T00:00:00.000Z',
};

describe('pointerKey', () => {
  it('scopes each network to its own key, distinct from the legacy one', () => {
    expect(pointerKey('mainnet')).toBe('pointer:mainnet');
    expect(pointerKey('testnet')).toBe('pointer:testnet');
    expect(pointerKey('mainnet')).not.toBe(LEGACY_POINTER_KEY);
    expect(pointerKey('testnet')).not.toBe(LEGACY_POINTER_KEY);
  });
});

describe('isStorageReceipt', () => {
  it('accepts a Wave-2 receipt (no network field yet)', () => {
    expect(isStorageReceipt(WAVE2_RECEIPT)).toBe(true);
  });

  it('rejects anything malformed rather than letting the UI render undefined', () => {
    expect(isStorageReceipt(null)).toBe(false);
    expect(isStorageReceipt(undefined)).toBe(false);
    expect(isStorageReceipt({})).toBe(false);
    expect(isStorageReceipt('pointer')).toBe(false);
    expect(isStorageReceipt({ ...WAVE2_RECEIPT, seq: '3' })).toBe(false);
    expect(isStorageReceipt({ ...WAVE2_RECEIPT, rootHash: '' })).toBe(false);
    const { rootHash: _omitted, ...withoutRoot } = WAVE2_RECEIPT;
    expect(isStorageReceipt(withoutRoot)).toBe(false);
  });
});

describe('stampNetwork', () => {
  it('stamps an unscoped Wave-2 pointer as testnet — where every W2 save went', () => {
    const stamped = stampNetwork(WAVE2_RECEIPT, 'testnet');
    expect(stamped?.network).toBe('testnet');
    expect(stamped?.rootHash).toBe('0xabc123');
  });

  it('never relabels a receipt that already declares its network', () => {
    const mainnet: StorageReceipt = { ...WAVE2_RECEIPT, network: 'mainnet' };
    // Even if read through the wrong key, the receipt's own claim wins.
    expect(stampNetwork(mainnet, 'testnet')?.network).toBe('mainnet');
  });

  it('returns null for garbage instead of a half-built receipt', () => {
    expect(stampNetwork(null, 'mainnet')).toBeNull();
    expect(stampNetwork({ nope: true }, 'mainnet')).toBeNull();
  });
});

describe('deletionCount on a receipt', () => {
  const base = {
    seq: 1,
    rootHash: '0xroot',
    txHash: '0xtx',
    paddedBytes: 4096,
    turnCount: 3,
    savedAt: '2026-08-19T10:00:00.000Z',
  };

  it('accepts a receipt that predates the field', () => {
    expect(isStorageReceipt(base)).toBe(true);
  });

  it('accepts a numeric count', () => {
    expect(isStorageReceipt({ ...base, deletionCount: 2 })).toBe(true);
  });

  it('rejects a corrupt count rather than letting NaN reach syncStatus', () => {
    expect(isStorageReceipt({ ...base, deletionCount: 'two' })).toBe(false);
    expect(isStorageReceipt({ ...base, deletionCount: null })).toBe(false);
  });
});
