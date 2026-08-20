import { describe, expect, it } from 'vitest';

import {
  auditMutationCache,
  isSigningMutationKey,
  leakReport,
  looksLikeSignature,
  type CachedMutation,
} from './cacheAudit';
import { KEY_DERIVATION_MESSAGE } from './keys';

const SIGNATURE = '0x' + 'ab'.repeat(65); // 65 bytes — a real ECDSA signature
const LONG_SIGNATURE = '0x' + 'cd'.repeat(200); // ERC-1271 / 6492 smart-account
const TX_HASH = '0x' + 'ef'.repeat(32); // 32 bytes — harmless, and everywhere

describe('looksLikeSignature', () => {
  it('recognises a 65-byte signature and longer smart-account ones', () => {
    expect(looksLikeSignature(SIGNATURE)).toBe(true);
    expect(looksLikeSignature(LONG_SIGNATURE)).toBe(true);
  });

  it('does NOT flag a transaction hash — the length threshold is the discriminator', () => {
    // This app's caches are full of tx hashes and root hashes. Flagging them
    // would make the audit noise, and noise gets switched off.
    expect(looksLikeSignature(TX_HASH)).toBe(false);
    expect(looksLikeSignature('0x' + 'aa'.repeat(20))).toBe(false); // an address
  });

  it('ignores non-strings and non-hex', () => {
    for (const v of [undefined, null, 42, {}, [], '0xnothex', 'ab'.repeat(65)]) {
      expect(looksLikeSignature(v), String(v)).toBe(false);
    }
  });
});

describe('isSigningMutationKey', () => {
  it('flags the wagmi signing hooks', () => {
    expect(isSigningMutationKey(['signMessage'])).toBe(true);
    expect(isSigningMutationKey(['signTypedData'])).toBe(true);
  });

  it('leaves every other mutation alone', () => {
    for (const key of [['writeContract'], ['connect'], ['sendTransaction'], undefined, []]) {
      expect(isSigningMutationKey(key), JSON.stringify(key)).toBe(false);
    }
  });
});

describe('auditMutationCache', () => {
  it('is clean for an empty cache', () => {
    expect(auditMutationCache([])).toEqual([]);
    expect(leakReport(auditMutationCache([]))).toBeNull();
  });

  it('reports both the hook and the retained signature', () => {
    const entries: CachedMutation[] = [
      { mutationKey: ['signMessage'], data: SIGNATURE, variables: { message: 'x' } },
    ];
    const leaks = auditMutationCache(entries);
    expect(leaks).toHaveLength(2);
    expect(leaks.map((l) => l.where).sort()).toEqual(['data', 'mutationKey']);
  });

  it('passes the mutations this app legitimately has', () => {
    // useWriteContract for mint/anchor, useConnect from RainbowKit.
    const entries: CachedMutation[] = [
      { mutationKey: ['writeContract'], data: TX_HASH, variables: { functionName: 'anchorMemoryRoot' } },
      { mutationKey: ['connect'], data: { accounts: ['0xabc'] }, variables: {} },
    ];
    expect(auditMutationCache(entries)).toEqual([]);
  });

  it('catches the derivation message wherever it is nested', () => {
    const entries: CachedMutation[] = [
      { mutationKey: ['somethingElse'], variables: { message: KEY_DERIVATION_MESSAGE } },
    ];
    const leaks = auditMutationCache(entries);
    expect(leaks).toHaveLength(1);
    expect(leaks[0]!.where).toBe('variables');
  });

  it('catches a signature retained under an innocent-looking key', () => {
    // Shape-based, so renaming the hook does not evade the audit.
    const leaks = auditMutationCache([{ mutationKey: ['myCustomSigner'], data: SIGNATURE }]);
    expect(leaks).toHaveLength(1);
    expect(leaks[0]!.where).toBe('data');
  });

  it('does not recurse forever on a deep or cyclic-looking structure', () => {
    let nested: unknown = KEY_DERIVATION_MESSAGE;
    for (let i = 0; i < 12; i++) nested = { inner: nested };
    // Bounded depth: it stops looking rather than hanging. Missing a
    // twelve-deep nesting is acceptable; hanging the app is not.
    expect(() => auditMutationCache([{ variables: nested }])).not.toThrow();
  });
});

describe('leakReport', () => {
  it('never contains the leaked value itself', () => {
    const report = leakReport(auditMutationCache([{ mutationKey: ['signMessage'], data: SIGNATURE }]))!;
    expect(report).not.toContain(SIGNATURE);
    expect(report).not.toContain(SIGNATURE.slice(2, 40));
  });

  it('names the file and the claim it protects, so the fix is findable', () => {
    const report = leakReport(auditMutationCache([{ mutationKey: ['signMessage'] }]))!;
    expect(report).toContain('lib/crypto/cacheAudit.ts');
    expect(report).toContain('docs/privacy-model.md');
    expect(report).toContain('signMessage from wagmi/actions');
  });

  it('is null when there is nothing to report', () => {
    expect(leakReport([])).toBeNull();
  });
});
