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
  resolveCompanionDeployBlock,
  resolveCompanionAddress,
} from '@lumen/shared';

import { activeChain } from './chain';
import { activeNetwork } from './network';
import { agreesWithContract, buildAnchorChain, type AnchorChain } from './anchorHistory';
import { readAnchorLogs } from './anchorLogs';

// Re-exported from its leaf module so importing it does not drag this file's
// viem + next/cache + RPC graph into a client bundle. See lib/0g/address.ts.
export { parseAddress } from './address';

/** A slow RPC must not hang the page — a partial proof beats a spinner. */
const RPC_TIMEOUT_MS = 12_000;
const INDEXER_TIMEOUT_MS = 6_000;

/** Must stay in step with the page's "no more than N seconds ago" copy. */
export const PROOF_TTL_SECONDS = 30;

export type StorageProbe =
  | { status: 'available'; replicas: number }
  | { status: 'missing' }
  | { status: 'unchecked'; reason: string };

/**
 * Whether the replayed log matches the contract's own storage slot.
 *
 * `'unread'` is the state a boolean could not express: the `latestMemoryRoot`
 * call was rejected, so there is nothing to compare against and the page must
 * not blame the log — which it did, with "Incomplete log", for a failure that
 * belonged entirely to the contract read.
 */
export type ContractAgreement = 'agrees' | 'disagrees' | 'unread';

export interface CompanionProof {
  address: Address;
  tokenId: string | null;
  owner: Address | null;
  latestRoot: string | null;
  /** null when the read failed — never 0, which reads as a fact. */
  anchorCount: number | null;
  chain: AnchorChain;
  logAgrees: ContractAgreement;
  /** Anchors whose block time exceeded the lookup budget, so they carry no
   *  date and cannot appear on the practice calendar. Reported, not dropped. */
  undatedAnchors: number;
  /** ISO-8601. When the RPC reads happened, stamped inside the cached read. */
  readAt: string;
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
 * the reduced result keeps the shared-link case instant. The page states the
 * READ TIME rather than a maximum age, because neither cache bounds staleness.
 */
export const loadCompanionProof = (address: Address): Promise<CompanionProof> =>
  unstable_cache(
    () => readCompanionProof(address),
    ['lumen-companion-proof', address.toLowerCase()],
    { revalidate: PROOF_TTL_SECONDS },
  )();

// Literal member expressions — Next only inlines NEXT_PUBLIC_* it can see
// statically. Mirrors useCompanion.ts, which is the point: the app honoured the
// override and this page did not, so a custom deployment's owner saw their
// companion in-app and "No companion here" on their own shareable proof page.
const ADDRESS_OVERRIDE = process.env.NEXT_PUBLIC_LUMEN_INFT_ADDRESS;
const DEPLOY_BLOCK_OVERRIDE = process.env.NEXT_PUBLIC_LUMEN_INFT_DEPLOY_BLOCK;

async function readCompanionProof(address: Address): Promise<CompanionProof> {
  const net = activeNetwork();
  const contractAddress = resolveCompanionAddress(net.key, ADDRESS_OVERRIDE);
  const base = {
    address,
    tokenId: null,
    owner: null,
    latestRoot: null,
    // null, not 0. A rejected read is not "re-anchored zero times" — the page
    // printed that as a fact for a call that never completed, while the two
    // reads beside it already used null as their honest sentinel.
    anchorCount: null as number | null,
    chain: buildAnchorChain(null, []),
    logAgrees: 'agrees' as ContractAgreement,
    /** Undated anchors — see readAnchorLogs' timestamp-lookup budget. */
    undatedAnchors: 0,
    /** When the RPC reads actually happened. Stamped INSIDE the cached
     *  function, so it travels with the data instead of being asserted about
     *  it. See PROOF_TTL_SECONDS. */
    readAt: new Date().toISOString(),
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
    countResult.status === 'fulfilled' ? Number(countResult.value as bigint) : null;
  const owner = ownerResult.status === 'fulfilled' ? (ownerResult.value as Address) : null;

  // Scan from the deploy block, never genesis — see LUMEN_COMPANION_DEPLOY_BLOCK.
  // Same reader the in-app archive uses, so the two can never disagree.
  const { mint, anchors } = await readAnchorLogs(
    publicClient,
    contractAddress,
    tokenId,
    resolveCompanionDeployBlock(net.key, ADDRESS_OVERRIDE, DEPLOY_BLOCK_OVERRIDE),
  );

  const chain = buildAnchorChain(mint, anchors);
  const storage = await probeStorage(latestRoot);

  return {
    ...base,
    tokenId: tokenId.toString(),
    owner,
    latestRoot,
    anchorCount,
    chain,
    /**
     * Three states, not two.
     *
     * `agreesWithContract` returns false when `latestOnChain` is null — and a
     * REJECTED latestMemoryRoot read produces exactly that. So a companion
     * whose event log was fetched perfectly got told "Incomplete log ... the
     * events we could fetch end on a different root than the contract reports",
     * blaming the one read that succeeded for the failure of the one that
     * didn't. A boolean cannot express "we never got the contract's answer".
     */
    logAgrees: (rootResult.status === 'rejected'
      ? 'unread'
      : agreesWithContract(chain, latestRoot)
        ? 'agrees'
        : 'disagrees') as ContractAgreement,
    undatedAnchors: anchors.filter((a) => a.timestamp <= 0).length,
    storage,
  };
}


