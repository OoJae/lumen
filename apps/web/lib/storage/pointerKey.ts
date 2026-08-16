/**
 * Storage-pointer keying and validation — pure, so the rule that decides
 * whether the UI may claim "your journal is on 0G" is unit-testable without
 * IndexedDB.
 *
 * Root hashes do not cross networks: a testnet root simply does not exist on
 * mainnet. Before Wave 3 the pointer was stored under one unscoped key, so
 * flipping networks made the app show "Saved to 0G · 0xabc…" for a root the
 * active network had never heard of. Keys are scoped per network now, and the
 * one legacy (unscoped) key is read as testnet — where every Wave-2 save went.
 */
import type { StorageReceipt, ZgNetworkKey } from '@lumen/shared';

/** The Wave-2 unscoped key. Read for back-compat; never the target of new logic. */
export const LEGACY_POINTER_KEY = 'pointer';

export function pointerKey(network: ZgNetworkKey): string {
  return `pointer:${network}`;
}

/** Validate rather than cast — a malformed KV value must read as "nothing
 *  saved", never as a receipt whose undefined fields the UI then renders. */
export function isStorageReceipt(value: unknown): value is Omit<StorageReceipt, 'network'> {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.seq === 'number' &&
    typeof r.rootHash === 'string' &&
    r.rootHash.length > 0 &&
    typeof r.txHash === 'string' &&
    typeof r.paddedBytes === 'number' &&
    typeof r.turnCount === 'number' &&
    typeof r.savedAt === 'string'
  );
}

/**
 * Stamp a network onto a validated receipt. The ONE place the
 * legacy-pointer-means-testnet rule is applied; a receipt that already carries
 * a network keeps it, so a mis-scoped read can't silently relabel someone's
 * pointer.
 */
export function stampNetwork(value: unknown, network: ZgNetworkKey): StorageReceipt | null {
  if (!isStorageReceipt(value)) return null;
  const existing = (value as Partial<StorageReceipt>).network;
  return { ...value, network: existing ?? network };
}
