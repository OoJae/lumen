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

/** MEASURED on 0G mainnet (2026-08-19): two real saves cost 0.00118 and 0.00124
 *  0G. A small snapshot is gas-dominated — the storage fee itself is a rounding
 *  error next to the flow-contract transaction. */
export const TYPICAL_SAVE_COST = '0.0012';

export interface RemedyOptions {
  /** Typical cost of THIS action, e.g. '0.0003'. Defaults to a storage save. */
  cost?: string;
  /** What the fee is for, e.g. 'storage fee' | 'mint' | 'anchor'. */
  what?: string;
  /** Verb for the retry hint: 'save again' | 'mint again' | 'anchor again'. */
  retry?: string;
}

export function insufficientFundsRemedy(
  net: ZgNetwork,
  address: string | null,
  opts?: RemedyOptions,
): FundingRemedy {
  const symbol = net.nativeCurrency.symbol;
  const cost = opts?.cost ?? TYPICAL_SAVE_COST;
  const what = opts?.what ?? 'storage fee';
  const retry = opts?.retry ?? 'save again';

  if (net.faucetUrl) {
    return {
      text: `Your wallet needs a little ${net.label} ${symbol} to pay the ${what} — grab some at`,
      // Label derived from the href so the visible text cannot drift from it.
      link: { href: net.faucetUrl, label: new URL(net.faucetUrl).host },
    };
  }

  return {
    text:
      `Your wallet needs a little ${symbol} on ${net.label} to pay the ${what} — this ` +
      `typically costs about ${cost} ${symbol}. ${net.label} has no faucet: send ` +
      `${symbol} to this address from an exchange or bridge, then ${retry}.`,
    address: address ?? undefined,
  };
}

/**
 * The snapshot reached 0G but this device could not record where.
 *
 * The upload is real and was paid for, so this must never read as a failure —
 * offering a retry here would charge the user a second time for the same bytes
 * and add a second root to a chain whose value is that it is legible.
 */
export function pointerLostNotice(rootHash: string | null): string {
  const root = rootHash ? `${rootHash.slice(0, 10)}…${rootHash.slice(-4)}` : 'the root above';
  return (
    `Saved to 0G — but this device could not record where. Your snapshot is on 0G at ${root}; ` +
    'this browser will have forgotten the pointer after a reload, so copy that root hash now. ' +
    'Do not save again: it would upload and pay a second time for the same entries.'
  );
}
