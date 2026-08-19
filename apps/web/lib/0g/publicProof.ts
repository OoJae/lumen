/**
 * Server-side reads for the public proof page.
 *
 * Everything here is KEYLESS and read-only: a visitor with no wallet, no
 * extension and no 0G can check a companion's whole story. That is the point —
 * "your data is encrypted" is a claim every journaling app makes and none can
 * demonstrate. This module gathers the evidence; the page renders it.
 *
 * Deliberately does NOT import lib/storage/zgStorage: that module pulls the
 * storage SDK's *browser* build and wagmi types, neither of which belongs in a
 * server component. The one call we need from the indexer is a plain JSON-RPC
 * method, so we make it directly.
 */
import { unstable_cache } from 'next/cache';
import { createPublicClient, http, type Address } from 'viem';
import {
  LUMEN_COMPANION_ABI,
  LUMEN_COMPANION_DEPLOY_BLOCK,
  resolveCompanionAddress,
} from '@lumen/shared';

import { activeChain } from './chain';
import { activeNetwork } from './network';
import {
  buildAnchorChain,
  type AnchorChain,
  type RawAnchorEvent,
  type RawMintEvent,
} from './anchorHistory';

/** A slow RPC must not hang the page — a partial proof beats a spinner. */
const RPC_TIMEOUT_MS = 12_000;
const INDEXER_TIMEOUT_MS = 6_000;

/** Must stay in step with the page's "no more than N seconds ago" copy. */
export const PROOF_TTL_SECONDS = 30;

export type StorageProbe =
  | { status: 'available'; replicas: number }
  | { status: 'missing' }
  | { status: 'unchecked'; reason: string };

export interface CompanionProof {
  address: Address;
  tokenId: string | null;
  owner: Address | null;
  latestRoot: string | null;
  anchorCount: number;
  chain: AnchorChain;
  /** The replayed log agrees with the contract's own storage slot. */
  logAgrees: boolean;
  storage: StorageProbe;
  contractAddress: Address;
  explorerUrl: string;
  networkLabel: string;
  chainId: number;
  /** Set when the chain could not be read at all. */
  error: string | null;
}

function client() {
  return createPublicClient({
    chain: activeChain(),
    transport: http(activeNetwork().rpcUrl, { timeout: RPC_TIMEOUT_MS }),
  });
}

/** Is this a syntactically valid EVM address? Checked before any RPC work. */
export function parseAddress(raw: string): Address | null {
  let value: string;
  try {
    value = decodeURIComponent(raw ?? '').trim();
  } catch {
    // decodeURIComponent throws URIError on a malformed escape (a lone '%').
    // A junk URL must render "that isn't a wallet address", never a 500.
    return null;
  }
  return /^0x[0-9a-fA-F]{40}$/.test(value) ? (value as Address) : null;
}

/**
 * Ask the 0G Storage indexer whether the encrypted snapshot is actually
 * retrievable right now. This is the difference between "we say it's on 0G" and
 * "here are the three nodes currently serving it."
 */
export async function probeStorage(rootHash: string | null): Promise<StorageProbe> {
  if (!rootHash || /^0x0+$/.test(rootHash)) {
    return { status: 'unchecked', reason: 'No snapshot root anchored yet.' };
  }
  try {
    const res = await fetch(activeNetwork().storage.indexerRpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'indexer_getFileLocations',
        params: [rootHash],
      }),
      signal: AbortSignal.timeout(INDEXER_TIMEOUT_MS),
    });
    if (!res.ok) return { status: 'unchecked', reason: `Indexer returned ${res.status}.` };
    const body = (await res.json()) as { result?: unknown[] | null };
    const replicas = Array.isArray(body.result) ? body.result.length : 0;
    return replicas > 0 ? { status: 'available', replicas } : { status: 'missing' };
  } catch {
    // An indexer outage says nothing about the companion — never render it as
    // "your data is gone."
    return { status: 'unchecked', reason: 'The 0G Storage indexer did not respond in time.' };
  }
}

/**
 * Gather everything a stranger needs to verify one companion.
 *
 * Cached for PROOF_TTL_SECONDS via unstable_cache rather than route-level ISR:
 * Next 15 does not cache `fetch` by default, and viem's transport is fetch, so
 * the route would re-read the chain on every single hit — about four seconds
 * each time, for a page whose whole job is to be clicked by strangers. Caching
 * the reduced result keeps the shared-link case instant while the page's own
 * copy stays true ("no more than 30 seconds ago").
 */
