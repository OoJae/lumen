'use client';

import { useEffect, useRef } from 'react';

/**
 * Make a dialog reachable, containable and returnable by keyboard.
 *
 * Nine components in this app render `role="dialog" aria-modal="true"`. Two
 * moved focus inward; none trapped Tab, and none returned focus on close. The
 * attestation viewer was the worst case, because it is the product's core
 * affordance: a keyboard user tabs to the 🔒 badge, presses Enter, and focus
 * stays on the badge — now behind a blurred overlay. Tab then walks forward
 * through every control on the page UNDERNEATH the dialog before it can reach
 * the dialog's own close button, and because scrolling is locked the focus ring
 * is usually not even visible.
 *
 * Three things, all of which a modal owes a keyboard user:
 *  1. move focus in, so the next Tab lands inside;
 *  2. keep Tab inside, so the page underneath is not silently traversable;
 *  3. put focus back where it came from, so closing a dialog does not dump you
 *     at the top of the document.
 *
 * `preferred` picks the initial target when the safest control is not the first
 * one in the DOM — the delete dialog wants "Keep it" focused, not "Delete".
 */
/**
 * Every open dialog, innermost last.
 *
 * Module-scoped because the Tab handler lives on `document`, so without it two
 * open dialogs each see "focus is outside MY container" and each corrects it —
 * on the same keypress. With MemoryLibrary and DeleteEntryDialog stacked (which
 * is a normal flow: deleting from the library does not close the library), the
 * library pulled focus in, the delete dialog then pulled it to its own first
 * element, and both called preventDefault. Every Tab landed on the delete
 * dialog's close button and every Shift+Tab on its last element, so "Keep it"
 * and "Delete" could not be reached by keyboard at all — on a destructive
 * dialog.
 */
const openDialogs: HTMLElement[] = [];

/**
 * Scroll-lock refcount.
 *
 * Each dialog used to set and clear `document.body.style.overflow` itself, so
 * whichever one unmounted first unlocked the page while the other was still
 * open and modal. Owned here now, released only when the last dialog closes.
 */
let scrollLocks = 0;
let restoreOverflow = '';

function lockScroll(): void {
  if (scrollLocks === 0) {
    restoreOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLocks++;
}

function releaseScroll(): void {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) document.body.style.overflow = restoreOverflow;
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useModalFocus<T extends HTMLElement>(options?: {
  /** Focus this instead of the first focusable child, when it exists. */
  preferred?: React.RefObject<HTMLElement | null>;
  /** Skip moving focus inward (rare — a dialog that is purely informational
   *  and whose trigger should keep focus). Trapping and restoring still apply. */
  autoFocus?: boolean;
}) {
  const containerRef = useRef<T>(null);
  const preferred = options?.preferred;
  const autoFocus = options?.autoFocus ?? true;

  useEffect(() => {
    const container = containerRef.current;
    // Whoever opened this. Captured before we move focus anywhere.
    const opener = document.activeElement as HTMLElement | null;

    if (container) openDialogs.push(container);
    lockScroll();

    function focusable(): HTMLElement[] {
      if (!container) return [];
      return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
    }

    if (autoFocus) {
      const target = preferred?.current ?? focusable()[0] ?? container;
      target?.focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !container) return;
      // Only the topmost dialog traps. Without this every stacked dialog
      // corrects focus toward itself on the same keypress.
      if (openDialogs[openDialogs.length - 1] !== container) return;
      const items = focusable();
      if (items.length === 0) {
        // Nothing to move to — keep focus here rather than letting it escape
        // to the page behind the overlay.
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;

      if (!container.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const at = container ? openDialogs.lastIndexOf(container) : -1;
      if (at >= 0) openDialogs.splice(at, 1);
      releaseScroll();
      // Return focus to the trigger. Guarded because the opener can be gone by
      // now — an entry deleted from the library takes its own delete button
      // with it.
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [preferred, autoFocus]);

  return containerRef;
}

/** Test-only: how many dialogs currently hold the trap, innermost last. */
export function __openDialogCount(): number {
  return openDialogs.length;
}

/** Test-only: the outstanding scroll-lock refcount. */
export function __scrollLockCount(): number {
  return scrollLocks;
}
