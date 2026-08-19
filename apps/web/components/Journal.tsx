'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AttestationInfo, JournalTurn } from '@lumen/shared';
import { AppHeader } from './AppHeader';
import { DailyPrompt } from './DailyPrompt';
import { JournalComposer } from './JournalComposer';
import { MemoryStrip } from './MemoryStrip';
import { ReflectionCard } from './ReflectionCard';
import { AttestationViewer } from './AttestationViewer';
import { ChainGuardBanner } from './ChainGuardBanner';
import { LockIcon, SparkIcon } from './icons';
import { activeNetwork } from '@/lib/0g/network';
import { useJournalMemory } from '@/lib/hooks/useJournalMemory';
import { useStreamingReflection } from '@/lib/hooks/useStreamingReflection';
import { preloadEmbedder } from '@/lib/memory/embeddings';
import { recallRelevant } from '@/lib/memory/recall';
import { buildContextWithRecall, newTurnId } from '@/lib/memory/session';
import { promptOfTheDay } from '@/lib/prompts';

function formatJournalDate(date: Date, timeZone?: string): string {
  return date.toLocaleDateString('en-GB', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(timeZone ? { timeZone } : {}),
  });
}

export function Journal({ live, voiceLive = false }: { live: boolean; voiceLive?: boolean }) {
  const memory = useJournalMemory();
  const [activeEntry, setActiveEntry] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [viewer, setViewer] = useState<AttestationInfo | null>(null);
  const { text, attestation, status, error, reflect, reset } = useStreamingReflection();

  const prompt = useMemo(() => promptOfTheDay(), []);
  // The date must render identically on server and client or React bails out
  // of hydration (#418): the server's locale/timezone is not the reader's.
  // Render the deterministic UTC form first, then correct to local after mount.
  const [dateLabel, setDateLabel] = useState(() => formatJournalDate(new Date(), 'UTC'));
  useEffect(() => {
    setDateLabel(formatJournalDate(new Date()));
  }, []);

  const streaming = status === 'streaming';
  const turns = memory.turns;

  // Warm the on-device embedder once the user actually journals (anon users
  // included), so recall never cold-starts on the submit path.
  useEffect(() => {
    if (turns.length > 0) preloadEmbedder();
  }, [turns.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(entry: string) {
    if (submitting || streaming) return;
    setSubmitting(true);
    setActiveEntry(entry);
    try {
      // Recall reaches beyond the session window; it is budgeted (2.5s) and
      // failure-proof — the reflection always starts promptly.
      const recalled = await recallRelevant(entry, turns);
      const result = await reflect(buildContextWithRecall(turns, recalled, entry, prompt));
      if (result && result.text) {
        const turn: JournalTurn = {
          id: newTurnId(),
          entry,
          reflection: result.text,
          attestation: result.attestation,
          createdAt: new Date().toISOString(),
        };
        memory.addTurn(turn);
        setActiveEntry(null);
        reset();
      }
    } finally {
      setSubmitting(false);
    }
  }

  const past = [...turns].reverse();

  return (
    <div className="min-h-dvh">
      <AppHeader />

      <main className="mx-auto max-w-2xl px-5 pb-28 pt-9">
        <DailyPrompt prompt={prompt} dateLabel={dateLabel} />

        <JournalComposer
          onSubmit={handleSubmit}
          disabled={streaming || submitting}
          voiceLive={voiceLive}
        />

        <TrustLine live={live} />

        <ChainGuardBanner />

        <MemoryStrip memory={memory} />

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
        Every reflection is checked in your browser against the enclave&apos;s signature — no wallet
        needed. Tap the badge on any reply to inspect the proof.
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
    <div className="mt-14 flex flex-col items-center gap-4 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-accent-soft text-accent">
        <SparkIcon />
      </span>
      <p className="max-w-sm text-sm leading-relaxed text-muted">
        A private place to think. No wallet needed to begin.
      </p>
      <ol className="max-w-sm space-y-1.5 text-xs leading-relaxed text-muted">
        <li>1 · Write freely — reflections run inside a hardware enclave.</li>
        <li>2 · Tap the 🔒 badge on any reply to inspect the proof.</li>
        <li>3 · When it&apos;s worth keeping: one signature encrypts your journal with a key only
          your wallet holds, and saves it to 0G — yours, provably.</li>
      </ol>
    </div>
  );
}

function SiteFooter() {
  const net = activeNetwork();
  return (
    <footer className="border-t border-border/70">
      <div className="mx-auto max-w-2xl px-5 py-6 text-xs leading-relaxed text-muted">
        <p>
          <span className="font-serif text-sm text-ink">Lumen</span> — own your mind, prove your
          privacy. Built on 0G: TEE inference verified in your browser, encrypted memory on 0G
          Storage, and an ERC-7857 companion you own.
        </p>
        {/* Verifiable, not decorative: same frozen network object the uploader reads. */}
        <p className="mt-1.5">
          Running on <span className="font-medium text-ink">{net.label}</span> · chain{' '}
          {net.chainId} ·{' '}
          <a
            href={net.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-ink hover:underline"
          >
            {new URL(net.explorerUrl).host}
          </a>
        </p>
      </div>
    </footer>
  );
}
