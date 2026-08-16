/**
 * 0G network parameters — the single source of truth.
 *
 * Verified against live docs/repos (2026-08). Both chainIds are settled:
 * mainnet Aristotle 16661, testnet Galileo 16602 (confirmed by a live
 * eth_chainId call and docs.0g.ai; older posts saying 16601 are stale).
 *
 * A chainId is a property of a NETWORK, never of an environment — there is
 * deliberately no env override for it. Only endpoints (RPC, indexer) can be
 * overridden, and only within one network (see resolveNetwork).
 */

export type ZgNetworkKey = 'testnet' | 'mainnet';

export interface ZgNetwork {
  key: ZgNetworkKey;
  /** Canonical chain name, e.g. for a wallet's "add network" prompt. */
  name: string;
  /** Human prose for badges, banners and error copy: '0G mainnet'. */
  label: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  /** Explorer name shown by wallets — kept beside the URL so the two can't drift. */
  explorerName: string;
  explorerApiUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  /** 0G Storage flow contract + indexer endpoint. */
  storage: { flowContract: string; indexerRpc: string };
  /** Present on testnet only. Its ABSENCE is what gates faucet copy in the UI —
   *  mainnet has no faucet, and no code should branch on the key to learn that. */
  faucetUrl?: string;
}

export const ZG_TESTNET: ZgNetwork = {
  key: 'testnet',
  name: '0G-Galileo-Testnet',
  label: '0G testnet',
  chainId: 16602,
  rpcUrl: 'https://evmrpc-testnet.0g.ai',
  explorerUrl: 'https://chainscan-galileo.0g.ai',
  explorerName: '0G Chainscan (Galileo)',
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
  label: '0G mainnet',
  chainId: 16661,
  rpcUrl: 'https://evmrpc.0g.ai',
  explorerUrl: 'https://chainscan.0g.ai',
  explorerName: '0G Chainscan',
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
 * Resolve a network by TYPED key, optionally overriding its endpoints.
 *
 * The key is a union, not a string: the previous `network === 'mainnet' ? … : …`
 * silently resolved every typo — and every unset value — to testnet. Overrides
 * are endpoints only, and the caller supplies the ones belonging to this network,
 * so an override can never carry one network's RPC onto the other.
 *
 * `||` rather than `??`: a defined-but-empty env var (how a blank dashboard
 * field arrives) must fall through to the default, not produce `new Indexer('')`.
 */
export function resolveNetwork(
  key: ZgNetworkKey,
  overrides?: { rpcUrl?: string; indexerRpc?: string },
): ZgNetwork {
  const base = ZG_NETWORKS[key];
  return {
    ...base,
    rpcUrl: overrides?.rpcUrl || base.rpcUrl,
    storage: {
      ...base.storage,
      indexerRpc: overrides?.indexerRpc || base.storage.indexerRpc,
    },
  };
}
