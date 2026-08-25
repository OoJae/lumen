import { describe, expect, it } from 'vitest';

import { encryptBytes, type EncryptedEnvelope } from './encrypt';
import { deriveAesKey } from './keys';
import {
  decideExport,
  decideUnlock,
  evidenceFrom,
  kcvPlaintext,
  KCV_PLAINTEXT_V1,
  probeArtifacts,
  readKcvPlaintext,
  type DataVerdict,
  type KcvStatus,
  type KeyEvidence,
  type ProbeArtifact,
  type UnlockSource,
} from './keyTrust';

const SIG_A = '0x' + 'ab'.repeat(65);
const SIG_B = '0x' + 'cd'.repeat(65);
const WALLET = '0x1111111111111111111111111111111111111111';
const encoder = new TextEncoder();

async function turnArtifact(key: CryptoKey, id: string, keyVersion = 1): Promise<ProbeArtifact> {
  const aadId = `${WALLET}:${id}`;
  const envelope: EncryptedEnvelope = await encryptBytes(
    key,
    encoder.encode(JSON.stringify({ id, entry: `entry ${id}` })),
    'turn',
    aadId,
    keyVersion,
  );
  return { typ: 'turn', aadId, envelope };
}

const ALL_EVIDENCE: KeyEvidence[] = [
  'proven-data',
  'proven-kcv',
  'bootstrap-kcv',
  'refuted-data',
  'refuted-data-unproven',
  'refuted-kcv',
  'no-evidence',
];

const ALL_KCV: KcvStatus[] = ['ok-proven', 'ok-bootstrap', 'bad', 'none'];

describe('evidenceFrom — ciphertext outranks the KCV', () => {
  it('lets real data decide, whatever the KCV says', () => {
    for (const kcv of ALL_KCV) {
      expect(evidenceFrom('proven', kcv), kcv).toBe('proven-data');
      // Refuted stays refuted for every KCV state — the marker only changes
      // WHICH refutation, never turns one into an admission on its own.
      expect(evidenceFrom('refuted', kcv), kcv).toMatch(/^refuted-data/);
    }
  });

  it('distinguishes a refutation by a never-proven key from a real one', () => {
    // The trap: an asserted signature unlock writes a bootstrap KCV, the user
    // writes one entry under that unproven key, and from then on every candidate
    // is refuted — including the CORRECT recovery key, on the one device it
    // exists for.
    expect(evidenceFrom('refuted', 'ok-bootstrap')).toBe('refuted-data-unproven');
    // A proven KCV, or none at all, keeps the strict refusal. 'none' is unknown
    // provenance, and guessing would admit a typo onto a device holding a real
    // journal.
    expect(evidenceFrom('refuted', 'ok-proven')).toBe('refuted-data');
    expect(evidenceFrom('refuted', 'none')).toBe('refuted-data');
    expect(evidenceFrom('refuted', 'bad')).toBe('refuted-data');
  });

  it('THE LOCKOUT FIX: the correct recovery key gets in, the wrong signature does not', () => {
    const rec = decideUnlock('recovery', 'refuted-data-unproven');
    expect(rec.admit).toBe(true);
    if (rec.admit) {
      expect(rec.trust).toBe('asserted');
      // Must not stamp: the key has still proven nothing.
      expect(rec.writeKcv).toBeNull();
    }
    // A fresh signature that disagrees is the determinism problem, unchanged.
    const sig = decideUnlock('signature', 'refuted-data-unproven');
    expect(sig.admit).toBe(false);
    if (!sig.admit) expect(sig.nextState).toBe('mismatch');
  });

  it('still refuses a recovery key when the device holds a PROVEN journal', () => {
    // The counterpart the fix must not break: on a device whose key was proven,
    // a recovery key that decrypts nothing is a typo and must be rejected.
    const d = decideUnlock('recovery', 'refuted-data');
    expect(d.admit).toBe(false);
  });

  it('never exports a key any refutation disproves', () => {
    for (const e of ['refuted-data', 'refuted-data-unproven', 'refuted-kcv'] as const) {
      expect(decideExport(e).allow, e).toBe(false);
    }
  });

  it('falls back to the KCV only when there is no data', () => {
    expect(evidenceFrom('no-data', 'ok-proven')).toBe('proven-kcv');
    expect(evidenceFrom('no-data', 'ok-bootstrap')).toBe('bootstrap-kcv');
    expect(evidenceFrom('no-data', 'bad')).toBe('refuted-kcv');
    expect(evidenceFrom('no-data', 'none')).toBe('no-evidence');
  });

  it('SECOND INVERSION: a matching KCV is only proof if the KCV was proof', () => {
    // Observed in production. Unlock #1 on an empty device writes a bootstrap
    // KCV from an unverified signature. Unlock #2 matched it and called the key
    // `proven` — on a device where nothing had ever been decrypted, for a user
    // whose real journal was sitting anchored on 0G. All a bootstrap match
    // establishes is that the wallet signs consistently.
    expect(evidenceFrom('no-data', 'ok-bootstrap')).not.toBe('proven-kcv');
  });
});

