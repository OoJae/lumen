'use client';

import { useMemo, useState } from 'react';
import type { AttestationInfo, JournalTurn } from '@lumen/shared';
import { AppHeader } from './AppHeader';
import { DailyPrompt } from './DailyPrompt';
import { JournalComposer } from './JournalComposer';
import { ReflectionCard } from './ReflectionCard';
import { AttestationViewer } from './AttestationViewer';
import { LockIcon, SparkIcon } from './icons';
import { useStreamingReflection } from '@/lib/hooks/useStreamingReflection';
import { buildContext, newTurnId } from '@/lib/memory/session';
import { promptOfTheDay } from '@/lib/prompts';

export function Journal({ live }: { live: boolean }) {
  const [turns, setTurns] = useState<JournalTurn[]>([]);
  const [activeEntry, setActiveEntry] = useState<string | null>(null);
  const [viewer, setViewer] = useState<AttestationInfo | null>(null);
  const { text, attestation, status, error, reflect, reset } = useStreamingReflection();

  const prompt = useMemo(() => promptOfTheDay(), []);
  const dateLabel = useMemo(
    () => new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
    [],
  );

  const streaming = status === 'streaming';

  async function handleSubmit(entry: string) {
    setActiveEntry(entry);
    const result = await reflect(buildContext(turns, entry));
    if (result && result.text) {
      const turn: JournalTurn = {
        id: newTurnId(),
        entry,
        reflection: result.text,
        attestation: result.attestation,
        createdAt: new Date().toISOString(),
      };
      setTurns((prev) => [...prev, turn]);
      setActiveEntry(null);
      reset();
    }
  }

  const past = [...turns].reverse();

  return (
    <div className="min-h-dvh">
      <AppHeader />

      <main className="mx-auto max-w-2xl px-5 pb-28 pt-9">
        <DailyPrompt prompt={prompt} dateLabel={dateLabel} />

        <JournalComposer onSubmit={handleSubmit} disabled={streaming} />

        <TrustLine live={live} />

        {activeEntry && (
          <div className="mt-8">
            <ReflectionCard
              entry={activeEntry}
              reflection={text}
              attestation={attestation}
              streaming={streaming}
              onOpenAttestation={(a) => setViewer(a)}
            />
            {status === 'error' && (
              <p className="mt-2 text-sm text-red-500">
                {error ?? 'Something went wrong'} — please try again.
              </p>
            )}
          </div>
        )}

        {past.length > 0 && (
          <div className="mt-8 space-y-5">
            {past.map((turn) => (
              <ReflectionCard
                key={turn.id}
                entry={turn.entry}
                reflection={turn.reflection}
                attestation={turn.attestation}
                onOpenAttestation={(a) => setViewer(a)}
              />
            ))}
          </div>
        )}

        {turns.length === 0 && !activeEntry && <EmptyState />}
      </main>

      {viewer && <AttestationViewer attestation={viewer} onClose={() => setViewer(null)} />}

      <SiteFooter />
    </div>
  );
}

function TrustLine({ live }: { live: boolean }) {
  if (live) {
    return (
      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
        <LockIcon width={12} height={12} />
        Every reflection runs in 0G&apos;s private trust mode inside a hardware TEE. Tap the badge on
        any reply to inspect the proof.
      </p>
    );
  }
  return (
    <p className="mt-3 flex items-start gap-1.5 text-xs text-caution">
      <LockIcon width={12} height={12} className="mt-0.5 shrink-0" />
      <span>
        Demo mode — no 0G Compute key configured, so replies are clearly-labeled mocks (not real
        TEE). Set <code className="font-mono">ZG_COMPUTE_API_KEY</code> for live Sealed Inference.
      </span>
    </p>
  );
}

function EmptyState() {
  return (
    <div className="mt-14 flex flex-col items-center gap-3 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-accent-soft text-accent">
        <SparkIcon />
      </span>
      <p className="max-w-sm text-sm leading-relaxed text-muted">
        A private place to think. Write a line above — Lumen will reflect, and remember you within
        this session. No wallet needed to begin.
      </p>
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-border/70">
      <div className="mx-auto max-w-2xl px-5 py-6 text-xs leading-relaxed text-muted">
        <p>
          <span className="font-serif text-sm text-ink">Lumen</span> — own your mind, prove your
          privacy. Built on 0G: Compute (TEE inference) today; Storage, ERC-7857 ownership, and
          payments across Waves 2–4.
        </p>
      </div>
    </footer>
  );
}
