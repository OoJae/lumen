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

import type { JournalTurn, PersistedTurnV1, StorageReceipt } from '@lumen/shared';

import { decryptBytes, encryptBytes } from '@/lib/crypto/encrypt';
import { bytesToVector, vectorToBytes } from '@/lib/crypto/canonical';
import { embed, preloadEmbedder } from '@/lib/memory/embeddings';
import type { RecallableTurn } from '@/lib/memory/recall';
import * as db from '@/lib/storage/db';
import {
  buildSnapshot,
  decryptSnapshot,
  encryptSnapshot,
  packVector,
  unpackVector,
} from '@/lib/storage/snapshot';
import { useMemoryKey, type MemoryKeyState } from './useMemoryKey';

/** The 0G SDK (+ ethers) is ~250 kB — load it only when a save/restore/verify
 *  actually happens, never on first paint. */
function zg() {
  return import('@/lib/storage/zgStorage');
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type SaveState = 'idle' | 'saving' | 'error';

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
    error: string | null;
    receipt: StorageReceipt | null;
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
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const turnsRef = useRef<RecallableTurn[]>(turns);
  turnsRef.current = turns;
  const receiptRef = useRef<StorageReceipt | null>(receipt);
  receiptRef.current = receipt;
  const walletRef = useRef<string | null>(memoryKey.wallet);
  const prevWalletRef = useRef<string | null>(null);

  const { getKey, keyVersion, wallet, state: keyState } = memoryKey;

  // Wallet transitions: anon → wallet keeps the session turns (they get
  // backfill-encrypted at unlock); wallet → other/none drops decrypted content.
  useEffect(() => {
    const prev = prevWalletRef.current;
    if (prev !== null && prev !== wallet) {
      setTurns([]);
      setReceipt(null);
    }
    prevWalletRef.current = wallet;
    walletRef.current = wallet;
    if (wallet) {
      db.countTurns(wallet).then(setLockedCount).catch(() => setLockedCount(0));
    } else {
      setLockedCount(0);
    }
  }, [wallet]);

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
      if (turn.embedding) {
        const vecEnvelope = await encryptBytes(
          key,
          vectorToBytes(Float32Array.from(turn.embedding)),
          'vector',
          `${forWallet}:${turn.id}`,
          keyVersion,
        );
        await db.putVector(forWallet, turn.id, vecEnvelope);
      }
    },
    [keyVersion],
  );

  const hydrate = useCallback(async () => {
    const key = getKey();
    const forWallet = walletRef.current;
    if (!key || !forWallet) return;

    const [storedTurns, storedVectors] = await Promise.all([
      db.getTurns(forWallet),
      db.getVectors(forWallet),
    ]);

    const vectorMap = new Map<string, number[]>();
    for (const { turnId, envelope } of storedVectors) {
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
    }

    const hydrated: RecallableTurn[] = [];
    for (const record of storedTurns) {
      try {
        const bytes = await decryptBytes(key, record.envelope, {
          typ: 'turn',
          keyVersion,
          aadId: `${forWallet}:${record.meta.id}`,
        });
        const persisted = JSON.parse(decoder.decode(bytes)) as PersistedTurnV1;
        hydrated.push({ ...persisted, embedding: vectorMap.get(persisted.id) });
      } catch {
        // Skip anything that fails its binding checks rather than show garbage.
      }
    }

    // Backfill: session turns written before the wallet existed.
    const known = new Set(hydrated.map((t) => t.id));
    const backfill = turnsRef.current.filter((t) => !known.has(t.id));
    for (const turn of backfill) {
      await persistTurn(key, forWallet, turn).catch(() => {});
    }

    setTurns([...hydrated, ...backfill].sort(byCreatedAt));
    setReceipt(await db.getPointer(forWallet));
    setLockedCount(0);
    preloadEmbedder();
  }, [getKey, keyVersion, persistTurn]);

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
      void embed(turn.entry)
        .then(async (vector) => {
          setTurns((prev) =>
            prev.map((t) => (t.id === turn.id ? { ...t, embedding: vector } : t)),
          );
          const k = getKey();
          const w = walletRef.current;
          if (k && w) {
            const vecEnvelope = await encryptBytes(
              k,
              vectorToBytes(Float32Array.from(vector)),
              'vector',
              `${w}:${turn.id}`,
              keyVersion,
            );
            await db.putVector(w, turn.id, vecEnvelope);
          }
        })
        .catch(() => {
          // Model unavailable — recall degrades to session context.
        });
    },
    [getKey, keyVersion, persistTurn],
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
      const bytes = await encryptSnapshot(key, snapshot);
      const { getStorageSigner, uploadBlob } = await zg();
      const signer = await getStorageSigner(connector);
      const result = await uploadBlob(signer, bytes);
      const nextReceipt: StorageReceipt = {
        seq: snapshot.seq,
        rootHash: result.rootHash,
        txHash: result.txHash,
        paddedBytes: bytes.length,
        savedAt: snapshot.createdAt,
      };
      await db.setPointer(forWallet, nextReceipt);
      setReceipt(nextReceipt);
      setSaveState('idle');
      return nextReceipt;
    } catch (err) {
      setSaveState('error');
      setSaveError(err instanceof Error ? err.message : 'Save failed');
      throw err;
    }
  }, [connector, getKey, keyVersion]);

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

      for (const turn of restored) {
        await persistTurn(key, forWallet, turn).catch(() => {});
      }

      setTurns((prev) => {
        const have = new Set(prev.map((t) => t.id));
        return [...prev, ...restored.filter((t) => !have.has(t.id))].sort(byCreatedAt);
      });

      const pointer: StorageReceipt = {
        seq: snapshot.seq,
        rootHash: rootHash.trim(),
        txHash: '',
        paddedBytes: bytes.length,
        savedAt: snapshot.createdAt,
      };
      await db.setPointer(forWallet, pointer);
      setReceipt(pointer);
      return restored.length;
    },
    [getKey, keyVersion, persistTurn],
  );

  const verifyOnZg = useCallback(async () => {
    const current = receiptRef.current;
    if (!current) throw new Error('Nothing saved to 0G yet');
    const { checkAvailability } = await zg();
    return checkAvailability(current.rootHash);
  }, []);

  const proveOwnership = useCallback(async (): Promise<ProofResult> => {
    const key = getKey();
    const forWallet = walletRef.current;
    const current = receiptRef.current;
    if (!key || !forWallet) throw new Error('Unlock your journal first');
    if (!current) throw new Error('Nothing saved to 0G yet');
    const { downloadBlob } = await zg();
    const bytes = await downloadBlob(current.rootHash);
    const snapshot = await decryptSnapshot(key, bytes, {
      wallet: forWallet,
      keyVersion,
      seq: current.seq,
    });
    return { turnCount: snapshot.turns.length, savedAt: snapshot.createdAt };
  }, [getKey, keyVersion]);

  const dirty = useMemo(() => {
    if (keyState !== 'unlocked') return false;
    if (turns.length === 0) return false;
    if (!receipt) return true;
    return turns.some((t) => t.createdAt > receipt.savedAt);
  }, [keyState, turns, receipt]);

  return {
    keyState,
    wallet,
    turns,
    lockedCount,
    addTurn,
    unlock,
    unlockWithRecoveryKey,
    lock: memoryKey.lock,
    exportRecoveryKey: memoryKey.exportRecoveryKey,
    save: { state: saveState, error: saveError, receipt, dirty, toZg },
    restoreFromRoot,
    verifyOnZg,
    proveOwnership,
  };
}
