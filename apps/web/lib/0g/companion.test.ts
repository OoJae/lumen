import { describe, expect, it } from 'vitest';

import { LUMEN_COMPANION_ABI, type StorageReceipt } from '@lumen/shared';

import {
  buildDataDescription,
  companionFailure,
  companionState,
  COMPANION_DATA_DESCRIPTION,
  COMPANION_METADATA,
  COMPANION_METADATA_MAX_BYTES,
  isZeroRoot,
  namesToken,
  sameRoot,
  shortRoot,
  ZERO_ROOT,
  type CompanionReads,
  type CompanionState,
  type FailurePhase,
} from './companion';

const ROOT_A = '0xb6fcacd4a48bc26a0678318d7a6edac6513fb895648f7de38b6bf0c55884bf7d';
const ROOT_B = '0x609f4ae108aa1f5b9b1e6f8a1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e5';
const ROOT_C = '0x1111111111111111111111111111111111111111111111111111111111111111';

function receipt(rootHash: string, prevRootHash?: string | null): StorageReceipt {
  return {
    seq: 2,
    rootHash,
    txHash: '0xtx',
    paddedBytes: 4096,
    turnCount: 5,
    savedAt: '2026-08-16T00:00:00.000Z',
    network: 'mainnet',
    ...(prevRootHash !== undefined ? { prevRootHash } : {}),
  };
}

const OK = (over: Partial<CompanionReads> = {}): CompanionReads => ({
  status: 'ok',
  tokenId: 0n,
  root: ZERO_ROOT,
  anchorCount: 0,
  ...over,
});

const BASE = {
  wallet: '0xwallet',
  unlocked: true,
  contractConfigured: true,
  receipt: null as StorageReceipt | null,
  writing: null as 'mint' | 'anchor' | null,
};

describe('root helpers', () => {
  it('compares case-insensitively and never throws on junk', () => {
    expect(sameRoot(ROOT_A, ROOT_A.toUpperCase())).toBe(true);
    expect(sameRoot(ROOT_A, ROOT_B)).toBe(false);
    expect(sameRoot(null, null)).toBe(false);
    expect(sameRoot(undefined, ROOT_A)).toBe(false);
    expect(sameRoot('', '')).toBe(false);
  });

  it('detects the zero root', () => {
    expect(isZeroRoot(ZERO_ROOT)).toBe(true);
    expect(isZeroRoot(ZERO_ROOT.toUpperCase())).toBe(true);
    expect(isZeroRoot(null)).toBe(true);
    expect(isZeroRoot(ROOT_A)).toBe(false);
  });

  it('shortens roots consistently', () => {
    expect(shortRoot(ROOT_A)).toBe('0xb6fcacd4…bf7d');
    expect(shortRoot('0xshort')).toBe('0xshort');
  });
});

