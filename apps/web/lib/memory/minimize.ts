/**
 * Send the gateway less.
 *
 * The honest cost of Lumen's architecture is that the gateway sits in the
 * plaintext path for the inference call. docs/privacy-model.md states it
 * plainly: a routine reflection has been sending the new entry, the last six
 * turns, AND up to four recalled entries — each one WHOLE — which can be from
 * any point in the writer's history, including entries restored from a 0G
 * snapshot months later. Ten previously-stored entries, in cleartext, to write
 * one reflection.
 *
 * The recalled entries are the wrong part of that. They are selected by cosine
 * similarity over a WHOLE-entry embedding, and then the whole entry is sent —
 * so a two-page entry about a hard year gets forwarded in full because one
 * paragraph of it rhymes with today's sentence. The model needs the rhyming
 * paragraph. It does not need the year.
 *
 * So this module cuts each recalled entry down to the part that earned its
 * place, before it leaves the device. It is deliberately pure, synchronous and
 * model-free: the submit path already carries a 2.5s embedding budget
 * (RECALL_EMBED_BUDGET_MS) and a cold MiniLM can miss it, so anything that
 * could add latency here would get skipped exactly when the journal is largest
 * and the leak is worst.
 *
 * What this does NOT claim: the gateway still sees whatever is sent, and this
 * shrinks that, it does not encrypt it. Removing the gateway from the plaintext
 * path entirely is a different piece of work with its own costs.
 */

/** Words too common to be evidence of relevance. Small on purpose — this is a
 *  relevance heuristic, not a language model. */
const STOPWORDS = new Set([
  'a', 'about', 'after', 'again', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'but', 'by', 'can', 'did', 'do', 'does',
  'doing', 'done', 'down', 'for', 'from', 'had', 'has', 'have', 'having', 'he', 'her',
  'here', 'hers', 'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its',
  'just', 'me', 'more', 'most', 'my', 'no', 'not', 'now', 'of', 'on', 'one', 'only',
  'or', 'other', 'our', 'out', 'over', 'own', 'said', 'same', 'she', 'should', 'so',
  'some', 'still', 'such', 'than', 'that', 'the', 'their', 'them', 'then', 'there',
  'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'up', 'very',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'why',
  'will', 'with', 'would', 'you', 'your',
]);

export interface MinimizeOptions {
  /** Sentences to keep from each recalled entry. */
  maxSentences?: number;
  /** Hard ceiling per entry, whatever the sentence count says. */
  maxChars?: number;
}

export const DEFAULT_MAX_SENTENCES = 3;
export const DEFAULT_MAX_CHARS = 420;

/** The marker standing in for text that was NOT sent. */
export const ELISION = '…';

export interface Excerpt {
  /** Exactly what will leave the device for this entry. */
  text: string;
  /** Sentences kept, and how many the entry had. */
  kept: number;
  total: number;
  /** True when anything at all was withheld. */
  reduced: boolean;
  /** Characters withheld — the number the UI can honestly quote. */
  charsWithheld: number;
}

/**
 * Split on sentence enders, keeping the punctuation.
 *
 * Journals are not well-formed prose: they run on, they use line breaks as
 * punctuation, and they trail off. So a bare newline ends a sentence too,
 * otherwise a whole entry written without full stops counts as one sentence and
 * nothing can be trimmed from it.
 */
