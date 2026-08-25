'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AttestationInfo, JournalTurn } from '@lumen/shared';
import { AppHeader } from './AppHeader';
import { DailyPrompt } from './DailyPrompt';
import { JournalComposer } from './JournalComposer';
import { MemoryStrip } from './MemoryStrip';
import { ReflectionCard } from './ReflectionCard';
import { AttestationViewer } from './AttestationViewer';
import { MemoryLibrary } from './MemoryLibrary';
import { DeleteEntryDialog } from './DeleteEntryDialog';
import { SealSheet } from './SealSheet';
import { PracticeArchive } from './PracticeArchive';
import { useSeal } from '@/lib/hooks/useSeal';
import { insufficientFundsRemedy, TYPICAL_SAVE_COST } from '@/lib/storage/saveErrorCopy';
import { TYPICAL_ANCHOR_COST } from '@/lib/0g/companion';
import { useCompanion } from '@/lib/hooks/useCompanion';
import type { RecallableTurn } from '@/lib/memory/recall';
import { BookIcon } from './icons';
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
  // Owned here, passed to MemoryStrip, and read by the delete dialog — which
  // needs to know whether a root is anchored to say what deleting can and
  // cannot undo. One instance, so there is only ever one tx state machine.
  const companion = useCompanion(memory);
  // Owned here for the same reason companion is: the run must survive the sheet
  // closing, because step 1 costs real money and forgetting it would charge the
  // user twice.
  const seal = useSeal(memory, companion);
  const net = activeNetwork();

  // The on-chain half of "this wallet has a journal somewhere else". It is the
  // half that matters most: an anchored root can exist with NO local pointer —
  // a new device, a new browser profile, cleared site data — which is exactly
  // when an unproven key must be told to restore before writing, not to start
  // a new journal. The contract read resolves after the unlock, which is why
  // the notice is derived rather than captured. `useJournalMemory` reports the
  // local half; this only ever adds to it.
  const { reportSnapshot } = memory;
  useEffect(() => {
    if (companion.onChainRoot) reportSnapshot(true);
  }, [companion.onChainRoot, reportSnapshot]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [activeEntry, setActiveEntry] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [viewer, setViewer] = useState<AttestationInfo | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RecallableTurn | null>(null);
  // Which earlier entries the companion drew on, per reflection. Session-only
  // and deliberately NOT persisted: putting provenance on JournalTurn would
  // change the on-disk format, and this is worth showing, not storing.
  const [recalledBy, setRecalledBy] = useState<Record<string, JournalTurn[]>>({});

  // Drop recall provenance when the wallet changes. useJournalMemory clears
  // `turns` on a wallet switch, but this map holds references to the SAME
  // decrypted turn objects — so without this, wallet A's entries stayed live in
  // Journal's state, and readable through the recall chip, after switching to
  // wallet B. Journal is never remounted, so nothing else would clear it.
  useEffect(() => {
    setRecalledBy({});
  }, [memory.wallet]);
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

  /** Returns true only when the entry is safely in memory, so the composer
   *  knows whether it may clear the box. */
  async function handleSubmit(entry: string): Promise<boolean> {
    if (submitting || streaming) return false;
    setSubmitting(true);
    setActiveEntry(entry);
    try {
      // Recall reaches beyond the session window; it is budgeted (2.5s) and
      // failure-proof — the reflection always starts promptly.
      const recalled = await recallRelevant(entry, turns);
      const result = await reflect(buildContextWithRecall(turns, recalled, entry, prompt));
      if (result && result.text) {
        const turnRecall = recalled;
      const turn: JournalTurn = {
          id: newTurnId(),
          entry,
          reflection: result.text,
          attestation: result.attestation,
          createdAt: new Date().toISOString(),
        };
        memory.addTurn(turn);
        if (turnRecall.length > 0) {
          setRecalledBy((prev) => ({ ...prev, [turn.id]: turnRecall }));
        }
        setActiveEntry(null);
        reset();
        return true;
      }
      // No reflection: the entry is nowhere yet. Say so by returning false,
      // which leaves the words in the composer instead of discarding them.
      setActiveEntry(null);
      return false;
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

        <MemoryStrip
          memory={memory}
          companion={companion}
          seal={seal}
          onOpenArchive={() => setArchiveOpen(true)}
        />

        {seal.nudge.tier === 'raised' && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3">
            <div className="flex-1">
              <p className="text-sm text-ink">{seal.nudge.headline}</p>
              {seal.nudge.detail && (
                <p className="mt-0.5 text-xs leading-relaxed text-muted">{seal.nudge.detail}</p>
              )}
            </div>
            <span className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={seal.dismissNudge}
                className="text-xs text-muted underline hover:text-ink"
              >
                Not now
              </button>
              <button
                type="button"
                onClick={seal.begin}
                className="rounded-full bg-accent px-3.5 py-1.5 text-xs font-medium text-[#fffdf8] hover:opacity-90"
              >
                Seal
              </button>
            </span>
          </div>
        )}

        {memory.keyState === 'unlocked' && turns.length > 0 && (
          <button
            type="button"
            onClick={() => setLibraryOpen(true)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted hover:border-accent/40 hover:text-ink"
          >
            <BookIcon width={13} height={13} />
            Search your journal
          </button>
        )}

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
                recalled={recalledBy[turn.id]}
                onOpenAttestation={(a) => setViewer(a)}
              />
            ))}
          </div>
        )}

        {turns.length === 0 && !activeEntry && <EmptyState />}
      </main>

      {viewer && <AttestationViewer attestation={viewer} onClose={() => setViewer(null)} />}

      {libraryOpen && (
        <MemoryLibrary
          memory={memory}
          onClose={() => setLibraryOpen(false)}
          onDelete={(turn) => setPendingDelete(turn)}
        />
      )}

      {seal.open && (
        <SealSheet
          networkLabel={net.label}
          phase={seal.phase}
          plan={seal.activePlan}
          primaryAction={seal.primaryAction}
          cost={seal.cost}
          unsealed={seal.unsealed}
          savedRoot={seal.run?.savedRoot ?? null}
          savedSeq={seal.run?.seq ?? null}
          txUrl={
            // Only when a transaction was actually broadcast. useCompanion.fail()
            // MERGES into the existing tx rather than resetting it, so every
            // pre-send failure (network, ZeroRoot, SameRoot) leaves the previous
            // tx's hash in place — and linking it under "the chain step didn't
            // happen" would point at an earlier SUCCESS.
            companion.tx.phase === 'pending' ||
            companion.tx.phase === 'confirmed' ||
            companion.tx.phase === 'reverted' ||
            companion.tx.phase === 'lost'
              ? companion.tx.explorerTxUrl
              : null
          }
          preflightMessage={seal.preflight.ok ? null : seal.preflight.message}
          saveErrorMessage={memory.save.error?.message ?? null}
          saveFundingRemedy={
            memory.save.error?.kind === 'insufficient-funds'
              ? insufficientFundsRemedy(net, memory.wallet, {
                  cost: TYPICAL_SAVE_COST,
                  what: 'storage fee',
                  retry: 'save again',
                })
              : null
          }
          anchorErrorMessage={companion.tx.failure?.message ?? null}
          anchorFundingRemedy={
            companion.tx.failure?.funding
              ? insufficientFundsRemedy(net, memory.wallet, {
                  cost: TYPICAL_ANCHOR_COST,
                  what: 'anchor',
                  retry: 'anchor again',
                })
              : null
          }
          onPrimary={() => {
            if (seal.primaryAction === 'save') void seal.save();
            else if (seal.primaryAction === 'anchor') void seal.anchor();
            else if (seal.primaryAction === 'switch-chain') void seal.switchChain();
            else seal.close();
          }}
          onClose={seal.close}
        />
      )}

      {archiveOpen && (
        <PracticeArchive
          archive={seal.archive}
          networkLabel={net.label}
          explorerUrl={net.explorerUrl}
          proofUrl={memory.wallet ? `/companion/${memory.wallet}` : null}
          onClose={() => setArchiveOpen(false)}
        />
      )}

      {pendingDelete && (
        <DeleteEntryDialog
          turn={pendingDelete}
          memory={memory}
          anchoredRoot={companion.onChainRoot}
          onClose={() => setPendingDelete(null)}
        />
      )}

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
