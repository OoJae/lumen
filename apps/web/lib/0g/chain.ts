/**
 * 0G Chain — viem chain definitions for the wallet layer.
 *
 * Wave 1: the wallet is a non-transacting "save & own" stub, so these chains are
 * only used to populate RainbowKit's network list. chainId/RPC are overridable via
 * NEXT_PUBLIC_ env vars (see the contested-testnet-chainId note in @lumen/shared).
 */
import { defineChain } from 'viem';
import { ZG_TESTNET, ZG_MAINNET } from '@lumen/shared';

const testnetChainId = Number(process.env.NEXT_PUBLIC_ZG_CHAIN_ID ?? ZG_TESTNET.chainId);
const testnetRpc = process.env.NEXT_PUBLIC_ZG_RPC ?? ZG_TESTNET.rpcUrl;

export const zgTestnet = defineChain({
  id: testnetChainId,
  name: ZG_TESTNET.name,
  nativeCurrency: ZG_TESTNET.nativeCurrency,
  rpcUrls: { default: { http: [testnetRpc] } },
  blockExplorers: {
    default: { name: '0G Chainscan (Galileo)', url: ZG_TESTNET.explorerUrl },
  },
  testnet: true,
});

export const zgMainnet = defineChain({
  id: ZG_MAINNET.chainId,
  name: ZG_MAINNET.name,
  nativeCurrency: ZG_MAINNET.nativeCurrency,
  rpcUrls: { default: { http: [ZG_MAINNET.rpcUrl] } },
  blockExplorers: {
    default: { name: '0G Chainscan', url: ZG_MAINNET.explorerUrl },
  },
});