describe('companionState', () => {
  it('handles the pre-companion states', () => {
    expect(companionState({ ...BASE, wallet: null, reads: OK() })).toBe('no-wallet');
    expect(companionState({ ...BASE, contractConfigured: false, reads: OK() })).toBe('unsupported');
    expect(companionState({ ...BASE, unlocked: false, reads: OK() })).toBe('locked');
    expect(companionState({ ...BASE, reads: OK() })).toBe('nothing-to-mint');
  });

  it('offers a mint only once a save exists on THIS network', () => {
    expect(companionState({ ...BASE, reads: OK(), receipt: receipt(ROOT_A) })).toBe('mintable');
    // save.receipt is already active-network-only, so a foreign-only journal
    // (receipt === null) can never be mintable here.
    expect(companionState({ ...BASE, reads: OK(), receipt: null })).toBe('nothing-to-mint');
  });

  it('distinguishes anchored states', () => {
    const minted = (root: string) => OK({ tokenId: 7n, root });

    expect(companionState({ ...BASE, reads: minted(ZERO_ROOT), receipt: receipt(ROOT_A) })).toBe(
      'unanchored',
    );
    expect(companionState({ ...BASE, reads: minted(ROOT_A), receipt: null })).toBe('anchor-only');
    expect(companionState({ ...BASE, reads: minted(ROOT_A), receipt: receipt(ROOT_A) })).toBe(
      'synced',
    );
    // one step behind: the on-chain root is exactly what this save superseded
    expect(
      companionState({ ...BASE, reads: minted(ROOT_B), receipt: receipt(ROOT_A, ROOT_B) }),
    ).toBe('ahead');
    // unknown ordering — we must not claim to know which is newer
    expect(
      companionState({ ...BASE, reads: minted(ROOT_C), receipt: receipt(ROOT_A, ROOT_B) }),
    ).toBe('diverged');
    // a Wave-2 receipt with no prevRootHash can only ever be 'diverged'
    expect(companionState({ ...BASE, reads: minted(ROOT_B), receipt: receipt(ROOT_A) })).toBe(
      'diverged',
    );
  });

  it('reports writes in flight', () => {
    expect(companionState({ ...BASE, reads: OK(), writing: 'mint' })).toBe('minting');
    expect(companionState({ ...BASE, reads: OK({ tokenId: 7n }), writing: 'anchor' })).toBe(
      'anchoring',
    );
  });

  it('THE INVARIANT: an unresolved or failed read never names a token', () => {
    // The bug this forbids: `tokenId = data ?? 0n` while loading offers a mint
    // to someone who already owns one — a lie followed by a failed transaction.
    for (const status of ['loading', 'error'] as const) {
      for (const tokenId of [0n, 7n]) {
        for (const root of [ZERO_ROOT, ROOT_A]) {
          for (const rec of [null, receipt(ROOT_A), receipt(ROOT_A, ROOT_B)]) {
            for (const writing of [null, 'mint', 'anchor'] as const) {
              const state = companionState({
                ...BASE,
                reads: { status, tokenId, root, anchorCount: 0 },
                receipt: rec,
                writing,
              });
              expect(namesToken(state)).toBe(false);
              expect(state).not.toBe('mintable');
              expect(['checking', 'unreadable', 'minting', 'anchoring']).toContain(state);
            }
          }
        }
      }
    }
  });
});

describe('mint metadata', () => {
  it('is a valid data URI that round-trips', () => {
    expect(COMPANION_DATA_DESCRIPTION.startsWith('data:application/json,')).toBe(true);
    const json = decodeURI(COMPANION_DATA_DESCRIPTION.slice('data:application/json,'.length));
    expect(JSON.parse(json)).toEqual(COMPANION_METADATA);
  });

  it('cannot be truncated by a stray "#" — the one real URI hazard', () => {
    expect(COMPANION_DATA_DESCRIPTION).not.toContain('#');
    expect(() => decodeURI(COMPANION_DATA_DESCRIPTION)).not.toThrow();
    expect(() => buildDataDescription({ note: 'has # fragment' })).toThrow(/truncate/);

    // Why it matters: encodeURI PRESERVES '#', so it survives into the URI and
    // everything after it is lost when the URI is parsed — permanently, on-chain.
    const withHash = `data:application/json,${encodeURI('{"n":"a#b"}')}`;
    expect(withHash.split('#')[0]).not.toBe(withHash);

    // And why '%' is NOT guarded: encodeURI escapes it to %25 and it round-trips.
    const withPercent = `data:application/json,${encodeURI('{"n":"100% x"}')}`;
    expect(decodeURI(withPercent.slice('data:application/json,'.length))).toBe('{"n":"100% x"}');
  });

  it('stays inside the on-chain byte budget the minter pays for', () => {
    expect(new TextEncoder().encode(COMPANION_DATA_DESCRIPTION).length).toBeLessThanOrEqual(
      COMPANION_METADATA_MAX_BYTES,
    );
  });

  it('is identical for every companion — no personal data at all', () => {
    const json = JSON.stringify(COMPANION_METADATA);
    expect(json).not.toMatch(/0x[0-9a-fA-F]{6,}/); // no address, no root
    expect(json.toLowerCase()).not.toContain('wallet 0x');
    for (const field of ['timestamp', 'mintedAt', 'entries', 'turnCount', 'network', 'chainId']) {
      expect(json).not.toContain(field);
    }
  });

  it('states the transfer limitation and avoids overclaiming words', () => {
    const json = JSON.stringify(COMPANION_METADATA).toLowerCase();
    expect(json).toContain('transfers revert');
    for (const word of ['rollback', 'guaranteed', 'anonymous', 'unhackable']) {
      expect(json).not.toContain(word);
    }
  });
});

