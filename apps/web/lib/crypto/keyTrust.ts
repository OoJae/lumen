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
 * The decision is derived from what the database holds AT UNLOCK TIME. An
 * existing user with data lands on `proven-data` and sees exactly today's
 * behaviour.
 *
 * SECOND INVERSION, found in production. The first version of this module
 * carried no provenance on the KCV, and that let the inversion reappear one
 * unlock later. On a device with no ciphertext, `no-evidence` + `signature`
 * writes a bootstrap KCV so non-determinism can be detected next time. But the
 * NEXT unlock then found `kcv === 'ok'`, called that `proven-kcv`, and admitted
 * the key as `proven` — on the strength of a token the device had minted from
 * an unverified signature fourteen minutes earlier. All it actually proves is
 * that the same wallet signed the same way twice. That is a determinism check,
 * not a journal check, and the user it was observed on had their real journal
 * anchored on 0G and never once decrypted on that device.
 *
 * So the KCV now records HOW it was written, in its own plaintext:
 *
 *   proven    — written by a key that decrypted real wallet-bound ciphertext
 *   bootstrap — written by an unverified signature on an empty device
 *
 * Matching a `proven` KCV is real evidence. Matching a `bootstrap` KCV means
 * only "your wallet is signing consistently", which keeps the key `asserted`
 * until real data confirms it. A legacy KCV with no marker is read as
 * `bootstrap`, which is the conservative direction: the cost is one honest
 * notice, and the first successful decrypt rewrites it as `proven`.
 */
import { decryptBytes, parseAad, type EncryptedEnvelope } from './encrypt';

export type UnlockSource = 'signature' | 'recovery';
/** How a stored KCV was minted. Legacy KCVs carry no marker and read as
 *  'bootstrap' — see the header. */
export type KcvProvenance = 'proven' | 'bootstrap';
export type KcvStatus = 'ok-proven' | 'ok-bootstrap' | 'bad' | 'none';
export type DataVerdict = 'proven' | 'refuted' | 'no-data';

/** What this device can prove, strongest first. */
export type KeyEvidence =
  /** An authenticated decrypt of real wallet-bound ciphertext succeeded. */
  | 'proven-data'
  /** Matches a KCV that was itself written by a key proven against real data,
   *  and this device holds no other ciphertext. */
  | 'proven-kcv'
  /**
   * Matches a KCV that was written by an unverified signature on an empty
   * device. Proves the wallet is signing consistently and NOTHING about whether
   * this key opens the journal — which may be sitting on 0G, untouched.
   */
  | 'bootstrap-kcv'
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
  /** `writeKcv` names the provenance to stamp, or null to leave the KCV alone. */
  | { admit: true; trust: KeyTrust; writeKcv: KcvProvenance | null }
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

/** The constant every KCV plaintext starts with. */
export const KCV_PLAINTEXT_V1 = 'lumen-kcv-v1';

/** What to encrypt when writing a KCV, provenance included. */
export function kcvPlaintext(provenance: KcvProvenance): string {
  return `${KCV_PLAINTEXT_V1}:${provenance}`;
}

/**
 * What a DECRYPTED KCV plaintext is worth. Callers pass 'none' themselves when
 * no KCV exists, and 'bad' when the decrypt threw.
 *
 * A bare `lumen-kcv-v1` predates the provenance marker and could have been
 * written either way, so it reads as `ok-bootstrap`. That is the conservative
 * direction: the cost is one honest "restore to check this key" notice, and the
 * first successful decrypt of real data rewrites it as proven. Reading it the
 * other way would re-open the exact hole this marker closes.
 */
export function readKcvPlaintext(text: string): Extract<KcvStatus, 'ok-proven' | 'ok-bootstrap' | 'bad'> {
  if (text === kcvPlaintext('proven')) return 'ok-proven';
  if (text === kcvPlaintext('bootstrap') || text === KCV_PLAINTEXT_V1) return 'ok-bootstrap';
  // Decrypted, but not to anything we ever wrote.
  return 'bad';
}

export function evidenceFrom(data: DataVerdict, kcv: KcvStatus): KeyEvidence {
  if (data === 'proven') return 'proven-data';
  if (data === 'refuted') return 'refuted-data';
  if (kcv === 'ok-proven') return 'proven-kcv';
  if (kcv === 'ok-bootstrap') return 'bootstrap-kcv';
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
      return { admit: true, trust: 'proven', writeKcv: 'proven' };
    case 'proven-kcv':
      return { admit: true, trust: 'proven', writeKcv: null };
    case 'bootstrap-kcv':
      // The wallet is signing consistently. That is worth knowing and it is not
      // proof: nothing here has ever been opened by this key. Stay `asserted`
      // so the UI keeps asking for the restore that would settle it, and leave
      // the marker alone — re-stamping it `proven` would launder the bootstrap
      // into evidence, which is the exact bug this branch exists to stop.
      return { admit: true, trust: 'asserted', writeKcv: null };
    case 'refuted-data':
      return source === 'signature'
        ? { admit: false, refusal: 'signature-mismatch-data', nextState: 'mismatch' }
        : // Not a wallet-determinism problem — do not trap the UI in `mismatch`,
          // which hides "Sign to unlock".
          { admit: false, refusal: 'recovery-mismatch-data', nextState: 'locked' };
    case 'refuted-kcv':
      return source === 'signature'
        ? { admit: false, refusal: 'signature-mismatch-kcv', nextState: 'mismatch' }
        : { admit: true, trust: 'asserted', writeKcv: null };
    case 'no-evidence':
      return source === 'signature'
        ? // A revocable bootstrap: the KCV is written so non-determinism can be
          // detected next time, but the session is only `asserted`, a recovery
          // key can still overrule it (see `refuted-kcv` above), and it is
          // stamped `bootstrap` so a later unlock cannot mistake it for proof.
          { admit: true, trust: 'asserted', writeKcv: 'bootstrap' }
        : { admit: true, trust: 'asserted', writeKcv: null };
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
  const unchecked = evidence === 'no-evidence' || evidence === 'bootstrap-kcv';
  return { allow: true, trust: unchecked ? 'asserted' : 'proven' };
}
