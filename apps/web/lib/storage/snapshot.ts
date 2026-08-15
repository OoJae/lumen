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

import type { MemorySnapshotV1, PersistedTurnV1, PersistedVectorV1 } from '@lumen/shared';

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
}

export function buildSnapshot(params: BuildSnapshotParams): MemorySnapshotV1 {
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
  };
}

/** Encrypt a snapshot into the exact bytes destined for the 0G Log layer. */
export async function encryptSnapshot(
  key: CryptoKey,
  snapshot: MemorySnapshotV1,
): Promise<Uint8Array> {
  const plaintext = encoder.encode(canonicalJson(snapshot));
  const envelope = await encryptBytes(
    key,
    padToBucket(plaintext),
    'snapshot',
    `${snapshot.wallet}:${snapshot.seq}`,
    snapshot.keyVersion,
  );
  return encoder.encode(JSON.stringify(envelope));
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
  if (envelope?.v !== 2 || envelope.typ !== 'snapshot') {
    throw new Error('Not a Lumen snapshot envelope');
  }

  const aad = parseAad(envelope.aad);
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
