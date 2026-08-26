'use client';

/**
 * Turns a finished live reflection into a verified attestation — in the
 * browser, for every user, wallet or not.
 *
 * Runs eagerly right after the stream drains: the provider expires signatures
 * after a while, so waiting for the user to click "verify" would mean the proof
 * is sometimes already gone. The full proof triple is then persisted with the
 * turn, which is what makes "re-check this proof" work months later.
 */
import type { AttestationInfo, InferencePath, TeeProofRecord } from '@lumen/shared';

import {
  buildLiveAttestation,
  buildUnverifiedAttestation,
  buildVerifiedAttestation,
  type ProviderDisclosure,
} from './attestation';
import { fetchTeeSignature, verifyTeeProof } from './verify';

export interface TeeSignerInfo {
  providerAddress: string;
  teeSignerAddress: string;
  providerUrl: string;
  model: string;
  disclosure: ProviderDisclosure;
  /**
   * Has the provider ACKNOWLEDGED the TEE signer registered against it?
   *
   * /api/tee-signer has always read and returned this, and this interface used
   * to omit it — so it was fetched, serialised, and dropped. A provider whose
   * registered signer was never acknowledged verified identically to one whose
   * was, under the label "Cryptographically verified". Carried through now, and
   * disclosed by the attestation note rather than silently ignored.
   */
  teeSignerAcknowledged?: boolean;
}

let signerCache: { value: TeeSignerInfo; at: number } | null = null;
const SIGNER_TTL_MS = 30 * 60 * 1000;

export async function loadTeeSigner(signal?: AbortSignal): Promise<TeeSignerInfo | null> {
  if (signerCache && Date.now() - signerCache.at < SIGNER_TTL_MS) return signerCache.value;
  try {
    const res = await fetch('/api/tee-signer', { signal });
    if (!res.ok) return null;
    const value = (await res.json()) as TeeSignerInfo & { error?: string };
    if (value.error || !value.teeSignerAddress) return null;
    signerCache = { value, at: Date.now() };
    return value;
  } catch {
    return null;
  }
}

export interface VerifyReflectionInput {
  rawBytes: Uint8Array;
  chatId: string | null;
  model: string;
  path: InferencePath;
  /** From response headers when the gateway relayed; else the provider we called. */
  providerUrl?: string | null;
  providerAddress?: string | null;
}

/**
 * Total budget for verification.
 *
 * Was 5s, and it was losing. Measured against the live provider: the signer
 * lookup takes 2.2–2.5s and the signature fetch 1.7–3.0s, both inside this one
 * budget — so a real reflection needs 3.9–5.5s and roughly half of them were
 * aborted mid-flight. The product's headline claim was failing on a coin flip,
 * and the failure was silent because the fallback state is a legitimate one.
 *
 * Raising it costs nothing the user can feel: this runs AFTER the stream has
 * drained, with the reflection already on screen and readable. The budget
 * exists so verification cannot hang forever, not to make it fast.
 */
const VERIFY_BUDGET_MS = 15_000;

export async function verifyAndBuildAttestation(
  input: VerifyReflectionInput,
): Promise<AttestationInfo> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_BUDGET_MS);

  try {
    const signer = await loadTeeSigner(controller.signal);
    const base = { model: input.model, inferencePath: input.path };

    if (!input.chatId) {
      return buildLiveAttestation(
        { ...base, providerAddress: input.providerAddress ?? undefined, disclosure: signer?.disclosure },
        'no proof reference returned',
      );
    }

    const opts = {
      ...base,
      chatId: input.chatId,
      providerAddress: input.providerAddress ?? signer?.providerAddress,
      disclosure: signer?.disclosure,
    };

    if (!signer) {
      return buildLiveAttestation(opts, "couldn't read the provider's registered signer");
    }

    const providerUrl = input.providerUrl || signer.providerUrl;
    let proof;
    try {
      proof = await fetchTeeSignature(providerUrl, input.chatId, input.model, controller.signal);
    } catch (err) {
      // Do not blame the provider for OUR abort. This branch used to report
      // "the provider no longer serves this signature" for every failure
      // including a budget timeout — which was the common case, and which sent
      // anyone investigating to the wrong system entirely. The provider was
      // serving the signature correctly the whole time.
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      return buildLiveAttestation(
        opts,
        aborted
          ? 'the check did not finish in time on this connection'
          : 'the provider no longer serves this signature',
      );
    }

    const verdict = await verifyTeeProof(proof, input.rawBytes, signer.teeSignerAddress);

    const record: TeeProofRecord = {
      chatId: input.chatId,
      providerAddress: opts.providerAddress ?? '',
      signedText: proof.text,
      signature: proof.signature,
      signingAddress: proof.signingAddress,
      teeSignerAddress: signer.teeSignerAddress,
      recovered: verdict.recovered,
      responseSha256: verdict.computedResponseSha256,
      verifiedAt: new Date().toISOString(),
      checks: verdict.checks,
    };

    // Prefer the disclosure the enclave itself signed over the registry copy.
    const signed = verdict.parsed
      ? { providerType: verdict.parsed.providerType, providerIdentity: verdict.parsed.providerIdentity }
      : signer.disclosure;
    const withSigned = { ...opts, disclosure: signed };

    if (verdict.ok)
      return buildVerifiedAttestation(withSigned, record, signer.teeSignerAcknowledged);

    // A signature that exists but does not match the bytes is an alarm, not a
    // shrug. Anything softer would be exactly the overclaiming we refuse.
    if (verdict.checks.signature && !verdict.checks.responseHash) {
      return buildUnverifiedAttestation(withSigned, record);
    }
    return buildLiveAttestation(withSigned, verdict.reason ?? 'verification failed');
  } finally {
    clearTimeout(timer);
  }
}
