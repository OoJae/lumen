/** Shared types across the client, gateway, and (later) contracts. */

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

export interface MemorySnapshotV1 {
  v: 1;
  kind: 'lumen-memory-snapshot';
  /** Lowercase 0x address of the owning wallet. */
  wallet: string;
  /** Which KEY_DERIVATION_MESSAGES version encrypts this history. */
  keyVersion: number;
  /** Monotonic save counter; part of the envelope AAD. */
  seq: number;
  /** rootHash of the previous snapshot — a tamper-EVIDENT chain. True rollback
   *  PROTECTION arrives when Wave 3 anchors the root on-chain. */
  prevRootHash: string | null;
  createdAt: string; // ISO-8601
  turns: PersistedTurnV1[];
  vectors: PersistedVectorV1[];
}

/** Receipt for one user-signed "Save to 0G" upload; kept locally as the pointer. */
export interface StorageReceipt {
  seq: number;
  rootHash: string;
  txHash: string;
  /** Padded (bucketed) ciphertext size actually uploaded, in bytes. */
  paddedBytes: number;
  savedAt: string; // ISO-8601
}

/** Response shape of POST /api/transcribe (Wave 2 voice). */
export interface TranscribeResponse {
  text: string;
}
