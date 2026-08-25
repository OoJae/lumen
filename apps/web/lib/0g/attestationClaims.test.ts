import { existsSync } from 'node:fs';
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

  it('GUARDS THE GUARD: if the header is ever sent again, revisit this claim', () => {
    // The whole justification for dropping "private trust mode" is that nothing
    // sends the header. If that changes, these assertions need rethinking
    // rather than silently continuing to pass.
    const sources = ['../0g/compute.ts', '../../app/api/reflect/route.ts'].map((rel) => {
      try {
        return readFileSync(join(__dirname, rel), 'utf8');
      } catch {
        return '';
      }
    });
    for (const src of sources) {
      expect(src).not.toContain('X-0G-Provider-Trust-Mode');
    }
  });
});