describe('decideUnlock — the full table', () => {
  const table: Array<[UnlockSource, KeyEvidence, string]> = [
    ['signature', 'proven-data', 'admit proven writeKcv:proven'],
    ['signature', 'proven-kcv', 'admit proven'],
    ['signature', 'bootstrap-kcv', 'admit asserted'],
    ['signature', 'refuted-data', 'refuse signature-mismatch-data mismatch'],
    ['signature', 'refuted-data-unproven', 'refuse signature-mismatch-data mismatch'],
    ['signature', 'refuted-kcv', 'refuse signature-mismatch-kcv mismatch'],
    ['signature', 'no-evidence', 'admit asserted writeKcv:bootstrap'],
    ['recovery', 'proven-data', 'admit proven writeKcv:proven'],
    ['recovery', 'proven-kcv', 'admit proven'],
    ['recovery', 'bootstrap-kcv', 'admit asserted'],
    ['recovery', 'refuted-data', 'refuse recovery-mismatch-data locked'],
    ['recovery', 'refuted-data-unproven', 'admit asserted'],
    ['recovery', 'refuted-kcv', 'admit asserted'],
    ['recovery', 'no-evidence', 'admit asserted'],
  ];

  it('matches the design table in every cell', () => {
    for (const [source, evidence, expected] of table) {
      const d = decideUnlock(source, evidence);
      const actual = d.admit
        ? `admit ${d.trust}${d.writeKcv ? ` writeKcv:${d.writeKcv}` : ''}`
        : `refuse ${d.refusal} ${d.nextState}`;
      expect(actual, `${source} + ${evidence}`).toBe(expected);
    }
  });

  it('covers every cell — the table cannot silently miss a new evidence value', () => {
    expect(table).toHaveLength(2 * ALL_EVIDENCE.length);
  });

  it('THE SECOND FIX: matching a bootstrap KCV never reaches `proven`', () => {
    for (const source of ['signature', 'recovery'] as UnlockSource[]) {
      const d = decideUnlock(source, 'bootstrap-kcv');
      expect(d.admit, source).toBe(true);
      if (d.admit) {
        expect(d.trust, source).toBe('asserted');
        // And it must NOT re-stamp: promoting the bootstrap to `proven` here
        // would launder an unverified signature into evidence, which is exactly
        // the inversion this module exists to prevent.
        expect(d.writeKcv, source).toBeNull();
      }
    }
  });

  it('THE FIX: a recovery key works on a device with nothing to check it against', () => {
    // This is the fresh device, the new browser profile, and "clear site data".
    // It used to be refused outright — the one case the recovery key exists for.
    const d = decideUnlock('recovery', 'no-evidence');
    expect(d.admit).toBe(true);
    if (d.admit) {
      expect(d.trust).toBe('asserted');
      // Must NOT write: a typo here would become the device's law.
      expect(d.writeKcv).toBeNull();
    }
  });

  it('THE FIX: a recovery key overrules a KCV that no data corroborates', () => {
    // Unsticks a device poisoned by the old unlock(), where a wrong signature
    // silently became the KCV and the correct recovery key was rejected forever.
    const d = decideUnlock('recovery', 'refuted-kcv');
    expect(d.admit).toBe(true);
    if (d.admit) expect(d.writeKcv).toBeNull();
  });

  it('THE HEAL: proving against real data always rewrites the KCV', () => {
    for (const source of ['signature', 'recovery'] as UnlockSource[]) {
      const d = decideUnlock(source, 'proven-data');
      expect(d.admit).toBe(true);
      if (d.admit) expect(d.writeKcv).toBe('proven');
    }
  });

  it('still refuses a key that real data disproves, from either source', () => {
    for (const source of ['signature', 'recovery'] as UnlockSource[]) {
      expect(decideUnlock(source, 'refuted-data').admit, source).toBe(false);
    }
  });

  it('never traps the UI in `mismatch` for a wrong recovery key', () => {
    // `mismatch` hides "Sign to unlock"; a typo is not a wallet-determinism
    // problem and must not cost the user that button.
    const d = decideUnlock('recovery', 'refuted-data');
    if (!d.admit) expect(d.nextState).toBe('locked');
  });

  it('only ever writes a KCV when proven, or when bootstrapping from a signature', () => {
    for (const source of ['signature', 'recovery'] as UnlockSource[]) {
      for (const evidence of ALL_EVIDENCE) {
        const d = decideUnlock(source, evidence);
        if (d.admit && d.writeKcv) {
          const bootstrap = source === 'signature' && evidence === 'no-evidence';
          expect(evidence === 'proven-data' || bootstrap, `${source} + ${evidence}`).toBe(true);
        }
      }
    }
  });
});

