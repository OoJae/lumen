/**
 * Deletion, made durable.
 *
 * A hard delete alone silently undoes itself in this codebase, by two separate
 * routes: `hydrate()` backfills in-memory turns back into IndexedDB, so an entry
 * deleted from the store while still on screen is re-persisted at the next
 * unlock; and `restoreFromRoot` union-merges an older snapshot, so restoring
 * anything from before the delete brings it back. Tombstones are what close
 * both, and carrying them inside later snapshots is what makes a deletion
 * survive to another device.
 *
 * All the decisions live here, pure, because the IndexedDB layer underneath
 * cannot be unit-tested in this repo's node environment. What is left in db.ts
 * is mechanical request plumbing.
 *
 * What this can NOT do, and no code can: unpublish a snapshot already uploaded
 * to 0G. Those bytes stay retrievable by root hash forever, decryptable only by
 * the wallet that wrote them. The UI says so; see lib/storage/deleteCopy.ts.
 */
import type { DeletedTurnV1 } from '@lumen/shared';

/**
 * Union by id, keeping the EARLIEST deletedAt, sorted by id.
 *
 * Sorted deliberately: this array is canonical-JSON'd into snapshots, and
 * canonicalJson sorts object KEYS but not array ORDER. Unsorted markers would
 * make two devices produce different bytes — and therefore different root
 * hashes — for the same logical journal, which would break the determinism the
 * ownership proof rests on.
 */
export function mergeTombstones(
  a: readonly DeletedTurnV1[],
  b: readonly DeletedTurnV1[],
): DeletedTurnV1[] {
  const byId = new Map<string, DeletedTurnV1>();
  for (const marker of [...a, ...b]) {
    const existing = byId.get(marker.id);
    if (!existing || marker.deletedAt < existing.deletedAt) byId.set(marker.id, marker);
  }
  return [...byId.values()].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

export function tombstoneIdSet(markers: readonly DeletedTurnV1[]): Set<string> {
  return new Set(markers.map((marker) => marker.id));
}

/**
 * Validate rather than cast.
 *
 * A corrupt `deletions` array inside a decrypted snapshot must degrade to "no
 * deletions I can trust" rather than crash a restore — the same rule
 * isStorageReceipt follows in lib/storage/pointerKey.ts.
 */
export function sanitizeTombstones(value: unknown): DeletedTurnV1[] {
  if (!Array.isArray(value)) return [];
  const out: DeletedTurnV1[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const { id, deletedAt } = item as { id?: unknown; deletedAt?: unknown };
    if (typeof id !== 'string' || id.trim() === '') continue;
    if (typeof deletedAt !== 'string' || deletedAt === '') continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, deletedAt });
  }
  return out.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

export function withoutDeleted<T extends { id: string }>(
  items: readonly T[],
  deleted: ReadonlySet<string>,
): T[] {
  return items.filter((item) => !deleted.has(item.id));
}

/**
 * Which in-memory turns hydrate may write back to IndexedDB.
 *
 * The missing `deleted` filter here IS the resurrection bug: hydrate backfills
 * React state into the store, so a turn deleted from the store while another
 * tab still holds it in state comes straight back at the next unlock.
 */
export function backfillCandidates<T extends { id: string }>(
  sessionTurns: readonly T[],
  storedIds: ReadonlySet<string>,
  deleted: ReadonlySet<string>,
): T[] {
  return sessionTurns.filter((turn) => !storedIds.has(turn.id) && !deleted.has(turn.id));
}

export interface RestoreMerge<T> {
  merged: T[];
  /** Entries actually added to this device. */
  added: number;
  /** Entries in the snapshot this device had deleted, deliberately not restored. */
  skippedDeleted: number;
}

/**
 * The restore merge, with deletions respected in both directions.
 *
 * Drops locally-held turns that the incoming snapshot says were deleted (the
 * cross-device case), and never re-adds a tombstoned id (the same-device case).
 */
export function mergeRestored<T extends { id: string; createdAt: string }>(
  local: readonly T[],
  incoming: readonly T[],
  deleted: ReadonlySet<string>,
): RestoreMerge<T> {
  const kept = new Map<string, T>();
  for (const turn of local) {
    if (!deleted.has(turn.id)) kept.set(turn.id, turn);
  }

  let added = 0;
  let skippedDeleted = 0;
  for (const turn of incoming) {
    if (deleted.has(turn.id)) {
      skippedDeleted++;
      continue;
    }
    if (kept.has(turn.id)) continue;
    kept.set(turn.id, turn);
    added++;
  }

  const merged = [...kept.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { merged, added, skippedDeleted };
}

/**
 * Vector ids with no surviving turn — content that outlived its entry.
 *
 * Vectors are derived from the entry text and are content in their own right
 * (privacy-model.md treats them as such), so an orphan is a real leak, not
 * housekeeping.
 */
export function orphanVectorIds(
  vectorIds: readonly string[],
  turnIds: readonly string[],
): string[] {
  const alive = new Set(turnIds);
  return vectorIds.filter((id) => !alive.has(id));
}
