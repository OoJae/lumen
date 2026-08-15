/**
 * Wave 1 session memory — in-memory only (no plaintext at rest).
 *
 * Builds the model context from the most recent turns so Lumen "remembers" within
 * a session. Wave 2 replaces this with encrypted persistence on 0G Storage + an
 * embeddings recall pass (see ./embeddings.ts, ./recall.ts).
 */
import type { ChatMessage, JournalTurn } from '@lumen/shared';

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
): ChatMessage[] {
  const base = buildContext(turns, newEntry);
  if (recalled.length === 0) return base;
  const block = recalled
    .map((turn) => `[${turn.createdAt.slice(0, 10)}] ${turn.entry}`)
    .join('\n\n');
  return [
    {
      role: 'system',
      content:
        'Earlier entries from this journal, in the writer\'s own words — quietly ' +
        'draw on them when they are relevant:\n\n' +
        block,
    },
    ...base,
  ];
}
