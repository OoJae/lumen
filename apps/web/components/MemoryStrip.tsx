'use client';

import { useState } from 'react';

import type { JournalMemory } from '@/lib/hooks/useJournalMemory';
import { CloudCheckIcon, KeyIcon, LockIcon } from './icons';
import { OnboardingSheet } from './OnboardingSheet';
import { RecoveryKeyModal } from './RecoveryKeyModal';
import { StorageReceiptViewer } from './StorageReceiptViewer';

type OpenModal = 'onboarding' | 'receipt' | 'recovery' | null;

/**
 * The memory state surface under the composer: converts "Save & own", shows
 * the locked banner, and (unlocked) the honest sync chip + Save-to-0G action.
 */
export function MemoryStrip({ memory }: { memory: JournalMemory }) {
  const [open, setOpen] = useState<OpenModal>(null);
  const { keyState, turns, lockedCount, save } = memory;

  const modal = (
    <>
      {open === 'onboarding' && (
        <OnboardingSheet
          memory={memory}
          onClose={() => setOpen(null)}
          onExportKey={() => setOpen('recovery')}
        />
      )}
      {open === 'receipt' && (
        <StorageReceiptViewer memory={memory} onClose={() => setOpen(null)} />
      )}
      {open === 'recovery' && <RecoveryKeyModal memory={memory} onClose={() => setOpen(null)} />}
    </>
  );

  if (keyState === 'no-wallet') {
    if (turns.length === 0) return modal;
    return (
      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-accent/25 bg-accent-soft/40 px-4 py-3">
        <p className="text-sm text-ink">
          Keep this? Save your journal to 0G — encrypted on this device with a key only your
          wallet holds.
        </p>
        <button
          type="button"
          onClick={() => setOpen('onboarding')}
          className="shrink-0 rounded-full bg-accent px-3.5 py-1.5 text-sm font-medium text-[#fffdf8] hover:opacity-90"
        >
          Save &amp; own
        </button>
        {modal}
      </div>
    );
  }

  if (keyState === 'locked' || keyState === 'unlocking') {
    return (
      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3">
        <p className="flex items-center gap-2 text-sm text-muted">
          <LockIcon width={14} height={14} className="shrink-0" />
          {lockedCount > 0
            ? `${lockedCount} encrypted ${lockedCount === 1 ? 'entry' : 'entries'} on this device — sign to unlock.`
            : 'Sign to unlock your private memory on this device.'}
        </p>
        <button
          type="button"
          onClick={() => setOpen('onboarding')}
          disabled={keyState === 'unlocking'}
          className="shrink-0 rounded-full border border-accent/40 bg-accent-soft px-3.5 py-1.5 text-sm font-medium text-accent hover:border-accent disabled:opacity-50"
        >
          {keyState === 'unlocking' ? 'Check your wallet…' : 'Unlock'}
        </button>
        {modal}
      </div>
    );
  }

  if (keyState === 'mismatch') {
    return (
      <div className="mt-4 rounded-xl border border-caution/40 bg-caution/5 px-4 py-3">
        <p className="text-sm text-caution">
          This wallet signed differently than when your journal was encrypted (some smart-account
          wallets do). Your data is intact — unlock it with your recovery key.
        </p>
        <button
          type="button"
          onClick={() => setOpen('onboarding')}
          className="mt-2 rounded-full border border-caution/50 px-3.5 py-1.5 text-sm font-medium text-caution hover:border-caution"
        >
          Use recovery key
        </button>
        {modal}
      </div>
    );
  }

  // unlocked
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2.5">
      <SyncChip memory={memory} onOpenReceipt={() => setOpen('receipt')} />
      {save.dirty && (
        <button
          type="button"
          onClick={() => void save.toZg().catch(() => {})}
          disabled={save.state === 'saving'}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-xs font-medium text-[#fffdf8] hover:opacity-90 disabled:opacity-50"
        >
          <CloudCheckIcon width={13} height={13} />
          {save.state === 'saving' ? 'Confirm in wallet…' : 'Save to 0G'}
        </button>
      )}
      <button
        type="button"
        onClick={() => setOpen('recovery')}
        title="Export your recovery key"
        className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs text-muted hover:border-accent/40 hover:text-ink"
      >
        <KeyIcon width={12} height={12} />
        Recovery key
      </button>
      {save.state === 'error' && save.error && (
        <span className="w-full text-xs text-caution">
          {save.error.kind === 'insufficient-funds' ? (
            <>
              Your wallet needs a little testnet 0G to pay the storage fee — grab some at{' '}
              <a
                href="https://faucet.0g.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                faucet.0g.ai
              </a>
              .
            </>
          ) : (
            save.error.message
          )}
        </span>
      )}
      {modal}
    </div>
  );
}

function SyncChip({
  memory,
  onOpenReceipt,
}: {
  memory: JournalMemory;
  onOpenReceipt: () => void;
}) {
  const { save, turns } = memory;
  if (save.state === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
        Saving to 0G…
      </span>
    );
  }
  if (save.receipt) {
    const short = `${save.receipt.rootHash.slice(0, 8)}…${save.receipt.rootHash.slice(-4)}`;
    return (
      <button
        type="button"
        onClick={onOpenReceipt}
        title="View your 0G storage receipt"
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
          save.dirty
            ? 'border-border text-muted hover:border-accent/40'
            : 'border-accent/40 bg-accent-soft text-accent'
        }`}
      >
        <CloudCheckIcon width={13} height={13} />
        {save.dirty ? `On 0G: ${short} (new entries not yet saved)` : `Saved to 0G · ${short}`}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted">
      <LockIcon width={12} height={12} />
      {turns.length > 0 ? 'Encrypted on this device' : 'Unlocked — write to begin'}
    </span>
  );
}
