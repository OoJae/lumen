'use client';

import { useChainGuard } from '@/lib/hooks/useChainGuard';

/**
 * Shown when the connected wallet is on a different chain than this build
 * writes to. Scope is stated precisely — writing, reflecting and unlocking all
 * still work, and the banner must not imply otherwise.
 */
export function ChainGuardBanner() {
  const guard = useChainGuard();
  if (!guard.blocked && !guard.error) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-caution/40 bg-caution/5 px-4 py-3">
      <p className="text-sm text-caution">
        {guard.error ??
          `Your wallet is on ${guard.walletChainLabel ?? 'another network'}. Lumen saves to ${guard.expectedLabel} — switch to save or restore.`}
      </p>
      <button
        type="button"
        onClick={() => void guard.switchToExpected()}
        disabled={guard.status === 'switching'}
        className="shrink-0 rounded-full border border-caution/50 px-3.5 py-1.5 text-sm font-medium text-caution transition-colors hover:border-caution disabled:opacity-50"
      >
        {guard.status === 'switching' ? 'Check your wallet…' : `Switch to ${guard.expectedLabel}`}
      </button>
    </div>
  );
}
