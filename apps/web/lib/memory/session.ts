/**
 * Wave 1 session memory — in-memory only (no plaintext at rest).
 *
 * Builds the model context from the most recent turns so Lumen "remembers" within
 * a session. Wave 2 replaces this with encrypted persistence on 0G Storage + an
 * embeddings recall pass (see ./embeddings.ts, ./recall.ts).
 */
import type { ChatMessage, JournalTurn } from '@lumen/shared';

import { ELISION, minimizeRecall } from './minimize';

/** How many prior turns to feed back as context. */
export const MAX_CONTEXT_TURNS = 6;

export function buildContext(turns: JournalTurn[], newEntry: string): ChatMessage[] {
  const recent = turns.slice(-MAX_CONTEXT_TURNS);
  const messages: ChatMessage[] = [];
  for (const turn of recent) {
    messages.push({ role: 'user', content: turn.entry });
    if (turn.reflection) {
      messages.push({ role: 'assistant', content: turn.reflection });
    }
  }
  messages.push({ role: 'user', content: newEntry });
  return messages;
}

export function newTurnId(): string {
  return `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Wave 2: session context + an embeddings-recall block. Recalled entries are
 * prepended as one system message (the gateway's own system prompt still goes
 * first, server-side) so older, relevant moments inform the reflection without
 * bloating the turn-by-turn context.
 */
export function buildContextWithRecall(
  turns: JournalTurn[],
  recalled: JournalTurn[],
  newEntry: string,
  /** The prompt the writer was shown. Until this existed the model could not
   *  see the question being answered, so an entry that only made sense as a
   *  reply ("not really, no") arrived with no idea what it replied to. */
  prompt?: string,
): ChatMessage[] {
  const base = buildContext(turns, newEntry);
  const preamble: ChatMessage[] = [];

  if (prompt && prompt.trim()) {
    preamble.push({
      role: 'system',
      content:
        `Today's journal page asked: "${prompt.trim()}" — the entry below may be ` +
        'answering it. Do not repeat the question back.',
    });
  }

  if (recalled.length > 0) {
    // EXCERPTS, not whole entries. Recall picks an entry by whole-entry cosine
    // similarity and this used to forward the whole entry — so a long, hard
    // entry travelled in full because one paragraph of it rhymed with today's
    // sentence. The gateway is in the plaintext path for the inference call, so
    // that difference is the difference between it seeing a paragraph and it
    // seeing a year. See lib/memory/minimize.ts.
    const minimized = minimizeRecall(recalled, (turn) => turn.entry, newEntry);
    if (minimized.entries > 0) {
      const block = minimized.items
        .map(({ item, excerpt }) => `[${item.createdAt.slice(0, 10)}] ${excerpt.text}`)
        .join('\n\n');
      preamble.push({
        role: 'system',
        content:
          "Excerpts from earlier entries in this journal, in the writer's own words. " +
          `${ELISION} marks where text was deliberately withheld — do not ask about ` +
          'the gaps or guess at them. Quietly draw on what is here when it is ' +
          'relevant:\n\n' +
          block,
      });
    }
  }

  return preamble.length > 0 ? [...preamble, ...base] : base;
}

/**
 * What this reflection will actually send, in counts — for the composer notice.
 * Kept beside the builder so the two can never drift: if one changes what goes
 * out, the other reports it.
 */
export function contextFootprint(
  turns: JournalTurn[],
  recalled: JournalTurn[],
  newEntry: string,
): { sessionTurns: number; recalledEntries: number; charsWithheld: number } {
  const minimized = minimizeRecall(recalled, (turn) => turn.entry, newEntry);
  return {
    sessionTurns: Math.min(turns.length, MAX_CONTEXT_TURNS),
    recalledEntries: minimized.entries,
    charsWithheld: minimized.charsWithheld,
  };
}
