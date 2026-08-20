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
      // Return focus to the trigger. Guarded because the opener can be gone by
      // now — an entry deleted from the library takes its own delete button
      // with it.
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [preferred, autoFocus]);

  return containerRef;
}
