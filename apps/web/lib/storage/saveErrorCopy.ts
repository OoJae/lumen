/**
 * What to tell someone whose wallet can't cover a save — pure, so the copy is
 * testable and the mainnet path can be asserted never to mention a faucet.
 *
 * Branches on the PRESENCE of `faucetUrl`, never on `key === 'testnet'`: the
 * faucet is the structural difference between the networks, and coupling the
 * copy to that fact means a future network is handled correctly by default.
 */
import type { ZgNetwork } from '@lumen/shared';

export interface FundingRemedy {
  text: string;
  link?: { href: string; label: string };
  /** Shown so the user funds the wallet that is actually connected. */
  address?: string;
}

/** Measured on 0G mainnet: a small snapshot save is gas-dominated, ~0.001 0G. */
const TYPICAL_SAVE_COST = '0.001';

export function insufficientFundsRemedy(
  net: ZgNetwork,
  address: string | null,
): FundingRemedy {
  const symbol = net.nativeCurrency.symbol;

  if (net.faucetUrl) {
    return {
      text: `Your wallet needs a little ${net.label} ${symbol} to pay the storage fee — grab some at`,
      // Label derived from the href so the visible text cannot drift from it.
      link: { href: net.faucetUrl, label: new URL(net.faucetUrl).host },
    };
  }

  return {
    text:
      `Your wallet needs a little ${symbol} on ${net.label} to pay the storage fee — a snapshot ` +
      `this size costs roughly ${TYPICAL_SAVE_COST} ${symbol}. ${net.label} has no faucet: send ` +
      `${symbol} to this address from an exchange or bridge, then save again.`,
    address: address ?? undefined,
  };
}
