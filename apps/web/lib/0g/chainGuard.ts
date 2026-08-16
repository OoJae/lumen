/**
 * Chain guard — pure, no ethers, no wagmi, no SDK.
 *
 * Kept dependency-free so any write path (storage today, the companion INFT
 * next) can import it without dragging a bundle along.
 *
 * Why this is a hard guard and not a nudge: with a mainnet indexer and a
 * testnet-connected wallet, the 0G storage SDK quotes the fee from the mainnet
 * indexer, binds the MAINNET flow address to the signer, and broadcasts to
 * Galileo — where that address holds no code, so the call succeeds as a plain
 * value transfer that burns the fee, while the app polls the mainnet RPC for a
 * receipt that will never exist. Silent loss plus a hung save. A wrong-chain
 * write must be impossible, not merely discouraged.
 */
import { ZG_NETWORKS } from '@lumen/shared';

import { activeNetwork } from './network';

/**
 * A 0G write was attempted while the wallet was on a different chain.
 * "Nothing was sent" is part of the message on purpose: the user must know no
 * transaction was broadcast and no fee was spent.
 */
export class WrongChainError extends Error {
  readonly name = 'WrongChainError';

  constructor(
    readonly expectedChainId: number,
    readonly actualChainId: number,
    readonly expectedLabel: string,
  ) {
    super(
      `Your wallet is on ${chainLabel(actualChainId)}, but Lumen writes to ` +
        `${expectedLabel} (chain ${expectedChainId}). Nothing was sent.`,
    );
  }
}

/**
 * Name a chain without ever guessing: the two 0G chains come from the shared
 * constants, a short list of majors is keyed by canonical id, and anything else
 * renders as its number rather than a wrong name.
 */
const MAJOR_CHAINS: Record<number, string> = {
  1: 'Ethereum',
  10: 'OP Mainnet',
  56: 'BNB Chain',
  137: 'Polygon',
  8453: 'Base',
  42161: 'Arbitrum One',
};

export function chainLabel(chainId: number): string {
  for (const net of Object.values(ZG_NETWORKS)) {
    if (net.chainId === chainId) return net.label;
  }
  return MAJOR_CHAINS[chainId] ?? `chain ${chainId}`;
}

export function assertChainId(actual: number, expected = activeNetwork().chainId): void {
  if (actual !== expected) {
    throw new WrongChainError(expected, actual, chainLabel(expected));
  }
}
