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
