/**
 * Single network resolution for the whole app (client-safe, dependency-free).
 *
 * ONE build talks to ONE network. NEXT_PUBLIC_ZG_NETWORK moves the wallet chain,
 * the upload RPC, the storage indexer and every explorer link together — never
 * one without the others. Endpoint overrides are per-network by construction, so
 * flipping the switch cannot leave a mainnet build pointed at a testnet indexer.
 *
 * IMPORTANT: NEXT_PUBLIC_* is inlined at BUILD time. The active network is a
 * property of the compiled artifact, not of the running environment — changing
 * it in a dashboard does nothing until a rebuild. (The `force-dynamic` trick
 * used for the server-side compute flags does NOT apply here.) That is why the
 * network is displayed permanently in the UI: what you see is what was built.
 */
import { resolveNetwork, type ZgNetwork, type ZgNetworkKey } from '@lumen/shared';

/** Lumen ships pointed at mainnet. Testnet is reachable by env switch only. */
export const DEFAULT_NETWORK: ZgNetworkKey = 'mainnet';

export interface NetworkEnv {
  network?: string;
  mainnetRpc?: string;
  mainnetIndexerRpc?: string;
  testnetRpc?: string;
  testnetIndexerRpc?: string;
}

/**
 * Unknown value → the DEFAULT plus a loud `invalid`, never the other network.
 * Silently resolving `mainet` to testnet is exactly the lie this prevents.
 */
export function parseNetworkKey(raw: string | undefined): {
  key: ZgNetworkKey;
  invalid?: string;
} {
  const value = raw?.trim().toLowerCase();
  if (!value) return { key: DEFAULT_NETWORK };
  if (value === 'mainnet' || value === 'testnet') return { key: value };
  return { key: DEFAULT_NETWORK, invalid: raw };
}

/** Pure: env in → network out. The only place these env names are interpreted. */
export function resolveActiveNetwork(env: NetworkEnv): ZgNetwork {
  const { key } = parseNetworkKey(env.network);
  return resolveNetwork(
    key,
    key === 'mainnet'
      ? { rpcUrl: env.mainnetRpc, indexerRpc: env.mainnetIndexerRpc }
      : { rpcUrl: env.testnetRpc, indexerRpc: env.testnetIndexerRpc },
  );
}

// Literal member expressions: Next only inlines NEXT_PUBLIC_* it can see statically.
const ENV: NetworkEnv = {
  network: process.env.NEXT_PUBLIC_ZG_NETWORK,
  mainnetRpc: process.env.NEXT_PUBLIC_ZG_MAINNET_RPC,
  mainnetIndexerRpc: process.env.NEXT_PUBLIC_ZG_MAINNET_INDEXER_RPC,
  testnetRpc: process.env.NEXT_PUBLIC_ZG_TESTNET_RPC,
  testnetIndexerRpc: process.env.NEXT_PUBLIC_ZG_TESTNET_INDEXER_RPC,
};

const parsed = parseNetworkKey(ENV.network);
if (parsed.invalid) {
  // next.config.mjs fails the BUILD on this. If it somehow reaches a runtime,
  // say so rather than quietly serving a network nobody asked for.
  console.error(
    `[lumen] NEXT_PUBLIC_ZG_NETWORK="${parsed.invalid}" is not a 0G network — using ` +
      `${DEFAULT_NETWORK}. Valid values: mainnet | testnet.`,
  );
}

const resolved = resolveActiveNetwork(ENV);
/**
 * Frozen + memoized on purpose. Memoized because this object lands in React
 * dependency arrays (useChainGuard, the memory hook) and a fresh identity per
 * call would loop effects. Frozen because it is now a shared singleton — a
 * stray mutation would poison every other consumer, including the uploader.
 */
const ACTIVE: ZgNetwork = Object.freeze({
  ...resolved,
  storage: Object.freeze({ ...resolved.storage }),
  nativeCurrency: Object.freeze({ ...resolved.nativeCurrency }),
});

/** The one network this build talks to. */
export function activeNetwork(): ZgNetwork {
  return ACTIVE;
}

export function otherNetworkKey(): ZgNetworkKey {
  return ACTIVE.key === 'mainnet' ? 'testnet' : 'mainnet';
}
