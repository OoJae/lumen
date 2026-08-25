/**
 * Memory snapshot codec (Wave 2) — pure, no I/O, fully unit-testable.
 *
 * plaintext MemorySnapshotV1
 *   → canonicalJson (deterministic bytes on any device)
 *   → padToBucket   (public size leaks only coarse magnitude)
 *   → encryptBytes  (envelope v2, AAD = wallet:seq — snapshot N can't pose as M)
 *   → UTF-8 envelope JSON = the exact bytes uploaded to the 0G Log layer.
 *
 * The uploaded file's merkle rootHash is "the memory root" — the value the
 * Wave 3 INFT anchors. decrypt reverses each step and re-validates every
 * binding (type, wallet, seq, kind) before trusting the content.
 */

import type {
  DeletedTurnV1,
  MemorySnapshotV1,
  PersistedTurnV1,
  PersistedVectorV1,
} from '@lumen/shared';

import { bytesToVector, canonicalJson, padToBucket, unpad, vectorToBytes } from '../crypto/canonical';
import {
  base64ToBytes,
  bytesToBase64,
  decryptBytes,
  encryptBytes,
  parseAad,
  type EncryptedEnvelope,
} from '../crypto/encrypt';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const EMBEDDING_MODEL_NAME = 'all-MiniLM-L6-v2';

export function packVector(turnId: string, vector: Float32Array | number[]): PersistedVectorV1 {
  const f32 = vector instanceof Float32Array ? vector : Float32Array.from(vector);
  return {
    turnId,
    model: EMBEDDING_MODEL_NAME,
    dim: f32.length,
    dataB64: bytesToBase64(vectorToBytes(f32)),
  };
}

export function unpackVector(pv: PersistedVectorV1): Float32Array {
  const vec = bytesToVector(base64ToBytes(pv.dataB64));
  if (vec.length !== pv.dim) throw new Error('Vector dim mismatch');
  return vec;
}

export interface BuildSnapshotParams {
  wallet: string;
  keyVersion: number;
  seq: number;
  prevRootHash: string | null;
  createdAt: string;
  turns: PersistedTurnV1[];
  vectors: PersistedVectorV1[];
  /** Deletion markers to carry forward. Omit or pass [] for none. */
  deletions?: DeletedTurnV1[];
}

export function buildSnapshot(params: BuildSnapshotParams): MemorySnapshotV1 {
  const deletions = params.deletions ?? [];
  return {
    v: 1,
    kind: 'lumen-memory-snapshot',
    wallet: params.wallet.toLowerCase(),
    keyVersion: params.keyVersion,
    seq: params.seq,
    prevRootHash: params.prevRootHash,
    createdAt: params.createdAt,
    turns: params.turns,
    vectors: params.vectors,
    // Spread conditionally so a journal that never deletes produces canonical
    // bytes IDENTICAL to before this field existed — which keeps the padded
    // bucket size and the "re-download and byte-compare" ownership check
    // unchanged for every existing user.
    ...(deletions.length > 0 ? { deletions } : {}),
  };
}

export interface EncryptedSnapshot {
  /** The exact bytes destined for the 0G Log layer (UTF-8 envelope JSON). */
  bytes: Uint8Array;
  /** The power-of-two padded plaintext bucket size — what "bucketed size"
   *  means in the privacy docs and the storage receipt. */
  paddedBytes: number;
}

/** Compute the padded plaintext bucket size of a snapshot without encrypting. */
export function snapshotBucketBytes(snapshot: MemorySnapshotV1): number {
  return padToBucket(encoder.encode(canonicalJson(snapshot))).length;
}

/** Encrypt a snapshot into the exact bytes destined for the 0G Log layer. */
export async function encryptSnapshot(
  key: CryptoKey,
  snapshot: MemorySnapshotV1,
): Promise<EncryptedSnapshot> {
  const padded = padToBucket(encoder.encode(canonicalJson(snapshot)));
  const envelope = await encryptBytes(
    key,
    padded,
    'snapshot',
    `${snapshot.wallet}:${snapshot.seq}`,
    snapshot.keyVersion,
  );
  return { bytes: encoder.encode(JSON.stringify(envelope)), paddedBytes: padded.length };
}

