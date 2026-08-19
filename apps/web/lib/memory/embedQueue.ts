/**
 * A bounded, de-duplicating work queue for embedding backfill.
 *
 * Why this exists: `hydrate()` used to fire `embed()` for every vectorless turn
 * in one synchronous loop — no cap, no dedupe, each with its own 30-second
 * timeout started at postMessage time. The worker processes them one at a time
 * behind a single model promise, so on a cold model with a real history the
 * later items burn their entire timeout waiting in line, get dropped, and are
 * retried from scratch on the next unlock. The visible symptom is semantic
 * search that is quietly missing your older entries.
 *
 * Bounding concurrency fixes it: each item's timeout starts near when its work
 * actually starts, so a slow model delays the queue instead of failing it.
 *
 * Pure and synchronous to construct; no timers, no globals, no React. Rejections
 * are swallowed by design — backfill is best-effort and must never surface as an
 * error, but `onSettled` lets a caller observe progress.
 */

export interface BoundedQueue<T> {
  /** Enqueue unless `key` is already queued or in flight. Returns false if skipped. */
  push(key: string, item: T): boolean;
  /** Items waiting for a slot. */
  readonly pending: number;
  /** Items currently running. */
  readonly active: number;
  /** Resolves when the queue has fully drained. Safe to call repeatedly. */
  onIdle(): Promise<void>;
  /** Forget everything queued but not started (e.g. the wallet changed). */
  clear(): void;
}

export interface BoundedQueueOptions<T> {
  /** Max items in flight. */
  concurrency: number;
  run: (item: T, key: string) => Promise<unknown>;
  /** Called after each item, successful or not. */
  onSettled?: (key: string, ok: boolean) => void;
}

export const DEFAULT_EMBED_CONCURRENCY = 2;

export function createBoundedQueue<T>(options: BoundedQueueOptions<T>): BoundedQueue<T> {
  const concurrency = Math.max(1, options.concurrency);
  const waiting: Array<{ key: string; item: T }> = [];
  // One set covers queued AND in-flight: an item must not be re-enqueued while
  // it is still running, or a second unlock doubles the work.
  const known = new Set<string>();
  let active = 0;
  let idleResolvers: Array<() => void> = [];

  function settleIdle() {
    if (active === 0 && waiting.length === 0) {
      const resolvers = idleResolvers;
      idleResolvers = [];
      for (const resolve of resolvers) resolve();
    }
  }

  function pump() {
    while (active < concurrency && waiting.length > 0) {
      const next = waiting.shift()!;
      active++;
      void Promise.resolve()
        .then(() => options.run(next.item, next.key))
        .then(
          () => options.onSettled?.(next.key, true),
          () => options.onSettled?.(next.key, false),
        )
        .then(() => {
          active--;
          // Release the key. It guards against double-queueing while an item is
          // WAITING or RUNNING, which is all the de-duplication that is wanted;
          // holding it forever meant a failed embed could never be retried, in
          // this session or any later one, because the queue lives as long as
          // the hook. clear() cannot release it either — that only walks the
          // waiting list.
          known.delete(next.key);
          pump();
          settleIdle();
        });
    }
  }

  return {
    push(key, item) {
      if (known.has(key)) return false;
      known.add(key);
      waiting.push({ key, item });
      pump();
      return true;
    },
    get pending() {
      return waiting.length;
    },
    get active() {
      return active;
    },
    onIdle() {
      if (active === 0 && waiting.length === 0) return Promise.resolve();
      return new Promise<void>((resolve) => idleResolvers.push(resolve));
    },
    clear() {
      for (const entry of waiting) known.delete(entry.key);
      waiting.length = 0;
      settleIdle();
    },
  };
}
