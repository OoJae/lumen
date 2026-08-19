import { describe, expect, it } from 'vitest';

import {
  agreesWithContract,
  buildAnchorChain,
  isZeroRoot,
  sameRoot,
  shortRoot,
  utcDay,
  type RawAnchorEvent,
  type RawMintEvent,
} from './anchorHistory';

const ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000';
const R1 = '0x1caeee295b94a8f28c09a19e32c243fa238f684476289f63bc06f1c2546eb6a2';
const R2 = '0x94f51264d5288f3359020eb37be3008445f0ca61591a414c46d814bdf6fd4e5d';
const R3 = '0x609f4ae10895ecb95458d7a9d036f0674d91ba526ff803eeaad614a8485701c2';

function mint(memoryRoot: string, timestamp = 1_755_608_747): RawMintEvent {
  return {
    tokenId: '2',
    owner: '0xB5609C73784Aa81De2eBe01cCC04Eb7ea4ce1a52',
    memoryRoot,
    txHash: '0x9abb62f70a399d1edb4bb69c7e6bcd7dec8c0f3e7c08be03a70356aa41e196ee',
    blockNumber: 42_066_838,
    timestamp,
  };
}

function anchor(
  seq: number,
  prevRoot: string,
  newRoot: string,
  timestamp = 1_755_609_055,
): RawAnchorEvent {
  return { seq, prevRoot, newRoot, txHash: `0xtx${seq}`, blockNumber: 42_067_000 + seq, timestamp };
}

describe('root comparison', () => {
  it('ignores case and 0x prefix', () => {
    expect(sameRoot(R1, R1.toUpperCase().replace('0X', '0x'))).toBe(true);
    expect(sameRoot(R1, R1.slice(2))).toBe(true);
    expect(sameRoot(R1, R2)).toBe(false);
  });

  it('treats missing roots as unequal rather than throwing', () => {
    expect(sameRoot(null, null)).toBe(false);
    expect(sameRoot(R1, undefined)).toBe(false);
  });

  it('recognises the zero root', () => {
    expect(isZeroRoot(ZERO)).toBe(true);
    expect(isZeroRoot(R1)).toBe(false);
  });

  it('shortens long roots but leaves short strings alone', () => {
    expect(shortRoot(R1)).toBe('0x1caeee29…546eb6a2');
    expect(shortRoot('0xabc')).toBe('0xabc');
  });
});

describe('buildAnchorChain', () => {
  it('links a real mint-then-anchor history (token #2 on mainnet)', () => {
    const chain = buildAnchorChain(mint(R1), [anchor(1, R1, R2)]);
    expect(chain.intact).toBe(true);
    expect(chain.brokenAtSeq).toBeNull();
    expect(chain.latestRoot).toBe(R2);
    expect(chain.links[0]!.linked).toBe(true);
  });

  it('orders by seq, not by the order the RPC returned them', () => {
    const chain = buildAnchorChain(mint(ZERO), [
      anchor(2, R3, R2),
      anchor(1, ZERO, R3),
    ]);
    expect(chain.links.map((l) => l.seq)).toEqual([1, 2]);
    expect(chain.intact).toBe(true);
    expect(chain.latestRoot).toBe(R2);
  });

  it('flags the first link that does not continue its predecessor', () => {
    // seq 2 claims to replace R1, but seq 1 left the pointer at R3.
    const chain = buildAnchorChain(mint(ZERO), [anchor(1, ZERO, R3), anchor(2, R1, R2)]);
    expect(chain.intact).toBe(false);
    expect(chain.brokenAtSeq).toBe(2);
    expect(chain.links[0]!.linked).toBe(true);
    expect(chain.links[1]!.linked).toBe(false);
    expect(chain.links[1]!.expectedPrev).toBe(R3);
  });

  it('reports only the FIRST break, so one gap does not cascade', () => {
    const chain = buildAnchorChain(mint(ZERO), [anchor(1, R1, R2), anchor(2, R2, R3)]);
    expect(chain.brokenAtSeq).toBe(1);
    expect(chain.links[1]!.linked).toBe(true);
  });

  it('does not invent a break when the mint event is out of range', () => {
    // Without a mint we have nothing to anchor the first link to. Claiming a
    // break we cannot demonstrate would be exactly the overclaiming this page
    // exists to avoid.
    const chain = buildAnchorChain(null, [anchor(1, R1, R2)]);
    expect(chain.intact).toBe(true);
    expect(chain.links[0]!.linked).toBe(true);
    expect(chain.latestRoot).toBe(R2);
  });

  it('handles a mint with no anchors yet — the mint day still counts', () => {
    const chain = buildAnchorChain(mint(R1), []);
    expect(chain.intact).toBe(true);
    expect(chain.latestRoot).toBe(R1);
    expect(chain.mintDay).toBe(utcDay(1_755_608_747));
    expect(chain.practiceDays).toEqual([utcDay(1_755_608_747)]);
  });

  it('handles a companion minted before its first save (zero root)', () => {
    const chain = buildAnchorChain(mint(ZERO), [anchor(1, ZERO, R1)]);
    expect(chain.intact).toBe(true);
    expect(chain.latestRoot).toBe(R1);
  });

  it('returns an empty chain for an address with no companion', () => {
    const chain = buildAnchorChain(null, []);
    expect(chain.intact).toBe(true);
    expect(chain.latestRoot).toBeNull();
    expect(chain.links).toEqual([]);
  });
});

