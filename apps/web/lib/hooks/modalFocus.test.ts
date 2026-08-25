import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { __openDialogCount, __scrollLockCount } from './useModalFocus';

/**
 * Stacked dialogs.
 *
 * The Tab handler lives on `document`, so without a stack two open dialogs each
 * see "focus is outside MY container" and each corrects it — on the same
 * keypress, both calling preventDefault. With MemoryLibrary and
 * DeleteEntryDialog open together (a normal flow: deleting from the library does
 * not close the library) every Tab landed on the delete dialog's close button
 * and every Shift+Tab on its last element, so "Keep it" and "Delete" could not
 * be reached by keyboard at all — on a destructive dialog.
 *
 * The hook is not render-tested here (no React Testing Library in this repo, by
 * convention), so these assert the module-level invariants directly plus the
 * source shape that keeps them true.
 */
describe('the dialog stack starts empty and balances', () => {
  it('holds nothing when no dialog is mounted', () => {
    expect(__openDialogCount()).toBe(0);
    expect(__scrollLockCount()).toBe(0);
  });
});

describe('useModalFocus owns the scroll lock', () => {
  const src = readFileSync(join(process.cwd(), 'lib/hooks/useModalFocus.ts'), 'utf8');

  it('refcounts rather than setting and clearing unconditionally', () => {
    // Each dialog used to lock and unlock body.overflow itself, so whichever
    // unmounted first unlocked the page while the other was still modal.
    expect(src).toContain('scrollLocks');
    expect(src).toMatch(/scrollLocks === 0/);
  });

  it('restores the previous overflow rather than assuming it was empty', () => {
    expect(src).toContain('restoreOverflow');
  });

  it('only the topmost dialog traps Tab', () => {
    expect(src).toMatch(/openDialogs\[openDialogs\.length - 1\] !== container/);
  });

  it('NO dialog manages body.overflow itself any more', () => {
    // Nine components used to. Duplicated, and subtly different in each.
    const dialogs = [
      'AttestationViewer', 'DeleteEntryDialog', 'MemoryLibrary', 'MintCompanionSheet',
      'OnboardingSheet', 'PracticeArchive', 'RecoveryKeyModal', 'SealSheet',
      'StorageReceiptViewer',
    ];
    for (const name of dialogs) {
      const body = readFileSync(join(process.cwd(), 'components', `${name}.tsx`), 'utf8');
      expect(body.length, `${name} unreadable — this check would be vacuous`).toBeGreaterThan(0);
      expect(body, `${name} still locks scrolling itself`).not.toContain('body.style.overflow');
    }
  });
});

describe('RecoveryKeyModal does not wipe the key on a parent re-render', () => {
  const src = readFileSync(join(process.cwd(), 'components/RecoveryKeyModal.tsx'), 'utf8');

  it('keeps the secret wipe in a mount-only effect', () => {
    // Bundled with the Escape listener on [onClose] — and MemoryStrip passes a
    // fresh inline arrow every render — the wipe fired whenever the parent
    // re-rendered. Revealing the key was itself the trigger: the wallet popup
    // returns focus, TanStack refetches useCompanion's stale reads, Journal
    // re-renders, and the key the user just signed for disappeared.
    const wipe = src.indexOf('setHex(null)');
    expect(wipe).toBeGreaterThan(-1);
    // The effect containing the wipe must close with an empty dep array.
    const after = src.slice(wipe);
    const deps = /\}, (\[[^\]]*\])\);/.exec(after);
    expect(deps, 'could not find the enclosing effect deps').not.toBeNull();
    expect(deps![1]!.replace(/\s/g, '')).toBe('[]');
  });

  it('still wipes at all — the security property must survive the fix', () => {
    expect(src).toContain('setHex(null)');
    expect(src).toContain('setTrust(null)');
  });
});

describe('the composer keeps focus while a reflection runs', () => {
  const src = readFileSync(join(process.cwd(), 'components/JournalComposer.tsx'), 'utf8');

  it('uses readOnly on the textarea, never disabled', () => {
    // Disabling a focused element blurs it to <body>, and nothing here
    // refocuses it — so submitting with the keyboard threw focus away for the
    // whole several-second round trip.
    const ta = src.slice(src.indexOf('<textarea'), src.indexOf('</div>', src.indexOf('<textarea')));
    expect(ta).toContain('readOnly={disabled}');
    expect(ta).not.toMatch(/\bdisabled=\{disabled\}/);
  });

  it('marks the busy state for assistive tech', () => {
    expect(src).toContain('aria-busy={disabled}');
  });

  it('still disables the submit BUTTON — only the textarea keeps focus', () => {
    expect(src).toMatch(/disabled=\{disabled \|\| value\.trim\(\)\.length === 0\}/);
  });
});
