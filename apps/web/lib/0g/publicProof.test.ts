import { LUMEN_COMPANION_DEPLOY_BLOCK, resolveCompanionDeployBlock } from '@lumen/shared';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseAddress, PROOF_TTL_SECONDS } from './publicProof';

describe('parseAddress', () => {
  it('accepts a checksummed address', () => {
    expect(parseAddress('0xB5609C73784Aa81De2eBe01cCC04Eb7ea4ce1a52')).toBe(
      '0xB5609C73784Aa81De2eBe01cCC04Eb7ea4ce1a52',
    );
  });

  it('accepts lowercase and trims surrounding whitespace', () => {
    expect(parseAddress('  0xb5609c73784aa81de2ebe01ccc04eb7ea4ce1a52  ')).toBe(
      '0xb5609c73784aa81de2ebe01ccc04eb7ea4ce1a52',
    );
  });

  it('decodes a URL-encoded segment before validating', () => {
    expect(parseAddress('%200xB5609C73784Aa81De2eBe01cCC04Eb7ea4ce1a52')).toBe(
      '0xB5609C73784Aa81De2eBe01cCC04Eb7ea4ce1a52',
    );
  });

  it('rejects anything that is not 20 hex bytes', () => {
    for (const bad of [
      'not-an-address',
      '0x',
      '',
      '0xB5609C73784Aa81De2eBe01cCC04Eb7ea4ce1a5', // 39 nibbles
      '0xB5609C73784Aa81De2eBe01cCC04Eb7ea4ce1a521', // 41 nibbles
      'B5609C73784Aa81De2eBe01cCC04Eb7ea4ce1a52', // no 0x
      '0xZZ609C73784Aa81De2eBe01cCC04Eb7ea4ce1a52',
    ]) {
      expect(parseAddress(bad), bad).toBeNull();
    }
  });

  it('does not throw on a malformed percent-escape', () => {
    // decodeURIComponent throws on a lone '%'; a bad URL must render the
    // "that isn't an address" page, not a 500.
    expect(() => parseAddress('%')).not.toThrow();
    expect(parseAddress('%')).toBeNull();
  });
});

describe('cache TTL and page copy stay in step', () => {
  // The page tells visitors the data is "no more than N seconds ago" and Next
  // forces its `revalidate` to be a literal, so the literal cannot import the
  // constant. If the two ever drift, the page starts lying about its freshness
  // — which is the one thing this page cannot afford to do.
  it('the page revalidate literal equals PROOF_TTL_SECONDS', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'app', 'companion', '[address]', 'page.tsx'),
      'utf8',
    );
    const match = source.match(/export const revalidate = (\d+);/);
    expect(match, 'page.tsx must export a literal revalidate').not.toBeNull();
    expect(Number(match![1])).toBe(PROOF_TTL_SECONDS);
  });

  it('the page states a READ TIME, never a maximum age', () => {
    // "no more than N seconds ago" was an upper bound nothing enforced. Both
    // caches in front of this read — the route cache from `revalidate` and the
    // unstable_cache wrapper — are stale-while-revalidate with no hard age
    // bound, and they compound, so the first visitor after an idle hour got an
    // hour-old proof under a sentence promising thirty seconds. A rendered
    // timestamp cannot be made false by a cache: it travels with the data.
    const source = readFileSync(
      join(__dirname, '..', '..', 'app', 'companion', '[address]', 'page.tsx'),
      'utf8',
    );
    expect(source).not.toContain('no more than');
    expect(source).toContain('proof.readAt');
    expect(source).toContain('refreshes at least every {PROOF_TTL_SECONDS} seconds');
  });

  it('readAt is stamped inside the cached read, not at render', () => {
    // Stamping it at render would print "now" over data an hour old — exactly
    // the lie the sentence above was making.
    const source = readFileSync(join(__dirname, 'publicProof.ts'), 'utf8');
    const readFn = source.slice(source.indexOf('async function readCompanionProof'));
    expect(readFn).toContain('readAt: new Date().toISOString()');
  });
});

