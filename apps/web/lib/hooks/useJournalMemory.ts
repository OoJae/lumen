'use client';

/**
 * Journal memory orchestrator (Wave 2).
 *
 * Ties together: session turns (Wave 1 behavior before any wallet), the
 * ciphertext-only local store (IndexedDB), on-device embeddings, and
 * user-signed snapshot saves to the 0G Log layer.
 *
 * Data rules:
 *  - plaintext turns exist ONLY in React state (memory);
 *  - every persisted byte is envelope-v2 ciphertext, per-wallet;
 *  - Save to 0G is explicit — the user's wallet signs and pays; Lumen is not
 *    in the storage path;
 *  - embedding failures, storage failures, and lock state can never block the
 *    reflect loop.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccount } from 'wagmi';

import { ZG_NETWORKS } from '@lumen/shared';
import type {
  DeletedTurnV1,
  JournalTurn,
  PersistedTurnV1,
  StorageReceipt,
} from '@lumen/shared';

import { decryptBytes, encryptBytes } from '@/lib/crypto/encrypt';
import { bytesToVector, vectorToBytes } from '@/lib/crypto/canonical';
import { embed, preloadEmbedder } from '@/lib/memory/embeddings';
import {
  backfillCandidates,
  mergeRestored,
  mergeTombstones,
  orphanVectorIds,
  sanitizeTombstones,
  tombstoneIdSet,
  withoutDeleted,
} from '@/lib/memory/deletions';
import {
  createBoundedQueue,
  DEFAULT_EMBED_CONCURRENCY,
  type BoundedQueue,
} from '@/lib/memory/embedQueue';
import type { RecallableTurn } from '@/lib/memory/recall';
import type { KeyTrust, UnlockRefusal } from '@/lib/crypto/keyTrust';
import type { UnlockNotice } from '@/lib/crypto/unlockCopy';
import * as db from '@/lib/storage/db';
import {
  buildSnapshot,
  decryptSnapshot,
  encryptSnapshot,
  packVector,
  snapshotBucketBytes,
  unpackVector,
} from '@/lib/storage/snapshot';
import { WrongChainError } from '@/lib/0g/chainGuard';
import { activeNetwork, otherNetworkKey } from '@/lib/0g/network';
import { isDirty, syncStatus, type SyncStatus } from '@/lib/storage/saveStatus';
import { useMemoryKey, type MemoryKeyState } from './useMemoryKey';

/** The 0G SDK (+ ethers) is ~250 kB — load it only when a save/restore/verify
 *  actually happens, never on first paint. */
