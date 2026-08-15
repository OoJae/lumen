/**
 * Embedding worker (Wave 2) — runs the MiniLM feature-extraction pipeline OFF
 * the main thread, entirely on-device. Journal text enters this worker and
 * only a vector leaves it; nothing here touches the network except the
 * one-time model-weight download (~23 MB, cached by the browser afterwards —
 * disclosed in docs/privacy-model.md).
 */
import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

interface EmbedRequest {
  id: number;
  text: string;
}

type EmbedResponse = { id: number; vector: number[] } | { id: number; error: string };

// transformers' overloaded pipeline() type explodes into a union TS can't
// represent (TS2590); narrow it to the one task we use.
const createExtractor = pipeline as unknown as (
  task: 'feature-extraction',
  model: string,
  options?: { dtype?: string },
) => Promise<FeatureExtractionPipeline>;

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  extractorPromise ??= createExtractor('feature-extraction', MODEL_ID, { dtype: 'q8' });
  return extractorPromise;
}

self.onmessage = async (event: MessageEvent<EmbedRequest>) => {
  const { id, text } = event.data;
  try {
    const extractor = await getExtractor();
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    const vector = Array.from(output.data as Float32Array);
    self.postMessage({ id, vector } satisfies EmbedResponse);
  } catch (err) {
    self.postMessage({
      id,
      error: err instanceof Error ? err.message : 'embedding failed',
    } satisfies EmbedResponse);
  }
};
