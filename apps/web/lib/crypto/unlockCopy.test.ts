import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { KeyTrust, UnlockRefusal, UnlockSource } from './keyTrust';
import {
  exportTrustNotice,
  keyConfirmedNotice,
  persistFailureNotice,
  refusalMessage,
  undecryptableNotice,
  unlockNotice,
} from './unlockCopy';

const SOURCES: UnlockSource[] = ['signature', 'recovery'];
const REFUSALS: UnlockRefusal[] = [
  'signature-mismatch-data',
  'signature-mismatch-kcv',
  'recovery-mismatch-data',
];

function everyAssertedNotice(): string[] {
  const out: string[] = [];
  for (const source of SOURCES) {
    for (const hasSnapshot of [false, true]) {
      const n = unlockNotice({ trust: 'asserted', source, hasSnapshot });
      if (n) out.push(`${n.title} ${n.body}`);
    }
  }
  out.push(exportTrustNotice('asserted'));
  return out;
}

describe('unlockNotice', () => {
  it('says nothing when the key is proven — from either source', () => {
    for (const source of SOURCES) {
      for (const hasSnapshot of [false, true]) {
        expect(unlockNotice({ trust: 'proven', source, hasSnapshot })).toBeNull();
      }
    }
  });

  it('always speaks when the key is only asserted', () => {
    for (const source of SOURCES) {
      for (const hasSnapshot of [false, true]) {
        expect(unlockNotice({ trust: 'asserted', source, hasSnapshot })).not.toBeNull();
      }
    }
  });

  it('points a recovery unlock at the restore that would prove it', () => {
    const n = unlockNotice({ trust: 'asserted', source: 'recovery', hasSnapshot: false })!;
    expect(n.action).toBe('restore');
    expect(n.tone).toBe('caution');
    // It must warn that writing first encrypts under a possibly-wrong key.
    expect(n.body).toContain('anything you write before then will be encrypted with it');
  });

  it('is cautious when a snapshot exists but nothing here corroborates the signature', () => {
    const n = unlockNotice({ trust: 'asserted', source: 'signature', hasSnapshot: true })!;
    expect(n.tone).toBe('caution');
    expect(n.action).toBe('restore');
    expect(n.body).toContain('unlock with your recovery key instead');
  });

  it('treats a genuinely new journal as information, not alarm', () => {
    const n = unlockNotice({ trust: 'asserted', source: 'signature', hasSnapshot: false })!;
    expect(n.tone).toBe('info');
    expect(n.action).toBe('export-key');
    expect(n.body).toContain('Export your recovery key now');
  });
});

describe('INVARIANT: an unverified key is never described as verified', () => {
  it('no asserted notice ASSERTS verification or safety', () => {
    // Targets the assertive forms only. "until you have confirmed this key
    // decrypts a snapshot" is an instruction to the user, not a claim that it
    // is confirmed — banning the bare word would forbid telling them what to do.
    const banned = [
      /\b(is|was|has been|are|were) (verified|confirmed|checked)\b/i,
      /\bLumen (verified|confirmed|checked) (this|your|it)\b/i,
      /\b(is|are) safe\b/i,
      /\bguaranteed\b/i,
      /\bknown to (work|decrypt)\b/i,
    ];
    for (const text of everyAssertedNotice()) {
      for (const pattern of banned) {
        expect(text, `${pattern} in: ${text.slice(0, 80)}`).not.toMatch(pattern);
      }
    }
  });

  it('the assertive forms WOULD be caught if they appeared', () => {
    // Guards the guard: a banned-word test that matches nothing is worthless.
    const banned = /\b(is|was|has been|are|were) (verified|confirmed|checked)\b/i;
    expect('This key is verified against your journal.').toMatch(banned);
    expect('until you have confirmed this key decrypts a snapshot').not.toMatch(banned);
  });

  it('every asserted notice admits the check did not happen', () => {
    for (const text of everyAssertedNotice()) {
      expect(text.toLowerCase(), text.slice(0, 80)).toMatch(
        /no way to check|nothing (here|for lumen)|could not check|not checked/,
      );
    }
  });

  it('the proven export notice is the only one that claims a check', () => {
    expect(exportTrustNotice('proven')).toContain('Lumen checked before exporting it');
    expect(exportTrustNotice('asserted')).toContain('could not check');
  });
});

