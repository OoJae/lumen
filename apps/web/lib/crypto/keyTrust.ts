/**
 * What this device can actually PROVE about a candidate key.
 *
 * The bug this module exists to fix was an inversion. The key-check value was
 * treated as the authority on what a correct key is — but the KCV is a
 * self-issued token: it is a fixed constant encrypted with whatever key the
 * last signature produced, verified against nothing. Two failures followed:
 *
 *  1. `unlock()` minted authority out of nothing. On a device with no KCV, ANY
 *     signature became that device's law. For a smart-account or MPC wallet
 *     whose signatures are not deterministic, a fresh device's WRONG signature
 *     became the KCV — and from that moment the correct recovery key was
 *     rejected forever, with the UI insisting it "doesn't match this journal".
 *  2. `unlockWithRecoveryKey()` refused whenever there was no KCV to appeal to
 *     — which is precisely the fresh device, new profile, or cleared-site-data
 *     case the recovery key exists for.
 *
 * The real authority is the user's own ciphertext. Every envelope is AES-GCM
 * bound to `lumen:v2:<keyVersion>:<typ>:<wallet>:<id>`, so a single successful
 * authenticated decrypt is cryptographic proof that this key is this journal's
 * key — and a typo cannot forge it. So: ciphertext is the authority, and the
 * KCV is demoted to a cache used only when there is no ciphertext to ask.
 *
 * No stored provenance flag, and therefore no migration: the decision is
 * derived from what the database holds AT UNLOCK TIME. An existing user with
 * data lands on `proven-data` and sees exactly today's behaviour.
 */
import { decryptBytes, parseAad, type EncryptedEnvelope } from './encrypt';

export type UnlockSource = 'signature' | 'recovery';
export type KcvStatus = 'ok' | 'bad' | 'none';
export type DataVerdict = 'proven' | 'refuted' | 'no-data';

/** What this device can prove, strongest first. */
export type KeyEvidence =
  /** An authenticated decrypt of real wallet-bound ciphertext succeeded. */
  | 'proven-data'
  /** Matches the stored KCV; this device holds no other ciphertext. */
  | 'proven-kcv'
  /** This device holds ciphertext and none of it decrypts. */
  | 'refuted-data'
  /** The KCV disagrees, and no data corroborates it either way. */
  | 'refuted-kcv'
  /** Nothing on this device to check against. */
  | 'no-evidence';

/** Honesty level of an unlocked key. Never persisted; recomputed every unlock. */
export type KeyTrust = 'proven' | 'asserted';

export type UnlockRefusal =
  | 'signature-mismatch-data'
  | 'signature-mismatch-kcv'
  | 'recovery-mismatch-data';

export type UnlockDecision =
  | { admit: true; trust: KeyTrust; writeKcv: boolean }
  | { admit: false; refusal: UnlockRefusal; nextState: 'mismatch' | 'locked' };

/** One candidate artifact to try a key against. `aadId` is the exact id the
 *  envelope was bound to — `${wallet}:${turnId}` for both turns and vectors. */
export interface ProbeArtifact {
  typ: 'turn' | 'vector';
  aadId: string;
  envelope: EncryptedEnvelope;
}

/**
 * Try a key against real ciphertext.
 *
 * Deliberately asymmetric: proving exits on the FIRST success, while refuting
 * requires exhausting the iterable. A false refutation is exactly the lockout
 * this module exists to remove, so it must be the expensive answer.
 *
 * Artifacts written under a different key version are SKIPPED rather than
 * counted as failures. Without that, the day CURRENT_KEY_VERSION becomes 2
 * every v1 envelope fails to decrypt and every user on earth is refuted into a
 * lockout on their next unlock.
 */
export async function probeArtifacts(
  key: CryptoKey,
  artifacts: AsyncIterable<ProbeArtifact> | Iterable<ProbeArtifact>,
  keyVersion: number,
): Promise<DataVerdict> {
  let tried = 0;
  for await (const artifact of artifacts as AsyncIterable<ProbeArtifact>) {
    let envelopeVersion: number;
    try {
      envelopeVersion = parseAad(artifact.envelope.aad).keyVersion;
    } catch {
      // Unparseable AAD is not evidence about this key either way.
      continue;
    }
    if (envelopeVersion !== keyVersion) continue;

    tried++;
    try {
      await decryptBytes(key, artifact.envelope, {
        typ: artifact.typ,
        keyVersion,
        aadId: artifact.aadId,
      });
      return 'proven';
    } catch {
      // Keep going: one corrupt record must not refute a good key.
    }
  }
  return tried === 0 ? 'no-data' : 'refuted';
}

export function evidenceFrom(data: DataVerdict, kcv: KcvStatus): KeyEvidence {
  if (data === 'proven') return 'proven-data';
  if (data === 'refuted') return 'refuted-data';
  if (kcv === 'ok') return 'proven-kcv';
  if (kcv === 'bad') return 'refuted-kcv';
  return 'no-evidence';
}

/**
 * The whole fix, as one table.
 *
 * Three cells carry it:
 *  - `recovery` + `no-evidence` → admit. The fresh device / new profile /
 *    cleared-site-data case, which today is refused outright.
 *  - `recovery` + `refuted-kcv` → admit. Unsticks a device already poisoned by
 *    the old `unlock()`. Safe because `refuted-kcv` can only occur on a device
 *    holding zero ciphertext, so a wrong key admitted there destroys nothing,
 *    and the possibly-good bootstrap KCV is left in place.
 *  - anything + `proven-data` → writeKcv. This HEALS a poisoned device: a key
 *    that decrypted real data regenerates the KCV from proven material. A typo
 *    cannot reach this branch, so the original "a typo would poison every
 *    future signature unlock" hazard is fully preserved.
 */
export function decideUnlock(source: UnlockSource, evidence: KeyEvidence): UnlockDecision {
  switch (evidence) {
    case 'proven-data':
      return { admit: true, trust: 'proven', writeKcv: true };
    case 'proven-kcv':
      return { admit: true, trust: 'proven', writeKcv: false };
    case 'refuted-data':
      return source === 'signature'
        ? { admit: false, refusal: 'signature-mismatch-data', nextState: 'mismatch' }
        : // Not a wallet-determinism problem — do not trap the UI in `mismatch`,
          // which hides "Sign to unlock".
          { admit: false, refusal: 'recovery-mismatch-data', nextState: 'locked' };
    case 'refuted-kcv':
      return source === 'signature'
        ? { admit: false, refusal: 'signature-mismatch-kcv', nextState: 'mismatch' }
        : { admit: true, trust: 'asserted', writeKcv: false };
    case 'no-evidence':
      return source === 'signature'
        ? // A revocable bootstrap: the KCV is written so non-determinism can be
          // detected next time, but the session is only `asserted`, and a
          // recovery key can still overrule it (see `refuted-kcv` above).
          { admit: true, trust: 'asserted', writeKcv: true }
        : { admit: true, trust: 'asserted', writeKcv: false };
  }
}

export type ExportVerdict = { allow: true; trust: KeyTrust } | { allow: false };

/**
 * Exporting an unverified key is not automatically wrong — on a brand-new
 * journal it is the only way to get a backup at all — but exporting a REFUTED
 * one would hand the user a key that cannot open their data, and let it
 * overwrite a good backup. That is silent data loss, so it is the one case
 * that is refused.
 */
export function decideExport(evidence: KeyEvidence): ExportVerdict {
  if (evidence === 'refuted-data' || evidence === 'refuted-kcv') return { allow: false };
  return { allow: true, trust: evidence === 'no-evidence' ? 'asserted' : 'proven' };
}
