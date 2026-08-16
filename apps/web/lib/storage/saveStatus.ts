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
  /** Saved here, but there are newer entries since. */
  | 'stale'
  | 'saved';

export interface SyncStatusInput {
  unlocked: boolean;
  turnCount: number;
  /** Receipt for the ACTIVE network only. */
  receipt: StorageReceipt | null;
  /** Receipt found on the other network, when the active one has none. */
  foreign: StorageReceipt | null;
}

export function syncStatus(input: SyncStatusInput): SyncStatus {
  if (!input.unlocked) return 'locked';
  if (input.turnCount === 0) return 'empty';
  if (input.receipt) {
    return input.turnCount !== input.receipt.turnCount ? 'stale' : 'saved';
  }
  return input.foreign ? 'foreign-only' : 'unsaved';
}

export function isDirty(status: SyncStatus): boolean {
  return status === 'unsaved' || status === 'foreign-only' || status === 'stale';
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
