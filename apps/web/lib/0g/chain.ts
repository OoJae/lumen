/**
 * 0G Chain — the viem chain the wallet layer transacts on.
 *
 * Derived from activeNetwork(), so the wallet's chain can never disagree with
 * the storage indexer and RPC the uploader uses. The app knows exactly ONE
 * chain; anything else is a wrong-chain state to be corrected
 * (lib/0g/chainGuard.ts), not a supported alternative.
 */
import { defineChain, type Chain } from 'viem';
import { activeNetwork } from './network';

const net = activeNetwork();

const ACTIVE_CHAIN: Chain = defineChain({
  id: net.chainId,
  name: net.name,
  nativeCurrency: net.nativeCurrency,
  rpcUrls: { default: { http: [net.rpcUrl] } },
  blockExplorers: { default: { name: net.explorerName, url: net.explorerUrl } },
  ...(net.key === 'testnet' ? { testnet: true as const } : {}),
});

export function activeChain(): Chain {
  return ACTIVE_CHAIN;
}
