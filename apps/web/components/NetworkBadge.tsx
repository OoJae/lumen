'use client';

import { activeNetwork } from '@/lib/0g/network';
import { useChainGuard } from '@/lib/hooks/useChainGuard';

/**
 * Which 0G network this build talks to, permanently visible.
 *
 * NEXT_PUBLIC_* is inlined at build time, so "which network am I on" is a
 * property of the deployed artifact that nothing else makes observable — a
 * dashboard value can say mainnet while the running build is testnet. This
 * badge reads the very same frozen object the uploader uses, so what a judge
 * sees cannot disagree with where the bytes actually go.
 */
export function NetworkBadge() {
  const net = activeNetwork();
  const guard = useChainGuard();

  const title = `Lumen is pointed at ${net.name} · chain ${net.chainId}`;

  if (guard.status === 'wrong-chain' || guard.status === 'switching') {
    return (
      <button
        type="button"
        onClick={() => void guard.switchToExpected()}
        disabled={guard.status === 'switching'}
        title={`${title} — your wallet is on ${guard.walletChainLabel ?? 'another network'}`}
        className="inline-flex items-center gap-1.5 rounded-full border border-caution/50 bg-caution/10 px-2.5 py-1 text-xs font-medium text-caution transition-colors hover:border-caution disabled:opacity-60"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-caution" aria-hidden />
        {guard.status === 'switching' ? 'Switching…' : 'Wrong network'}
      </button>
    );
  }

  const isMainnet = net.key === 'mainnet';
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
        isMainnet
          ? 'border-accent/40 bg-accent-soft text-accent'
          : 'border-border bg-surface-2 text-muted'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${isMainnet ? 'bg-accent' : 'bg-muted'}`}
        aria-hidden
      />
      {net.label}
    </span>
  );
}