describe('a failed read never renders as a fact', () => {
  const page = readFileSync(
    join(__dirname, '..', '..', 'app', 'companion', '[address]', 'page.tsx'),
    'utf8',
  );
  const src = readFileSync(join(__dirname, 'publicProof.ts'), 'utf8');

  it('anchorCount is null on a rejected read, not 0', () => {
    // Three reads share one Promise.allSettled; latestRoot and owner already
    // used null as their sentinel. anchorCount collapsed to 0, so a call that
    // never completed printed "Times re-anchored: 0" as though it had.
    expect(src).toContain("countResult.status === 'fulfilled' ? Number(countResult.value as bigint) : null");
    expect(page).toContain("proof.anchorCount ??");
  });

  it('logAgrees carries the third state, so the log is not blamed for a contract failure', () => {
    // agreesWithContract returns false when latestOnChain is null — which is
    // exactly what a REJECTED latestMemoryRoot read produces. A boolean could
    // not distinguish that from a genuine disagreement, so a perfectly fetched
    // log was accused of being incomplete.
    expect(src).toContain("'unread'");
    expect(src).toContain("rootResult.status === 'rejected'");
    expect(page).toContain("proof.logAgrees === 'unread'");
    // And no truthiness checks may remain: a non-empty string is always truthy,
    // so `proof.logAgrees ?` would silently pass for every state.
    expect(page).not.toMatch(/proof\.logAgrees\s*\?/);
    expect(page).not.toMatch(/&&\s*proof\.logAgrees\s*$/m);
  });

  it('undated anchors are reported rather than silently dropped', () => {
    expect(src).toContain('undatedAnchors');
    expect(page).toContain('proof.undatedAnchors > 0');
  });
});

describe('a custom deployment reads its own contract', () => {
  const src = readFileSync(join(__dirname, 'publicProof.ts'), 'utf8');

  it('honours NEXT_PUBLIC_LUMEN_INFT_ADDRESS like the app does', () => {
    // useCompanion honoured it and this page did not, so a custom deployment's
    // owner saw their companion in-app and "No companion here" on the very page
    // they would share to prove it.
    expect(src).toContain('resolveCompanionAddress(net.key, ADDRESS_OVERRIDE)');
  });

  it('reads the start block as a literal member expression, so Next inlines it', () => {
    expect(src).toContain('process.env.NEXT_PUBLIC_LUMEN_INFT_DEPLOY_BLOCK');
  });

  it('passes BOTH overrides to the shared resolver, which decides', () => {
    // The pairing rule moved into resolveCompanionDeployBlock so the in-app
    // archive gets it too — it is asserted directly further down rather than
    // by grepping for an implementation detail that now lives elsewhere.
    expect(src).toContain('resolveCompanionDeployBlock(net.key, ADDRESS_OVERRIDE, DEPLOY_BLOCK_OVERRIDE)');
  });
});

describe('resolveCompanionDeployBlock — the coupling both call sites had', () => {
  it('returns the built-in block with no overrides', () => {
    expect(resolveCompanionDeployBlock('mainnet')).toBe(LUMEN_COMPANION_DEPLOY_BLOCK.mainnet);
    expect(resolveCompanionDeployBlock('testnet')).toBe(LUMEN_COMPANION_DEPLOY_BLOCK.testnet);
  });

  it('IGNORES a block override when the address is NOT overridden', () => {
    // A custom start block against the canonical contract would skip real
    // history for no reason — the built-in block is correct for it by
    // definition.
    expect(resolveCompanionDeployBlock('mainnet', undefined, '1')).toBe(
      LUMEN_COMPANION_DEPLOY_BLOCK.mainnet,
    );
    expect(resolveCompanionDeployBlock('mainnet', '   ', '1')).toBe(
      LUMEN_COMPANION_DEPLOY_BLOCK.mainnet,
    );
  });

  it('honours the pair, which is the case that was broken', () => {
    // The table is keyed by NETWORK, so an overridden contract used to be
    // scanned from the canonical deployment's block — past its own mint,
    // yielding an empty chain and then an "incomplete history" verdict for a
    // companion that is fine.
    expect(resolveCompanionDeployBlock('mainnet', '0xabc', '123')).toBe(123n);
  });

  it('falls back rather than throwing on an unparseable override', () => {
    // One caller renders a public page for strangers; a bad env var must not
    // 500 it.
    for (const bad of ['not-a-number', '12.5', '', '  ', '-1']) {
      expect(resolveCompanionDeployBlock('mainnet', '0xabc', bad), bad).toBe(
        LUMEN_COMPANION_DEPLOY_BLOCK.mainnet,
      );
    }
  });

  it('both call sites use the shared resolver, so they cannot drift', () => {
    // The in-app archive truthfully claims it shows exactly what a stranger
    // sees. Two separate resolutions could make that false silently.
    for (const rel of ['lib/0g/publicProof.ts', 'lib/hooks/useAnchorArchive.ts']) {
      const src = readFileSync(join(process.cwd(), rel), 'utf8');
      expect(src.length, `${rel} unreadable — this check would be vacuous`).toBeGreaterThan(0);
      expect(src, rel).toContain('resolveCompanionDeployBlock(');
      expect(src, `${rel} still indexes the table directly`).not.toMatch(
        /LUMEN_COMPANION_DEPLOY_BLOCK\[/,
      );
    }
  });
});
