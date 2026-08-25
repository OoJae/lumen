'use client';

/**
 * Tell the other tabs something changed.
 *
 * The data corruption two tabs could cause is already fixed: `toZg` re-reads
 * the pointer and the stored turns from IndexedDB before it builds a snapshot,
 * so a stale tab can no longer reissue a published `seq` or fork the chain.
 * What that fix does NOT do is make the stale tab's SCREEN right. It still
 * shows the old receipt, the old entry list, and a "Save to 0G" button offering
 * to publish work the other tab already published — the user is told something
 * untrue until they reload.
 *
 * So this is a nudge, not a transport. The message carries no journal content
 * and no key material: only which wallet changed and roughly what. The
 * receiving tab re-reads its own IndexedDB, which it can already do and which
 * is the only place either tab trusts anyway. That keeps plaintext off the
 * channel entirely rather than relying on same-origin to make it acceptable,
 * and it means a message that arrives out of order or twice costs a re-read
 * rather than corrupting anything.
 *
 * BroadcastChannel does not deliver a message to the tab that posted it, so
 * there is no self-echo to guard against.
 */

/** What changed. The receiver decides how expensive a response is warranted. */
export type TabSyncKind =
  /**
   * The 0G pointer moved — another tab saved. Cheap to absorb: re-read the
   * pointer, no decryption.
   */
  | 'pointer'
  /**
   * Entries were added or removed. Absorbing this means decrypting, so it is a
   * separate kind rather than folded into 'pointer'.
   */
  | 'turns';

export interface TabSyncMessage {
  kind: TabSyncKind;
  /** Lowercase address. A message for another wallet is not ours to act on. */
  wallet: string;
  /** Network key, so a mainnet tab ignores a testnet tab's pointer. */
  network: string;
  /** Millisecond timestamp, for ordering and for ignoring anything absurd. */
  at: number;
}

export const TAB_SYNC_CHANNEL = 'lumen-tab-sync';

/** Anything older than this is a resumed background tab replaying history. */
export const TAB_SYNC_MAX_AGE_MS = 60_000;

/**
 * Should this tab act on a message?
 *
 * Pure, because every reason to say no is a reason a bug would be invisible:
 * acting on another wallet's message would make one wallet's UI reflect
 * another's, and acting on a message from the other network would show a
 * mainnet user their testnet pointer.
 */
export function shouldApply(
  message: unknown,
  self: { wallet: string | null; network: string; now: number },
): message is TabSyncMessage {
  if (!message || typeof message !== 'object') return false;
  const m = message as Partial<TabSyncMessage>;
  if (m.kind !== 'pointer' && m.kind !== 'turns') return false;
  if (typeof m.wallet !== 'string' || typeof m.network !== 'string') return false;
  if (typeof m.at !== 'number' || !Number.isFinite(m.at)) return false;
  // Locked or disconnected: there is no key to re-read with, and unlocking
  // hydrates from scratch anyway.
  if (!self.wallet) return false;
  if (m.wallet.toLowerCase() !== self.wallet.toLowerCase()) return false;
  if (m.network !== self.network) return false;
  // A tab that was suspended for an hour should not replay a stale burst on
  // wake; it will re-read on its own terms.
  if (self.now - m.at > TAB_SYNC_MAX_AGE_MS) return false;
  // Clock skew between tabs is possible but small; a message from the future by
  // more than the window is not something to act on.
  if (m.at - self.now > TAB_SYNC_MAX_AGE_MS) return false;
  return true;
}

/**
 * The strongest kind wins when several arrive together.
 *
 * A save writes entries and moves the pointer, so both kinds can land in the
 * same tick. Re-reading turns also re-reads everything cheaper, so collapsing
 * to 'turns' is correct rather than merely convenient.
 */
export function strongest(kinds: readonly TabSyncKind[]): TabSyncKind | null {
  if (kinds.length === 0) return null;
  return kinds.includes('turns') ? 'turns' : 'pointer';
}

type Channel = { postMessage(data: unknown): void; close(): void };

/**
 * Open the channel, or return a no-op.
 *
 * Absent during SSR and in browsers without BroadcastChannel, and this is a
 * convenience — never let its absence break journaling.
 */
export function openTabSync(onMessage: (data: unknown) => void): {
  post: (kind: TabSyncKind, wallet: string, network: string) => void;
  close: () => void;
} {
  let channel: Channel | null = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel(TAB_SYNC_CHANNEL);
      bc.onmessage = (event: MessageEvent) => onMessage(event.data);
      channel = bc;
    }
  } catch {
    // Some privacy modes throw on construction. Single-tab behaviour is fine.
  }

  return {
    post(kind, wallet, network) {
      try {
        channel?.postMessage({ kind, wallet, network, at: Date.now() } satisfies TabSyncMessage);
      } catch {
        // A failed nudge costs the other tab a stale view until it reloads —
        // never the write that just succeeded here.
      }
    },
    close() {
      try {
        channel?.close();
      } catch {
        // Already gone.
      }
      channel = null;
    },
  };
}
