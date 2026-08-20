import { describe, expect, it } from 'vitest';

import { encryptBytes, type EncryptedEnvelope } from './encrypt';
import { deriveAesKey } from './keys';
import {
  decideExport,
  decideUnlock,
  evidenceFrom,
  probeArtifacts,
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
  'refuted-data',
  'refuted-kcv',
  'no-evidence',
];

describe('evidenceFrom — ciphertext outranks the KCV', () => {
  it('lets real data decide, whatever the KCV says', () => {
    for (const kcv of ['ok', 'bad', 'none'] as KcvStatus[]) {
      expect(evidenceFrom('proven', kcv), kcv).toBe('proven-data');
      expect(evidenceFrom('refuted', kcv), kcv).toBe('refuted-data');
    }
  });

  it('falls back to the KCV only when there is no data', () => {
    expect(evidenceFrom('no-data', 'ok')).toBe('proven-kcv');
    expect(evidenceFrom('no-data', 'bad')).toBe('refuted-kcv');
    expect(evidenceFrom('no-data', 'none')).toBe('no-evidence');
  });
});

describe('decideUnlock — the full table', () => {
  const table: Array<[UnlockSource, KeyEvidence, string]> = [
    ['signature', 'proven-data', 'admit proven writeKcv'],
    ['signature', 'proven-kcv', 'admit proven'],
    ['signature', 'refuted-data', 'refuse signature-mismatch-data mismatch'],
    ['signature', 'refuted-kcv', 'refuse signature-mismatch-kcv mismatch'],
    ['signature', 'no-evidence', 'admit asserted writeKcv'],
    ['recovery', 'proven-data', 'admit proven writeKcv'],
    ['recovery', 'proven-kcv', 'admit proven'],
    ['recovery', 'refuted-data', 'refuse recovery-mismatch-data locked'],
    ['recovery', 'refuted-kcv', 'admit asserted'],
    ['recovery', 'no-evidence', 'admit asserted'],
  ];

  it('matches the design table in all ten cells', () => {
    for (const [source, evidence, expected] of table) {
      const d = decideUnlock(source, evidence);
      const actual = d.admit
        ? `admit ${d.trust}${d.writeKcv ? ' writeKcv' : ''}`
        : `refuse ${d.refusal} ${d.nextState}`;
      expect(actual, `${source} + ${evidence}`).toBe(expected);
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
      expect(d.writeKcv).toBe(false);
    }
  });

  it('THE FIX: a recovery key overrules a KCV that no data corroborates', () => {
    // Unsticks a device poisoned by the old unlock(), where a wrong signature
    // silently became the KCV and the correct recovery key was rejected forever.
    const d = decideUnlock('recovery', 'refuted-kcv');
    expect(d.admit).toBe(true);
    if (d.admit) expect(d.writeKcv).toBe(false);
  });

  it('THE HEAL: proving against real data always rewrites the KCV', () => {
    for (const source of ['signature', 'recovery'] as UnlockSource[]) {
      const d = decideUnlock(source, 'proven-data');
      expect(d.admit).toBe(true);
      if (d.admit) expect(d.writeKcv).toBe(true);
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
