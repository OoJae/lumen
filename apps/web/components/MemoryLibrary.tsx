'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { embed, isEmbedderReady } from '@/lib/memory/embeddings';
import { resurface, type Resurfaced } from '@/lib/memory/resurface';
import { searchTurns, type SearchHit, type SearchResults } from '@/lib/memory/search';
import type { RecallableTurn } from '@/lib/memory/recall';
import type { JournalMemory } from '@/lib/hooks/useJournalMemory';
import { buildExportBundle } from '@/lib/export/bundle';
import { CalendarIcon, CloseIcon, DownloadIcon, SearchIcon } from './icons';

/** Hand a file to the browser. Same idiom as the recovery-key download: the
 *  anchor is never attached to the DOM and the object URL is revoked at once. */
function download(filename: string, contents: string, type: string) {
  const blob = new globalThis.Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Long enough that a fast typist doesn't queue an embed per keystroke. */
const SEARCH_DEBOUNCE_MS = 220;
/** A user-initiated search can wait longer than the submit path's 2.5s budget,
 *  but not forever — past this we show literal results and say why. */
const SEARCH_EMBED_BUDGET_MS = 6_000;

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function EntryRow({
  turn,
  snippet,
  onDelete,
}: {
  turn: RecallableTurn;
  snippet?: string;
  onDelete?: (turn: RecallableTurn) => void;
}) {
  const [open, setOpen] = useState(false);
  const body = open ? turn.entry : (snippet ?? turn.entry);

  return (
    <li className="border-b border-border/60 py-3 last:border-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] uppercase tracking-wide text-muted">
          {dayLabel(turn.createdAt)}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-[11px] text-muted underline hover:text-ink"
          >
            {open ? 'less' : 'more'}
          </button>
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(turn)}
              className="text-[11px] text-muted underline hover:text-caution"
              aria-label={`Delete the entry from ${dayLabel(turn.createdAt)}`}
            >
              delete
            </button>
          )}
        </div>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">{body}</p>
      {open && turn.reflection && (
        <p className="mt-2 whitespace-pre-wrap border-l-2 border-accent/40 pl-3 text-sm leading-relaxed text-muted">
          {turn.reflection}
        </p>
      )}
    </li>
  );
}

function Group({
  title,
  hint,
  hits,
  onDelete,
}: {
  title: string;
  hint?: string;
  hits: SearchHit[];
  onDelete?: (turn: RecallableTurn) => void;
}) {
  if (hits.length === 0) return null;
  return (
    <section className="mt-5">
      <h3 className="text-xs uppercase tracking-wide text-muted">
        {title} <span className="text-muted/70">· {hits.length}</span>
      </h3>
      {hint && <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{hint}</p>}
      <ul className="mt-1">
        {hits.map((hit) => (
          <EntryRow key={hit.turn.id} turn={hit.turn} snippet={hit.snippet} onDelete={onDelete} />
        ))}
      </ul>
    </section>
  );
}

function OnThisDay({ item }: { item: Resurfaced }) {
  return (
    <section className="mt-4 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-accent">
        <CalendarIcon width={13} height={13} />
        {item.label}
      </p>
      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink">
        {item.turn.entry}
      </p>
      {item.also.length > 0 && (
        <p className="mt-1.5 text-[11px] text-muted">
          {item.also.length} more from this day in other years.
        </p>
      )}
    </section>
  );
}

/**
 * The memory library — history, search and resurfacing.
 *
 * Everything here runs on the device against `memory.turns`, which is plaintext
 * only in this tab's memory and only after the user signed to unlock. There is
 * no server call in this component, which is the whole reason it can exist at
 * all: a hosted journal can offer search because its servers can read you.
 */
