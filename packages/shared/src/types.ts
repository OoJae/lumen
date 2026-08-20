/** Shared types across the client, gateway, and (later) contracts. */
import type { ZgNetworkKey } from './networks';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/**
 * What "Verified private" means for a given response — kept deliberately honest.
 *  - attested-by-trust-mode: Wave 1 Router path. Request ran in private trust mode
 *    inside the TEE; no per-request cryptographic proof is checkable on the hosted
 *    Router (it abstracts away the providerAddress).
 *  - pending-crypto-proof / verified: Wave 3 Direct-SDK path, where the broker's
 *    processResponse(providerAddress, chatID) cryptographically verifies the TEE
 *    signature.
 *  - demo: no API key configured — a mock stream, NOT real TEE inference.
 *  - unverified: the trust-mode header was not acknowledged / state unknown.
 */
export type VerificationStatus =
  | 'attested-by-trust-mode'
  | 'pending-crypto-proof'
  | 'verified'
  | 'demo'
  | 'unverified';

/**
 * A per-request TEE proof, verified in the user's browser (Wave 3) and kept
 * with the turn. The whole triple is persisted because the provider stops
 * serving signatures after a while — holding it means "re-check this proof"
 * keeps working long after the endpoint has forgotten the request.
 */
export interface TeeProofRecord {
  chatId: string;
  providerAddress: string;
  /** `requestHash:responseHash:providerType:providerIdentity:tlsFingerprint` */
  signedText: string;
  signature: string;
  /** Signer the provider claimed (informational). */
  signingAddress: string;
  /** Signer read from the on-chain registry — what we actually checked against. */
  teeSignerAddress: string;
  /**
   * The address RECOVERED from the signature over `signedText`.
   *
   * This is the derivation the whole proof rests on: recovering it and finding
   * it equal to `teeSignerAddress` is what "cryptographically verified" means.
   * It used to be computed and thrown away, so the viewer could only show a
   * checkmark — asking for trust exactly where evidence was promised.
   */
  recovered?: string;
  /** SHA-256 we computed locally over the exact bytes received. */
  responseSha256: string;
  verifiedAt: string; // ISO-8601
  checks: { signature: boolean; responseHash: boolean };
}

/** Which path carried this reflection — drives the honest trust copy. */
export type InferencePath = 'gateway' | 'browser-direct' | 'demo';

export interface AttestationInfo {
  verificationStatus: VerificationStatus;
  trustMode: 'private' | 'unspecified';
  teeType: string; // e.g. 'Intel TDX'
  teeHardware: string; // e.g. 'NVIDIA H100/H200'
  model: string;
  timestamp: string; // ISO-8601
  /** Per-request proof reference from the ZG-Res-Key header, when present. */
  proofReference?: { chatId: string };
  learnMoreUrl: string;
  /** One honest sentence describing exactly what this attestation proves. */
  note: string;
  // ── Wave 3 (all optional: older persisted turns stay valid) ──
  providerAddress?: string;
  inferencePath?: InferencePath;
  /** From the enclave-signed statement: e.g. {type:'centralized', identity:'aliyun'}.
   *  Drives the disclosure that the model runs at an upstream host. */
  providerDisclosure?: { providerType: string; providerIdentity: string };
  proof?: TeeProofRecord;
}

export interface ReflectRequest {
  messages: ChatMessage[];
  /** Optional model override; defaults to ZG_COMPUTE_MODEL / DEFAULT_MODEL_ID. */
  model?: string;
}

/** A single journal turn held in (Wave 1) in-memory session state. */
export interface JournalTurn {
  id: string;
  entry: string;
  reflection: string;
  attestation: AttestationInfo | null;
  createdAt: string; // ISO-8601
}

// ── Wave 2: encrypted memory on 0G Storage ─────────────────────────────────────
// The snapshot is the durable, versioned persistence format. It is ALWAYS
// encrypted client-side (envelope v2, AAD-bound) before it exists anywhere
// outside browser memory. Its uploaded file's rootHash is "the memory root" —
// exactly the value the Wave 3 INFT anchors on-chain.

/** Persisted turn — deliberately mirrors JournalTurn field-for-field but is its
 *  own type so the on-disk format can't silently drift with runtime changes. */
