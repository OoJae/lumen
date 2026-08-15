/**
 * Pure recall math (Wave 2) — no model, no I/O, fully unit-testable.
 * The embedding model lives in the worker; everything rankable lives here.
 */

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface Ranked<T> {
  item: T;
  score: number;
}

/** Top-k items by cosine similarity to the query vector, at or above minScore. */
export function rankBySimilarity<T>(
  queryVector: readonly number[],
  items: readonly T[],
  getVector: (item: T) => readonly number[] | undefined,
  k: number,
  minScore: number,
): Ranked<T>[] {
  const scored: Ranked<T>[] = [];
  for (const item of items) {
    const vector = getVector(item);
    if (!vector) continue;
    const score = cosineSimilarity(queryVector, vector);
    if (score >= minScore) scored.push({ item, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, Math.max(0, k));
}
