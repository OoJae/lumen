import { describe, expect, it } from 'vitest';

import { readAnchorLogs, type LogReader } from './anchorLogs';

const ADDRESS = '0x0FD618664FFAc86ef734C0C46eFF23bD73CBd738' as const;
const OWNER = '0xB5609C73784Aa81De2eBe01cCC04Eb7ea4ce1a52';
const R1 = '0x1caeee295b94a8f28c09a19e32c243fa238f684476289f63bc06f1c2546eb6a2';
const R2 = '0x94f51264d5288f3359020eb37be3008445f0ca61591a414c46d814bdf6fd4e5d';
const FROM = 41_801_714n;

interface FakeLog {
  args: Record<string, unknown>;
  transactionHash: string;
  blockNumber: bigint;
}

/**
 * A LogReader is only two methods, which is the whole point of typing it
 * structurally — no viem client, no RPC, no mocking library (this repo has
 * zero vi.mock by convention).
 */
function reader(opts: {
  minted?: FakeLog[];
  anchored?: FakeLog[];
  blocks?: Record<string, number>;
  failEvents?: boolean;
  failBlocks?: boolean;
  onGetBlock?: (bn: bigint) => void;
}): LogReader {
  return {
    getContractEvents: (async ({ eventName }: { eventName?: string }) => {
      if (opts.failEvents) throw new Error('rpc down');
      return eventName === 'Minted' ? (opts.minted ?? []) : (opts.anchored ?? []);
    }) as unknown as LogReader['getContractEvents'],
    getBlock: (async ({ blockNumber }: { blockNumber: bigint }) => {
      opts.onGetBlock?.(blockNumber);
      if (opts.failBlocks) throw new Error('block read failed');
      const ts = opts.blocks?.[String(blockNumber)];
      if (ts === undefined) throw new Error('unknown block');
      return { timestamp: BigInt(ts) };
    }) as unknown as LogReader['getBlock'],
  };
}

const mintLog: FakeLog = {
  args: { tokenId: 2n, owner: OWNER, memoryRoot: R1 },
  transactionHash: '0xmint',
  blockNumber: 42_066_838n,
};

function anchorLog(seq: number, prevRoot: string, newRoot: string, block: bigint): FakeLog {
  return {
    args: { tokenId: 2n, seq: BigInt(seq), prevRoot, newRoot },
    transactionHash: `0xanchor${seq}`,
    blockNumber: block,
  };
}

describe('readAnchorLogs', () => {
  it('decodes a mint and its anchors with block timestamps', async () => {
    const logs = await readAnchorLogs(
      reader({
        minted: [mintLog],
        anchored: [anchorLog(1, R1, R2, 42_067_154n)],
        blocks: { '42066838': 1_755_608_747, '42067154': 1_755_609_055 },
      }),
      ADDRESS,
      2n,
      FROM,
    );

    expect(logs.mint).toEqual({
      tokenId: '2',
      owner: OWNER,
      memoryRoot: R1,
      txHash: '0xmint',
      blockNumber: 42_066_838,
      timestamp: 1_755_608_747,
    });
    expect(logs.anchors).toHaveLength(1);
    expect(logs.anchors[0]).toMatchObject({ seq: 1, prevRoot: R1, newRoot: R2, timestamp: 1_755_609_055 });
  });

  it('asks for each DISTINCT block once, not once per log', async () => {
    const asked: bigint[] = [];
    await readAnchorLogs(
      reader({
        anchored: [
          anchorLog(1, R1, R2, 500n),
          anchorLog(2, R2, R1, 500n),
          anchorLog(3, R1, R2, 900n),
        ],
        blocks: { '500': 1_000, '900': 2_000 },
        onGetBlock: (bn) => asked.push(bn),
      }),
      ADDRESS,
      2n,
      FROM,
    );
    expect(asked.sort()).toEqual([500n, 900n]);
  });

  it('reports timestamp 0 rather than inventing a time when a block read fails', async () => {
    const logs = await readAnchorLogs(
      reader({ minted: [mintLog], anchored: [anchorLog(1, R1, R2, 42_067_154n)], failBlocks: true }),
      ADDRESS,
      2n,
      FROM,
    );
    expect(logs.mint?.timestamp).toBe(0);
    expect(logs.anchors[0]!.timestamp).toBe(0);
  });

  it('caps timestamp lookups and leaves the rest at 0', async () => {
    const asked: bigint[] = [];
    const anchored = Array.from({ length: 10 }, (_, i) => anchorLog(i + 1, R1, R2, BigInt(600 + i)));
    const blocks = Object.fromEntries(anchored.map((a, i) => [String(600 + i), 1_000 + i]));
    const logs = await readAnchorLogs(
      reader({ anchored, blocks, onGetBlock: (bn) => asked.push(bn) }),
      ADDRESS,
      2n,
      FROM,
      { maxTimestampLookups: 3 },
    );
    expect(asked).toHaveLength(3);
    expect(logs.anchors.filter((a) => a.timestamp === 0)).toHaveLength(7);
  });

  it('degrades to an empty history when the log query itself fails', async () => {
    const logs = await readAnchorLogs(reader({ failEvents: true }), ADDRESS, 2n, FROM);
    expect(logs.mint).toBeNull();
    expect(logs.anchors).toEqual([]);
  });

  it('returns a null mint when no Minted log is in range', async () => {
    const logs = await readAnchorLogs(
      reader({ anchored: [anchorLog(1, R1, R2, 500n)], blocks: { '500': 1_000 } }),
      ADDRESS,
      2n,
      FROM,
    );
    expect(logs.mint).toBeNull();
    expect(logs.anchors).toHaveLength(1);
  });

  it('tolerates a log with missing args rather than throwing', async () => {
    const logs = await readAnchorLogs(
      reader({
        anchored: [{ args: {}, transactionHash: '0xbare', blockNumber: 500n }],
        blocks: { '500': 1_000 },
      }),
      ADDRESS,
      2n,
      FROM,
    );
    expect(logs.anchors[0]).toMatchObject({ seq: 0, prevRoot: '', newRoot: '' });
  });
});

describe('the timestamp budget keeps the NEWEST blocks', () => {
  it('dates recent anchors and drops old ones when capped', async () => {
    // eth_getLogs returns ascending by block, so slicing from the front timed
    // the oldest and left a prolific anchorer's most recent activity undated —
    // and undated days are dropped from the practice record entirely.
    const anchored = Array.from({ length: 10 }, (_, i) => anchorLog(i + 1, R1, R2, BigInt(600 + i)));
    const blocks = Object.fromEntries(anchored.map((_, i) => [String(600 + i), 1_000 + i]));
    const logs = await readAnchorLogs(reader({ anchored, blocks }), ADDRESS, 2n, FROM, {
      maxTimestampLookups: 3,
    });

    const dated = logs.anchors.filter((a) => a.timestamp > 0).map((a) => a.seq);
    expect(dated).toEqual([8, 9, 10]);
    expect(logs.anchors.filter((a) => a.timestamp === 0).map((a) => a.seq)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });
});
