/**
 * Reading a companion's on-chain history — the SAME read on the server and in
 * the browser.
 *
 * This lives apart from publicProof.ts on purpose. That module is server-only
 * (it reaches for `next/cache`), and the in-app practice archive must be able
 * to claim it is showing you exactly what a stranger sees on your public proof
 * page. Two implementations could drift; one cannot.
 *
 * Isomorphic by construction: viem types and @lumen/shared only — no
 * `next/cache`, no wagmi, no React. `LogReader` is a structural type rather
 * than viem's generic `PublicClient` so wagmi's concretely-parameterised client
 * satisfies it without generic gymnastics, and so a fake is three lines in a test.
 */
import type { Address, PublicClient } from 'viem';
import { LUMEN_COMPANION_ABI } from '@lumen/shared';

import type { RawAnchorEvent, RawMintEvent } from './anchorHistory';

/** The only two chain calls this module makes. */
export type LogReader = Pick<PublicClient, 'getContractEvents' | 'getBlock'>;

export interface AnchorLogs {
  mint: RawMintEvent | null;
  anchors: RawAnchorEvent[];
}

/**
 * Cap on distinct blocks we'll ask for timestamps. A prolific anchorer should
 * not turn one page load into hundreds of round-trips; beyond the cap, days
 * degrade to `timestamp: 0` and downstream drops them rather than guessing.
 */
export const DEFAULT_MAX_TIMESTAMP_LOOKUPS = 64;

/**
 * A block whose timestamp we could not read reports 0, never an invented time.
 * `buildAnchorChain` filters those out of the practice record — a day we cannot
 * date is a day we do not claim.
 */
async function blockTime(client: LogReader, blockNumber: bigint): Promise<number> {
  try {
    const block = await client.getBlock({ blockNumber });
    return Number(block.timestamp);
  } catch {
    return 0;
  }
}

/** Timestamps for many logs: one round-trip per DISTINCT block, capped. */
async function blockTimes(
  client: LogReader,
  blockNumbers: readonly bigint[],
  max: number,
): Promise<Map<bigint, number>> {
  const distinct = [...new Set(blockNumbers)];
  // eth_getLogs returns ascending by block and Set preserves insertion order,
  // so slicing from the FRONT would time the oldest blocks and leave the newest
  // undated — and undated days are dropped from the practice record. For a
  // prolific anchorer that silently erased their most recent activity, which is
  // exactly the part anyone looking at the page cares about. Keep the tail.
  // `slice(-0)` is `slice(0)` — the whole array — so a cap of 0 would fetch
  // EVERY block instead of none. Handle it explicitly.
  const budgeted = max <= 0 ? [] : distinct.slice(-max);
  const times = new Map<bigint, number>();
  await Promise.all(
    budgeted.map(async (bn) => {
      times.set(bn, await blockTime(client, bn));
    }),
  );
  return times;
}

/**
 * Every `Minted` and `MemoryRootAnchored` log for one token, with block times.
 *
 * Scans from `fromBlock` (the deploy block) rather than genesis — 0G mainnet is
 * past block 42M and a genesis scan turned the proof page into a 17-second wait.
 * Every failure path returns empty rather than throwing: a partial proof that
 * says so beats a page that will not render.
 */
export async function readAnchorLogs(
  client: LogReader,
  address: Address,
  tokenId: bigint,
  fromBlock: bigint,
  opts?: { maxTimestampLookups?: number },
): Promise<AnchorLogs> {
  const max = opts?.maxTimestampLookups ?? DEFAULT_MAX_TIMESTAMP_LOOKUPS;
  const [mint, anchors] = await Promise.all([
    readMint(client, address, tokenId, fromBlock),
    readAnchors(client, address, tokenId, fromBlock, max),
  ]);
  return { mint, anchors };
}

async function readMint(
  client: LogReader,
  address: Address,
  tokenId: bigint,
  fromBlock: bigint,
): Promise<RawMintEvent | null> {
  try {
    const logs = await client.getContractEvents({
      address,
      abi: LUMEN_COMPANION_ABI,
      eventName: 'Minted',
      args: { tokenId },
      fromBlock,
      toBlock: 'latest',
    });
    const log = logs[0];
    if (!log) return null;
    const args = log.args as { owner?: Address; memoryRoot?: string };
    return {
      tokenId: tokenId.toString(),
      owner: args.owner ?? '0x',
      memoryRoot: args.memoryRoot ?? '',
      txHash: log.transactionHash ?? '',
      blockNumber: Number(log.blockNumber ?? 0n),
      timestamp: await blockTime(client, log.blockNumber ?? 0n),
    };
  } catch {
    return null;
  }
}

async function readAnchors(
  client: LogReader,
  address: Address,
  tokenId: bigint,
  fromBlock: bigint,
  max: number,
): Promise<RawAnchorEvent[]> {
  try {
    const logs = await client.getContractEvents({
      address,
      abi: LUMEN_COMPANION_ABI,
      eventName: 'MemoryRootAnchored',
      args: { tokenId },
      fromBlock,
      toBlock: 'latest',
    });
    const times = await blockTimes(
      client,
      logs.map((log) => log.blockNumber ?? 0n),
      max,
    );
    return logs.map((log) => {
      const args = log.args as { seq?: bigint; prevRoot?: string; newRoot?: string };
      return {
        seq: Number(args.seq ?? 0n),
        prevRoot: args.prevRoot ?? '',
        newRoot: args.newRoot ?? '',
        txHash: log.transactionHash ?? '',
        blockNumber: Number(log.blockNumber ?? 0n),
        timestamp: times.get(log.blockNumber ?? 0n) ?? 0,
      };
    });
  } catch {
    return [];
  }
}