export const loadCompanionProof = (address: Address): Promise<CompanionProof> =>
  unstable_cache(
    () => readCompanionProof(address),
    ['lumen-companion-proof', address.toLowerCase()],
    { revalidate: PROOF_TTL_SECONDS },
  )();

async function readCompanionProof(address: Address): Promise<CompanionProof> {
  const net = activeNetwork();
  const contractAddress = resolveCompanionAddress(net.key);
  const base = {
    address,
    tokenId: null,
    owner: null,
    latestRoot: null,
    anchorCount: 0,
    chain: buildAnchorChain(null, []),
    logAgrees: true,
    storage: { status: 'unchecked', reason: 'Not checked.' } as StorageProbe,
    contractAddress: (contractAddress ?? '0x') as Address,
    explorerUrl: net.explorerUrl,
    networkLabel: net.label,
    chainId: net.chainId,
    error: null as string | null,
  };
  if (!contractAddress) {
    return { ...base, error: `No LumenCompanion contract is configured for ${net.label}.` };
  }

  const publicClient = client();
  const contract = { address: contractAddress, abi: LUMEN_COMPANION_ABI } as const;

  let tokenId: bigint;
  try {
    tokenId = (await publicClient.readContract({
      ...contract,
      functionName: 'companionOf',
      args: [address],
    })) as bigint;
  } catch {
    return { ...base, error: `Could not reach the ${net.label} RPC to read the contract.` };
  }

  // 0 is the contract's "no companion" sentinel, not a token.
  if (tokenId === 0n) return base;

  // latestMemoryRoot REVERTS for a token that doesn't exist, and anchorCount is
  // 0 straight after a mint — so neither is fatal on its own.
  const [rootResult, countResult, ownerResult] = await Promise.allSettled([
    publicClient.readContract({ ...contract, functionName: 'latestMemoryRoot', args: [tokenId] }),
    publicClient.readContract({ ...contract, functionName: 'anchorCount', args: [tokenId] }),
    publicClient.readContract({ ...contract, functionName: 'ownerOf', args: [tokenId] }),
  ]);

  const latestRoot =
    rootResult.status === 'fulfilled' ? (rootResult.value as string) : null;
  const anchorCount =
    countResult.status === 'fulfilled' ? Number(countResult.value as bigint) : 0;
  const owner = ownerResult.status === 'fulfilled' ? (ownerResult.value as Address) : null;

  // Scan from the deploy block, never genesis — see LUMEN_COMPANION_DEPLOY_BLOCK.
  const fromBlock = LUMEN_COMPANION_DEPLOY_BLOCK[net.key];
  const [mint, anchors] = await Promise.all([
    fetchMint(publicClient, contractAddress, tokenId, fromBlock),
    fetchAnchors(publicClient, contractAddress, tokenId, fromBlock),
  ]);

  const chain = buildAnchorChain(mint, anchors);
  const storage = await probeStorage(latestRoot);

  return {
    ...base,
    tokenId: tokenId.toString(),
    owner,
    latestRoot,
    anchorCount,
    chain,
    logAgrees: latestRoot ? sameHex(chain.latestRoot, latestRoot) : true,
    storage,
  };
}

function sameHex(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

type Client = ReturnType<typeof client>;

async function blockTime(publicClient: Client, blockNumber: bigint): Promise<number> {
  try {
    const block = await publicClient.getBlock({ blockNumber });
    return Number(block.timestamp);
  } catch {
    return 0;
  }
}

async function fetchMint(
  publicClient: Client,
  address: Address,
  tokenId: bigint,
  fromBlock: bigint,
): Promise<RawMintEvent | null> {
  try {
    const logs = await publicClient.getContractEvents({
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
      timestamp: await blockTime(publicClient, log.blockNumber ?? 0n),
    };
  } catch {
    return null;
  }
}

async function fetchAnchors(
  publicClient: Client,
  address: Address,
  tokenId: bigint,
  fromBlock: bigint,
): Promise<RawAnchorEvent[]> {
  try {
    const logs = await publicClient.getContractEvents({
      address,
      abi: LUMEN_COMPANION_ABI,
      eventName: 'MemoryRootAnchored',
      args: { tokenId },
      fromBlock,
      toBlock: 'latest',
    });
    // Block timestamps in parallel: one round-trip per distinct block, not per log.
    const times = new Map<bigint, number>();
    await Promise.all(
      [...new Set(logs.map((l) => l.blockNumber ?? 0n))].map(async (bn) => {
        times.set(bn, await blockTime(publicClient, bn));
      }),
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
