/**
 * Local-first store (Wave 2) — a thin, zero-dependency IndexedDB wrapper.
 *
 * CONTENT IS CIPHERTEXT-ONLY: every entry/reflection/vector is an envelope-v2
 * blob encrypted before it gets here ("no plaintext at rest"). The only
 * plaintext this DB holds is deliberately-scoped metadata, enumerated in
 * docs/privacy-model.md: turn ids + timestamps (pre-unlock "N entries" UX),
 * the storage pointer {seq, rootHash, txHash} (already public on-chain), and
 * the KCV envelope (itself ciphertext).
 *
 * One database per wallet (lumen-mem-<address>) so two wallets can never mix.
 */

import type { DeletedTurnV1, StorageReceipt, ZgNetworkKey } from '@lumen/shared';

import type { EncryptedEnvelope } from '../crypto/encrypt';
import { LEGACY_POINTER_KEY, pointerKey, stampNetwork } from './pointerKey';

export interface TurnMeta {
  id: string;
  createdAt: string; // ISO-8601
}

export interface StoredTurnRecord {
  meta: TurnMeta;
  envelope: EncryptedEnvelope;
}

// v2 adds the `tombstones` store. Deleting an entry has to record that it was
// deleted, or hydrate()'s backfill and restoreFromRoot's union merge each
// resurrect it — see lib/memory/deletions.ts.
const DB_VERSION = 2;
const TURNS = 'turns';
const VECTORS = 'vectors';
const KV = 'kv';
const TOMBSTONES = 'tombstones';
const KEY_KCV = 'kcv';

function dbName(wallet: string): string {
  return `lumen-mem-${wallet.toLowerCase()}`;
}

function openDb(wallet: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName(wallet), DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TURNS)) db.createObjectStore(TURNS);
      if (!db.objectStoreNames.contains(VECTORS)) db.createObjectStore(VECTORS);
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
      if (!db.objectStoreNames.contains(TOMBSTONES)) db.createObjectStore(TOMBSTONES);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    // Without this an upgrade blocked by another open tab hangs the promise
    // forever, with nothing on screen to explain why. An error is worse than
    // success and far better than a spinner that never stops.
    request.onblocked = () =>
      reject(
        new Error(
          'Another Lumen tab is open — close it and reload to finish updating local storage.',
        ),
      );
  });
}

async function withStore<T>(
  wallet: string,
  store: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb(wallet);
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(store, mode).objectStore(store));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
  } finally {
    db.close();
  }
}

/**
 * A transaction across several stores that resolves only when the browser has
 * COMMITTED.
 *
 * `withStore` cannot express this: it resolves on the first request's
 * `onsuccess`, which fires BEFORE commit, and it spans exactly one store. For a
 * delete that is not good enough — a crash between "turn removed" and
 * "tombstone written" would resurrect the entry at the next restore, and the
 * opposite order would mark an entry deleted while its ciphertext remained.
 *
 * `run` must issue its requests synchronously. Awaiting anything non-IDB inside
 * a transaction lets it auto-commit, and the next request throws.
 */
async function withTx(
  wallet: string,
  stores: readonly string[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => void,
): Promise<void> {
  const db = await openDb(wallet);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([...stores], mode);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      run(tx);
    });
  } finally {
    db.close();
  }
}

export async function putTurn(
  wallet: string,
  meta: TurnMeta,
  envelope: EncryptedEnvelope,
): Promise<void> {
  await withStore(wallet, TURNS, 'readwrite', (s) =>
    s.put({ meta, envelope } satisfies StoredTurnRecord, meta.id),
  );
}

/** All turn records, oldest first (by stored createdAt). */
export async function getTurns(wallet: string): Promise<StoredTurnRecord[]> {
  const records = await withStore<StoredTurnRecord[]>(wallet, TURNS, 'readonly', (s) =>
    s.getAll(),
  );
  return records.sort((a, b) => a.meta.createdAt.localeCompare(b.meta.createdAt));
}

export async function countTurns(wallet: string): Promise<number> {
  return withStore<number>(wallet, TURNS, 'readonly', (s) => s.count());
}

export async function putVector(
  wallet: string,
  turnId: string,
  envelope: EncryptedEnvelope,
): Promise<void> {
  await withStore(wallet, VECTORS, 'readwrite', (s) => s.put(envelope, turnId));
}

export async function getVectors(
  wallet: string,
): Promise<{ turnId: string; envelope: EncryptedEnvelope }[]> {
  const db = await openDb(wallet);
  try {
    return await new Promise((resolve, reject) => {
      const out: { turnId: string; envelope: EncryptedEnvelope }[] = [];
      const cursorReq = db.transaction(VECTORS, 'readonly').objectStore(VECTORS).openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return resolve(out);
        out.push({ turnId: String(cursor.key), envelope: cursor.value as EncryptedEnvelope });
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error ?? new Error('IndexedDB cursor failed'));
    });
  } finally {
    db.close();
  }
}

