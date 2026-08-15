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
import { activeNetwork } from '@/lib/0g/network';

function indexerRpc(): string {
  return activeNetwork().storage.indexerRpc;
}

function evmRpc(): string {
  return activeNetwork().rpcUrl;
}

/** Thrown when the signing wallet can't cover gas + the storage fee, so the UI
 *  can offer the faucet without sniffing provider message strings. */
export class InsufficientFundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientFundsError';
  }
}

function isInsufficientFunds(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  if (code === 'INSUFFICIENT_FUNDS' || code === -32000) return true;
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return message.includes('insufficient funds') || message.includes('insufficient balance');
}

/** Bridge the active wagmi connector (EIP-1193) to the ethers signer the SDK expects. */
export async function getStorageSigner(connector: Connector): Promise<Signer> {
  const provider = (await connector.getProvider()) as Eip1193Provider;
  const browserProvider = new BrowserProvider(provider);
  return browserProvider.getSigner();
}

export interface UploadResult {
  rootHash: string;
  txHash: string;
  /** True when the network already had this exact content (same merkle root) —
   *  the SDK skips the duplicate tx. Normal when a snapshot didn't change. */
  alreadyStored: boolean;
}

export async function uploadBlob(signer: Signer, bytes: Uint8Array): Promise<UploadResult> {
  const file = new MemData(bytes);
  const indexer = new Indexer(indexerRpc());
  const [result, err] = await indexer.upload(file, evmRpc(), signer);
  if (err) {
    if (isInsufficientFunds(err)) {
      throw new InsufficientFundsError(
        'Your wallet needs a little testnet 0G to pay the storage fee.',
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

/** Download a blob by root hash, with merkle-proof verification on. */
export async function downloadBlob(rootHash: string): Promise<Uint8Array> {
  const indexer = new Indexer(indexerRpc());
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

/** Compute the merkle root of bytes locally, without any network call — used to
 *  predict/verify the rootHash of a snapshot before or after upload. */
export async function computeRootHash(bytes: Uint8Array): Promise<string> {
  const file = new MemData(bytes);
  const [tree, err] = await file.merkleTree();
  if (err || !tree) throw new Error(`merkle tree failed: ${err?.message ?? 'unknown'}`);
  const root = tree.rootHash();
  if (!root) throw new Error('merkle tree returned no root');
  return root;
}
