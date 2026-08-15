/**
 * Embeddings recall (Wave 2). Top-k cosine search over the user's own turns,
 * entirely on-device — vectors live decrypted only in memory, encrypted
 * (envelope v2) everywhere at rest. Falls back to [] on ANY failure so the
 * reflect loop can never be blocked by recall.
 */
import type { JournalTurn } from '@lumen/shared';

import { embed } from './embeddings';
import { MAX_CONTEXT_TURNS } from './session';
import { rankBySimilarity } from './vectorMath';

/** A turn plus its (optional, in-memory plaintext) embedding vector. */
export interface RecallableTurn extends JournalTurn {
  embedding?: number[];
}

export const RECALL_MIN_SCORE = 0.35;

/** Hard budget for the query embed on the SUBMIT path. A cold model (first
 *  download) simply misses this window and recall skips — the reflection must
 *  start immediately; the model keeps warming for next time. */
export const RECALL_EMBED_BUDGET_MS = 2_500;

export async function recallRelevant(
  query: string,
  turns: RecallableTurn[],
  k = 4,
): Promise<RecallableTurn[]> {
  try {
    // The most recent turns are already in the session context — recall only
    // reaches further back than the session window.
    const candidates = turns.slice(0, Math.max(0, turns.length - MAX_CONTEXT_TURNS));
    if (candidates.length === 0) return [];
    // No candidate has a vector yet → embedding the query is pure waste.
    if (!candidates.some((turn) => turn.embedding)) return [];
    const queryVector = await Promise.race([
      embed(query),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('recall embed budget exceeded')), RECALL_EMBED_BUDGET_MS),
      ),
    ]);
    return rankBySimilarity(
      queryVector,
      candidates,
      (turn) => turn.embedding,
      k,
      RECALL_MIN_SCORE,
    ).map((ranked) => ranked.item);
  } catch {
    return [];
  }
}
