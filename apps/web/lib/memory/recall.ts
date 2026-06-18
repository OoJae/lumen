/**
 * Wave 2 surface (stub). Top-k recall over encrypted vectors stored in 0G Storage
 * KV, decrypted locally to build context. Intentionally unimplemented in Wave 1 —
 * session memory (./session.ts) covers the Wave 1 loop.
 */
import type { JournalTurn } from '@lumen/shared';

export async function recallRelevant(_query: string, _turns: JournalTurn[], _k = 4): Promise<JournalTurn[]> {
  throw new Error('Embeddings-based recall arrives in Wave 2.');
}
