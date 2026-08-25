import type { Address } from 'viem';

/**
 * Address parsing, deliberately in a leaf module.
 *
 * This function is a regex and a decodeURIComponent, but it used to live in
 * publicProof.ts alongside `createPublicClient`, `next/cache`, the chain reader
 * and the anchor-log replayer. Importing it from a client component therefore
 * pulled the entire chain-reading stack into the browser bundle: the /proof
 * page weighed 157 KB against /how-it-works' 109 KB, for one text input.
 *
 * The `Address` import is type-only and erased at build, so this module has no
 * runtime dependencies at all.
 */

/** Is this a syntactically valid EVM address? Checked before any RPC work. */
export function parseAddress(raw: string): Address | null {
  let value: string;
  try {
    value = decodeURIComponent(raw ?? '').trim();
  } catch {
    // decodeURIComponent throws URIError on a malformed escape (a lone '%').
    // A junk URL must render "that isn't a wallet address", never a 500.
    return null;
  }
  return /^0x[0-9a-fA-F]{40}$/.test(value) ? (value as Address) : null;
}
