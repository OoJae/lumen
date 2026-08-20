/**
 * What Lumen may say about an unlocked key.
 *
 * Pure and tested for the same reason `deleteCopy.ts` is: these sentences are
 * the ones most likely to be wrong in a way that matters. Two of them were.
 *
 * The old signature-mismatch message told the user "your entries are still on
 * this device and still decrypt with your recovery key" — on a device where
 * nothing is stored, both halves are false. And nothing anywhere admitted that
 * a key might be unverified, so an `asserted` unlock looked identical to a
 * proven one.
 */
import type { KeyTrust, UnlockRefusal, UnlockSource } from './keyTrust';

export interface UnlockNoticeInput {
  trust: KeyTrust;
  source: UnlockSource;
  /** This wallet has a snapshot pointer on some network. */
  hasSnapshot: boolean;
}

export interface UnlockNotice {
  tone: 'info' | 'caution';
  title: string;
  body: string;
  /** What the user can do to turn 'asserted' into 'proven'. */
  action: 'restore' | 'export-key' | null;
}

/** null when the key is proven — say nothing when there is nothing to say. */
export function unlockNotice(input: UnlockNoticeInput): UnlockNotice | null {
  if (input.trust === 'proven') return null;

  if (input.source === 'recovery') {
    return {
      tone: 'caution',
      title: 'Unlocked with your recovery key — not checked yet',
      body:
        'Nothing is encrypted on this device yet, so Lumen has no way to check this key against ' +
        'your journal. Restore a snapshot from 0G: if it decrypts, this is the right key and ' +
        'Lumen will recognise it here from then on. If it does not, the key is wrong — and ' +
        'anything you write before then will be encrypted with it rather than with your ' +
        "journal's key.",
      action: 'restore',
    };
  }

  if (input.hasSnapshot) {
    return {
      tone: 'caution',
      title: 'Unlocked, but not checked against your journal',
      body:
        'This wallet has a snapshot on 0G, and there is nothing encrypted on this device to ' +
        'check this signature against. Restore from your root hash before writing more: if the ' +
        'snapshot decrypts, this is the right key. If it does not, your wallet is signing ' +
        'differently than when your journal was encrypted — unlock with your recovery key instead.',
      action: 'restore',
    };
  }

  return {
    tone: 'info',
    title: 'Unlocked. This is a new journal on this device.',
    body:
      'Nothing has been encrypted with this key yet, so there is nothing here for Lumen to check ' +
      'it against. Export your recovery key now — if this wallet ever signs differently, it is ' +
      'the only way back in.',
    action: 'export-key',
  };
}

/** Why an unlock was refused. Each states only what is true of that case. */
export function refusalMessage(refusal: UnlockRefusal): string {
  switch (refusal) {
    case 'signature-mismatch-data':
      return (
        'This wallet signed differently than when your journal was encrypted, so the key it ' +
        'derives does not open your entries. Nothing is lost — they are still on this device, ' +
        'and they still decrypt with your recovery key.'
      );
    case 'signature-mismatch-kcv':
      // Deliberately does NOT claim entries are intact: this case can only
      // occur on a device that holds none.
      return (
        'This wallet signed differently than the last time it unlocked on this device. Nothing ' +
        'is stored here yet, so nothing here is at risk. Unlock with your recovery key to bring ' +
        'your journal back.'
      );
    case 'recovery-mismatch-data':
      // Provable, unlike the old "doesn't match this journal": we tried it
      // against the actual entries.
      return (
        "That recovery key does not decrypt the entries on this device — check for typos and " +
        'try again. Nothing has changed.'
      );
  }
}

/** Shown once a key has demonstrably opened real data. */
export function keyConfirmedNotice(): string {
  return 'Confirmed — this key decrypted your journal. Lumen will recognise it on this device now.';
}

/** Shown beside an exported recovery key. */
export function exportTrustNotice(trust: KeyTrust): string {
  if (trust === 'proven') {
    return 'This key decrypts the journal on this device — Lumen checked before exporting it.';
  }
  return (
    'Lumen could not check this key against anything on this device, because nothing here is ' +
    'encrypted yet. It is the key your wallet’s signature derives right now. If you already ' +
    'have a recovery key, keep it — do not overwrite it with this one until you have confirmed ' +
    'this key decrypts a snapshot.'
  );
}

/** Entries on this device that were written with a DIFFERENT key. */
export function undecryptableNotice(n: number): string | null {
  if (n <= 0) return null;
  const one = n === 1;
  const subject = one ? '1 entry' : `${n} entries`;
  const they = one ? 'it is' : 'they are';
  const They = one ? 'It is' : 'They are';
  const them = one ? 'it' : 'them';
  return (
    `${subject} on this device ${one ? 'was' : 'were'} not written with this key, so ${they} not ` +
    `shown. ${They} still here, untouched — unlock with the key that wrote ${them} to read ${them}.`
  );
}

/** Local writes that failed. The UI must not keep claiming "encrypted on this
 *  device" for an entry IndexedDB rejected. */
export function persistFailureNotice(n: number): string | null {
  if (n <= 0) return null;
  const what = n === 1 ? '1 entry' : `${n} entries`;
  return (
    `${what} could not be written to this device's encrypted store, so ${n === 1 ? 'it' : 'they'} ` +
    `will be gone if you reload. Your browser may be out of space, or in a private window that ` +
    `does not allow storage. Save to 0G to keep ${n === 1 ? 'it' : 'them'}.`
  );
}
