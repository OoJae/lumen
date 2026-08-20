'use client';

import { useEffect, useRef, useState } from 'react';

import { useModalFocus } from '@/lib/hooks/useModalFocus';

import { activeNetwork } from '@/lib/0g/network';
import { deleteCopy } from '@/lib/storage/deleteCopy';
import type { JournalMemory } from '@/lib/hooks/useJournalMemory';
import type { RecallableTurn } from '@/lib/memory/recall';
import { CloseIcon, TrashIcon } from './icons';

/**
 * The delete confirmation.
 *
 * Every sentence in here comes from lib/storage/deleteCopy.ts, which is pure
 * and unit-tested — including a test that bans "permanently", "forever",
 * "everywhere" and "erased" from every branch. A delete dialog is exactly where
 * an app reaches for those words, and here they would be false: a snapshot
 * already on 0G cannot be unpublished by anyone, us included.
 *
 * "Keep it" is the default action. The destructive button is never focused
 * first.
 */
export function DeleteEntryDialog({
  turn,
  memory,
  anchoredRoot,
  onClose,
}: {
  turn: RecallableTurn;
  memory: JournalMemory;
  anchoredRoot: string | null;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const net = activeNetwork();

  const copy = deleteCopy({
    receipt: memory.save.receipt,
    foreign: memory.save.foreignReceipt,
    anchoredRoot,
    networkLabel: net.label,
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose, busy]);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await memory.deleteTurn(turn.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
      setBusy(false);
    }
  }

  // The first focusable child is the close button; the safe action is what a
  // destructive dialog should land on.
  const keepRef = useRef<HTMLButtonElement>(null);
  const panelRef = useModalFocus<HTMLDivElement>({ preferred: keepRef });

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={busy ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Delete this entry"
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-border bg-surface p-6 shadow-2xl sm:rounded-3xl"
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft text-accent">
              <TrashIcon />
            </span>
            <p className="font-serif text-lg leading-tight text-ink">{copy.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted hover:text-ink disabled:opacity-50"
          >
            <CloseIcon />
          </button>
        </div>

        <blockquote className="mb-4 max-h-24 overflow-y-auto border-l-2 border-border pl-3 text-sm leading-relaxed text-muted">
          {turn.entry}
        </blockquote>

        <div className="space-y-3 text-sm leading-relaxed text-muted">
          <p>
            <span className="font-medium text-ink">Removed from this device.</span> {copy.removed}
          </p>
          {copy.notRemoved && (
            <p className="rounded-xl border border-border bg-canvas/40 p-3 text-xs">
              <span className="mb-1 block font-medium text-ink">What isn&apos;t removed</span>
              {copy.notRemoved}
            </p>
          )}
          {copy.anchored && <p className="text-xs">{copy.anchored}</p>}
          <p className="text-xs">{copy.otherDevices}</p>
          <p className="text-xs font-medium text-ink">{copy.finality}</p>
        </div>

        {error && <p className="mt-3 text-sm text-caution">{error}</p>}

        <div className="mt-5 flex gap-2">
          {/* Default action first, and it is the safe one. */}
          <button
            type="button"
            ref={keepRef}
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-[#fffdf8] hover:opacity-90 disabled:opacity-50"
          >
            {copy.cancel}
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className="rounded-full border border-caution/50 px-4 py-2.5 text-sm font-medium text-caution hover:border-caution disabled:opacity-50"
          >
            {busy ? 'Deleting…' : copy.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
