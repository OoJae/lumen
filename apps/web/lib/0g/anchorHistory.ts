/**
 * The on-chain memory-pointer history, reduced to a chain anyone can check.
 *
 * `LumenCompanion` anchors with compare-and-swap: every `MemoryRootAnchored`
 * carries the root it replaced (`prevRoot`) as well as the new one. That makes
 * the event log self-describing — link N's `prevRoot` MUST equal link N-1's
 * `newRoot`, and the first link must continue from the root recorded at mint.
 * A history that satisfies that is one an outside observer can replay; a gap or
 * a rewrite shows up as a broken link rather than a plausible-looking list.
 *
 * This module is deliberately pure: no viem, no RPC, no React. The page fetches
 * logs and hands them here, which is what makes the verification testable
 * without a chain — and what lets the same reducer serve the public proof page
 * and any future in-app view.
 */

/** One decoded `MemoryRootAnchored`, normalised out of viem's log shape. */
export interface RawAnchorEvent {
  seq: number;
  prevRoot: string;
  newRoot: string;
  txHash: string;
  blockNumber: number;
  /** Unix seconds, from the block. */
  timestamp: number;
}

/** The decoded `Minted` for this token. */
export interface RawMintEvent {
  tokenId: string;
  owner: string;
  memoryRoot: string;
  txHash: string;
  blockNumber: number;
  timestamp: number;
}

export interface AnchorLink extends RawAnchorEvent {
  /** Does this link continue the previous one? */
  linked: boolean;
  /** What we expected `prevRoot` to be, when `linked` is false. */
  expectedPrev: string;
}

export interface AnchorChain {
  mint: RawMintEvent | null;
  links: AnchorLink[];
  /** Every link continues the one before it, back to the mint. */
  intact: boolean;
  /** `seq` of the first link that does not continue its predecessor. */
  brokenAtSeq: number | null;
  /** The root the chain ends on — what `latestMemoryRoot` should return. */
  latestRoot: string | null;
  /**
   * Distinct UTC days on which the owner committed a root, oldest first.
   *
   * Includes the mint day: minting writes a root into the very slot that
   * `anchorMemoryRoot` later compare-and-swaps against, and `buildAnchorChain`
   * already treats it as link 0. It is a signed transaction, in a block, by the
   * owner, committing to a specific encrypted snapshot — every property this
   * record claims. Excluding it would show nothing at all for someone who just
   * minted, directly below a chain view rendering their mint with a timestamp.
   */
  practiceDays: string[];
  /** The UTC day the token was minted, or null if it sealed no real root. */
  mintDay: string | null;
}

const ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000';

/** Roots come off-chain as bytes32 hex; compare case- and prefix-insensitively. */
export function sameRoot(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (v: string) => (v.startsWith('0x') ? v.slice(2) : v).toLowerCase();
  return norm(a) === norm(b);
}

export function isZeroRoot(root: string | null | undefined): boolean {
  return sameRoot(root, ZERO);
}

/** `0x94f51264…f6fd4e5d` — enough to eyeball, short enough to sit in a table. */
export function shortRoot(root: string): string {
  if (root.length <= 18) return root;
  return `${root.slice(0, 10)}…${root.slice(-8)}`;
}

/** UTC day key for an anchor's block timestamp. UTC, not local: the same chain
 *  history must render the same number of practice days for every viewer. */
export function utcDay(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toISOString().slice(0, 10);
}

/**
 * Replay the log into a verified chain.
 *
 * Ordering is by `seq`, not by block: `seq` is what the contract itself
 * increments, so trusting it and then checking the root links catches a
 * reordered or partial log rather than quietly accepting it.
 */
export function buildAnchorChain(
  mint: RawMintEvent | null,
  anchors: readonly RawAnchorEvent[],
): AnchorChain {
  const ordered = [...anchors].sort((a, b) => a.seq - b.seq);

  // The chain starts at whatever root was recorded when the token was minted.
  // Minting with no snapshot yet is legal, and records the zero root.
  let expected = mint ? mint.memoryRoot : null;
  let brokenAtSeq: number | null = null;

  const links: AnchorLink[] = ordered.map((event) => {
    // With no mint event in range we cannot anchor the first link to anything,
    // so we take its word for the starting root rather than claim a break we
    // cannot actually demonstrate.
    const expectedPrev = expected ?? event.prevRoot;
    const linked = sameRoot(event.prevRoot, expectedPrev);
    if (!linked && brokenAtSeq === null) brokenAtSeq = event.seq;
    expected = event.newRoot;
    return { ...event, linked, expectedPrev };
  });

  // A zero-root mint committed to nothing, so it is not a sealed day. And a
  // timestamp of 0 means the block read FAILED (blockTime returns 0 rather than
  // inventing a time) — counting it would put a '1970-01-01' day in the record
  // and, once this feeds a calendar, drag the window back fifty-six years.
  const mintDay =
    mint && mint.timestamp > 0 && !isZeroRoot(mint.memoryRoot) ? utcDay(mint.timestamp) : null;

  const practiceDays = [
    ...new Set([
      ...(mintDay ? [mintDay] : []),
      ...ordered.filter((event) => event.timestamp > 0).map((event) => utcDay(event.timestamp)),
    ]),
  ].sort();

  return {
    mint,
    links,
    intact: brokenAtSeq === null,
    brokenAtSeq,
    latestRoot: links.length > 0 ? links[links.length - 1]!.newRoot : (mint?.memoryRoot ?? null),
    practiceDays,
    mintDay,
  };
}

/**
 * Does the chain we replayed actually end where the contract says it does?
 *
 * The log and the storage slot are independent reads. Agreement means the
 * history is complete; disagreement means the log we fetched is missing
 * something (a truncated block range, an RPC that dropped events) and the page
 * must say so rather than present a confident, wrong chain.
 */
export function agreesWithContract(chain: AnchorChain, latestOnChain: string | null): boolean {
  if (!latestOnChain) return chain.links.length === 0 && !chain.mint;
  return sameRoot(chain.latestRoot, latestOnChain);
}
