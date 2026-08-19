'use client';

import { useState } from 'react';

import type { AttestationInfo, JournalTurn } from '@lumen/shared';
import { AttestationBadge } from './AttestationBadge';

/**
 * "Drew on N earlier entries" — the anti-creep affordance.
 *
 * Cross-entry memory is the most-loved feature in AI journaling and, per CHI
 * 2026 research on ChatGPT's memory, the one that most often unsettles people:
 * users report negative expectancy violations on discovering what a system
 * remembered about them. The fix is not less memory, it is memory you can see.
 * Lumen computes the recall set anyway; showing it costs nothing and is the one
 * thing a server-side competitor structurally cannot offer, because theirs
 * would mean displaying a profile they built about you.
 */
function RecallChip({ recalled }: { recalled: JournalTurn[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] text-muted underline decoration-dotted underline-offset-2 hover:text-ink"
        aria-expanded={open}
      >
        Drew on {recalled.length} earlier {recalled.length === 1 ? 'entry' : 'entries'}
        {open ? ' ▴' : ' ▾'}
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5 border-l-2 border-border pl-3">
          {recalled.map((turn) => (
            <li key={turn.id} className="text-xs leading-relaxed text-muted">
              <span className="text-muted/70">{turn.createdAt.slice(0, 10)}</span> — {turn.entry}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ReflectionCard({
  entry,
  reflection,
  attestation,
  recalled,
  streaming = false,
  onOpenAttestation,
}: {
  entry: string;
  reflection: string;
  attestation: AttestationInfo | null;
  /** Earlier entries fed to the model for this reflection, if any. */
  recalled?: JournalTurn[];
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

      {recalled && recalled.length > 0 && <RecallChip recalled={recalled} />}

      {attestation && (
        <div className="mt-4">
          <AttestationBadge attestation={attestation} onClick={() => onOpenAttestation(attestation)} />
        </div>
      )}
    </article>
  );
}
