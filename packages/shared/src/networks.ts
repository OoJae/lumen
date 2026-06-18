/**
 * 0G network parameters — the single source of truth.
 *
 * Verified against live docs/repos (mid-2026). Mainnet "Aristotle" values are
 * high-confidence and consistent across docs.0g.ai + ChainList. The Galileo
 * testnet chainId is CONTESTED — see note below — so it is overridable via
 * NEXT_PUBLIC_ZG_CHAIN_ID.
 */

export type ZgNetworkKey = 'testnet' | 'mainnet';

export interface ZgNetwork {
  key: ZgNetworkKey;
  name: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  explorerApiUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  /** Forward-looking (Wave 2): 0G Storage flow contract + indexer endpoint. */
  storage: { flowContract: string; indexerRpc: string };
  faucetUrl?: string;
}

/**
 * ⚠️ CONTESTED chainId. docs.0g.ai + ChainList currently show 16602; an official
 * 0G relaunch announcement + ThirdWeb show 16601. Both resolve to the same RPC.
 * Confirm via the wallet "Add Network" prompt / https://faucet.0g.ai before
 * relying on it. Wave 1's wallet is a non-transacting stub, so this is low-risk now.
 */
export const ZG_TESTNET: ZgNetwork = {
  key: 'testnet',
  name: '0G-Galileo-Testnet',
  chainId: 16602,
  rpcUrl: 'https://evmrpc-testnet.0g.ai',
  explorerUrl: 'https://chainscan-galileo.0g.ai',
  explorerApiUrl: 'https://chainscan-galileo.0g.ai/open/api',
  nativeCurrency: { name: '0G', symbol: '0G', decimals: 18 },
  storage: {
    flowContract: '0x22E03a6A89B950F1c82ec5e74F8eCa321a105296',
    indexerRpc: 'https://indexer-storage-testnet-turbo.0g.ai',
  },
  faucetUrl: 'https://faucet.0g.ai',
};

export const ZG_MAINNET: ZgNetwork = {
  key: 'mainnet',
  name: '0G-Aristotle',
  chainId: 16661,
  rpcUrl: 'https://evmrpc.0g.ai',
  explorerUrl: 'https://chainscan.0g.ai',
  explorerApiUrl: 'https://chainscan.0g.ai/open/api',
  nativeCurrency: { name: '0G', symbol: '0G', decimals: 18 },
  storage: {
    flowContract: '0x62D4144dB0F0a6fBBaeb6296c785C71B3D57C526',
    indexerRpc: 'https://indexer-storage-turbo.0g.ai',
  },
};

export const ZG_NETWORKS: Record<ZgNetworkKey, ZgNetwork> = {
  testnet: ZG_TESTNET,
  mainnet: ZG_MAINNET,
};

/**
 * Resolve the active network from a key, with optional chainId/rpc overrides
 * (e.g. from NEXT_PUBLIC_ env vars). Centralizes the contested-chainId handling.
 */
export function resolveNetwork(opts?: {
  network?: string;
  chainId?: number;
  rpcUrl?: string;
}): ZgNetwork {
  const base = opts?.network === 'mainnet' ? ZG_MAINNET : ZG_TESTNET;
  return {
    ...base,
    chainId: opts?.chainId ?? base.chainId,
    rpcUrl: opts?.rpcUrl ?? base.rpcUrl,
  };
}