export interface PersistedTurnV1 {
  id: string;
  entry: string;
  reflection: string;
  attestation: AttestationInfo | null;
  createdAt: string; // ISO-8601
}

/** Embedding vector for one turn; float32 little-endian bytes, base64. */
export interface PersistedVectorV1 {
  turnId: string;
  model: string; // e.g. 'all-MiniLM-L6-v2'
  dim: number; // e.g. 384
  dataB64: string;
}

/**
 * A deleted entry. The id survives, the content does not.
 *
 * Without this a delete silently undoes itself: hydrate() backfills in-memory
 * turns into IndexedDB, and restoreFromRoot union-merges an older snapshot, so
 * either path resurrects what you removed. Keeping the id is what makes
 * "deleted" survive a restore — here and on another device.
 */
export interface DeletedTurnV1 {
  id: string;
  /** ISO-8601, from the device that deleted it. Merges keep the EARLIEST, so
   *  re-learning a deletion never moves the date forward. */
  deletedAt: string;
}

export interface MemorySnapshotV1 {
  v: 1;
  kind: 'lumen-memory-snapshot';
  /** Lowercase 0x address of the owning wallet. */
  wallet: string;
  /** Which KEY_DERIVATION_MESSAGES version encrypts this history. */
  keyVersion: number;
  /** Monotonic save counter; part of the envelope AAD. */
  seq: number;
  /** rootHash of the previous snapshot — a tamper-EVIDENT chain. Wave 3 anchors
   *  roots on-chain, which adds a public, timestamped witness to that chain; it
   *  does NOT prevent the owner from anchoring an older root. See
   *  docs/privacy-model.md ("What an on-chain anchor proves — exactly"). */
  prevRootHash: string | null;
  createdAt: string; // ISO-8601
  turns: PersistedTurnV1[];
  vectors: PersistedVectorV1[];
  /**
   * Entries the owner deleted, carried in EVERY later snapshot so a restore on
   * another device cannot resurrect them.
   *
   * Optional and additive on purpose. `v` stays 1 because decryptSnapshot hard-
   * rejects v !== 1, so a version bump would make every existing snapshot
   * unreadable to guard a case the local tombstone store already covers.
   * Omitted entirely when empty, so a journal that never deletes produces
   * byte-identical snapshots to before this existed.
   */
  deletions?: DeletedTurnV1[];
}

/** Receipt for one user-signed "Save to 0G" upload; kept locally as the pointer. */
export interface StorageReceipt {
  seq: number;
  rootHash: string;
  txHash: string;
  /** The power-of-two padded PLAINTEXT bucket size — the value the privacy
   *  docs' "bucketed size" claim refers to (not the uploaded envelope length). */
  paddedBytes: number;
  /** How many turns the saved snapshot contained — the clock-skew-proof basis
   *  for "are there unsaved entries?". */
  turnCount: number;
  savedAt: string; // ISO-8601
  /** The root this snapshot superseded, when known. Lets the UI say "your save
   *  is exactly one step ahead of your on-chain anchor" as a fact rather than a
   *  guess. Optional: Wave-2 pointers predate it and fall back to the honest
   *  "can't tell which is newer" copy. */
  prevRootHash?: string | null;
  /** Which 0G network this root lives on. Root hashes do not cross networks, so
   *  a receipt without one is meaningless: every read path stamps it (an
   *  unscoped Wave-2 pointer is stamped 'testnet' in lib/storage/pointerKey.ts,
   *  where that rule lives and is tested). Required on purpose — this field was
   *  optional with a comment promising a guarantee no code implemented. */
  network: ZgNetworkKey;
  /**
   * How many deletions the saving device had recorded when this snapshot was
   * written. `turnCount` alone cannot see a delete-plus-add — 5 → 4 → 5 reads
   * as unchanged while the content differs — and deletions are append-only, so
   * comparing this monotonic counter closes that hole exactly. Optional:
   * pointers written before delete shipped read as 0.
   */
  deletionCount?: number;
}

/** Response shape of POST /api/transcribe (Wave 2 voice). */
export interface TranscribeResponse {
  text: string;
}
