import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  openTabSync,
  shouldApply,
  strongest,
  TAB_SYNC_MAX_AGE_MS,
  type TabSyncKind,
} from './tabSync';

const SELF = { wallet: '0xAbC0000000000000000000000000000000000001', network: 'mainnet', now: 1_000_000 };
const OK = { kind: 'pointer' as const, wallet: SELF.wallet.toLowerCase(), network: 'mainnet', at: SELF.now };

describe('shouldApply', () => {
  it('accepts a well-formed message for this wallet and network', () => {
    expect(shouldApply(OK, SELF)).toBe(true);
  });

  it('is case-insensitive about the address', () => {
    // Wallets hand back mixed-case checksummed addresses; storage keys are
    // lowercase. A case mismatch must not silently mean "never converge".
    expect(shouldApply({ ...OK, wallet: SELF.wallet.toUpperCase() }, SELF)).toBe(true);
  });

  it('IGNORES another wallet — one wallet must never reflect another', () => {
    expect(shouldApply({ ...OK, wallet: '0x' + 'b'.repeat(40) }, SELF)).toBe(false);
  });

  it('IGNORES the other network', () => {
    // One network per build, but a user can have both open. A mainnet tab
    // absorbing a testnet pointer would show the wrong root as its own.
    expect(shouldApply({ ...OK, network: 'testnet' }, SELF)).toBe(false);
  });

  it('IGNORES everything when this tab has no wallet', () => {
    // Locked or disconnected: no key to re-read with, and unlocking hydrates
    // from scratch anyway.
    expect(shouldApply(OK, { ...SELF, wallet: null })).toBe(false);
  });

  it('ignores a stale burst from a tab that was suspended', () => {
    expect(shouldApply({ ...OK, at: SELF.now - TAB_SYNC_MAX_AGE_MS - 1 }, SELF)).toBe(false);
    expect(shouldApply({ ...OK, at: SELF.now - TAB_SYNC_MAX_AGE_MS + 1 }, SELF)).toBe(true);
  });

  it('ignores a message from the future beyond plausible clock skew', () => {
    expect(shouldApply({ ...OK, at: SELF.now + TAB_SYNC_MAX_AGE_MS + 1 }, SELF)).toBe(false);
  });

  it('rejects malformed input rather than trusting the channel', () => {
    // Same origin is not the same as trusted: another page on this origin, or a
    // future version of this app, can post anything.
    for (const bad of [
      null,
      undefined,
      'pointer',
      42,
      {},
      { ...OK, kind: 'everything' },
      { ...OK, kind: undefined },
      { ...OK, at: 'soon' },
      { ...OK, at: Number.NaN },
      { ...OK, wallet: 123 },
      { ...OK, network: null },
    ]) {
      expect(shouldApply(bad, SELF), JSON.stringify(bad)).toBe(false);
    }
  });

  it('carries no journal content — the shape has no room for any', () => {
    // The message is a nudge, not a transport. The receiver re-reads its own
    // IndexedDB, which keeps plaintext off the channel entirely instead of
    // relying on same-origin to make it acceptable.
    expect(Object.keys(OK).sort()).toEqual(['at', 'kind', 'network', 'wallet']);
  });
});

describe('strongest', () => {
  it('collapses a burst to the kind that subsumes the others', () => {
    // A save writes entries AND moves the pointer, so both land in one tick.
    // Re-reading turns re-reads the pointer too, so this is correct rather
    // than merely cheaper.
    expect(strongest(['pointer', 'turns'])).toBe('turns');
    expect(strongest(['turns', 'pointer'])).toBe('turns');
  });

  it('stays cheap when only a pointer moved', () => {
    expect(strongest(['pointer', 'pointer'])).toBe('pointer');
  });

  it('is null for nothing', () => {
    expect(strongest([])).toBeNull();
  });

  it('handles every kind', () => {
    const all: TabSyncKind[] = ['pointer', 'turns'];
    for (const k of all) expect(strongest([k])).toBe(k);
  });
});

describe('openTabSync degrades instead of breaking', () => {
  it('returns a working no-op where BroadcastChannel does not exist', () => {
    // Node has no BroadcastChannel in this vitest env, which is the same shape
    // as SSR and as a privacy mode that throws on construction. Journaling must
    // not depend on a convenience.
    const sync = openTabSync(() => {});
    expect(() => sync.post('pointer', '0xabc', 'mainnet')).not.toThrow();
    expect(() => sync.close()).not.toThrow();
    // Closing twice is what React strict-mode double-invocation produces.
    expect(() => sync.close()).not.toThrow();
  });
});

describe('the post sites fire only after a write COMMITTED', () => {
  // This is the part a pure test cannot reach, and the part that would be
  // silently wrong: nudging before the write lands tells the other tab to read
  // an entry that is not there, or to hide one that was never deleted. Both
  // sites had a rollback path already, so the ordering is load-bearing.
  const src = readFileSync(join(process.cwd(), 'lib/hooks/useJournalMemory.ts'), 'utf8');

  it('useJournalMemory is readable — otherwise every check below is vacuous', () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it('addTurn nudges from .then(), never before the persist resolves', () => {
    expect(src).toMatch(/persistTurn\([^)]*\)\s*\n?\s*(\/\/[^\n]*\n\s*)*\.then\(\(\) => notifyTabs\('turns'\)\)/);
  });

  it('deleteTurn nudges after the transaction, not before the rollback path', () => {
    const del = src.slice(src.indexOf('await db.deleteTurn'));
    const nudge = del.indexOf("notifyTabs('turns')");
    const rollback = del.indexOf('Honest rollback');
    expect(nudge).toBeGreaterThan(-1);
    expect(nudge, 'the nudge must come after the rollback branch').toBeGreaterThan(rollback);
  });

  it('a save nudges both kinds, since it moves the pointer AND publishes turns', () => {
    const save = src.slice(src.indexOf('setPointerLost(!pointerPersisted)'));
    expect(save).toContain("notifyTabs('pointer')");
    expect(save).toContain("notifyTabs('turns')");
  });

  it('the receiver validates before acting on anything off the channel', () => {
    expect(src).toContain('shouldApply(data,');
    expect(src).toContain('strongest(pending)');
  });
});