function zg() {
  return import('@/lib/storage/zgStorage');
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type SaveState = 'idle' | 'saving' | 'error';

/** Structured save failure so the UI never has to sniff provider strings. */
export interface SaveError {
  message: string;
  kind: 'insufficient-funds' | 'wrong-chain' | 'rejected' | 'other';
}

/** ethers rewrites EIP-1193 code 4001 into an `ethers-user-denied:` message,
 *  which would otherwise reach the user as raw SDK noise. */
function isUserRejection(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  if (code === 4001 || code === 'ACTION_REJECTED') return true;
  const message = err instanceof Error ? err.message.toLowerCase() : '';
  return message.includes('user-denied') || message.includes('user rejected');
}

export interface ProofResult {
  turnCount: number;
  savedAt: string;
}

export interface RestoreResult {
  /** Entries actually added to this device. */
  restored: number;
  /** Entries in the snapshot this device had deleted, deliberately not
   *  restored. Surfaced so the UI can say so rather than quietly drop them. */
  skippedDeleted: number;
}

export interface JournalMemory {
  keyState: MemoryKeyState;
  wallet: string | null;
  turns: RecallableTurn[];
  /** Encrypted turns waiting locally while the journal is locked. */
  lockedCount: number;
  addTurn(turn: JournalTurn): void;
  unlock(): Promise<void>;
  unlockWithRecoveryKey(hex: string): Promise<void>;
  lock(): void;
  exportRecoveryKey(): Promise<{ hex: string; trust: KeyTrust }>;
  /** How well this device could check the live key. Null unless unlocked. */
  trust: KeyTrust | null;
  /** What to say about an unproven key; null when there is nothing to say. */
  keyNotice: UnlockNotice | null;
  /** Stored entries that did NOT decrypt with the live key — written under a
   *  different one. They are still there; they are just not shown. */
  undecryptableCount: number;
  /** Entries whose local write FAILED. They render, but a reload loses them. */
  persistFailureCount: number;
  /**
   * True when a snapshot uploaded to 0G successfully but the local pointer
   * write failed. The save is real and paid for; this device just will not
   * remember it across a reload, so the UI must show the root hash rather than
   * offer a retry that would pay twice.
   */
  pointerLost: boolean;
  save: {
    state: SaveState;
    error: SaveError | null;
    /** Saved on the ACTIVE network — null means nothing is anchored here,
     *  whatever may exist elsewhere. */
    receipt: StorageReceipt | null;
    /** Surfaced only when the active network has no receipt but the other does. */
    foreignReceipt: StorageReceipt | null;
    status: SyncStatus;
    dirty: boolean;
    toZg(): Promise<StorageReceipt>;
  };
  /** Deletions recorded on this device, sorted by id. */
  deletions: DeletedTurnV1[];
  /**
   * Tell the key provider this wallet has a journal off this device, so an
   * unproven key is told to restore-and-prove rather than to start writing.
   * This hook reports local pointers itself; Journal folds in the on-chain
   * anchored root, which is the case that has no local pointer.
   */
  reportSnapshot(hasSnapshot: boolean): void;
  /** Why the last unlock was refused — the mismatch surfaces speak from this
   *  rather than from a hardcoded sentence that is false half the time. */
  keyRefusal: UnlockRefusal | null;
  /**
   * Remove one entry from this device and from every snapshot saved after
   * this. Resolves once the local removal has COMMITTED. Never touches
   * snapshots already on 0G — nothing can.
   */
  deleteTurn(turnId: string): Promise<void>;
  restoreFromRoot(rootHash: string): Promise<RestoreResult>;
  /** Is the saved snapshot actually retrievable from 0G right now? */
  verifyOnZg(): Promise<boolean>;
  /** Re-download the saved snapshot fresh from 0G and decrypt it locally. */
  proveOwnership(): Promise<ProofResult>;
}

function toPersisted(turn: RecallableTurn): PersistedTurnV1 {
  return {
    id: turn.id,
    entry: turn.entry,
    reflection: turn.reflection,
    attestation: turn.attestation,
    createdAt: turn.createdAt,
  };
}

function byCreatedAt(a: RecallableTurn, b: RecallableTurn): number {
  return a.createdAt.localeCompare(b.createdAt);
}

export function useJournalMemory(): JournalMemory {
  const memoryKey = useMemoryKey();
  const { connector } = useAccount();

  const [turns, setTurns] = useState<RecallableTurn[]>([]);
  const [lockedCount, setLockedCount] = useState(0);
  const [receipt, setReceipt] = useState<StorageReceipt | null>(null);
  const [foreignReceipt, setForeignReceipt] = useState<StorageReceipt | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<SaveError | null>(null);
  const [deletions, setDeletions] = useState<DeletedTurnV1[]>([]);
  const [undecryptableCount, setUndecryptableCount] = useState(0);
  /**
   * Local writes that were rejected. Every persist used to be
   * `.catch(() => {})` while SyncChip said "Encrypted on this device" — an
   * affirmative durability claim about an entry that was never written and is
   * gone on reload. deleteTurn already did this correctly; the write path did not.
   */
  const [persistFailureCount, setPersistFailureCount] = useState(0);
  /** The snapshot reached 0G but this device could not remember where. */
  const [pointerLost, setPointerLost] = useState(false);

  const turnsRef = useRef<RecallableTurn[]>(turns);
  turnsRef.current = turns;
  const receiptRef = useRef<StorageReceipt | null>(receipt);
  receiptRef.current = receipt;
  const foreignRef = useRef<StorageReceipt | null>(foreignReceipt);
  foreignRef.current = foreignReceipt;
  const deletionsRef = useRef<DeletedTurnV1[]>(deletions);
  deletionsRef.current = deletions;
  /** Checked on a hot path after every await, so a Set rather than the array. */
  const deletedIdsRef = useRef<Set<string>>(new Set());
  const saveStateRef = useRef<SaveState>(saveState);
  saveStateRef.current = saveState;

  // One network per build; both keys are stable module constants.
  const net = activeNetwork();
  const networkKey = net.key;
  const otherKey = otherNetworkKey();
  const walletRef = useRef<string | null>(memoryKey.wallet);
  const prevWalletRef = useRef<string | null>(null);

  // `confirmKeyProven` is destructured rather than reached through `memoryKey`
  // so the dependency arrays below can be TRUE. Reaching through the object left
  // `memoryKey` missing from two dep arrays; the callbacks then ran the first
  // render's closure, and the promotion to a proven key silently never happened.
  // It is stable by construction (useCallback([]) over a ref) — but nobody
  // should have to re-derive that at each call site, and eslint cannot.
  const { getKey, keyVersion, wallet, state: keyState, confirmKeyProven } = memoryKey;

  /**
   * Embedding backfill runs through a bounded queue so a cold model slows the
   * work instead of failing its tail. It used to be a bare `for` loop firing
   * every vectorless turn at once; the worker embeds one at a time behind a
   * single model promise, so the later items burned their whole 30s timeout
   * queued and were dropped — search then quietly lacked older entries.
   *
   * Indirected through a ref so the queue itself is created ONCE and keeps a
   * stable identity: rebuilding it whenever `embedAndPersist` changed would
   * discard in-flight bookkeeping on every render that touched the key.
   */
  const embedRef = useRef<(turn: RecallableTurn) => Promise<void>>(() => Promise.resolve());
  // A ref, not useMemo: useMemo is a performance hint React is permitted to
  // discard, and this object owns the in-flight/de-dupe bookkeeping. Losing it
  // mid-backfill would create a second queue with an empty `known` set while
  // the first kept running — doubling worker load on exactly the cold-model
  // path the queue exists to protect.
  const queueRef = useRef<BoundedQueue<RecallableTurn> | null>(null);
  if (queueRef.current === null) {
    queueRef.current = createBoundedQueue<RecallableTurn>({
      concurrency: DEFAULT_EMBED_CONCURRENCY,
      run: (turn) => embedRef.current(turn),
    });
  }
  const embedQueue = queueRef.current;

  // Wallet transitions: anon → wallet keeps the session turns (they get
  // backfill-encrypted at unlock); wallet → other/none drops decrypted content.
  useEffect(() => {
    const prev = prevWalletRef.current;
    if (prev !== null && prev !== wallet) {
      // Different wallet (or disconnect): drop decrypted content AND the
      // previous wallet's save status — its errors must not leak into this one.
      setTurns([]);
      setReceipt(null);
      setForeignReceipt(null);
      setSaveState('idle');
      setSaveError(null);
    }
    prevWalletRef.current = wallet;
    walletRef.current = wallet;
    // Backfill queued for the previous wallet is dead work — embedAndPersist
    // would bail on the wallet check anyway, but it would still occupy slots.
    embedQueue.clear();
    if (wallet) {
      db.countTurns(wallet).then(setLockedCount).catch(() => setLockedCount(0));
    } else {
      setLockedCount(0);
    }
  }, [wallet, embedQueue]);

  const persistVector = useCallback(
    async (key: CryptoKey, forWallet: string, turnId: string, vector: number[]) => {
      const envelope = await encryptBytes(
        key,
        vectorToBytes(Float32Array.from(vector)),
        'vector',
        `${forWallet}:${turnId}`,
        keyVersion,
      );
      await db.putVector(forWallet, turnId, envelope);
    },
    [keyVersion],
  );

  const persistTurn = useCallback(
    async (key: CryptoKey, forWallet: string, turn: RecallableTurn) => {
      const envelope = await encryptBytes(
        key,
        encoder.encode(JSON.stringify(toPersisted(turn))),
        'turn',
        `${forWallet}:${turn.id}`,
        keyVersion,
      );
      await db.putTurn(forWallet, { id: turn.id, createdAt: turn.createdAt }, envelope);
      if (turn.embedding) await persistVector(key, forWallet, turn.id, turn.embedding);
    },
    [keyVersion, persistVector],
  );

  /** Best-effort async embed for a turn that lacks a vector. The wallet is
   *  captured NOW: if the user switches wallets before the model finishes,
   *  nothing is persisted under the new wallet (no cross-wallet writes).
   *
   *  RETURNS the promise rather than firing and forgetting: the bounded queue
   *  below has to be able to await it, or "concurrency 2" would mean nothing
   *  and every turn would start at once — the exact bug this replaced. */
  const embedAndPersist = useCallback(
    (turn: RecallableTurn): Promise<void> => {
      const ownerWallet = walletRef.current;
      return embed(turn.entry)
        .then(async (vector) => {
          if (walletRef.current !== ownerWallet) return;
          // Deleted while the model was working: writing the vector now would
          // leave content behind for an entry that no longer exists.
          if (deletedIdsRef.current.has(turn.id)) return;
          setTurns((prev) =>
            prev.map((t) => (t.id === turn.id ? { ...t, embedding: vector } : t)),
          );
          const key = getKey();
          if (key && ownerWallet) {
            await persistVector(key, ownerWallet, turn.id, vector);
          }
        })
        .catch(() => {
          // Model unavailable — recall degrades to session context.
        });
    },
    [getKey, persistVector],
  );

  // Point the queue at the current closure. Assigned during render rather than
  // in an effect so a push that happens before effects flush still runs the
  // real function instead of the no-op placeholder.
  embedRef.current = embedAndPersist;

  const hydrate = useCallback(async () => {
    const key = getKey();
    const forWallet = walletRef.current;
    if (!key || !forWallet) return;

    const [storedTurns, storedVectors, storedTombs, vectorIds] = await Promise.all([
      db.getTurns(forWallet),
      db.getVectors(forWallet),
      db.getTombstones(forWallet),
      db.getVectorIds(forWallet),
    ]);
    const deletedIds = tombstoneIdSet(storedTombs);

    const vectorMap = new Map<string, number[]>();
    await Promise.all(
      storedVectors.map(async ({ turnId, envelope }) => {
        try {
          const bytes = await decryptBytes(key, envelope, {
            typ: 'vector',
            keyVersion,
            aadId: `${forWallet}:${turnId}`,
          });
          vectorMap.set(turnId, Array.from(bytesToVector(bytes)));
        } catch {
          // Corrupt/foreign vector — recall just won't cover this turn.
        }
      }),
    );

    const hydrated = (
      await Promise.all(
        // A tombstoned row should not exist; if a crash left one behind it must
        // not render. applyTombstones below then actually removes it.
        storedTurns
          .filter((record) => !deletedIds.has(record.meta.id))
          .map(async (record): Promise<RecallableTurn | null> => {
          try {
            const bytes = await decryptBytes(key, record.envelope, {
              typ: 'turn',
              keyVersion,
              aadId: `${forWallet}:${record.meta.id}`,
            });
            const persisted = JSON.parse(decoder.decode(bytes)) as PersistedTurnV1;
            return { ...persisted, embedding: vectorMap.get(persisted.id) };
          } catch {
            // Skip anything that fails its binding checks rather than show garbage.
            return null;
          }
        }),
      )
    ).filter((t): t is RecallableTurn => t !== null);

    // Entries that exist but did not open with this key. They were written
    // under a different one — say so rather than let them vanish silently.
    const failedToDecrypt = storedTurns.filter((r) => !deletedIds.has(r.meta.id)).length -
      hydrated.length;
    setUndecryptableCount(Math.max(0, failedToDecrypt));
    // One authenticated decrypt of real wallet-bound ciphertext PROVES this key.
    // This is what promotes a fresh-device recovery unlock from 'asserted'.
    if (hydrated.length > 0) void confirmKeyProven();

    // Backfill: session turns written before the wallet existed. The deleted
    // filter is load-bearing — without it a turn removed from the store while
    // another tab still holds it in state is re-persisted right here, and the
    // delete silently undoes itself.
    const known = new Set(hydrated.map((t) => t.id));
    const backfill = backfillCandidates(turnsRef.current, known, deletedIds);
    const backfilled = await Promise.allSettled(
      backfill.map((turn) => persistTurn(key, forWallet, turn)),
    );
    const backfillFailures = backfilled.filter((r) => r.status === 'rejected').length;
    if (backfillFailures > 0) setPersistFailureCount((n) => n + backfillFailures);

    const merged = [...hydrated, ...backfill].sort(byCreatedAt);
    setTurns(merged);
    const [activePointer, otherPointer] = await Promise.all([
      db.getPointer(forWallet, networkKey),
      db.getPointer(forWallet, otherKey),
    ]);
    setReceipt(activePointer);
    // Only surface the other network's snapshot when nothing is anchored here.
    setForeignReceipt(activePointer ? null : otherPointer);
    setLockedCount(0);
    setDeletions(storedTombs);
    deletedIdsRef.current = deletedIds;
    // Converge anything a crash or another tab left inconsistent. Both are
    // idempotent and best-effort; neither blocks unlocking.
    void db.applyTombstones(forWallet, storedTombs).catch(() => {});
    void db
      .deleteVectors(forWallet, orphanVectorIds(vectorIds, [...known, ...backfill.map((t) => t.id)]))
      .catch(() => {});
    preloadEmbedder();
    // Re-embed anything that never got a vector (model was offline, tab closed
    // mid-embed, restored from another device) so recall and search cover it.
    // THROUGH THE QUEUE, not a bare loop: the worker handles one embed at a
    // time behind a single model promise, so firing N at once made the later
    // ones spend their whole 30s timeout waiting in line and get dropped —
    // which showed up as search quietly missing older entries.
    for (const turn of merged) {
      if (!turn.embedding) embedQueue.push(turn.id, turn);
    }
  }, [getKey, keyVersion, persistTurn, embedQueue, networkKey, otherKey, confirmKeyProven]);

  const unlock = useCallback(async () => {
    await memoryKey.unlock();
    await hydrate();
  }, [memoryKey, hydrate]);

  const unlockWithRecoveryKey = useCallback(
    async (hex: string) => {
      await memoryKey.unlockWithRecoveryKey(hex);
      await hydrate();
    },
    [memoryKey, hydrate],
  );

  const addTurn = useCallback(
    (turn: JournalTurn) => {
      const recallable: RecallableTurn = { ...turn };
      setTurns((prev) => [...prev, recallable]);

      const key = getKey();
      const forWallet = walletRef.current;
      if (key && forWallet) {
        void persistTurn(key, forWallet, recallable).catch(() => {
          // The entry is on screen but not on disk. Surface it — a reload will
          // lose it, and the chip must stop claiming it is stored.
          setPersistFailureCount((n) => n + 1);
        });
      }

      // Embed asynchronously — never awaited by the reflect loop.
      // Straight through, not queued: a turn the user just wrote should embed
      // now, not behind a backfill of their whole history.
      void embedAndPersist(recallable);
    },
    [getKey, persistTurn, embedAndPersist],
  );

  /**
   * Delete one entry. The ORDER here is the design, not a style choice.
   *
   * React state first, because hydrate() backfills in-memory turns back into
   * IndexedDB — remove it from the store while it is still on screen and the
   * next unlock puts it straight back. The store write is one committed
   * transaction covering the turn, its vector and the tombstone, so no crash
   * can leave the entry deleted without its marker (it returns at the next
   * restore) or marked without being deleted (a lie the other way). And the
   * deletion COUNTER only moves after that commit, because it is what drives
   * `dirty`.
   */
  const deleteTurn = useCallback(
    async (turnId: string): Promise<void> => {
      const key = getKey();
      const forWallet = walletRef.current;
      // The marker is plaintext and needs no key, but requiring one is what
      // keeps "locked means closed" true — and keeps lockedCount, a raw
      // countTurns that hydrate zeroes, from describing a store it no longer
      // matches.
      if (!key || !forWallet) throw new Error('Unlock your journal to delete an entry');
      // A save in flight has ALREADY captured turnsRef into a snapshot; letting
      // a delete race it would upload the entry the user just removed.
      if (saveStateRef.current === 'saving') {
        throw new Error('Finishing your save — try again in a moment');
      }

      const marker: DeletedTurnV1 = { id: turnId, deletedAt: new Date().toISOString() };
      const previous = turnsRef.current;

      deletedIdsRef.current = new Set(deletedIdsRef.current).add(turnId);
      setTurns((prev) => prev.filter((t) => t.id !== turnId));

      try {
        await db.deleteTurn(forWallet, turnId, marker.deletedAt);
      } catch {
        // Honest rollback: it is still on this device, so it must still be on
        // screen. Never claim a delete that did not commit.
        const next = new Set(deletedIdsRef.current);
        next.delete(turnId);
        deletedIdsRef.current = next;
        if (walletRef.current === forWallet) setTurns(previous);
        throw new Error("Couldn't delete that entry — it's still on this device.");
      }

      if (walletRef.current === forWallet) {
        setDeletions((prev) => mergeTombstones(prev, [marker]));
      }
    },
    [getKey],
  );

  const toZg = useCallback(async (): Promise<StorageReceipt> => {
    const key = getKey();
    const forWallet = walletRef.current;
    if (!key || !forWallet) throw new Error('Unlock your journal first');
    if (!connector) throw new Error('No wallet connector available');

    setSaveState('saving');
    setSaveError(null);
    try {
      // Read tombstones fresh: another tab may have deleted since this one
      // hydrated, and uploading an entry the user already removed would put it
      // back on 0G permanently.
      const freshTombs = await db.getTombstones(forWallet);
      const allDeletions = mergeTombstones(deletionsRef.current, freshTombs);
      const deletedIds = tombstoneIdSet(allDeletions);
      const current = withoutDeleted(turnsRef.current, deletedIds);
      // Converge this tab, or turns.length disagrees with the receipt's
      // turnCount forever and the journal reads 'stale' permanently.
      if (current.length !== turnsRef.current.length) setTurns(current);
      if (allDeletions.length !== deletionsRef.current.length) {
        setDeletions(allDeletions);
        deletedIdsRef.current = deletedIds;
      }

      const snapshot = buildSnapshot({
        wallet: forWallet,
        keyVersion,
        seq: (receiptRef.current?.seq ?? 0) + 1,
        prevRootHash: receiptRef.current?.rootHash ?? null,
        createdAt: new Date().toISOString(),
        turns: current.map(toPersisted),
        vectors: current
          .filter((t): t is RecallableTurn & { embedding: number[] } => Boolean(t.embedding))
          .map((t) => packVector(t.id, t.embedding)),
        deletions: allDeletions,
      });
      const { bytes, paddedBytes } = await encryptSnapshot(key, snapshot);
      const { getStorageSigner, uploadBlob } = await zg();
      const signer = await getStorageSigner(connector);
      const result = await uploadBlob(signer, bytes);
      const nextReceipt: StorageReceipt = {
        seq: snapshot.seq,
        rootHash: result.rootHash,
        txHash: result.txHash,
        paddedBytes,
        turnCount: snapshot.turns.length,
        savedAt: snapshot.createdAt,
        network: networkKey,
        deletionCount: allDeletions.length,
        // What this save superseded — lets the companion UI state "one step
        // ahead of your anchor" as a fact instead of a guess.
        prevRootHash: snapshot.prevRootHash,
      };
      /**
       * The upload above is DONE and PAID FOR. Everything from here is
       * bookkeeping, and none of it may be allowed to throw away the receipt.
       *
       * This used to be `await db.setPointer(...)` on the success path, so a
       * rejected IndexedDB write — quota exceeded, a private window, a corrupted
       * store — fell into the catch below, discarded `nextReceipt` including its
       * rootHash, and showed "Save failed" over a snapshot that was sitting on
       * 0G. The retry button then uploaded and paid a second time, for the same
       * bytes, producing a second root and a pointless extra link in a chain
       * whose whole value is that it is legible.
       *
       * So: React state first, because that is what the UI, the seal flow and
       * the receipt viewer read; then the durable write, whose failure is
       * surfaced rather than fatal.
       */
      setReceipt(nextReceipt);
      setForeignReceipt(null);
      setSaveState('idle');
      let pointerPersisted = true;
      try {
        await db.setPointer(forWallet, networkKey, nextReceipt);
      } catch {
        pointerPersisted = false;
      }
      setPointerLost(!pointerPersisted);
      return nextReceipt;
    } catch (err) {
      const { InsufficientFundsError } = await zg();
      setSaveState('error');
      setSaveError({
        message:
          isUserRejection(err) && !(err instanceof WrongChainError)
            ? 'Save cancelled — nothing was sent.'
            : err instanceof Error
              ? err.message
              : 'Save failed',
        kind:
          err instanceof WrongChainError
            ? 'wrong-chain'
            : err instanceof InsufficientFundsError
              ? 'insufficient-funds'
              : isUserRejection(err)
                ? 'rejected'
                : 'other',
      });
      throw err;
    }
  }, [connector, getKey, keyVersion, networkKey]);

  const restoreFromRoot = useCallback(
    async (rootHash: string): Promise<RestoreResult> => {
      const key = getKey();
      const forWallet = walletRef.current;
      if (!key || !forWallet) throw new Error('Unlock your journal first');

      const { downloadBlob } = await zg();
      const bytes = await downloadBlob(rootHash.trim());
      const snapshot = await decryptSnapshot(key, bytes, { wallet: forWallet, keyVersion });
      // The snapshot decrypted, so this key is provably the journal's key. On a
      // fresh device this is the moment a recovery unlock becomes 'proven'.
      void confirmKeyProven();

      // Learn deletions the snapshot carries BEFORE merging, and hard-delete
      // anything they cover. This line is what makes cross-device deletion real
      // rather than a claim: without it, a device that still holds an entry
      // deleted elsewhere keeps it and re-publishes it on its next save.
      const incoming = sanitizeTombstones(snapshot.deletions);
      const localTombs = await db.getTombstones(forWallet);
      const union = mergeTombstones(localTombs, incoming);
      if (union.length !== localTombs.length) {
        await db.applyTombstones(forWallet, union).catch(() => {});
      }
      const deletedIds = tombstoneIdSet(union);

      const vectorMap = new Map(
        snapshot.vectors.map((v) => [v.turnId, Array.from(unpackVector(v))]),
      );
      const restorable: RecallableTurn[] = snapshot.turns
        .filter((t) => !deletedIds.has(t.id))
        .map((t) => ({ ...t, embedding: vectorMap.get(t.id) }));

      await Promise.all(
        restorable.map((turn) =>
          persistTurn(key, forWallet, turn).catch(() => {
            setPersistFailureCount((n) => n + 1);
          }),
        ),
      );

      // `skippedDeleted` is deliberately NOT taken from here. mergeRestored
      // counts incoming turns that are tombstoned, and `restorable` was already
      // filtered by exactly that set — so it is always 0 at this call site. It
      // looks like the right number, which makes it a trap: using it would mean
      // restoreSkippedNotice never fires. The honest count is computed at the
      // return, against the unfiltered snapshot.
      const { merged, added } = mergeRestored(turnsRef.current, restorable, deletedIds);
      setTurns(merged);
      setDeletions(union);
      deletedIdsRef.current = deletedIds;

      // Never REGRESS the pointer: restoring an old receipt must not fork the
      // seq/prevRootHash chain by making the next save re-use an old seq.
      const current = receiptRef.current;
      if (!current || snapshot.seq >= current.seq) {
        const pointer: StorageReceipt = {
          seq: snapshot.seq,
          rootHash: rootHash.trim(),
          txHash: '',
          paddedBytes: snapshotBucketBytes(snapshot),
          // What the snapshot AT THIS ROOT contains — if the local merge holds
          // more turns than that, `dirty` correctly prompts a fresh save.
          turnCount: snapshot.turns.length,
          savedAt: snapshot.createdAt,
          // Verified, not assumed: this blob was just downloaded from THIS
          // network's indexer.
          network: networkKey,
          prevRootHash: snapshot.prevRootHash,
          deletionCount: incoming.length,
        };
        await db.setPointer(forWallet, networkKey, pointer);
        setReceipt(pointer);
        setForeignReceipt(null);
      }

      // Same bounded queue as hydrate — a restore of hundreds of turns shares
      // one concurrency budget with everything else in flight.
      for (const turn of restorable) {
        if (!turn.embedding) embedQueue.push(turn.id, turn);
      }
      return { restored: added, skippedDeleted: snapshot.turns.length - restorable.length };
    },
    [getKey, keyVersion, persistTurn, embedQueue, networkKey, confirmKeyProven],
  );

  const nothingSavedHere = useCallback(() => {
    const other = foreignRef.current;
    return new Error(
      other
        ? `Nothing is saved on ${net.label} yet — your last snapshot is on ${
            ZG_NETWORKS[other.network]?.label ?? other.network
          }.`
        : 'Nothing saved to 0G yet',
    );
  }, [net.label]);

  const verifyOnZg = useCallback(async () => {
    const current = receiptRef.current;
    if (!current) throw nothingSavedHere();
    const { checkAvailability } = await zg();
    return checkAvailability(current.rootHash);
  }, [nothingSavedHere]);

  const proveOwnership = useCallback(async (): Promise<ProofResult> => {
    const key = getKey();
    const forWallet = walletRef.current;
    const current = receiptRef.current;
    if (!key || !forWallet) throw new Error('Unlock your journal first');
    if (!current) throw nothingSavedHere();
    const { downloadBlob } = await zg();
    const bytes = await downloadBlob(current.rootHash);
    const snapshot = await decryptSnapshot(key, bytes, {
      wallet: forWallet,
      keyVersion,
      seq: current.seq,
    });
    return { turnCount: snapshot.turns.length, savedAt: snapshot.createdAt };
  }, [getKey, keyVersion, nothingSavedHere]);

  // Count-based, not timestamp-based: wall clocks differ across devices, and a
  // skewed clock must never hide the Save button. Network-scoped, so a snapshot
  // on the other chain can never read as "saved" here.
  const status = useMemo(
    () =>
      syncStatus({
        unlocked: keyState === 'unlocked',
        turnCount: turns.length,
        deletionCount: deletions.length,
        receipt,
        foreign: foreignReceipt,
      }),
    [keyState, turns.length, deletions.length, receipt, foreignReceipt],
  );
  const dirty = useMemo(() => isDirty(status), [status]);

  /**
   * The local half of "does this wallet have a journal somewhere else?".
   *
   * A pointer on either network means a snapshot exists off this device, which
   * changes what an unproven key should be told to do: restore and prove the
   * key, rather than start writing. Journal folds in the on-chain half (an
   * anchored root can exist with no local pointer at all — that is exactly the
   * fresh-device case), so this reports a floor, never a veto.
   */
  const localSnapshot = Boolean(receipt || foreignReceipt);
  const { reportSnapshot } = memoryKey;
  useEffect(() => {
    if (localSnapshot) reportSnapshot(true);
  }, [localSnapshot, reportSnapshot]);


  const save = useMemo(
    () => ({ state: saveState, error: saveError, receipt, foreignReceipt, status, dirty, toZg }),
    [saveState, saveError, receipt, foreignReceipt, status, dirty, toZg],
  );

  return useMemo(
    () => ({
      keyState,
      wallet,
      turns,
      lockedCount,
      deletions,
      addTurn,
      deleteTurn,
      unlock,
      unlockWithRecoveryKey,
      lock: memoryKey.lock,
      exportRecoveryKey: memoryKey.exportRecoveryKey,
      trust: memoryKey.trust,
      keyNotice: memoryKey.notice,
      keyRefusal: memoryKey.refusal,
      reportSnapshot,
      undecryptableCount,
      persistFailureCount,
      pointerLost,
      save,
      restoreFromRoot,
      verifyOnZg,
      proveOwnership,
    }),
    [
      keyState,
      wallet,
      turns,
      lockedCount,
      deletions,
      addTurn,
      deleteTurn,
      unlock,
      unlockWithRecoveryKey,
      memoryKey.lock,
      memoryKey.exportRecoveryKey,
      memoryKey.trust,
      memoryKey.notice,
      memoryKey.refusal,
      reportSnapshot,
      undecryptableCount,
      persistFailureCount,
      pointerLost,
      save,
      restoreFromRoot,
      verifyOnZg,
      proveOwnership,
    ],
  );
}