export function splitSentences(entry: string): string[] {
  // Latin enders need trailing whitespace to avoid splitting "3.14" and "e.g.".
  // CJK, Devanagari and Arabic enders do NOT — those scripts frequently write no
  // space after the stop, and requiring one meant an entire Chinese, Japanese,
  // Hindi or Urdu entry counted as ONE sentence. Nothing could then be trimmed
  // from it, so every recalled entry in those languages was forwarded WHOLE —
  // exactly the behaviour this module exists to stop, silently skipped for a
  // large fraction of the world.
  const parts = entry
    .split(/(?<=[.!?])\s+|(?<=[\u3002\uFF01\uFF1F\u0964\u0965\u06D4\u061F\u2026])\s*|\n+/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : [];
}

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * How well one sentence answers the query.
 *
 * Overlap normalised by sqrt(length), so a long sentence cannot win simply by
 * containing more words — without that, excerpting reliably picked the longest
 * sentence, which is the opposite of minimising.
 */
export function scoreSentence(sentence: string, queryTerms: Set<string>): number {
  if (queryTerms.size === 0) return 0;
  const words = terms(sentence);
  if (words.length === 0) return 0;
  let hits = 0;
  const seen = new Set<string>();
  for (const w of words) {
    if (queryTerms.has(w) && !seen.has(w)) {
      hits++;
      seen.add(w);
    }
  }
  return hits === 0 ? 0 : hits / Math.sqrt(words.length);
}

/** Cut one entry down to the part that earned its place. */
export function excerptEntry(entry: string, query: string, opts: MinimizeOptions = {}): Excerpt {
  const maxSentences = opts.maxSentences ?? DEFAULT_MAX_SENTENCES;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const sentences = splitSentences(entry);
  const total = sentences.length;

  if (total === 0) {
    return { text: '', kept: 0, total: 0, reduced: false, charsWithheld: 0 };
  }

  const queryTerms = new Set(terms(query));
  const scored = sentences.map((text, index) => ({
    index,
    text,
    score: scoreSentence(text, queryTerms),
  }));

  let chosen = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maxSentences);

  // Recall selected this entry by SEMANTIC similarity, so it can be genuinely
  // relevant while sharing no words with the query. Falling back to the opening
  // keeps the entry useful; it never falls back to the whole thing.
  if (chosen.length === 0) {
    chosen = scored.slice(0, Math.min(maxSentences, total));
  }

  // Original order: an excerpt that reorders someone's sentences misrepresents
  // what they wrote, even to a model.
  chosen.sort((a, b) => a.index - b.index);

  const pieces: string[] = [];
  // Tracked explicitly rather than recovered by filtering `pieces` for the
  // elision marker: an entry can legitimately contain a sentence that IS just
  // "…", and filtering by content silently undercounted it and appended a
  // trailing marker that described nothing.
  const kept: Array<{ index: number }> = [];
  /** Only the sentence text actually sent — never the markers we insert. */
  const sentPieces: string[] = [];
  let used = 0;
  let lastIndex = -1;
  for (const s of chosen) {
    if (used > 0 && used + s.text.length > maxChars) break;
    if (lastIndex >= 0 && s.index !== lastIndex + 1) pieces.push(ELISION);
    // The first sentence is admitted even if it alone exceeds maxChars, then
    // hard-cut — returning nothing would silently drop a relevant memory. The
    // cut carries its own marker: the prompt tells the model that every gap is
    // marked, and a silent mid-word truncation made that untrue for exactly the
    // entries that lost the most text.
    const first = used === 0 && s.text.length > maxChars;
    const body = first ? s.text.slice(0, maxChars).trimEnd() : s.text;
    pieces.push(first ? `${body}${ELISION}` : body);
    sentPieces.push(body);
    kept.push({ index: s.index });
    used += s.text.length;
    lastIndex = s.index;
  }

  const keptIndices = kept;
  const leading = keptIndices.length > 0 && keptIndices[0]!.index > 0;
  const trailing = keptIndices.length > 0 && keptIndices[keptIndices.length - 1]!.index < total - 1;
  const text = [leading ? ELISION : '', pieces.join(' '), trailing ? ELISION : '']
    .filter(Boolean)
    .join(' ')
    .trim();

  const keptCount = keptIndices.length;
  // Measured from the sentences actually SENT, not by stripping markers out of
  // the rendered text. Stripping treated an elision the writer had typed
  // themselves as one of ours, so an entry containing '…' reported characters
  // withheld that were never withheld. Compare against the entry's own length
  // rather than the sum of its sentences: splitting discards the whitespace
  // between them, and counting that as withheld would overstate the saving.
  const sentText = sentPieces.join(' ').replace(/\s+/g, ' ').trim();
  const charsWithheld = Math.max(0, entry.replace(/\s+/g, ' ').trim().length - sentText.length);

  return {
    text,
    kept: keptCount,
    total,
    reduced: keptCount < total || charsWithheld > 0,
    charsWithheld,
  };
}

export interface MinimizedRecall<T> {
  /** Each recalled item with the text that will actually be sent. */
  items: Array<{ item: T; excerpt: Excerpt }>;
  /** Entries included. */
  entries: number;
  /** Characters that stayed on the device. */
  charsWithheld: number;
  /** True when any entry was cut — what the UI may honestly claim. */
  reduced: boolean;
}

/** Apply the excerpt to every recalled entry. */
export function minimizeRecall<T>(
  recalled: T[],
  getEntry: (item: T) => string,
  query: string,
  opts: MinimizeOptions = {},
): MinimizedRecall<T> {
  const items = recalled
    .map((item) => ({ item, excerpt: excerptEntry(getEntry(item), query, opts) }))
    .filter((r) => r.excerpt.text.length > 0);

  return {
    items,
    entries: items.length,
    charsWithheld: items.reduce((n, r) => n + r.excerpt.charsWithheld, 0),
    reduced: items.some((r) => r.excerpt.reduced),
  };
}

/**
 * What the composer tells the writer BEFORE they press Reflect.
 *
 * privacy-model.md invites the reader to open DevTools and inspect the payload.
 * That invitation is honest and almost nobody will take it, so this says the
 * same thing where it is actually read. Counts only — never the content.
 */
export function contextNotice(input: {
  sessionTurns: number;
  recalledEntries: number;
  charsWithheld: number;
}): string {
  const { sessionTurns, recalledEntries, charsWithheld } = input;
  const bits: string[] = [];
  if (sessionTurns > 0) {
    bits.push(`your last ${sessionTurns === 1 ? 'entry' : `${sessionTurns} entries`}`);
  }
  if (recalledEntries > 0) {
    bits.push(
      `${recalledEntries === 1 ? 'an excerpt' : `excerpts from ${recalledEntries} earlier entries`}`,
    );
  }
  if (bits.length === 0) return 'This reflection sends only what you just wrote.';

  // Rounding to the nearest 100 printed "About 0 characters ... stay on this
  // device" for every reduction under 50 — a sentence that reads as a bug and
  // undersells a real one. Below the rounding floor, say it without a number.
  const rounded = Math.round(charsWithheld / 100) * 100;
  const withheld =
    charsWithheld <= 0
      ? ''
      : rounded === 0
        ? ' A little of those earlier entries stays on this device.'
        : ` About ${rounded} characters of those earlier entries stay on this device.`;
  return `This reflection sends what you just wrote, plus ${bits.join(' and ')}.${withheld}`;
}