describe('companionFailure', () => {
  const ctx = (phase: FailurePhase = 'submit') =>
    ({ action: 'anchor' as const, phase, networkLabel: '0G mainnet' });

  it('maps EVERY custom error in the deployed ABI to real copy', () => {
    // Guards against a new contract error silently becoming "execution reverted".
    const errorNames = LUMEN_COMPANION_ABI.filter((e) => e.type === 'error').map(
      (e) => (e as { name: string }).name,
    );
    expect(errorNames.length).toBeGreaterThan(10);

    for (const errorName of errorNames) {
      const failure = companionFailure({ kind: 'revert', errorName, args: [1n, ROOT_A, ROOT_B] }, ctx());
      expect(failure.code).toBe(errorName);
      expect(failure.message.length).toBeGreaterThan(20);
    }
  });

  it('never confuses "nothing was sent" with "the fee was spent"', () => {
    const cases: Parameters<typeof companionFailure>[0][] = [
      { kind: 'revert', errorName: 'SameRoot', args: [ROOT_A] },
      { kind: 'revert', errorName: 'AlreadyHasCompanion', args: ['0xowner', 3n] },
      { kind: 'revert', errorName: 'SomethingNew' },
    ];
    for (const raw of cases) {
      expect(companionFailure(raw, ctx('submit')).message).not.toContain('fee was spent');
      expect(companionFailure(raw, ctx('onchain')).message).not.toContain('Nothing was sent');
    }
  });

  it('writes specific copy for the errors a user can actually cause', () => {
    expect(
      companionFailure({ kind: 'revert', errorName: 'AlreadyHasCompanion', args: ['0xo', 7n] }, ctx())
        .message,
    ).toContain('Companion #7');

    const stale = companionFailure(
      { kind: 'revert', errorName: 'StaleAnchor', args: [1n, ROOT_B, ROOT_A] },
      ctx(),
    );
    expect(stale.message).toContain(shortRoot(ROOT_A)); // the ACTUAL on-chain root
    expect(stale.refetch).toBe(true);

    expect(
      companionFailure({ kind: 'revert', errorName: 'SameRoot', args: [ROOT_A] }, ctx()).message,
    ).toContain('nothing to anchor');

    expect(
      companionFailure({ kind: 'revert', errorName: 'OracleNotLive' }, ctx()).message,
    ).toContain('TEE re-encryption oracle');
  });

  it('handles the non-revert failures', () => {
    expect(companionFailure({ kind: 'rejected' }, { ...ctx(), action: 'mint' }).message).toBe(
      'Mint cancelled — nothing was sent.',
    );
    expect(companionFailure({ kind: 'insufficient-funds' }, ctx()).funding).toBe(true);
    expect(companionFailure({ kind: 'wrong-chain', message: 'on Ethereum' }, ctx()).message).toBe(
      'on Ethereum',
    );
    expect(companionFailure({ kind: 'network' }, ctx()).message).toContain("won't guess");
    const lost = companionFailure({ kind: 'lost', hash: '0xabc' }, ctx());
    expect(lost.message).toContain('may still confirm');
    expect(lost.refetch).toBe(true);
  });
});

describe('namesToken', () => {
  it('covers exactly the states that print a token id', () => {
    const naming: CompanionState[] = ['unanchored', 'synced', 'ahead', 'diverged', 'anchor-only'];
    const silent: CompanionState[] = [
      'no-wallet',
      'locked',
      'unsupported',
      'checking',
      'unreadable',
      'nothing-to-mint',
      'mintable',
      'minting',
      'anchoring',
    ];
    for (const s of naming) expect(namesToken(s)).toBe(true);
    for (const s of silent) expect(namesToken(s)).toBe(false);
  });
});
