/**
 * Companion (ERC-7857 INFT) logic — pure, dependency-free, testable.
 *
 * The hook does the chain talking; every claim the UI makes about a companion
 * is decided here, where it can be asserted exhaustively. The governing rule is
 * the same one the rest of Lumen follows: never assert what hasn't been
 * verified. A read that failed produces "couldn't check", never a number.
 */
import type { StorageReceipt, ZgNetworkKey } from '@lumen/shared';

export const ZERO_ROOT = '0x0000000000000000000000000000000000000000000000000000000000000000';

/** Case-insensitive bytes32 comparison that never throws on junk. */
export function sameRoot(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

export function isZeroRoot(root: string | null | undefined): boolean {
  return !root || sameRoot(root, ZERO_ROOT);
}

/** `0xb6fcacd4…bf7d` — one shortener for every surface (matches SyncChip's 8/4). */
export function shortRoot(root: string): string {
  if (root.length <= 14) return root;
  return `${root.slice(0, 10)}…${root.slice(-4)}`;
}

// ── State machine ─────────────────────────────────────────────────────────────

export type CompanionState =
  | 'no-wallet'
  | 'locked'
  | 'unsupported'
  | 'checking'
  | 'unreadable'
  | 'nothing-to-mint'
  | 'mintable'
  | 'minting'
  | 'unanchored'
  | 'synced'
  | 'ahead'
  | 'diverged'
  | 'anchor-only'
  | 'anchoring';

export interface CompanionReads {
  /** 'ok' ONLY when every required read resolved. Never optimistic. */
  status: 'loading' | 'ok' | 'error';
  /** 0n = no companion. */
  tokenId: bigint;
  /** ZERO_ROOT when none or unread. */
  root: string;
  /** Anchors AFTER mint — the root minted with is not counted. */
  anchorCount: number;
}

export interface CompanionStateInput {
  wallet: string | null;
  unlocked: boolean;
  contractConfigured: boolean;
  reads: CompanionReads;
  /** ACTIVE-network receipt only, same invariant saveStatus.ts enforces. */
  receipt: StorageReceipt | null;
  writing: 'mint' | 'anchor' | null;
}

/**
 * Evaluation order IS the honesty guarantee: every branch that could name a
 * token is placed after the guards that prove we actually read one.
 */
export function companionState(input: CompanionStateInput): CompanionState {
  if (!input.wallet) return 'no-wallet';
  if (!input.contractConfigured) return 'unsupported';
  if (input.writing === 'mint') return 'minting';
  if (input.writing === 'anchor') return 'anchoring';
  if (!input.unlocked) return 'locked';

  // A failed or in-flight read must never produce a state that names a token.
  if (input.reads.status === 'error') return 'unreadable';
  if (input.reads.status === 'loading') return 'checking';

  if (input.reads.tokenId === 0n) {
    // A foreign-network root can't be minted here, and save.receipt is already
    // active-network-only, so this correctly covers foreign-only too.
    return input.receipt ? 'mintable' : 'nothing-to-mint';
  }

  if (isZeroRoot(input.reads.root)) return 'unanchored';
  if (!input.receipt) return 'anchor-only';
  if (sameRoot(input.reads.root, input.receipt.rootHash)) return 'synced';
  if (sameRoot(input.reads.root, input.receipt.prevRootHash)) return 'ahead';
  return 'diverged';
}

/** States in which the UI names a token id. Used by the invariant test. */
export function namesToken(state: CompanionState): boolean {
  return (
    state === 'unanchored' ||
    state === 'synced' ||
    state === 'ahead' ||
    state === 'diverged' ||
    state === 'anchor-only'
  );
}

// ── Mint metadata ─────────────────────────────────────────────────────────────

/**
 * The token's PUBLIC, effectively permanent metadata.
 *
 * `tokenURI(tokenId)` returns this string verbatim, stored on-chain and paid
 * for by the minter per byte — and the contract refuses a description change
 * that doesn't also move the root, so treat it as immutable.
 *
 * It is byte-identical for every Lumen companion on both networks: no address,
 * no timestamp, no entry count, no root. The metadata therefore distinguishes
 * nobody, which is a real privacy property rather than an oversight. The root
 * lives in `dataHash`, where it belongs — embedding it here would become a
 * permanent lie after the first anchor.
 */
export const COMPANION_METADATA = {
  schema: 'lumen-companion/1',
  name: 'Lumen Companion',
  description:
    "Holds one pointer: the 0G Storage root of a journal snapshot encrypted in its owner's browser under a wallet-derived key. No journal text is on-chain; Lumen cannot read it. The pointer moves only when the owner signs an anchor.",
  personal_data: 'none',
  transferable: false,
  transfer_note:
    'ERC-7857 transfer needs a TEE re-encryption oracle; none is live, so transfers revert.',
  source: 'https://github.com/OoJae/lumen',
} as const;

export const COMPANION_METADATA_MAX_BYTES = 700;

/**
 * `encodeURI` deliberately preserves `#`, so a `#` anywhere in the metadata
 * would truncate the data URI at a fragment and permanently lose the tail —
 * on-chain, unfixable. (Verified: `%` is NOT a hazard; encodeURI escapes it to
 * `%25` and it round-trips.) Throw rather than mint something broken.
 */
export function buildDataDescription(meta: object): string {
  const json = JSON.stringify(meta);
  if (json.includes('#')) {
    throw new Error('Companion metadata must not contain "#" — it would truncate the token URI');
  }
  return `data:application/json,${encodeURI(json)}`;
}

export const COMPANION_DATA_DESCRIPTION = buildDataDescription(COMPANION_METADATA);

// ── Costs ─────────────────────────────────────────────────────────────────────

/**
 * MEASURED on 0G mainnet (2026-08-19), not estimated:
 *   mint   648,192 gas → 0.0025 0G   anchor 60,729 gas → 0.00024 0G
 *
 * Mint costs ~10x an anchor because it writes COMPANION_DATA_DESCRIPTION into
 * contract storage — every 32 bytes of that public label is a fresh SSTORE the
 * minter pays for. That is the price of the token carrying its own honest
 * description instead of a link that can rot.
 *
 * Copy always pairs these with "your wallet shows the exact amount before you
 * sign", because they are typical values and not a quote.
 */
export const TYPICAL_MINT_COST = '0.0025';
export const TYPICAL_ANCHOR_COST = '0.00024';

// ── Failure → honest copy ─────────────────────────────────────────────────────

export type CompanionAction = 'mint' | 'anchor';

/**
 * 'submit' = rejected before broadcast — nothing sent, nothing spent.
 * 'onchain' = mined and reverted — the fee WAS spent.
 * Getting this backwards is the difference between reassurance and a lie.
 */
export type FailurePhase = 'submit' | 'onchain';

export type RawFailure =
  | { kind: 'rejected' }
  | { kind: 'insufficient-funds' }
  | { kind: 'wrong-chain'; message: string }
  | { kind: 'revert'; errorName: string; args?: readonly unknown[] }
  | { kind: 'network'; message?: string }
  | { kind: 'lost'; hash: string }
  | { kind: 'unknown'; message?: string };

export interface CompanionFailure {
  kind: RawFailure['kind'];
  /** Stable slug for tests/telemetry, e.g. 'AlreadyHasCompanion'. */
  code: string;
  message: string;
  /** The honest next step is "re-read the chain, then decide". */
  refetch: boolean;
  /** The user must top up; the UI then renders the shared funding remedy. */
  funding: boolean;
}

function nothingHappened(phase: FailurePhase): string {
  return phase === 'submit'
    ? 'Nothing was sent.'
    : 'The transaction was mined but reverted, so the network fee was spent and nothing changed.';
}

function arg(args: readonly unknown[] | undefined, index: number): string {
  const value = args?.[index];
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value;
  return '';
}

export function companionFailure(
  raw: RawFailure,
  ctx: { action: CompanionAction; phase: FailurePhase; networkLabel: string },
): CompanionFailure {
  const nothing = nothingHappened(ctx.phase);
  const verb = ctx.action === 'mint' ? 'Mint' : 'Anchor';

  switch (raw.kind) {
    case 'rejected':
      return {
        kind: 'rejected',
        code: 'rejected',
        message: `${verb} cancelled — nothing was sent.`,
        refetch: false,
        funding: false,
      };

    case 'insufficient-funds':
      // Message intentionally empty: the UI renders the shared funding remedy
      // so the faucet/no-faucet rule stays in exactly one place.
      return {
        kind: 'insufficient-funds',
        code: 'insufficient-funds',
        message: '',
        refetch: false,
        funding: true,
      };

    case 'wrong-chain':
      return {
        kind: 'wrong-chain',
        code: 'wrong-chain',
        message: raw.message,
        refetch: false,
        funding: false,
      };

    case 'network':
      return {
        kind: 'network',
        code: 'network',
        message: `Couldn't reach ${ctx.networkLabel} just now, so Lumen won't guess. Nothing was sent — check your connection and try again.`,
        refetch: false,
        funding: false,
      };

    case 'lost':
      return {
        kind: 'lost',
        code: 'lost',
        message:
          'Lumen lost track of your transaction. It may still confirm — check it on the explorer before trying again.',
        refetch: true,
        funding: false,
      };

    case 'revert':
      return revertCopy(raw.errorName, raw.args, ctx, nothing);

    default:
      return {
        kind: 'unknown',
        code: 'unknown',
        message: raw.message || `Something went wrong. ${nothing}`,
        refetch: false,
        funding: false,
      };
  }
}

function revertCopy(
  errorName: string,
  args: readonly unknown[] | undefined,
  ctx: { action: CompanionAction; phase: FailurePhase; networkLabel: string },
  nothing: string,
): CompanionFailure {
  const base = { kind: 'revert' as const, code: errorName, funding: false };

  switch (errorName) {
    case 'AlreadyHasCompanion':
      return {
        ...base,
        message: `This wallet already owns Companion #${arg(args, 1)}. LumenCompanion allows one per wallet. ${nothing}`,
        refetch: true,
      };
    case 'StaleAnchor':
      return {
        ...base,
        message: `Your companion already points at ${shortRoot(arg(args, 2))}, not the root Lumen expected — something anchored it elsewhere. ${nothing} Re-check and try again.`,
        refetch: true,
      };
    case 'SameRoot':
      return {
        ...base,
        message: `Your companion already points at this exact snapshot (${shortRoot(arg(args, 0))}), so there is nothing to anchor. ${nothing}`,
        refetch: true,
      };
    case 'ZeroRoot':
      return {
        ...base,
        message: `Lumen tried to anchor an empty root. That's a bug in Lumen, not in your wallet. ${nothing}`,
        refetch: false,
      };
    case 'NotTokenOwner':
      return {
        ...base,
        message: `Companion #${arg(args, 0)} isn't owned by the connected wallet. ${nothing}`,
        refetch: true,
      };
    case 'ERC721NonexistentToken':
      return {
        ...base,
        message: `Companion #${arg(args, 0)} doesn't exist on ${ctx.networkLabel}. Companions are per-network, like root hashes. ${nothing}`,
        refetch: true,
      };
    case 'TransferRequiresOracle':
    case 'OracleNotLive':
      return {
        ...base,
        message: `Lumen companions can't be transferred yet: an ERC-7857 transfer needs a TEE re-encryption oracle to hand the new owner a usable key, and none is live. The contract refuses rather than pretend. ${nothing}`,
        refetch: false,
      };
    default:
      // Name it verbatim. Never smooth an unknown contract error into
      // "something went wrong" — the name is the most useful thing we have.
      return {
        ...base,
        message: `${ctx.networkLabel} refused this: ${errorName}. ${nothing}`,
        refetch: true,
      };
  }
}

/** Per-network label for a companion, e.g. for cross-network copy. */
export function companionNetworkLabel(key: ZgNetworkKey): string {
  return key === 'mainnet' ? '0G mainnet' : '0G testnet';
}
