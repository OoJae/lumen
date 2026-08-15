/**
 * Client-side embeddings (Wave 2). 0G Compute has no embeddings model
 * (re-verified against the live /v1/models catalog, 2026-08), so recall runs
 * entirely on-device: MiniLM in a lazy Web Worker. Journal text NEVER leaves
 * the device for embedding; vectors are encrypted (envelope v2) before they
 * touch 0G Storage.
 *
 * Every function degrades gracefully — if the model can't load (offline, CDN
 * blocked), callers get a rejection and recall falls back to session-only
 * context. The reflect loop never awaits this module.
 */
export type Embedding = number[];

const EMBED_TIMEOUT_MS = 30_000;

let worker: Worker | null = null;
let ready = false;
let nextId = 1;
const pending = new Map<number, { resolve: (v: Embedding) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    throw new Error('Embeddings run client-side only');
  }
  if (!worker) {
    worker = new Worker(new URL('../workers/embedder.worker.ts', import.meta.url));
    worker.onmessage = (
      event: MessageEvent<{ id: number; vector?: number[]; error?: string }>,
    ) => {
      const { id, vector, error } = event.data;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (vector) {
        ready = true;
        entry.resolve(vector);
      } else {
        entry.reject(new Error(error ?? 'embedding failed'));
      }
    };
    worker.onerror = () => {
      const error = new Error('embedding worker crashed');
      for (const entry of pending.values()) entry.reject(error);
      pending.clear();
      worker?.terminate();
      worker = null;
      ready = false;
    };
  }
  return worker;
}

export function isEmbedderReady(): boolean {
  return ready;
}

/** Fire-and-forget model warm-up (call after unlock, never awaited by the UI). */
export function preloadEmbedder(): void {
  embed('lumen warm-up').catch(() => {
    /* offline / CDN blocked — recall degrades to session context */
  });
}

export async function embed(text: string): Promise<Embedding> {
  const w = getWorker();
  const id = nextId++;
  return new Promise<Embedding>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('embedding timed out'));
    }, EMBED_TIMEOUT_MS);
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    w.postMessage({ id, text });
  });
}
