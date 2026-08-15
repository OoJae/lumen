import { describe, expect, it } from 'vitest';

import {
  bytesToVector,
  canonicalJson,
  MIN_BUCKET_BYTES,
  padToBucket,
  unpad,
  vectorToBytes,
} from './canonical';
import {
  buildAad,
  decryptBytes,
  decryptString,
  encryptBytes,
  encryptString,
  parseAad,
  type EncryptedEnvelope,
} from './encrypt';
import { CURRENT_KEY_VERSION, deriveAesKey, getKeyDerivationMessage } from './keys';

const SIG_A = '0x' + 'ab'.repeat(65);
const SIG_B = '0x' + 'cd'.repeat(65);
const WALLET = '0x1111111111111111111111111111111111111111';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe('envelope v2 — AAD binding', () => {
  it('round-trips binary payloads with matching context', async () => {
    const key = await deriveAesKey(SIG_A);
    const payload = crypto.getRandomValues(new Uint8Array(313));
    const env = await encryptBytes(key, payload, 'turn', `${WALLET}:turn_1`, 1);
    expect(env.v).toBe(2);
    expect(env.typ).toBe('turn');
    expect(env.aad).toBe(`lumen:v2:1:turn:${WALLET}:turn_1`);
    const out = await decryptBytes(key, env, { typ: 'turn', keyVersion: 1, aadId: `${WALLET}:turn_1` });
    expect(Array.from(out)).toEqual(Array.from(payload));
  });

  it('rejects a blob presented in another slot (aadId mismatch)', async () => {
    const key = await deriveAesKey(SIG_A);
    const env = await encryptBytes(key, encoder.encode('secret'), 'turn', `${WALLET}:turn_1`, 1);
    await expect(
      decryptBytes(key, env, { typ: 'turn', keyVersion: 1, aadId: `${WALLET}:turn_2` }),
    ).rejects.toThrow(/different slot/);
  });

  it('rejects envelope-type confusion (turn presented as vector)', async () => {
    const key = await deriveAesKey(SIG_A);
    const env = await encryptBytes(key, encoder.encode('secret'), 'turn', `${WALLET}:turn_1`, 1);
    await expect(
      decryptBytes(key, env, { typ: 'vector', keyVersion: 1, aadId: `${WALLET}:turn_1` }),
    ).rejects.toThrow(/type mismatch/);
  });

  it('rejects key-version mismatch', async () => {
    const key = await deriveAesKey(SIG_A);
    const env = await encryptBytes(key, encoder.encode('secret'), 'kcv', WALLET, 1);
    await expect(
      decryptBytes(key, env, { typ: 'kcv', keyVersion: 2, aadId: WALLET }),
    ).rejects.toThrow(/key version/);
  });

  it('fails GCM auth when the aad field is rewritten to look legitimate', async () => {
    const key = await deriveAesKey(SIG_A);
    const env = await encryptBytes(key, encoder.encode('secret'), 'snapshot', `${WALLET}:1`, 1);
    // Attacker rewrites the transparent aad string (and matching typ) so the
    // structural checks pass — but the ciphertext was bound to the original AAD.
    const forged: EncryptedEnvelope = { ...env, aad: buildAad('snapshot', 1, `${WALLET}:2`) };
    await expect(
      decryptBytes(key, forged, { typ: 'snapshot', keyVersion: 1, aadId: `${WALLET}:2` }),
    ).rejects.toThrow();
  });

  it('rejects decryption with the wrong key', async () => {
    const keyA = await deriveAesKey(SIG_A);
    const keyB = await deriveAesKey(SIG_B);
    const env = await encryptBytes(keyA, encoder.encode('secret'), 'turn', `${WALLET}:t`, 1);
    await expect(
      decryptBytes(keyB, env, { typ: 'turn', keyVersion: 1, aadId: `${WALLET}:t` }),
    ).rejects.toThrow();
  });

  it('supports restore flows: id read back out of the AAD when aadId is omitted', async () => {
    const key = await deriveAesKey(SIG_A);
    const env = await encryptBytes(key, encoder.encode('snapshot-bytes'), 'snapshot', `${WALLET}:7`, 1);
    const out = await decryptBytes(key, env, { typ: 'snapshot', keyVersion: 1 });
    expect(decoder.decode(out)).toBe('snapshot-bytes');
    const parts = parseAad(env.aad);
    expect(parts).toEqual({ keyVersion: 1, typ: 'snapshot', id: `${WALLET}:7` });
  });

  it('keeps v1 blobs readable (back-compat)', async () => {
    const key = await deriveAesKey(SIG_A);
    const blob = await encryptString(key, 'wave-1 data');
    expect(blob.v).toBe(1);
    expect(await decryptString(key, blob)).toBe('wave-1 data');
  });

  it('parseAad rejects malformed and unknown-type strings', () => {
    expect(() => parseAad('lumen:v1:1:turn:x')).toThrow();
    expect(() => parseAad('lumen:v2:1:journal:x')).toThrow(/Unknown envelope type/);
  });

  it('current key version has a derivation message', () => {
    expect(getKeyDerivationMessage(CURRENT_KEY_VERSION)).toContain('Version: 1');
    expect(() => getKeyDerivationMessage(99)).toThrow(/Unknown key derivation/);
  });
});

describe('canonicalJson', () => {
  it('is insertion-order independent and stable', () => {
    const a = { z: 1, a: { d: [3, 1], c: 'x' }, m: null };
    const b = { m: null, a: { c: 'x', d: [3, 1] }, z: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":{"c":"x","d":[3,1]},"m":null,"z":1}');
  });

  it('preserves array order and skips undefined object values', () => {
    expect(canonicalJson({ a: undefined, b: [2, 1] })).toBe('{"b":[2,1]}');
  });

  it('throws on non-finite numbers', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(/non-finite/);
  });
});

describe('padToBucket / unpad', () => {
  it('round-trips and pads to power-of-two buckets ≥ 4 KiB', () => {
    const payload = crypto.getRandomValues(new Uint8Array(313));
    const padded = padToBucket(payload);
    expect(padded.length).toBe(MIN_BUCKET_BYTES);
    expect(Array.from(unpad(padded))).toEqual(Array.from(payload));
  });

  it('buckets different small sizes to the same size (leak resistance)', () => {
    expect(padToBucket(new Uint8Array(100)).length).toBe(padToBucket(new Uint8Array(3000)).length);
    expect(padToBucket(new Uint8Array(5000)).length).toBe(8192);
  });

  it('is deterministic for identical input', () => {
    const payload = new Uint8Array([1, 2, 3]);
    expect(Array.from(padToBucket(payload))).toEqual(Array.from(padToBucket(payload)));
  });

  it('unpad rejects a corrupt length prefix', () => {
    const padded = padToBucket(new Uint8Array(10));
    new DataView(padded.buffer).setUint32(0, 999999, false);
    expect(() => unpad(padded)).toThrow(/corrupt/);
  });
});

describe('vector byte codec', () => {
  it('round-trips floats in explicit little-endian', () => {
    const vec = new Float32Array([0.25, -1.5, 3.1415927, 0]);
    const bytes = vectorToBytes(vec);
    expect(bytes.length).toBe(16);
    // 0.25 as LE float32 = 00 00 80 3E
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x00, 0x00, 0x80, 0x3e]);
    expect(Array.from(bytesToVector(bytes))).toEqual(Array.from(vec));
  });

  it('rejects byte lengths that are not multiples of 4', () => {
    expect(() => bytesToVector(new Uint8Array(6))).toThrow(/multiple of 4/);
  });
});