export function MemoryLibrary({
  memory,
  onClose,
  onDelete,
}: {
  memory: JournalMemory;
  onClose: () => void;
  onDelete?: (turn: RecallableTurn) => void;
}) {
  const [query, setQuery] = useState('');
  const [queryVector, setQueryVector] = useState<number[] | null>(null);
  const [embedding, setEmbedding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const runId = useRef(0);

  // Mount-only. Kept apart from the Escape handler because `onClose` is an
  // inline arrow in the parent and so changes identity every render — and
  // Journal re-renders on every settled backfill embed. Bundled together, this
  // effect re-ran dozens of times while the library was open, yanking focus back
  // into the search box each time.
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    inputRef.current?.focus();
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Embed the query on a debounce. Literal results render immediately and are
  // never gated on this — if the model never answers, the "related" group just
  // doesn't appear and the footer says so.
  useEffect(() => {
    const text = query.trim();
    // Bump the run id FIRST, including on the empty branch. Otherwise an embed
    // already in flight for a previous query still matches `runId.current` when
    // it resolves, and clearing the box then retyping could apply a vector for
    // text the user had abandoned.
    const id = ++runId.current;
    if (!text) {
      setQueryVector(null);
      setEmbedding(false);
      return;
    }
    setEmbedding(true);
    const timer = setTimeout(() => {
      void Promise.race([
        embed(text),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('search embed budget')), SEARCH_EMBED_BUDGET_MS),
        ),
      ])
        .then((vector) => {
          if (runId.current === id) setQueryVector(vector);
        })
        .catch(() => {
          if (runId.current === id) setQueryVector(null);
        })
        .finally(() => {
          if (runId.current === id) setEmbedding(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const turns = memory.turns;
  const newestFirst = useMemo(
    () => [...turns].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [turns],
  );

  const results: SearchResults | null = useMemo(
    () => (query.trim() ? searchTurns(query, turns, queryVector) : null),
    [query, turns, queryVector],
  );

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const resurfaced = useMemo(() => resurface(turns, today), [turns, today]);

  const embedded = turns.filter((t) => t.embedding).length;
  const searching = Boolean(results);
  const nothingFound = searching && results!.exact.length === 0 && results!.related.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Your journal"
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-border bg-surface shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-6 pb-4 pt-6">
          <div>
            <p className="font-serif text-lg leading-tight text-ink">Your journal</p>
            <p className="text-xs text-muted">
              {turns.length} {turns.length === 1 ? 'entry' : 'entries'}, searched on this device
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted hover:text-ink"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="border-b border-border px-6 py-3">
          <div className="flex items-center gap-2 rounded-full border border-border bg-canvas/60 px-3.5 py-2">
            <SearchIcon width={15} height={15} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your entries…"
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted"
              aria-label="Search your entries"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="shrink-0 text-[11px] text-muted underline hover:text-ink"
              >
                clear
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {!searching && resurfaced && <OnThisDay item={resurfaced} />}

          {searching ? (
            <>
              <Group
                title="Contains your words"
                hits={results!.exact}
                onDelete={onDelete}
              />
              <Group
                title="Related"
                hint="Found by the on-device model, not by matching words. Its judgement, not a fact."
                hits={results!.related}
                onDelete={onDelete}
              />
              {nothingFound && (
                <p className="mt-6 text-sm leading-relaxed text-muted">
                  Nothing matches “{query.trim()}”.
                  {!results!.semanticAvailable &&
                    ' Related-entry search needs the on-device model, which isn’t ready yet.'}
                </p>
              )}
            </>
          ) : (
            <section className="mt-4">
              <h3 className="text-xs uppercase tracking-wide text-muted">Everything</h3>
              {newestFirst.length === 0 ? (
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  Nothing here yet. What you write stays encrypted on this device until you choose
                  to save it.
                </p>
              ) : (
                <ul className="mt-1">
                  {newestFirst.map((turn) => (
                    <EntryRow key={turn.id} turn={turn} onDelete={onDelete} />
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        {turns.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-6 py-3">
            <span className="mr-1 text-[11px] uppercase tracking-wide text-muted">Take it with you</span>
            <button
              type="button"
              onClick={() => {
                const bundle = buildExportBundle({
                  turns,
                  wallet: memory.wallet,
                  receipt: memory.save.receipt,
                  exportedAt: new Date().toISOString(),
                });
                download(bundle.markdownFilename, bundle.markdown, 'text/markdown');
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted hover:border-accent/40 hover:text-ink"
            >
              <DownloadIcon width={13} height={13} />
              Markdown
            </button>
            <button
              type="button"
              onClick={() => {
                const bundle = buildExportBundle({
                  turns,
                  wallet: memory.wallet,
                  receipt: memory.save.receipt,
                  exportedAt: new Date().toISOString(),
                });
                download(bundle.jsonFilename, bundle.json, 'application/json');
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted hover:border-accent/40 hover:text-ink"
            >
              <DownloadIcon width={13} height={13} />
              JSON
            </button>
            <span className="w-full text-[11px] leading-relaxed text-muted">
              Everything, unencrypted, in formats that outlive Lumen. The JSON keeps each
              reflection&apos;s enclave proof so it can be re-verified later. Store the file the way
              you would a paper journal.
            </span>
          </div>
        )}

        <p className="border-t border-border px-6 py-3 text-[11px] leading-relaxed text-muted">
          Searching happens in this browser. Your words are never sent anywhere to be indexed —
          which is also why related-entry search needs a model to finish loading
          {embedding
            ? '. Preparing your search…'
            : embedded < turns.length
              ? `. ${embedded} of ${turns.length} entries are ready for it so far.`
              : isEmbedderReady()
                ? ' — ready.'
                : '.'}
        </p>
      </div>
    </div>
  );
}
