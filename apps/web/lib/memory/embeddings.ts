/**
 * Wave 2 surface (stub). 0G Compute has no dedicated embeddings model yet
 * (verified mid-2026), so Wave 2 will ship a small client-side embedding model
 * and keep the vectors encrypted before they touch 0G Storage KV.
 *
 * Intentionally unimplemented in Wave 1.
 */
export type Embedding = number[];

export async function embed(_text: string): Promise<Embedding> {
  throw new Error('Embeddings arrive in Wave 2 (client-side model + encrypted vectors).');
}
