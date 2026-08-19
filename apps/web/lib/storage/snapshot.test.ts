import { describe, expect, it } from 'vitest';

import type { PersistedTurnV1 } from '@lumen/shared';

import { canonicalJson } from '../crypto/canonical';
import { deriveAesKey } from '../crypto/keys';
import { mergeTombstones } from '../memory/deletions';
import {
  buildSnapshot,
  decryptSnapshot,
  encryptSnapshot,
  packVector,
  snapshotBucketBytes,
  unpackVector,
} from './snapshot';

const SIG_A = '0x' + 'ab'.repeat(65);
const SIG_B = '0x' + 'cd'.repeat(65);
const WALLET = '0x1111111111111111111111111111111111111111';
const OTHER_WALLET = '0x2222222222222222222222222222222222222222';

function turn(id: string, entry: string): PersistedTurnV1 {
  return { id, entry, reflection: `about ${entry}`, attestation: null, createdAt: '2026-08-15T12:00:00.000Z' };
}

function sampleSnapshot(seq = 3) {
  return buildSnapshot({
    wallet: WALLET.toUpperCase(), // exercises lowercase normalization
    keyVersion: 1,
    seq,
    prevRootHash: seq > 0 ? '0x' + 'aa'.repeat(32) : null,
    createdAt: '2026-08-15T12:34:56.000Z',
    turns: [turn('t1', 'first entry'), turn('t2', 'second entry')],
    vectors: [packVector('t1', [0.1, -0.5, 0.25]), packVector('t2', new Float32Array([1, 2, 3]))],
  });
}

describe('snapshot codec', () => {
  it('round-trips encrypt → decrypt with full binding checks', async () => {
    const key = await deriveAesKey(SIG_A);
    const snapshot = sampleSnapshot();
    const { bytes, paddedBytes } = await encryptSnapshot(key, snapshot);
    expect(paddedBytes).toBe(4096); // power-of-two bucket, not the envelope length
    const restored = await decryptSnapshot(key, bytes, { wallet: WALLET, keyVersion: 1, seq: 3 });
    expect(restored).toEqual(snapshot);
    expect(restored.wallet).toBe(WALLET.toLowerCase());
    expect(Array.from(unpackVector(restored.vectors[1]!))).toEqual([1, 2, 3]);
  });

  it('produces deterministic plaintext: same snapshot → same padded size bucket', async () => {
    const key = await deriveAesKey(SIG_A);
    const a = (await encryptSnapshot(key, sampleSnapshot())).bytes;
    const b = (await encryptSnapshot(key, sampleSnapshot())).bytes;
    // IVs differ, so ciphertexts differ — but the envelope byte length only
    // varies by base64 of same-length buffers, proving stable bucketing.
    expect(a.length).toBe(b.length);
  });

  it('supports restore-by-rootHash: seq omitted, read back from the AAD', async () => {
    const key = await deriveAesKey(SIG_A);
    const { bytes } = await encryptSnapshot(key, sampleSnapshot(7));
    const restored = await decryptSnapshot(key, bytes, { wallet: WALLET, keyVersion: 1 });
    expect(restored.seq).toBe(7);
  });

  it('rejects another wallet\'s snapshot', async () => {
    const key = await deriveAesKey(SIG_A);
    const { bytes } = await encryptSnapshot(key, sampleSnapshot());
    await expect(
      decryptSnapshot(key, bytes, { wallet: OTHER_WALLET, keyVersion: 1 }),
    ).rejects.toThrow(/different wallet/);
  });

  it('rejects a seq replay (snapshot 3 presented as snapshot 5)', async () => {
    const key = await deriveAesKey(SIG_A);
    const { bytes } = await encryptSnapshot(key, sampleSnapshot(3));
    await expect(
      decryptSnapshot(key, bytes, { wallet: WALLET, keyVersion: 1, seq: 5 }),
    ).rejects.toThrow(/seq mismatch/);
  });

  it('rejects the wrong key', async () => {
    const keyA = await deriveAesKey(SIG_A);
    const keyB = await deriveAesKey(SIG_B);
    const { bytes } = await encryptSnapshot(keyA, sampleSnapshot());
    await expect(
      decryptSnapshot(keyB, bytes, { wallet: WALLET, keyVersion: 1 }),
    ).rejects.toThrow();
  });

  it('rejects non-snapshot bytes with a clear error', async () => {
    const key = await deriveAesKey(SIG_A);
    await expect(
      decryptSnapshot(key, new TextEncoder().encode('not json at all {'), {
        wallet: WALLET,
        keyVersion: 1,
      }),
    ).rejects.toThrow(/unreadable envelope/);
  });

  it('reports the padded plaintext bucket, not the uploaded envelope size', async () => {
    const key = await deriveAesKey(SIG_A);
    const snapshot = sampleSnapshot();
    const { bytes, paddedBytes } = await encryptSnapshot(key, snapshot);
    // Bucket is a power of two and matches the standalone helper…
    expect(paddedBytes).toBe(snapshotBucketBytes(snapshot));
    expect(Number.isInteger(Math.log2(paddedBytes))).toBe(true);
    // …and is NOT the base64-inflated envelope JSON length.
    expect(bytes.length).toBeGreaterThan(paddedBytes);
  });

  it('vector codec round-trips through base64 with dim validation', () => {
    const pv = packVector('t9', [0.25, -1.5]);
    expect(pv.dim).toBe(2);
    expect(pv.model).toBe('all-MiniLM-L6-v2');
    expect(Array.from(unpackVector(pv))).toEqual([0.25, -1.5]);
    expect(() => unpackVector({ ...pv, dim: 3 })).toThrow(/dim mismatch/);
  });
});

