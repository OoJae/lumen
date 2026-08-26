import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildLiveAttestation,
  buildVerifiedAttestation,
  statusPresentation,
} from './attestation';
import manifest from '@/app/manifest';

const OPTS = {
  model: 'glm-5.1',
  inferencePath: 'gateway' as const,
  chatId: 'chat-1',
  providerAddress: '0xDB7B4653',
  disclosure: { providerType: 'TeeML', providerIdentity: '0xsigner' },
};

const PROOF = {
  chatId: 'chat-1',
  providerAddress: '0xDB7B4653',
  signedText: '{}',
  signature: '0xdead',
  signingAddress: '0xabc',
  teeSignerAddress: '0xabc',
  recovered: '0xabc',
  responseSha256: 'ff',
  verifiedAt: '2026-08-20T00:00:00.000Z',
  checks: { signature: true, responseHash: true, signerMatch: true },
};

describe('the acknowledgement caveat', () => {
  it('discloses a signer the provider has NOT acknowledged', () => {
    // /api/tee-signer has always read this flag; until now the client type
    // omitted it, so an unacknowledged registry entry printed the same
    // "Cryptographically verified" as an acknowledged one.
    const a = buildVerifiedAttestation(OPTS, PROOF, false);
    expect(a.verificationStatus).toBe('verified');
    expect(a.note).toContain('has not acknowledged');
  });

  it('says nothing extra when the signer IS acknowledged', () => {
    expect(buildVerifiedAttestation(OPTS, PROOF, true).note).not.toContain('acknowledged');
  });

  it('says nothing extra when the flag is simply absent', () => {
    // An older gateway, or a fetch that failed — absence is not a red flag,
    // and treating it as one would cry wolf on every deploy skew.
    expect(buildVerifiedAttestation(OPTS, PROOF).note).not.toContain('acknowledged');
  });

  it('still carries the derived signer, so the viewer can show the derivation', () => {
    expect(buildVerifiedAttestation(OPTS, PROOF, true).proof?.recovered).toBe('0xabc');
  });
});

describe('the installable manifest', () => {
  const m = manifest();

  it('declares an icon large enough for Chrome to offer Install', () => {
    // The bug this guards: display:'standalone' with no icons at all, which
    // silently means "never installable" on every platform.
    const big = (m.icons ?? []).filter((i) => {
      const px = Number(String(i.sizes).split('x')[0]);
      return px >= 192 && i.purpose !== 'maskable';
    });
    expect(big.length).toBeGreaterThan(0);
  });

  it('declares a maskable icon, so a circular launcher mask does not clip it', () => {
    expect((m.icons ?? []).some((i) => i.purpose === 'maskable')).toBe(true);
  });

  it('every icon it names is actually served', () => {
    // A declared-but-404 icon is worse than none: Chrome offers Install and
    // then renders a blank tile. There was no public/ directory at all before.
    for (const icon of m.icons ?? []) {
      const file = join(process.cwd(), 'public', String(icon.src));
      expect(existsSync(file), String(icon.src)).toBe(true);
    }
  });

  it('serves the apple-touch-icon the document head points at', () => {
    expect(existsSync(join(process.cwd(), 'public', 'apple-touch-icon.png'))).toBe(true);
  });
});

describe('the unverified path must never present itself as verified', () => {
  // Three linked overclaims lived here, all on the FALLBACK path — the one a
  // judge on a flaky connection is most likely to see. The badge said
  // "Verified private" in the verified tone for a response nothing had checked;
  // trustMode said 'private'; and the note said "in private trust mode". No
  // trust-mode header is sent by this app, and the 0G SDK does not send one
  // either — it reduced every custom billing header to `Authorization` alone.
  const live = buildLiveAttestation(OPTS, 'the provider no longer serves this signature');

  it('does not call an unverified response verified', () => {
    const { label, tone } = statusPresentation('attested-by-trust-mode');
    expect(tone).not.toBe('verified');
    expect(label.toLowerCase()).not.toContain('verified private');
    expect(/^verified\b/i.test(label)).toBe(false);
  });

  it('reserves the verified tone for an actual signature check', () => {
    expect(statusPresentation('verified').tone).toBe('verified');
  });

  it('claims no trust mode, because it requests none', () => {
    expect(live.trustMode).toBe('unspecified');
  });

  it('never says "private trust mode" in any note', () => {
    for (const note of [
      live.note,
      buildLiveAttestation(OPTS).note,
      buildVerifiedAttestation(OPTS, PROOF, true).note,
    ]) {
      expect(note.toLowerCase()).not.toContain('trust mode');
    }
  });

  it('says the true thing instead — the on-chain registration', () => {
    expect(live.note).toContain('registered on-chain');
    // And still admits, in the same breath, that THIS response was not checked.
    expect(live.note).toContain('NOT cryptographically verified');
  });

  it('the private-mode header IS sent — the copy must not rest on it being absent', () => {
    // This test previously asserted the OPPOSITE, by grepping compute.ts for the
    // literal 'X-0G-Provider-Trust-Mode'. It passed vacuously: the header name is
    // the constant PRIVATE_MODE_HEADER, imported from @lumen/shared, so the
    // literal never appears in that file while the header goes out on every
    // request. A guard that cannot fire is worse than no guard, because it gets
    // cited as evidence — as it was, in a commit message.
    //
    // The invariant that actually matters: Lumen REQUESTS private trust mode and
    // nothing verifies the provider honoured it, so no user-facing string may
    // present it as something attested.
    const compute = readFileSync(join(process.cwd(), 'lib/0g/compute.ts'), 'utf8');
    const models = readFileSync(
      join(process.cwd(), '..', '..', 'packages', 'shared', 'src', 'models.ts'),
      'utf8',
    );
    expect(compute.length, 'compute.ts unreadable — this check would be vacuous').toBeGreaterThan(0);
    expect(models).toContain('X-0G-Provider-Trust-Mode');
    expect(compute).toContain('PRIVATE_MODE_HEADER');
  });
});

describe('the attestation note may not contradict itself', () => {
  // It did, in the dialog this product points at as its proof: the note opened
  // "registered on-chain as running the model inside a secure enclave" and the
  // very next sentence — correctly — said the model runs at an upstream host.
  // Two adjacent sentences disagreeing is worse than either alone.
  const CENTRALIZED = { providerType: 'centralized', providerIdentity: 'aliyun' };

  it('does not place the model in the enclave for a centralized provider', () => {
    const note = buildLiveAttestation({ ...OPTS, disclosure: CENTRALIZED }, 'the provider no longer serves this signature').note;
    expect(note).toContain('upstream host');
    expect(/registered on-chain as running the model inside/i.test(note)).toBe(false);
  });

  it('says the same thing on the verified path', () => {
    const note = buildVerifiedAttestation({ ...OPTS, disclosure: CENTRALIZED }, PROOF, true).note;
    expect(note).toContain('upstream host');
    expect(/the model runs inside the enclave/i.test(note)).toBe(false);
  });

  it('still credits a genuinely in-enclave provider when there is one', () => {
    // The honest counterpart: if a provider's record says the model runs in the
    // enclave, the copy must be free to say so.
    const note = buildVerifiedAttestation(
      { ...OPTS, disclosure: { providerType: 'tee', providerIdentity: 'phala' } },
      PROOF,
      true,
    ).note;
    expect(note).toContain('runs inside the enclave itself');
  });
});
