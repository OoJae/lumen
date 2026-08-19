/**
 * What Lumen is allowed to say when you delete an entry.
 *
 * Pure, and tested, for the same reason saveErrorCopy.ts is: this is the single
 * highest-risk sentence in the product. A delete dialog is exactly where an app
 * reaches for "permanently erased everywhere", and here that would be false —
 * a snapshot already uploaded to 0G cannot be unpublished by anyone, including
 * us. Overclaiming it would undo the one thing this product is for.
 *
 * The opposite failure matters too. Telling someone their words are scattered
 * irretrievably across a public network, when in fact the bytes are ciphertext
 * only their wallet can open, would be scaremongering. Both are lies.
 *
 * So every branch states three things: what is removed, what is not, and what
 * that practically means.
 */
import type { StorageReceipt } from '@lumen/shared';

export interface DeleteCopyInput {
  /** Receipt for the ACTIVE network, if this device has ever saved. */
  receipt: StorageReceipt | null;
  /** A snapshot exists only on the other network. */
  foreign: StorageReceipt | null;
  /** The root the companion is anchored to, if any. */
  anchoredRoot: string | null;
  networkLabel: string;
}

export interface DeleteCopy {
  title: string;
  /** What deleting actually removes. */
  removed: string;
  /** What it cannot remove. Null only when nothing has ever left the device. */
  notRemoved: string | null;
  /** The on-chain consequence, when a companion is anchored. */
  anchored: string | null;
  otherDevices: string;
  finality: string;
  confirm: string;
  cancel: string;
}

function shortRoot(root: string): string {
  return root.length <= 18 ? root : `${root.slice(0, 10)}…${root.slice(-8)}`;
}

function entries(n: number): string {
  return `${n} ${n === 1 ? 'entry' : 'entries'}`;
}

const REMOVED =
  'The entry and its search vector are deleted from this device, and they will not be in ' +
  'any snapshot you save from now on. Lumen keeps one marker — the entry’s id and the time ' +
  'you deleted it — so restoring an older snapshot cannot bring it back. That marker travels ' +
  'in your future snapshots, which is what keeps it deleted on your other devices too.';

const NOTHING_SAVED =
  'This entry has never left this device, so there is no snapshot and no on-chain record to undo.';

export function deleteCopy(input: DeleteCopyInput): DeleteCopy {
  const { receipt, foreign, anchoredRoot, networkLabel } = input;
  const snapshot = receipt ?? foreign;

  let notRemoved: string | null = null;
  if (!snapshot) {
    notRemoved = NOTHING_SAVED;
  } else {
    const where = receipt ? networkLabel : `0G ${snapshot.network}`;
    notRemoved =
      `Your last snapshot on ${where} — ${shortRoot(snapshot.rootHash)}, ` +
      `${entries(snapshot.turnCount)}, saved ${snapshot.savedAt.slice(0, 10)} — was uploaded ` +
      // Deliberately conditional. Lumen cannot know whether THIS id was in that
      // upload without downloading and decrypting it, and comparing createdAt
      // against savedAt is the clock-skew guess this codebase refuses to make
      // elsewhere. A sentence that is exactly true beats a confident wrong one.
      'before this delete, so if this entry was in it, it still is. That snapshot stays ' +
      'retrievable from 0G by anyone holding its root hash, and stays decryptable only by ' +
      'your wallet’s key. Nobody can unpublish it, including us. Save to 0G after deleting ' +
      'and your newest snapshot will not contain it; the older one still will.';
  }

  const anchored = anchoredRoot
    ? `Your companion on ${networkLabel} is anchored to ${shortRoot(anchoredRoot)}, so that root ` +
      'is a public, permanent record too. Saving and re-anchoring points your companion at a ' +
      'snapshot without this entry; the old root stays in the anchor history for anyone to see.'
    : null;

  return {
    title: 'Delete this entry?',
    removed: REMOVED,
    notRemoved,
    anchored,
    otherDevices:
      'Other devices that already hold this entry keep their copy until they restore from a ' +
      'snapshot you save after this.',
    finality: 'This cannot be undone.',
    confirm: 'Delete entry',
    cancel: 'Keep it',
  };
}

/**
 * The non-blocking nudge after a delete: what the last snapshot still holds,
 * and what saving does about it. Never claims saving removes anything from 0G.
 */
export function deletedNotSavedNotice(
  deletedSinceSave: number,
  receipt: StorageReceipt | null,
  anchored: boolean,
): string | null {
  if (deletedSinceSave <= 0 || !receipt) return null;
  const head =
    `${entries(deletedSinceSave)} you deleted ${deletedSinceSave === 1 ? 'is' : 'are'} still in ` +
    'your last snapshot on 0G. Save to 0G to publish one without ' +
    `${deletedSinceSave === 1 ? 'it' : 'them'} — the old snapshot stays where it is.`;
  return anchored ? `${head} Then anchor it so your companion points at the new one.` : head;
}

/** Shown when the device holds nothing but a saved snapshot still does. */
export function emptiedNotice(receipt: StorageReceipt): string {
  return (
    'Nothing is on this device now. Your last snapshot on 0G still holds ' +
    `${entries(receipt.turnCount)}. Save to 0G to publish an empty one — the old snapshot ` +
    'stays retrievable.'
  );
}

/** Shown after a restore that honoured deletions. */
export function restoreSkippedNotice(restored: number, skippedDeleted: number): string | null {
  if (skippedDeleted <= 0) return null;
  return (
    `Restored ${entries(restored)}. ${entries(skippedDeleted)} you deleted ` +
    `${skippedDeleted === 1 ? 'was' : 'were'} not restored.`
  );
}
