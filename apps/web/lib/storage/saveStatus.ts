/**
 * What the UI is allowed to say about where a journal is saved — pure, so the
 * claim can be tested exhaustively.
 *
 * The invariant that matters: **no receipt for the active network ⇒ never
 * "saved"**. Before Wave 3 the pointer was network-blind and "dirty" was a turn
 * count, so after a network flip the app confidently showed "Saved to 0G" for a
 * root the active network had never stored. For a product whose whole claim is
 * that its claims are checkable, that is the worst bug available.
 */
import type { StorageReceipt, ZgNetwork, ZgNetworkKey } from '@lumen/shared';
import { ZG_NETWORKS } from '@lumen/shared';

export type SyncStatus =
  | 'locked'
  | 'empty'
  /** Entries here, nothing saved on any network. */
  | 'unsaved'
  /** Entries here; a snapshot exists, but only on the OTHER network. */
  | 'foreign-only'
  /** Saved here, but the device and the snapshot no longer agree. */
  | 'stale'
  /** Everything here was deleted; the saved snapshot still holds entries. */
  | 'emptied'
  | 'saved';

export interface SyncStatusInput {
  unlocked: boolean;
  turnCount: number;
  /** Monotonic count of deletions recorded on this device. */
  deletionCount?: number;
  /** Receipt for the ACTIVE network only. */
  receipt: StorageReceipt | null;
  /** Receipt found on the other network, when the active one has none. */
  foreign: StorageReceipt | null;
}

/**
 * Note the receipt branch is checked BEFORE the empty branch.
 *
 * With the order reversed, deleting your last entry short-circuits to 'empty',
 * `isDirty` goes false, the Save button disappears, and the chip renders the
 * clean "Saved to 0G · 0x94f5…" style while the device holds nothing and the
 * snapshot still holds five entries. That is the worst lie this component could
 * tell, so 'emptied' exists to say the true thing instead.
 */
export function syncStatus(input: SyncStatusInput): SyncStatus {
  if (!input.unlocked) return 'locked';
  const deletionCount = input.deletionCount ?? 0;
  if (input.receipt) {
    if (input.turnCount === 0 && input.receipt.turnCount > 0) return 'emptied';
    // turnCount alone cannot see a delete-plus-add: 5 → 4 → 5 reads as
    // unchanged while the content differs. Deletions are append-only, so
    // comparing the monotonic counter closes that hole exactly.
    const savedDeletions = input.receipt.deletionCount ?? 0;
    return input.turnCount !== input.receipt.turnCount || deletionCount !== savedDeletions
      ? 'stale'
      : 'saved';
  }
  if (input.turnCount === 0) return 'empty';
  return input.foreign ? 'foreign-only' : 'unsaved';
}

export function isDirty(status: SyncStatus): boolean {
  return (
    status === 'unsaved' || status === 'foreign-only' || status === 'stale' || status === 'emptied'
  );
}

export interface PendingChanges {
  added: number;
  deleted: number;
}

/**
 * What changed since the last save, from counts alone — no clock, no id list.
 * Lets the UI stop saying "new entries not yet saved" for a change that is
 * purely a deletion.
 */
export function pendingChanges(
  turnCount: number,
  deletionCount: number,
  receipt: StorageReceipt | null,
): PendingChanges {
  if (!receipt) return { added: turnCount, deleted: 0 };
  const deleted = Math.max(0, deletionCount - (receipt.deletionCount ?? 0));
  const added = Math.max(0, turnCount - receipt.turnCount + deleted);
  return { added, deleted };
}

function entries(n: number): string {
  return `${n} ${n === 1 ? 'entry' : 'entries'}`;
}

/** The sync chip's parenthetical. Never says "new entries" when nothing was added. */
export function unsavedChangeNotice(changes: PendingChanges): string | null {
  const { added, deleted } = changes;
  if (added === 0 && deleted === 0) return null;
  if (added > 0 && deleted > 0) {
    return `${entries(added)} added and ${deleted} deleted, not yet saved`;
  }
  if (added > 0) return `${entries(added)} not yet saved`;
  return `${entries(deleted)} deleted, not yet saved`;
}

/**
 * The notice shown when this wallet's only snapshot lives on another network.
 * Every clause is checkable, and the words "saved", "synced" and "backed up"
 * are deliberately absent in relation to the ACTIVE network.
 */
export function foreignPointerNotice(
  active: ZgNetwork,
  receipt: StorageReceipt,
  localTurnCount: number,
): string {
  const other = ZG_NETWORKS[receipt.network as ZgNetworkKey]?.label ?? receipt.network;
  const short = `${receipt.rootHash.slice(0, 10)}…${receipt.rootHash.slice(-4)}`;
  const n = receipt.turnCount;
  const head =
    `Your last snapshot is on ${other} (${n} ${n === 1 ? 'entry' : 'entries'} · ${short}). ` +
    `You're on ${active.label} now, where nothing is anchored for this wallet yet`;
  return localTurnCount > 0
    ? `${head} — your entries are safe and encrypted on this device. One Save to 0G anchors them here.`
    : `${head}, and this device holds no entries to save.`;
}
