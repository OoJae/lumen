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
import type { JournalTurn, PersistedTurnV1, StorageReceipt } from '@lumen/shared';

import { decryptBytes, encryptBytes } from '@/lib/crypto/encrypt';
import { bytesToVector, vectorToBytes } from '@/lib/crypto/canonical';
import { embed, preloadEmbedder } from '@/lib/memory/embeddings';
import {
  createBoundedQueue,
  DEFAULT_EMBED_CONCURRENCY,
  type BoundedQueue,
} from '@/lib/memory/embedQueue';
import type { RecallableTurn } from '@/lib/memory/recall';
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
  exportRecoveryKey(): Promise<string>;
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
  restoreFromRoot(rootHash: string): Promise<number>;
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

  const turnsRef = useRef<RecallableTurn[]>(turns);
  turnsRef.current = turns;
  const receiptRef = useRef<StorageReceipt | null>(receipt);
  receiptRef.current = receipt;
  const foreignRef = useRef<StorageReceipt | null>(foreignReceipt);
  foreignRef.current = foreignReceipt;

  // One network per build; both keys are stable module constants.
  const net = activeNetwork();
  const networkKey = net.key;
  const otherKey = otherNetworkKey();
  const walletRef = useRef<string | null>(memoryKey.wallet);
  const prevWalletRef = useRef<string | null>(null);

  const { getKey, keyVersion, wallet, state: keyState } = memoryKey;

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
  const embedQueue = useMemo<BoundedQueue<RecallableTurn>>(
    () =>
      createBoundedQueue<RecallableTurn>({
        concurrency: DEFAULT_EMBED_CONCURRENCY,
        run: (turn) => embedRef.current(turn),
      }),
    [],
  );

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

    const [storedTurns, storedVectors] = await Promise.all([
      db.getTurns(forWallet),
      db.getVectors(forWallet),
    ]);

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
        storedTurns.map(async (record): Promise<RecallableTurn | null> => {
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

    // Backfill: session turns written before the wallet existed.
    const known = new Set(hydrated.map((t) => t.id));
    const backfill = turnsRef.current.filter((t) => !known.has(t.id));
    await Promise.all(backfill.map((turn) => persistTurn(key, forWallet, turn).catch(() => {})));

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
  }, [getKey, keyVersion, persistTurn, embedQueue, networkKey, otherKey]);

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
        void persistTurn(key, forWallet, recallable).catch(() => {});
      }

      // Embed asynchronously — never awaited by the reflect loop.
      // Straight through, not queued: a turn the user just wrote should embed
      // now, not behind a backfill of their whole history.
      void embedAndPersist(recallable);
    },
    [getKey, persistTurn, embedAndPersist],
  );

  const toZg = useCallback(async (): Promise<StorageReceipt> => {
    const key = getKey();
    const forWallet = walletRef.current;
    if (!key || !forWallet) throw new Error('Unlock your journal first');
    if (!connector) throw new Error('No wallet connector available');

    setSaveState('saving');
    setSaveError(null);
    try {
      const current = turnsRef.current;
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
        // What this save superseded — lets the companion UI state "one step
        // ahead of your anchor" as a fact instead of a guess.
        prevRootHash: snapshot.prevRootHash,
      };
      await db.setPointer(forWallet, networkKey, nextReceipt);
      setReceipt(nextReceipt);
      setForeignReceipt(null);
      setSaveState('idle');
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
    async (rootHash: string): Promise<number> => {
      const key = getKey();
      const forWallet = walletRef.current;
      if (!key || !forWallet) throw new Error('Unlock your journal first');

      const { downloadBlob } = await zg();
      const bytes = await downloadBlob(rootHash.trim());
      const snapshot = await decryptSnapshot(key, bytes, { wallet: forWallet, keyVersion });
      const vectorMap = new Map(
        snapshot.vectors.map((v) => [v.turnId, Array.from(unpackVector(v))]),
      );
      const restored: RecallableTurn[] = snapshot.turns.map((t) => ({
        ...t,
        embedding: vectorMap.get(t.id),
      }));

      await Promise.all(restored.map((turn) => persistTurn(key, forWallet, turn).catch(() => {})));

      const have = new Set(turnsRef.current.map((t) => t.id));
      const merged = [...turnsRef.current, ...restored.filter((t) => !have.has(t.id))].sort(
        byCreatedAt,
      );
      setTurns(merged);

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
        };
        await db.setPointer(forWallet, networkKey, pointer);
        setReceipt(pointer);
        setForeignReceipt(null);
      }

      // Same bounded queue as hydrate — a restore of hundreds of turns shares
      // one concurrency budget with everything else in flight.
      for (const turn of restored) {
        if (!turn.embedding) embedQueue.push(turn.id, turn);
      }
      return restored.length;
    },
    [getKey, keyVersion, persistTurn, embedQueue, networkKey],
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
        receipt,
        foreign: foreignReceipt,
      }),
    [keyState, turns.length, receipt, foreignReceipt],
  );
  const dirty = useMemo(() => isDirty(status), [status]);

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
      addTurn,
      unlock,
      unlockWithRecoveryKey,
      lock: memoryKey.lock,
      exportRecoveryKey: memoryKey.exportRecoveryKey,
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
      addTurn,
      unlock,
      unlockWithRecoveryKey,
      memoryKey.lock,
      memoryKey.exportRecoveryKey,
      save,
      restoreFromRoot,
      verifyOnZg,
      proveOwnership,
    ],
  );
}
