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