export async function setPointer(
  wallet: string,
  network: ZgNetworkKey,
  receipt: StorageReceipt,
): Promise<void> {
  const stamped: StorageReceipt = { ...receipt, network };
  await withStore(wallet, KV, 'readwrite', (s) => s.put(stamped, pointerKey(network)));
  // Dual-write the Wave-2 unscoped key on testnet so that promoting a
  // pre-cutover build (the fastest rollback) still finds the NEWEST pointer and
  // cannot fork the seq chain by reusing a seq. Drop once no pre-cutover build
  // can be promoted.
  if (network === 'testnet') {
    await withStore(wallet, KV, 'readwrite', (s) => s.put(stamped, LEGACY_POINTER_KEY));
  }
}

export async function getPointer(
  wallet: string,
  network: ZgNetworkKey,
): Promise<StorageReceipt | null> {
  const scoped = await withStore<unknown>(wallet, KV, 'readonly', (s) =>
    s.get(pointerKey(network)),
  );
  const hit = stampNetwork(scoped, network);
  if (hit) return hit;
  if (network !== 'testnet') return null;
  // Read-through only — never written back, never deleted, so a Wave-2 build
  // promoted during judging still finds its pointer exactly where it left it.
  const legacy = await withStore<unknown>(wallet, KV, 'readonly', (s) =>
    s.get(LEGACY_POINTER_KEY),
  );
  return stampNetwork(legacy, 'testnet');
}

export async function putKcv(wallet: string, envelope: EncryptedEnvelope): Promise<void> {
  await withStore(wallet, KV, 'readwrite', (s) => s.put(envelope, KEY_KCV));
}

export async function getKcv(wallet: string): Promise<EncryptedEnvelope | null> {
  const value = await withStore<unknown>(wallet, KV, 'readonly', (s) => s.get(KEY_KCV));
  return (value as EncryptedEnvelope | undefined) ?? null;
}

/**
 * Remove these turns and their vectors, and record their tombstones — all in
 * ONE committed transaction.
 *
 * Idempotent on purpose: deleting an absent key and re-putting an existing
 * marker are both no-ops, so hydrate() and restoreFromRoot can both call this
 * freely to converge a device that crashed mid-delete or has just learned about
 * a deletion made elsewhere.
 */
export async function applyTombstones(
  wallet: string,
  markers: readonly DeletedTurnV1[],
): Promise<void> {
  if (markers.length === 0) return;
  await withTx(wallet, [TURNS, VECTORS, TOMBSTONES], 'readwrite', (tx) => {
    const turns = tx.objectStore(TURNS);
    const vectors = tx.objectStore(VECTORS);
    const tombstones = tx.objectStore(TOMBSTONES);
    for (const marker of markers) {
      tombstones.put(marker, marker.id);
      turns.delete(marker.id);
      vectors.delete(marker.id);
    }
  });
}

/** Delete one entry: its ciphertext, its vector, and a marker so it stays gone. */
export async function deleteTurn(
  wallet: string,
  turnId: string,
  deletedAt: string,
): Promise<void> {
  await applyTombstones(wallet, [{ id: turnId, deletedAt }]);
}

/** Every deletion marker for this wallet, sorted by id — deterministic because
 *  this array is canonical-JSON'd into snapshots. */
export async function getTombstones(wallet: string): Promise<DeletedTurnV1[]> {
  const all = await withStore<DeletedTurnV1[]>(wallet, TOMBSTONES, 'readonly', (store) =>
    store.getAll(),
  );
  return [...all].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export async function getTurnIds(wallet: string): Promise<string[]> {
  const keys = await withStore<IDBValidKey[]>(wallet, TURNS, 'readonly', (store) =>
    store.getAllKeys(),
  );
  return keys.map(String);
}

export async function getVectorIds(wallet: string): Promise<string[]> {
  const keys = await withStore<IDBValidKey[]>(wallet, VECTORS, 'readonly', (store) =>
    store.getAllKeys(),
  );
  return keys.map(String);
}

/** Drop vectors whose turn no longer exists. A vector is derived from the entry
 *  text and is content in its own right, so an orphan is a leak, not litter. */
export async function deleteVectors(wallet: string, turnIds: readonly string[]): Promise<void> {
  if (turnIds.length === 0) return;
  await withTx(wallet, [VECTORS], 'readwrite', (tx) => {
    const vectors = tx.objectStore(VECTORS);
    for (const id of turnIds) vectors.delete(id);
  });
}
