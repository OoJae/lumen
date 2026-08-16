import { describe, expect, it } from 'vitest';

import fixture from './__fixtures__/teeProof.json';
import {
  parseSignedText,
  sha256Hex,
  verifyTeeProof,
  type TeeSignatureProof,
} from './verify';

/**
 * The fixture is a REAL proof captured live from our 0G mainnet provider
 * (glm-5.1, TeeML) — raw streamed bytes plus the enclave's signature over them.
 * If the provider ever changes its signing scheme, these tests fail loudly
 * rather than the app quietly downgrading in front of a judge.
 */
const RAW = Uint8Array.from(Buffer.from(fixture.rawResponseBase64, 'base64'));
const PROOF: TeeSignatureProof = {
  text: fixture.text,
  signature: fixture.signature as `0x${string}`,
  signingAddress: fixture.signingAddress,
};
const ON_CHAIN_SIGNER = '0x806C12A614272f6eE23c179a3D6Bc3f68b7Eb8e5';

describe('parseSignedText', () => {
  it('splits the five signed fields', () => {
    const parsed = parseSignedText(fixture.text);
    expect(parsed.responseHash).toHaveLength(64);
    expect(parsed.requestHash).toHaveLength(64);
    expect(parsed.providerType).toBe('centralized');
    expect(parsed.providerIdentity).toBe('aliyun');
    expect(parsed.tlsFingerprint).toHaveLength(64);
  });

  it('rejects malformed text', () => {
    expect(() => parseSignedText('a:b:c')).toThrow(/Malformed/);
    expect(() => parseSignedText('a:b:c:d:')).toThrow(/Malformed/);
    expect(() => parseSignedText('')).toThrow(/Malformed/);
  });
});

describe('sha256Hex', () => {
  it('matches the response hash the enclave signed', async () => {
    const computed = await sha256Hex(RAW);
    expect(computed).toBe(parseSignedText(fixture.text).responseHash);
  });

  it('is byte-exact — any mutation changes the digest', async () => {
    const trimmed = RAW.slice(0, RAW.length - 1);
    expect(await sha256Hex(trimmed)).not.toBe(await sha256Hex(RAW));
  });
});

describe('verifyTeeProof', () => {
  it('verifies a real streamed response end to end', async () => {
    const verdict = await verifyTeeProof(PROOF, RAW, ON_CHAIN_SIGNER);
    expect(verdict.ok).toBe(true);
    expect(verdict.checks).toEqual({ signature: true, responseHash: true });
    expect(verdict.recovered?.toLowerCase()).toBe(ON_CHAIN_SIGNER.toLowerCase());
    expect(verdict.reason).toBeUndefined();
  });

  it('accepts the on-chain signer in any letter case', async () => {
    const verdict = await verifyTeeProof(PROOF, RAW, ON_CHAIN_SIGNER.toLowerCase());
    expect(verdict.ok).toBe(true);
  });

  it('catches tampered response bytes (the check processResponse skips)', async () => {
    const tampered = Uint8Array.from(RAW);
    tampered[tampered.length - 2] = tampered[tampered.length - 2]! ^ 0x01;

    const verdict = await verifyTeeProof(PROOF, tampered, ON_CHAIN_SIGNER);
    expect(verdict.ok).toBe(false);
    expect(verdict.checks.signature).toBe(true); // signature itself still valid…
    expect(verdict.checks.responseHash).toBe(false); // …but it doesn't cover these bytes
    expect(verdict.reason).toBe('hash-mismatch');
  });

  it('rejects a signature from the wrong signer', async () => {
    const verdict = await verifyTeeProof(
      PROOF,
      RAW,
      '0x0000000000000000000000000000000000000001',
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.checks.signature).toBe(false);
    expect(verdict.reason).toBe('signer-mismatch');
  });

  it('rejects a forged signed text (recovers to a different address)', async () => {
    const forged: TeeSignatureProof = {
      ...PROOF,
      text: PROOF.text.replace('centralized', 'confidential'),
    };
    const verdict = await verifyTeeProof(forged, RAW, ON_CHAIN_SIGNER);
    expect(verdict.ok).toBe(false);
    expect(verdict.checks.signature).toBe(false);
  });

  it('rejects a corrupt signature without throwing', async () => {
    const bad: TeeSignatureProof = { ...PROOF, signature: '0xdeadbeef' };
    const verdict = await verifyTeeProof(bad, RAW, ON_CHAIN_SIGNER);
    expect(verdict.ok).toBe(false);
    expect(verdict.recovered).toBeUndefined();
  });

  it('reports malformed signed text without throwing', async () => {
    const bad: TeeSignatureProof = { ...PROOF, text: 'nope' };
    const verdict = await verifyTeeProof(bad, RAW, ON_CHAIN_SIGNER);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('malformed-signed-text');
  });

  it('records the provider disclosure we must surface to users', async () => {
    const verdict = await verifyTeeProof(PROOF, RAW, ON_CHAIN_SIGNER);
    // Our provider proxies to an upstream host — the UI must say so.
    expect(verdict.parsed?.providerType).toBe('centralized');
    expect(verdict.parsed?.providerIdentity).toBe('aliyun');
  });
});
