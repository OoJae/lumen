/**
 * Attestation helpers — shared by the server (gateway) and the client (viewer).
 * Pure: no `openai`, no secrets. Keeps the "what does this actually prove"
 * wording in ONE honest place.
 *
 * Wave 3 correction, and it matters: our provider's own on-chain record says
 * `ProviderType: centralized, ProviderIdentity: aliyun`, and every enclave
 * signature we verify literally contains `…:centralized:aliyun:…`. The model
 * therefore runs at an upstream host; the enclave is a sealed proxy that
 * attests the request, the response, and its TLS session to that host. Earlier
 * copy said the model ran inside the enclave. It doesn't, so we don't say it.
 */
import {
  TEE_HARDWARE,
  ATTESTATION_DOCS_URL,
  type AttestationInfo,
  type InferencePath,
  type TeeProofRecord,
  type VerificationStatus,
} from '@lumen/shared';

export interface ProviderDisclosure {
  providerType: string;
  providerIdentity: string;
}

/**
 * One sentence naming exactly who can see the words, derived from the
 * provider's own attested claims rather than our marketing.
 */
export function providerDisclosure(disclosure?: ProviderDisclosure): string {
  if (!disclosure || disclosure.providerType === 'unknown') {
    return 'The enclave operator cannot read your words.';
  }
  if (disclosure.providerType === 'centralized') {
    return (
      `This provider runs the model at an upstream host (${disclosure.providerIdentity}). ` +
      'The enclave is a sealed proxy: it attests your request, this response, and its TLS ' +
      "session to that host. The provider's operator cannot read your words — the upstream " +
      'model host does process them inside that attested session.'
    );
  }
  return (
    `The model runs inside the enclave itself (${disclosure.providerIdentity}), so the ` +
    'provider operating the hardware cannot read your words.'
  );
}

export const ATTESTATION_NOTE_DEMO =
  'DEMO mode — no 0G Compute credential is configured, so this reflection was generated ' +
  'locally as a mock. It did NOT run inside a TEE. Configure a 0G Compute token for real ' +
  'Sealed Inference.';

/**
 * Pre-verification, or verification unavailable.
 *
 * This used to open "Processed through the provider's secure enclave in private
 * trust mode." The last four words were unearned: `X-0G-Provider-Trust-Mode`
 * appears nowhere in this codebase, the 0G SDK never sends it either, and the
 * provider's own credential path carries only `Authorization`. So the app was
 * naming a request mode it does not request.
 *
 * What IS true, and is what this now says: the provider is registered on-chain
 * as running the model inside a TEE, and that registration — not a header — is
 * where the enclave property comes from. The rest is the honest caveat that
 * THIS response was not checked.
 */
export function buildTrustModeNote(disclosure?: ProviderDisclosure, reason?: string): string {
  const tail = reason
    ? `This specific response was NOT cryptographically verified (${reason}), so it rests on that registration rather than on a proof.`
    : 'Cryptographic verification of this specific response is still running.';
  return `This provider is registered on-chain as running the model inside a secure enclave. ${providerDisclosure(disclosure)} ${tail}`;
}

/** Verified: the strongest honest sentence we can write. */
export function buildVerifiedNote(disclosure?: ProviderDisclosure): string {
  return (
    'Verified on this device: the exact bytes of this response hash-match a signature ' +
    "produced inside the provider's secure enclave, and the signing key matches the enclave " +
    `key this provider registered on-chain. ${providerDisclosure(disclosure)}`
  );
}

/** The alarm state: a signature that does not match what we received. */
export const ATTESTATION_NOTE_MISMATCH =
  'WARNING: this response did NOT match the enclave signature for its request. The bytes may ' +
  'have been altered in transit, or the provider is misbehaving. Treat this reflection as ' +
  'untrusted and tell us — this should never happen.';

export interface LiveAttestationOptions {
  model: string;
  chatId?: string;
  providerAddress?: string;
  inferencePath?: InferencePath;
  disclosure?: ProviderDisclosure;
}

/** Live response, not yet verified (or verification skipped/unavailable). */
export function buildLiveAttestation(
  opts: LiveAttestationOptions,
  reason?: string,
): AttestationInfo {
  return {
    verificationStatus: 'attested-by-trust-mode',
    // 'unspecified' because Lumen specifies no trust mode. Saying 'private'
    // here described a header that is not sent — see buildTrustModeNote.
    trustMode: 'unspecified',
    teeType: TEE_HARDWARE.cpu,
    teeHardware: TEE_HARDWARE.gpu,
    model: opts.model,
    timestamp: new Date().toISOString(),
    proofReference: opts.chatId ? { chatId: opts.chatId } : undefined,
    learnMoreUrl: ATTESTATION_DOCS_URL,
    note: buildTrustModeNote(opts.disclosure, reason),
    providerAddress: opts.providerAddress,
    inferencePath: opts.inferencePath,
    providerDisclosure: opts.disclosure,
  };
}

/** Verification succeeded — both signature and content hash checked out. */
export function buildVerifiedAttestation(
  opts: LiveAttestationOptions,
  proof: TeeProofRecord,
  /** Whether the provider has acknowledged the signer we checked against. */
  signerAcknowledged?: boolean,
): AttestationInfo {
  // The signature check is the same either way — what changes is what we are
  // entitled to say about the address we checked it against. An unacknowledged
  // signer means the registry entry has not been confirmed by the provider, so
  // "verified" needs the caveat rather than swallowing it.
  const caveat =
    signerAcknowledged === false
      ? ' Note: this provider has not acknowledged the TEE signer registered against it on-chain, ' +
        'so the address we checked the signature against is the registry\u2019s claim rather than ' +
        'a confirmed one.'
      : '';
  return {
    ...buildLiveAttestation(opts),
    verificationStatus: 'verified',
    note: buildVerifiedNote(opts.disclosure) + caveat,
    proof,
  };
}

/** Verification actively FAILED (not merely unavailable). Never soften this. */
export function buildUnverifiedAttestation(
  opts: LiveAttestationOptions,
  proof: TeeProofRecord,
): AttestationInfo {
  return {
    ...buildLiveAttestation(opts),
    verificationStatus: 'unverified',
    note: ATTESTATION_NOTE_MISMATCH,
    proof,
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
    inferencePath: 'demo',
  };
}

export type AttestationTone = 'verified' | 'demo' | 'muted' | 'alarm';

/** UI label + tone for a verification status. */
export function statusPresentation(status: VerificationStatus): {
  label: string;
  tone: AttestationTone;
} {
  switch (status) {
    case 'verified':
      return { label: 'Cryptographically verified', tone: 'verified' };
    case 'attested-by-trust-mode':
      // NOT 'verified', and no longer says so. This is the state where
      // per-request verification did not complete, so the only thing standing
      // behind the reflection is the provider's on-chain registration. Labelling
      // that "Verified private" in the verified tone was the largest overclaim
      // in the app, and it sat on the fallback path — the one a judge on a flaky
      // connection is most likely to see.
      return { label: 'Enclave — this one unverified', tone: 'muted' };
    case 'pending-crypto-proof':
      return { label: 'Verifying…', tone: 'muted' };
    case 'demo':
      return { label: 'Demo — not live TEE', tone: 'demo' };
    case 'unverified':
      return { label: 'Signature mismatch', tone: 'alarm' };
    default:
      return { label: 'Unverified', tone: 'muted' };
  }
}
