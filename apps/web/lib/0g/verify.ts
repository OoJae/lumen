/**
 * Per-request TEE proof verification (Wave 3) — pure, client-safe, viem-only.
 *
 * What this proves, exactly: the 0G provider's enclave signed a statement whose
 * response-hash field equals SHA-256 of the bytes we actually received, and the
 * recovered signer matches the TEE signer address that provider registered
 * on-chain. So the response was not altered in transit — not by the network,
 * and not by Lumen's own gateway.
 *
 * Deliberately stronger than the SDK's `processResponse`, which checks the
 * signature but never compares the signed hash to the content you got.
 *
 * What it does NOT prove: the first field (a request digest) is displayed but
 * unverified — the provider normalizes the request before hashing and we have
 * not confirmed the preimage, so we never claim request binding.
 */
import { recoverMessageAddress, type Hex } from 'viem';

export interface TeeSignatureProof {
  text: string;
  signature: Hex;
  /** Signer address as claimed by the provider — informational only; we check
   *  the recovered address against the ON-CHAIN record instead. */
  signingAddress: string;
}

export interface ParsedSignedText {
  requestHash: string;
  responseHash: string;
  providerType: string;
  providerIdentity: string;
  tlsFingerprint: string;
}

export type ProofFailure =
  | 'malformed-signed-text'
  | 'signer-mismatch'
  | 'hash-mismatch'
  | 'signature-unavailable'
  | 'signer-record-unavailable';

export interface ProofVerdict {
  ok: boolean;
  checks: { signature: boolean; responseHash: boolean };
  recovered?: string;
  computedResponseSha256: string;
  parsed?: ParsedSignedText;
  reason?: ProofFailure;
}

/** `requestHash:responseHash:providerType:providerIdentity:tlsFingerprint` */
export function parseSignedText(text: string): ParsedSignedText {
  const parts = text.split(':');
  if (parts.length !== 5 || parts.some((p) => p.length === 0)) {
    throw new Error('Malformed signed text');
  }
  return {
    requestHash: parts[0]!,
    responseHash: parts[1]!,
    providerType: parts[2]!,
    providerIdentity: parts[3]!,
    tlsFingerprint: parts[4]!,
  };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Public, unauthenticated, CORS-open on the provider — no wallet involved. */
export async function fetchTeeSignature(
  providerUrl: string,
  chatId: string,
  model: string,
  signal?: AbortSignal,
): Promise<TeeSignatureProof> {
  const base = providerUrl.replace(/\/+$/, '');
  const url = `${base}/v1/proxy/signature/${encodeURIComponent(chatId)}?model=${encodeURIComponent(model)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    // Signatures expire provider-side; the caller downgrades honestly.
    throw new Error(`signature unavailable (${res.status})`);
  }
  const body = (await res.json()) as {
    text?: string;
    signature?: string;
    signing_address?: string;
  };
  if (!body.text || !body.signature) throw new Error('signature response incomplete');
  return {
    text: body.text,
    signature: body.signature as Hex,
    signingAddress: body.signing_address ?? '',
  };
}

/**
 * Both checks must pass: the enclave signature recovers to the on-chain TEE
 * signer, AND the signed response hash equals what we received.
 */
export async function verifyTeeProof(
  proof: TeeSignatureProof,
  rawResponseBytes: Uint8Array,
  expectedTeeSigner: string,
): Promise<ProofVerdict> {
  const computedResponseSha256 = await sha256Hex(rawResponseBytes);

  let parsed: ParsedSignedText;
  try {
    parsed = parseSignedText(proof.text);
  } catch {
    return {
      ok: false,
      checks: { signature: false, responseHash: false },
      computedResponseSha256,
      reason: 'malformed-signed-text',
    };
  }

  let recovered: string | undefined;
  try {
    recovered = await recoverMessageAddress({
      message: proof.text,
      signature: proof.signature,
    });
  } catch {
    recovered = undefined;
  }

  const signatureOk =
    !!recovered &&
    !!expectedTeeSigner &&
    recovered.toLowerCase() === expectedTeeSigner.toLowerCase();
  const responseHashOk = computedResponseSha256 === parsed.responseHash.toLowerCase();

  return {
    ok: signatureOk && responseHashOk,
    checks: { signature: signatureOk, responseHash: responseHashOk },
    recovered,
    computedResponseSha256,
    parsed,
    reason: signatureOk ? (responseHashOk ? undefined : 'hash-mismatch') : 'signer-mismatch',
  };
}
