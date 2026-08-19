/**
 * 0G Storage seam (Wave 2) — CLIENT-SIDE, user-signed.
 *
 * Uploads are signed and paid by the USER's wallet in-browser; Lumen holds no
 * storage key and is not in the storage path at all. Only ciphertext (envelope
 * v2) ever reaches this module — encryption happens in lib/storage/snapshot.ts
 * before these functions are called.
 *
 * Mirrors the lib/0g/compute.ts seam philosophy: all 0G specifics live here so
 * Wave 3 changes (anchoring the root on-chain) touch nothing above this file.
 *
 * Verified against @0gfoundation/0g-storage-ts-sdk@1.2.11 (scripts/spike-storage.mjs):
 * in-memory MemData uploads, flow contract auto-detected from the indexer,
 * download via downloadToBlob works browser-side with merkle proof verification.
 */

import { Indexer, MemData } from '@0gfoundation/0g-storage-ts-sdk/browser';
import { BrowserProvider, type Eip1193Provider, type Signer } from 'ethers';
import type { Connector } from 'wagmi';
import { ZG_MAINNET, ZG_TESTNET } from '@lumen/shared';
import { assertChainId } from '@/lib/0g/chainGuard';
import { activeNetwork } from '@/lib/0g/network';

/**
 * Where the SDK should send indexer traffic.
 *
 * In a browser this is our same-origin relay, NOT the indexer directly: the
 * indexer hands back node URLs like `http://34.x.x.x:5678`, and an HTTPS page
 * can never talk to those (mixed content — browsers block secure→insecure
 * subresource requests unconditionally). The relay rewrites them to itself, so
 * uploads, restores and proof-downloads all work. Node scripts, which have no
 * such restriction, keep talking to 0G directly.
 */
function indexerRpc(): string {
  const net = activeNetwork();
  if (typeof window === 'undefined') return net.storage.indexerRpc;
  return `${window.location.origin}/api/zg/indexer?network=${net.key}`;
}

function evmRpc(): string {
  return activeNetwork().rpcUrl;
}

/** Thrown when the signing wallet can't cover gas + the storage fee. The seam
 *  stays out of the remedy business — which remedy to show (faucet vs "send
 *  0G") is a network question, answered in lib/storage/saveErrorCopy.ts. */
export class InsufficientFundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientFundsError';
  }
}

export function isInsufficientFunds(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  if (code === 'INSUFFICIENT_FUNDS' || code === -32000) return true;
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return message.includes('insufficient funds') || message.includes('insufficient balance');
}

/**
 * Verify the WALLET's own chain — never React state, which can be stale.
 *
 * Useful side effect: ethers caches the first getNetwork() result and thereafter
 * throws NETWORK_ERROR if the wallet moves (AbstractSigner.populateTransaction
 * calls it before every send). So this both checks the chain AND pins it for the
 * rest of the operation, closing the gap between check and signature.
 */
export async function assertSignerChain(signer: Signer, expectedChainId: number): Promise<void> {
  const network = await signer.provider?.getNetwork();
  if (!network) throw new Error('Wallet provider has no network');
  assertChainId(Number(network.chainId), expectedChainId);
}

/** Bridge the active wagmi connector (EIP-1193) to the ethers signer the SDK expects. */
export async function getStorageSigner(connector: Connector): Promise<Signer> {
  const provider = (await connector.getProvider()) as Eip1193Provider;
  const signer = await new BrowserProvider(provider).getSigner();
  // Fail before any encryption work — and before the wallet is ever prompted.
  await assertSignerChain(signer, activeNetwork().chainId);
  return signer;
}

export interface UploadResult {
  rootHash: string;
  txHash: string;
  /** True when the network already had this exact content (same merkle root) —
   *  the SDK skips the duplicate tx. Normal when a snapshot didn't change. */
  alreadyStored: boolean;
}

export async function uploadBlob(signer: Signer, bytes: Uint8Array): Promise<UploadResult> {
  // Resolve ONCE so the chain we assert, the indexer we ask, and the RPC we
  // broadcast to cannot disagree with each other.
  const net = activeNetwork();
  // The choke point: every write, including any future caller that builds its
  // own signer, passes through here.
  await assertSignerChain(signer, net.chainId);

  const file = new MemData(bytes);
  const indexer = new Indexer(indexerRpc());
  const [result, err] = await indexer.upload(file, net.rpcUrl, signer);
  if (err) {
    if (isInsufficientFunds(err)) {
      throw new InsufficientFundsError(
        `Your wallet needs a little ${net.nativeCurrency.symbol} to cover the 0G storage fee.`,
      );
    }
    throw new Error(`0G upload failed: ${err.message}`);
  }
  if (!result || Array.isArray((result as { rootHashes?: string[] }).rootHashes)) {
    throw new Error('0G upload returned an unexpected multi-file result');
  }
  const single = result as { txHash: string; rootHash: string };
  if (!single.rootHash) throw new Error('0G upload returned no root hash');
  return {
    rootHash: single.rootHash,
    txHash: single.txHash,
    alreadyStored: !single.txHash,
  };
}

/** Thrown when a root hash simply is not on this network — which is the common
 *  case for a root copied from the other one, since roots don't cross networks. */
export class RootNotFoundError extends Error {
  readonly name = 'RootNotFoundError';
  constructor(readonly rootHash: string, networkLabel: string, otherLabel: string) {
    super(
      `No file with that root hash is on ${networkLabel}. Root hashes are per-network — ` +
        `a snapshot saved on ${otherLabel} can't be restored here.`,
    );
  }
}

/** Download a blob by root hash, with merkle-proof verification on. */
export async function downloadBlob(rootHash: string): Promise<Uint8Array> {
  const net = activeNetwork();
  const indexer = new Indexer(indexerRpc());

  // Distinguish "not on this network" from a transport failure before the SDK
  // buries it — pasting the other network's root (or an anchored root that was
  // never a storage root) is the likeliest way to reach this path, and without
  // this pre-check downloadToBlob hangs indefinitely instead of failing.
  //
  // Verified live: the indexer THROWS `file not found` for an unknown root
  // rather than returning an empty array, so both shapes are handled.
  const other = net.key === 'mainnet' ? ZG_TESTNET : ZG_MAINNET;
  let located: unknown = null;
  try {
    located = await indexer.getFileLocations(rootHash);
  } catch (err) {
    const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    if (message.includes('not found')) {
      throw new RootNotFoundError(rootHash, net.label, other.label);
    }
    // A genuine transport problem — let the download attempt report it.
  }
  if (Array.isArray(located) && located.length === 0) {
    throw new RootNotFoundError(rootHash, net.label, other.label);
  }

  const [blob, err] = await indexer.downloadToBlob(rootHash, { proof: true });
  if (err || !blob) throw new Error(`0G download failed: ${err?.message ?? 'no data'}`);
  return new Uint8Array(await blob.arrayBuffer());
}

/** Is this root hash actually retrievable from the storage network right now? */
export async function checkAvailability(rootHash: string): Promise<boolean> {
  const indexer = new Indexer(indexerRpc());
  try {
    const locations = await indexer.getFileLocations(rootHash);
    return Array.isArray(locations) && locations.length > 0;
  } catch {
    return false;
  }
}
