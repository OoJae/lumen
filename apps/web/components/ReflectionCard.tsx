'use client';

import type { AttestationInfo } from '@lumen/shared';
import { AttestationBadge } from './AttestationBadge';

export function ReflectionCard({
  entry,
  reflection,
  attestation,
  streaming = false,
  onOpenAttestation,
}: {
  entry: string;
  reflection: string;
  attestation: AttestationInfo | null;
  streaming?: boolean;
  onOpenAttestation: (a: AttestationInfo) => void;
}) {
  return (
    <article className="animate-rise rounded-2xl border border-border bg-surface p-5">
      <div className="mb-4 border-l-2 border-accent/40 pl-3.5">
        <p className="mb-0.5 text-[11px] uppercase tracking-[0.14em] text-muted">You wrote</p>
        <p className="writing whitespace-pre-wrap text-[1.05rem] leading-relaxed text-muted">
          {entry}
        </p>
      </div>

      <div>
        <p className="mb-1 text-[11px] uppercase tracking-[0.14em] text-accent/80">Lumen</p>
        {reflection ? (
          <p className={`writing whitespace-pre-wrap text-ink ${streaming ? 'caret' : ''}`}>
            {reflection}
          </p>
        ) : (
          <p className="writing text-muted/80">Reflecting…</p>
        )}
      </div>

      {attestation && (
        <div className="mt-4">
          <AttestationBadge attestation={attestation} onClick={() => onOpenAttestation(attestation)} />
        </div>
      )}
    </article>
  );
}