describe('probeArtifacts — against real envelopes', () => {
  it('proves a key that decrypts any one artifact', async () => {
    const key = await deriveAesKey(SIG_A);
    const artifacts = [
      await turnArtifact(key, 'a'),
      await turnArtifact(key, 'b'),
      await turnArtifact(key, 'c'),
    ];
    expect(await probeArtifacts(key, artifacts, 1)).toBe('proven');
  });

  it('proves on the THIRD artifact — early exit does not mean first-only', async () => {
    const good = await deriveAesKey(SIG_A);
    const other = await deriveAesKey(SIG_B);
    const artifacts = [
      await turnArtifact(other, 'a'),
      await turnArtifact(other, 'b'),
      await turnArtifact(good, 'c'),
    ];
    // One corrupt or foreign record must not refute a good key.
    expect(await probeArtifacts(good, artifacts, 1)).toBe('proven');
  });

  it('refutes only after exhausting a non-empty iterable', async () => {
    const good = await deriveAesKey(SIG_A);
    const wrong = await deriveAesKey(SIG_B);
    const artifacts = [await turnArtifact(good, 'a'), await turnArtifact(good, 'b')];
    expect(await probeArtifacts(wrong, artifacts, 1)).toBe('refuted');
  });

  it('returns no-data for an empty store, never refuted', async () => {
    const key = await deriveAesKey(SIG_A);
    expect(await probeArtifacts(key, [], 1)).toBe('no-data');
  });

  it('VERSION GUARD: skips other-version envelopes instead of counting them as failures', async () => {
    // Without this, the day CURRENT_KEY_VERSION becomes 2 every v1 envelope
    // fails to decrypt and every user is refuted into a lockout.
    const key = await deriveAesKey(SIG_A);
    const v1 = [await turnArtifact(key, 'a', 1), await turnArtifact(key, 'b', 1)];
    expect(await probeArtifacts(key, v1, 2)).toBe('no-data');
    // And a no-data result admits a recovery key rather than refusing it.
    expect(decideUnlock('recovery', evidenceFrom('no-data', 'none')).admit).toBe(true);
  });

  it('ignores an unparseable AAD rather than treating it as a failure', async () => {
    const key = await deriveAesKey(SIG_A);
    const good = await turnArtifact(key, 'good');
    const corrupt: ProbeArtifact = {
      typ: 'turn',
      aadId: `${WALLET}:junk`,
      envelope: { ...good.envelope, aad: 'not-a-lumen-aad' },
    };
    expect(await probeArtifacts(key, [corrupt], 1)).toBe('no-data');
    expect(await probeArtifacts(key, [corrupt, good], 1)).toBe('proven');
  });

  it('works over an async iterable', async () => {
    const key = await deriveAesKey(SIG_A);
    const one = await turnArtifact(key, 'a');
    async function* gen() {
      yield one;
    }
    expect(await probeArtifacts(key, gen(), 1)).toBe('proven');
  });

  it('END TO END: a wrong key is refuted and refused', async () => {
    const journalKey = await deriveAesKey(SIG_A);
    const wrongKey = await deriveAesKey(SIG_B);
    const artifacts = [await turnArtifact(journalKey, 'a')];
    const verdict: DataVerdict = await probeArtifacts(wrongKey, artifacts, 1);
    expect(verdict).toBe('refuted');
    expect(decideUnlock('recovery', evidenceFrom(verdict, 'none')).admit).toBe(false);
  });
});