describe('refusalMessage — each states only what is true of its case', () => {
  it('covers every refusal', () => {
    for (const r of REFUSALS) expect(refusalMessage(r).length).toBeGreaterThan(40);
  });

  it('does NOT claim entries are intact on a device that holds none', () => {
    // The old copy said "your entries are still on this device and still
    // decrypt with your recovery key" for this case. Both halves were false.
    const text = refusalMessage('signature-mismatch-kcv');
    expect(text).toContain('Nothing is stored here yet');
    expect(text).not.toMatch(/still (on this device|decrypt)/);
  });

  it('DOES reassure when entries really are present', () => {
    const text = refusalMessage('signature-mismatch-data');
    expect(text).toContain('Nothing is lost');
    expect(text).toContain('still on this device');
  });

  it('describes a wrong recovery key as a failed decrypt, which is provable', () => {
    const text = refusalMessage('recovery-mismatch-data');
    expect(text).toContain('does not decrypt the entries on this device');
    expect(text).toContain('Nothing has changed');
  });

  it('never blames the user or implies data loss', () => {
    for (const r of REFUSALS) {
      expect(refusalMessage(r), r).not.toMatch(/\b(lost forever|gone|destroyed|your fault)\b/i);
    }
  });
});

describe('undecryptableNotice', () => {
  it('is null when everything decrypted', () => {
    expect(undecryptableNotice(0)).toBeNull();
    expect(undecryptableNotice(-1)).toBeNull();
  });

  it('reads correctly for one and for many', () => {
    expect(undecryptableNotice(1)).toBe(
      '1 entry on this device was not written with this key, so it is not shown. It is still ' +
        'here, untouched — unlock with the key that wrote it to read it.',
    );
    expect(undecryptableNotice(3)).toContain('3 entries on this device were not written');
    expect(undecryptableNotice(3)).toContain('They are still here');
  });

  it('says the entries are still there rather than implying they were lost', () => {
    expect(undecryptableNotice(2)).toContain('still here, untouched');
  });
});

describe('persistFailureNotice — the write that did not happen', () => {
  it('is null when nothing failed', () => {
    expect(persistFailureNotice(0)).toBeNull();
  });

  it('says plainly that a reload loses them, and offers the way out', () => {
    const one = persistFailureNotice(1)!;
    expect(one).toContain('1 entry');
    expect(one).toContain('gone if you reload');
    expect(one).toContain('Save to 0G');
    expect(persistFailureNotice(4)).toContain('4 entries');
  });

  it('names the likely causes rather than blaming the user', () => {
    const text = persistFailureNotice(1)!;
    expect(text).toMatch(/out of space|private window/);
  });
});

describe('keyConfirmedNotice', () => {
  it('claims a decrypt, which is the thing that actually happened', () => {
    const text = keyConfirmedNotice();
    expect(text).toContain('decrypted your journal');
    expect(text).toContain('recognise it on this device');
  });
});

describe('trust values are exhaustive', () => {
  it('covers both', () => {
    const all: KeyTrust[] = ['proven', 'asserted'];
    for (const t of all) expect(exportTrustNotice(t).length).toBeGreaterThan(20);
  });
});

describe('the UI may not claim Lumen never sees the encrypted snapshot', () => {
  // It does see it. Browsers cannot reach 0G storage nodes directly (they are
  // HTTP-only), so every byte of an upload transits /api/zg/indexer and
  // /api/zg/node — Lumen's own relay. "Never sees" and "never touched" were
  // false; "cannot read" is the true and still-strong claim.
  const SURFACES = ['../../components/SealSheet.tsx', '../../components/StorageReceiptViewer.tsx'];

  it.each(SURFACES)('%s does not claim Lumen never sees or touches the bytes', (rel) => {
    const src = readFileSync(join(process.cwd(), rel.replace('../../', '')), 'utf8');
    expect(src.length, `${rel} unreadable — this check would be vacuous`).toBeGreaterThan(0);
    for (const phrase of ['never sees them', 'never touched it', 'never sees your snapshot']) {
      expect(src, phrase).not.toContain(phrase);
    }
  });

  it('the relay really is in the upload path, so the claim above is the honest one', () => {
    const zg = readFileSync(join(process.cwd(), 'lib/storage/zgStorage.ts'), 'utf8');
    expect(zg).toContain('/api/zg/indexer');
  });
});
