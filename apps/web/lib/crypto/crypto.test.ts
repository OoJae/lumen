import { describe, it, expect } from 'vitest';
import { deriveAesKey, deriveKeyMaterial, getKeyDerivationMessage, hexToBytes } from './keys';
import {
  encryptString,
  decryptString,
  encryptJSON,
  decryptJSON,
  bytesToBase64,
  base64ToBytes,
} from './encrypt';

// Two distinct fake 65-byte ECDSA-shaped signatures.
const SIG_A = '0x' + 'ab'.repeat(65);
const SIG_B = '0x' + 'cd'.repeat(65);

describe('key derivation', () => {
  it('is deterministic for the same signature', async () => {
    const a1 = await deriveKeyMaterial(SIG_A);
    const a2 = await deriveKeyMaterial(SIG_A);
    expect(a1.length).toBe(32);
    expect(bytesToBase64(a1)).toBe(bytesToBase64(a2));
  });

  it('produces different keys for different signatures', async () => {
    const a = await deriveKeyMaterial(SIG_A);
    const b = await deriveKeyMaterial(SIG_B);
    expect(bytesToBase64(a)).not.toBe(bytesToBase64(b));
  });

  it('parses hex with and without 0x prefix identically', () => {
    expect(Array.from(hexToBytes('0xff00'))).toEqual([255, 0]);
    expect(Array.from(hexToBytes('ff00'))).toEqual([255, 0]);
  });

  it('exposes a stable, reassuring derivation message', () => {
    expect(getKeyDerivationMessage()).toContain('never');
  });
});

describe('AES-GCM round-trip', () => {
  it('encrypts then decrypts a string', async () => {
    const key = await deriveAesKey(SIG_A);
    const blob = await encryptString(key, 'my most private thought');
    expect(blob.alg).toBe('AES-GCM');
    expect(blob.ciphertext).not.toContain('private'); // not plaintext
    const out = await decryptString(key, blob);
    expect(out).toBe('my most private thought');
  });

  it('round-trips structured JSON', async () => {
    const key = await deriveAesKey(SIG_A);
    const data = { entry: 'today was hard', mood: 3, tags: ['work', 'tired'] };
    const blob = await encryptJSON(key, data);
    const out = await decryptJSON<typeof data>(key, blob);
    expect(out).toEqual(data);
  });

  it('cannot be decrypted with the wrong key', async () => {
    const key = await deriveAesKey(SIG_A);
    const wrongKey = await deriveAesKey(SIG_B);
    const blob = await encryptString(key, 'secret');
    await expect(decryptString(wrongKey, blob)).rejects.toBeDefined();
  });

  it('uses a fresh IV per encryption (no nonce reuse)', async () => {
    const key = await deriveAesKey(SIG_A);
    const b1 = await encryptString(key, 'same plaintext');
    const b2 = await encryptString(key, 'same plaintext');
    expect(b1.iv).not.toBe(b2.iv);
    expect(b1.ciphertext).not.toBe(b2.ciphertext);
  });
});

describe('base64 helpers', () => {
  it('round-trip arbitrary bytes including 0 and 255', () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual([0, 1, 2, 127, 128, 254, 255]);
  });
});
