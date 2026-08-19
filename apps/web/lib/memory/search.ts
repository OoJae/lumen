/**
 * Searching a journal nobody else can read.
 *
 * Every cloud journal can search your entries because its servers can read
 * them. Lumen's cannot, so this runs entirely on the device: literal matching
 * over plaintext that only exists in this tab's memory, and semantic matching
 * over MiniLM vectors computed in a Web Worker. Nothing about a query leaves
 * the machine.
 *
 * Two deliberate decisions:
 *
 * 1. **Literal and semantic results are kept apart.** A literal match is a
 *    fact — the word is there. A semantic match is a model's opinion. Merging
 *    them into one ranked list would launder the second into looking like the
 *    first, which is precisely the kind of quiet overclaiming this product
 *    exists to avoid. The UI shows "contains your words" and "related" as
 *    separate groups.
 * 2. **Literal search never depends on the model.** MiniLM is ~23 MB fetched on
 *    first use; if it is cold, blocked, or the device is offline, typing in the
 *    search box still works. Semantic results simply aren't offered, and
 *    `semanticAvailable` says so rather than silently returning less.
 *
 * `recallRelevant` is NOT reusable here: it excludes the newest MAX_CONTEXT_TURNS
 * (they are already in the model's context), caps k at 4, drops scores and
 * imposes a 2.5s budget. All correct for the submit path, all wrong for search.
 */
import { rankBySimilarity } from './vectorMath';
import type { RecallableTurn } from './recall';

export type MatchField = 'entry' | 'reflection' | 'both';

export interface SearchHit {
  turn: RecallableTurn;
  /** Literal: fraction of query terms present (1 = all). Semantic: cosine. */
  score: number;
  /** Where the literal match landed. Null for a semantic-only hit. */
  field: MatchField | null;
  /** An excerpt around the match, or the opening of the entry. */
  snippet: string;
}

export interface SearchResults {
  query: string;
  /** Entries containing what you typed. Newest first — a fact needs no ranking. */
  exact: SearchHit[];
  /** Entries the on-device model thinks are related. Never overlaps `exact`. */
  related: SearchHit[];
  /** False when no query vector was available (model cold, blocked, or offline). */
  semanticAvailable: boolean;
}

export interface SearchOptions {
  /** Max hits per group. */
  limit?: number;
  /** Cosine floor for the related group. */
  minSemanticScore?: number;
}

export const DEFAULT_SEARCH_LIMIT = 50;
/** Higher than recall's 0.35: a browsing user is shown these as suggestions and
 *  a weak match reads as the search being bad rather than the entry being far. */
export const SEARCH_MIN_SEMANTIC_SCORE = 0.4;

const SNIPPET_RADIUS = 90;

/** Query terms, lowercased, de-duplicated, punctuation-trimmed. */
export function queryTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .map((term) => term.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
        .filter(Boolean),
    ),
  ];
}

/**
 * Fraction of query terms present in `text`, 0 when none are.
 *
 * A whole-phrase match scores 1 outright, so searching "anxious about work"
 * ranks an entry containing that phrase above one that merely contains all
 * three words scattered.
 */
export function textScore(terms: readonly string[], phrase: string, text: string): number {
  if (terms.length === 0) return 0;
  const haystack = text.toLowerCase();
  if (phrase.length > 0 && haystack.includes(phrase)) return 1;
  let found = 0;
  for (const term of terms) if (haystack.includes(term)) found++;
  return found === 0 ? 0 : found / terms.length;
}

/** An excerpt centred on the first matching term, else the opening of the text. */
export function snippet(text: string, terms: readonly string[]): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= SNIPPET_RADIUS * 2) return flat;

  const haystack = flat.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const i = haystack.indexOf(term);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) return `${flat.slice(0, SNIPPET_RADIUS * 2).trimEnd()}…`;

  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(flat.length, at + SNIPPET_RADIUS);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`;
}

function matchField(entryScore: number, reflectionScore: number): MatchField | null {
  if (entryScore > 0 && reflectionScore > 0) return 'both';
  if (entryScore > 0) return 'entry';
  if (reflectionScore > 0) return 'reflection';
  return null;
}

/**
 * Search the FULL history — unlike recall, nothing is held back.
 *
 * `queryVector` is optional: pass null and you get literal results only, with
 * `semanticAvailable: false`.
 */
export function searchTurns(
  query: string,
  turns: readonly RecallableTurn[],
  queryVector: readonly number[] | null,
  options: SearchOptions = {},
): SearchResults {
  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
  const minScore = options.minSemanticScore ?? SEARCH_MIN_SEMANTIC_SCORE;
  const phrase = query.trim().toLowerCase();
  const terms = queryTerms(query);
  const semanticAvailable = Boolean(queryVector && queryVector.length > 0);

  if (terms.length === 0) {
    return { query, exact: [], related: [], semanticAvailable };
  }

  const exact: SearchHit[] = [];
  const literalIds = new Set<string>();

  for (const turn of turns) {
    const entryScore = textScore(terms, phrase, turn.entry);
    const reflectionScore = textScore(terms, phrase, turn.reflection);
    const best = Math.max(entryScore, reflectionScore);
    if (best <= 0) continue;
    literalIds.add(turn.id);
    exact.push({
      turn,
      score: best,
      field: matchField(entryScore, reflectionScore),
      // Prefer an excerpt from what the user wrote; fall back to the reflection.
      snippet: snippet(entryScore > 0 ? turn.entry : turn.reflection, terms),
    });
  }

  // Newest first. A literal match is certain, so ordering by a made-up relevance
  // number would be less useful than ordering by when it happened.
  exact.sort((a, b) => b.turn.createdAt.localeCompare(a.turn.createdAt));

  let related: SearchHit[] = [];
  if (queryVector && queryVector.length > 0) {
    // Exclude literal hits so the two groups never show the same entry twice.
    const candidates = turns.filter((turn) => !literalIds.has(turn.id));
    related = rankBySimilarity(queryVector, candidates, (turn) => turn.embedding, limit, minScore).map(
      (ranked) => ({
        turn: ranked.item,
        score: ranked.score,
        field: null,
        snippet: snippet(ranked.item.entry, terms),
      }),
    );
  }

  return { query, exact: exact.slice(0, limit), related, semanticAvailable };
}