describe('practice days', () => {
  it('counts distinct UTC days, deduplicated and sorted', () => {
    const day1 = Date.UTC(2026, 7, 16, 14, 18) / 1000;
    const day1Later = Date.UTC(2026, 7, 16, 23, 59) / 1000;
    const day2 = Date.UTC(2026, 7, 19, 13, 10) / 1000;
    const chain = buildAnchorChain(mint(ZERO), [
      anchor(1, ZERO, R1, day2),
      anchor(2, R1, R2, day1),
      anchor(3, R2, R3, day1Later),
    ]);
    expect(chain.practiceDays).toEqual(['2026-08-16', '2026-08-19']);
  });

  it('counts the mint day, sorted to the front', () => {
    const day0 = Date.UTC(2026, 7, 14, 9, 0) / 1000;
    const day1 = Date.UTC(2026, 7, 19, 13, 10) / 1000;
    const chain = buildAnchorChain(mint(R1, day0), [anchor(1, R1, R2, day1)]);
    expect(chain.mintDay).toBe('2026-08-14');
    expect(chain.practiceDays).toEqual(['2026-08-14', '2026-08-19']);
  });

  it('does not count a zero-root mint — it committed to nothing', () => {
    const day1 = Date.UTC(2026, 7, 19, 13, 10) / 1000;
    const chain = buildAnchorChain(mint(ZERO), [anchor(1, ZERO, R1, day1)]);
    expect(chain.mintDay).toBeNull();
    expect(chain.practiceDays).toEqual(['2026-08-19']);
  });

  it('collapses a mint and a same-day anchor into one day', () => {
    const morning = Date.UTC(2026, 7, 19, 9, 0) / 1000;
    const evening = Date.UTC(2026, 7, 19, 21, 0) / 1000;
    const chain = buildAnchorChain(mint(R1, morning), [anchor(1, R1, R2, evening)]);
    expect(chain.practiceDays).toEqual(['2026-08-19']);
  });

  it('excludes a mint whose block timestamp could not be read', () => {
    // blockTime() returns 0 on failure rather than inventing a time; utcDay(0)
    // is '1970-01-01', which must never reach the record.
    const chain = buildAnchorChain(mint(R1, 0), [anchor(1, R1, R2, Date.UTC(2026, 7, 19) / 1000)]);
    expect(chain.mintDay).toBeNull();
    expect(chain.practiceDays).toEqual(['2026-08-19']);
    expect(chain.practiceDays).not.toContain('1970-01-01');
  });

  it('excludes an anchor whose block timestamp could not be read', () => {
    const chain = buildAnchorChain(mint(ZERO), [
      anchor(1, ZERO, R1, 0),
      anchor(2, R1, R2, Date.UTC(2026, 7, 19) / 1000),
    ]);
    expect(chain.practiceDays).toEqual(['2026-08-19']);
    expect(chain.practiceDays).not.toContain('1970-01-01');
  });

  it('has no mint day when the mint event is out of range', () => {
    const chain = buildAnchorChain(null, [anchor(1, R1, R2, Date.UTC(2026, 7, 19) / 1000)]);
    expect(chain.mintDay).toBeNull();
    expect(chain.practiceDays).toEqual(['2026-08-19']);
  });

  it('bins by UTC so the same history reads the same in every timezone', () => {
    // 23:30 UTC is already "tomorrow" in Sydney; the day key must not move.
    expect(utcDay(Date.UTC(2026, 7, 16, 23, 30) / 1000)).toBe('2026-08-16');
  });
});

describe('agreesWithContract', () => {
  it('agrees when the replayed chain ends where the contract says', () => {
    const chain = buildAnchorChain(mint(R1), [anchor(1, R1, R2)]);
    expect(agreesWithContract(chain, R2)).toBe(true);
  });

  it('disagrees when the log we fetched is missing later anchors', () => {
    const chain = buildAnchorChain(mint(R1), [anchor(1, R1, R2)]);
    expect(agreesWithContract(chain, R3)).toBe(false);
  });

  it('treats an empty chain and no on-chain root as agreement', () => {
    expect(agreesWithContract(buildAnchorChain(null, []), null)).toBe(true);
  });

  it('disagrees when the contract has a root but we replayed nothing', () => {
    expect(agreesWithContract(buildAnchorChain(null, []), R2)).toBe(false);
  });
});
