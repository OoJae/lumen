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

  it('the page renders its freshness claim from the constant, not a literal', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'app', 'companion', '[address]', 'page.tsx'),
      'utf8',
    );
    expect(source).toContain('no more than {PROOF_TTL_SECONDS} seconds ago');
  });
});
