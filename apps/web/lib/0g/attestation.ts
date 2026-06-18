/**
 * Attestation helpers — shared by the server (gateway) and the client (viewer).
 * Pure: no `openai`, no secrets. Keeps the "what does Verified-private mean"
 * wording in ONE honest place.
 */
import {
  TEE_HARDWARE,
  ATTESTATION_DOCS_URL,
  type AttestationInfo,
  type VerificationStatus,
} from '@lumen/shared';

export const ATTESTATION_NOTE_LIVE =
  'Processed in private trust mode inside a hardware TEE (Intel TDX + NVIDIA H100/H200). ' +
  'The model provider could not read your words. Per-request cryptographic verification ' +
  'arrives with the Direct SDK in Wave 3.';

export const ATTESTATION_NOTE_DEMO =
  'DEMO mode — no 0G Compute key is configured, so this reflection was generated locally ' +
  'as a mock. It did NOT run inside a TEE. Set ZG_COMPUTE_API_KEY (from pc.0g.ai) for real ' +
  'Sealed Inference.';

export function buildLiveAttestation(model: string, chatId?: string): AttestationInfo {
  return {
    verificationStatus: 'attested-by-trust-mode',
    trustMode: 'private',
    teeType: TEE_HARDWARE.cpu,
    teeHardware: TEE_HARDWARE.gpu,
    model,
    timestamp: new Date().toISOString(),
    proofReference: chatId ? { chatId } : undefined,
    learnMoreUrl: ATTESTATION_DOCS_URL,
    note: ATTESTATION_NOTE_LIVE,
  };
}

export function buildDemoAttestation(model: string): AttestationInfo {
  return {
    verificationStatus: 'demo',
    trustMode: 'unspecified',
    teeType: TEE_HARDWARE.cpu,
    teeHardware: TEE_HARDWARE.gpu,
    model: `${model} (mock)`,
    timestamp: new Date().toISOString(),
    learnMoreUrl: ATTESTATION_DOCS_URL,
    note: ATTESTATION_NOTE_DEMO,
  };
}

export type AttestationTone = 'verified' | 'demo' | 'muted';

/** UI label + tone for a verification status. */
export function statusPresentation(status: VerificationStatus): {
  label: string;
  tone: AttestationTone;
} {
  switch (status) {
    case 'attested-by-trust-mode':
      return { label: 'Verified private', tone: 'verified' };
    case 'verified':
      return { label: 'Cryptographically verified', tone: 'verified' };
    case 'pending-crypto-proof':
      return { label: 'Verifying…', tone: 'muted' };
    case 'demo':
      return { label: 'Demo — not live TEE', tone: 'demo' };
    default:
      return { label: 'Unverified', tone: 'muted' };
  }
}
