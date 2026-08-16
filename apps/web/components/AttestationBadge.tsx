'use client';

import type { AttestationInfo } from '@lumen/shared';
import { statusPresentation } from '@/lib/0g/attestation';
import { LockIcon, ShieldIcon } from './icons';

const toneClasses: Record<string, string> = {
  verified: 'border-accent/35 bg-accent-soft text-accent hover:border-accent/70',
  demo: 'border-caution/40 bg-caution/10 text-caution hover:border-caution/70',
  muted: 'border-border bg-surface-2 text-muted hover:border-muted/50',
  alarm: 'border-red-500/60 bg-red-500/10 text-red-500 hover:border-red-500',
};

export function AttestationBadge({
  attestation,
  onClick,
}: {
  attestation: AttestationInfo;
  onClick: () => void;
}) {
  const { label, tone } = statusPresentation(attestation.verificationStatus);
  // A cryptographically verified reflection earns the shield; everything else
  // keeps the lock, so the stronger claim is visually distinct.
  const Icon = attestation.verificationStatus === 'verified' ? ShieldIcon : LockIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${toneClasses[tone]}`}
      aria-label={`${label} — view attestation details`}
    >
      <Icon width={13} height={13} />
      <span>{label}</span>
      <span className="opacity-50 transition-opacity group-hover:opacity-90">· view proof</span>
    </button>
  );
}