describe('deletions travel with the snapshot', () => {
  const markers = [
    { id: 'gone-1', deletedAt: '2026-08-19T10:00:00.000Z' },
    { id: 'gone-2', deletedAt: '2026-08-19T11:00:00.000Z' },
  ];

  it('round-trips through encrypt/decrypt', async () => {
    const key = await deriveAesKey(SIG_A);
    const snapshot = buildSnapshot({ ...sampleSnapshot(), deletions: markers });
    const { bytes } = await encryptSnapshot(key, snapshot);
    const back = await decryptSnapshot(key, bytes, { wallet: WALLET, keyVersion: 1 });
    expect(back.deletions).toEqual(markers);
  });

  it('omits the field entirely when there are none', () => {
    const snapshot = buildSnapshot({ ...sampleSnapshot(), deletions: [] });
    expect('deletions' in snapshot).toBe(false);
    expect(canonicalJson(snapshot)).not.toContain('deletions');
  });

  it('produces bytes identical to a snapshot built without the field', () => {
    // The back-compat guarantee: existing users' snapshots must not change
    // shape, size or root hash because delete shipped.
    const withField = buildSnapshot({ ...sampleSnapshot(), deletions: [] });
    const withoutField = buildSnapshot(sampleSnapshot());
    expect(canonicalJson(withField)).toBe(canonicalJson(withoutField));
    expect(snapshotBucketBytes(withField)).toBe(snapshotBucketBytes(withoutField));
  });

  it('still decrypts a v1 snapshot that predates the field', async () => {
    const key = await deriveAesKey(SIG_A);
    const legacy = buildSnapshot(sampleSnapshot());
    const { bytes } = await encryptSnapshot(key, legacy);
    const back = await decryptSnapshot(key, bytes, { wallet: WALLET, keyVersion: 1 });
    expect(back.deletions).toBeUndefined();
    expect(back.turns).toHaveLength(legacy.turns.length);
  });

  it('is deterministic across differently ordered marker sets', () => {
    const a = buildSnapshot({ ...sampleSnapshot(), deletions: mergeTombstones(markers, []) });
    const b = buildSnapshot({
      ...sampleSnapshot(),
      deletions: mergeTombstones([markers[1]!], [markers[0]!]),
    });
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });
});