export interface ExpectedSnapshot {
  wallet: string;
  keyVersion: number;
  /** Enforce an exact seq when known (local restore); omit for
   *  restore-by-rootHash, where seq is read from the AAD and returned. */
  seq?: number;
}

export async function decryptSnapshot(
  key: CryptoKey,
  bytes: Uint8Array,
  expected: ExpectedSnapshot,
): Promise<MemorySnapshotV1> {
  const wallet = expected.wallet.toLowerCase();

  let envelope: EncryptedEnvelope;
  try {
    envelope = JSON.parse(decoder.decode(bytes)) as EncryptedEnvelope;
  } catch {
    throw new Error('Not a Lumen snapshot: unreadable envelope');
  }
  if (envelope?.v !== 2 || typeof envelope.aad !== 'string') {
    throw new Error('Not a Lumen snapshot envelope');
  }

  const aad = parseAad(envelope.aad);
  if (aad.typ !== 'snapshot') throw new Error('Not a Lumen snapshot envelope');
  const [aadWallet, aadSeqRaw] = splitLastColon(aad.id);
  if (aadWallet !== wallet) {
    throw new Error('This snapshot belongs to a different wallet');
  }
  const aadSeq = Number(aadSeqRaw);
  if (!Number.isInteger(aadSeq) || aadSeq < 0) throw new Error('Corrupt snapshot AAD seq');
  if (expected.seq !== undefined && aadSeq !== expected.seq) {
    throw new Error(`Snapshot seq mismatch: expected ${expected.seq}, got ${aadSeq}`);
  }

  const padded = await decryptBytes(key, envelope, {
    typ: 'snapshot',
    keyVersion: expected.keyVersion,
    aadId: `${wallet}:${aadSeq}`,
  });

  const snapshot = JSON.parse(decoder.decode(unpad(padded))) as MemorySnapshotV1;
  if (snapshot.v !== 1 || snapshot.kind !== 'lumen-memory-snapshot') {
    throw new Error('Unknown snapshot format version');
  }
  if (snapshot.wallet !== wallet || snapshot.seq !== aadSeq) {
    throw new Error('Snapshot content does not match its envelope binding');
  }
  return snapshot;
}

function splitLastColon(id: string): [string, string] {
  const i = id.lastIndexOf(':');
  if (i < 0) throw new Error('Corrupt snapshot AAD id');
  return [id.slice(0, i), id.slice(i + 1)];
}

/**
 * Where the next snapshot attaches to the chain.
 *
 * Pure so the two-tab case can actually be tested. `toZg` used to read this
 * straight off the in-memory receipt, and that receipt is written only during
 * render from state, which is loaded only by `hydrate()` — which runs on unlock
 * and never again. Nothing refreshes a second tab, so two tabs hydrated at the
 * same point both computed the same next seq: a duplicated sequence number, a
 * forked prev-root chain, and the first tab's paid-for upload orphaned on 0G
 * with no pointer left anywhere that names it.
 *
 * `fresh` is the pointer read from IndexedDB moments before upload; `inMemory`
 * is this tab's own view. Taking the max of the two means neither a stale tab
 * nor a stale read can reissue a sequence number that is already published.
 */
export function nextChainLink(
  fresh: { seq: number; rootHash: string } | null,
  inMemory: { seq: number; rootHash: string } | null,
): { seq: number; prevRootHash: string | null } {
  return {
    seq: Math.max(fresh?.seq ?? 0, inMemory?.seq ?? 0) + 1,
    // Prefer the durable pointer: if it is ahead, its root is the one actually
    // on 0G, and chaining to this tab's older root is what forks the history.
    prevRootHash: fresh?.rootHash ?? inMemory?.rootHash ?? null,
  };
}
