/**
 * Single network resolution for the whole app (client-safe, dependency-free).
 *
 * Kept out of lib/storage/zgStorage.ts so importing it never drags the 0G
 * storage SDK (+ ethers) into the main bundle — the SDK stays lazily loaded.
 * `NEXT_PUBLIC_ZG_NETWORK=mainnet` must move the wallet chain, the upload
 * RPC/indexer, and explorer links together, never one without the others.
 */
import { resolveNetwork, type ZgNetwork } from '@lumen/shared';

export function activeNetwork(): ZgNetwork {
  return resolveNetwork({
    network: process.env.NEXT_PUBLIC_ZG_NETWORK,
    chainId: process.env.NEXT_PUBLIC_ZG_CHAIN_ID
      ? Number(process.env.NEXT_PUBLIC_ZG_CHAIN_ID)
      : undefined,
    rpcUrl: process.env.NEXT_PUBLIC_ZG_RPC,
    indexerRpc: process.env.NEXT_PUBLIC_ZG_INDEXER_RPC,
  });
}