describe('decideExport', () => {
  it('allows a proven key and says so', () => {
    expect(decideExport('proven-data')).toEqual({ allow: true, trust: 'proven' });
    expect(decideExport('proven-kcv')).toEqual({ allow: true, trust: 'proven' });
  });

  it('allows an unverified key on a brand-new journal, labelled asserted', () => {
    // Refusing here would leave a new user with no backup at all.
    expect(decideExport('no-evidence')).toEqual({ allow: true, trust: 'asserted' });
  });

  it('refuses to export a key the device disproves', () => {
    // Exporting it would hand over a key that cannot open the data, and let it
    // overwrite a good backup — silent data loss.
    expect(decideExport('refuted-data').allow).toBe(false);
    expect(decideExport('refuted-kcv').allow).toBe(false);
  });
});

describe('the KCV plaintext carries its own provenance', () => {
  it('round-trips both markers', () => {
    expect(readKcvPlaintext(kcvPlaintext('proven'))).toBe('ok-proven');
    expect(readKcvPlaintext(kcvPlaintext('bootstrap'))).toBe('ok-bootstrap');
  });

  it('reads a LEGACY bare KCV as a bootstrap, never as proof', () => {
    // Written before the marker existed, so its provenance is unknowable. The
    // conservative reading costs one honest notice; the other reading hands an
    // unchecked key the word "proven", which is the bug this closes.
    expect(readKcvPlaintext(KCV_PLAINTEXT_V1)).toBe('ok-bootstrap');
    expect(evidenceFrom('no-data', readKcvPlaintext(KCV_PLAINTEXT_V1))).toBe('bootstrap-kcv');
    const d = decideUnlock('signature', 'bootstrap-kcv');
    expect(d.admit && d.trust).toBe('asserted');
  });

  it('treats anything else as a mismatch', () => {
    for (const junk of ['', 'lumen-kcv-v2', 'lumen-kcv-v1:', 'lumen-kcv-v1:PROVEN', 'proven']) {
      expect(readKcvPlaintext(junk), junk).toBe('bad');
    }
  });

  it('the two markers are distinct, so one cannot be read as the other', () => {
    expect(kcvPlaintext('proven')).not.toBe(kcvPlaintext('bootstrap'));
    // And neither equals the legacy constant, or upgrading would be a no-op.
    expect(kcvPlaintext('proven')).not.toBe(KCV_PLAINTEXT_V1);
  });

  it('THE REGRESSION, end to end: bootstrap then re-unlock stays asserted', () => {
    // Exactly what was observed. Unlock #1 on an empty device:
    const first = decideUnlock('signature', evidenceFrom('no-data', 'none'));
    expect(first.admit && first.trust).toBe('asserted');
    expect(first.admit && first.writeKcv).toBe('bootstrap');

    // Unlock #2 matches the KCV that unlock #1 just wrote. Before this fix that
    // was 'proven-kcv' and the user was told nothing at all, on a device where
    // their journal had never once been decrypted.
    const stored = readKcvPlaintext(kcvPlaintext(first.admit ? first.writeKcv! : 'bootstrap'));
    const second = decideUnlock('signature', evidenceFrom('no-data', stored));
    expect(second.admit && second.trust).toBe('asserted');

    // And after a restore actually decrypts something, it IS proven.
    const third = decideUnlock('signature', evidenceFrom('proven', 'none'));
    expect(third.admit && third.trust).toBe('proven');
    expect(third.admit && third.writeKcv).toBe('proven');
  });
});
