import { describe, expect, it } from 'vitest';

import { createBoundedQueue } from './embedQueue';

/** A run function whose promises resolve only when the test says so. */
function controllable() {
  const gates = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
  const started: string[] = [];
  const run = (_item: unknown, key: string) =>
    new Promise<void>((resolve, reject) => {
      started.push(key);
      gates.set(key, { resolve: () => resolve(), reject });
    });
  return {
    run,
    started,
    finish: async (key: string) => {
      gates.get(key)!.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
    fail: async (key: string) => {
      gates.get(key)!.reject(new Error('embed failed'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

const tick = () => Promise.resolve().then(() => undefined);

describe('createBoundedQueue', () => {
  it('starts at most `concurrency` items — the whole point of the change', async () => {
    const c = controllable();
    const q = createBoundedQueue({ concurrency: 2, run: c.run });
    for (const k of ['a', 'b', 'c', 'd']) q.push(k, k);
    await tick();

    expect(c.started).toEqual(['a', 'b']);
    expect(q.active).toBe(2);
    expect(q.pending).toBe(2);
  });

  it('starts the next item only when a slot frees', async () => {
    const c = controllable();
    const q = createBoundedQueue({ concurrency: 1, run: c.run });
    q.push('a', 'a');
    q.push('b', 'b');
    await tick();
    expect(c.started).toEqual(['a']);

    await c.finish('a');
    expect(c.started).toEqual(['a', 'b']);
  });

  it('keeps draining after an item rejects', async () => {
    const c = controllable();
    const settled: Array<[string, boolean]> = [];
    const q = createBoundedQueue({
      concurrency: 1,
      run: c.run,
      onSettled: (key, ok) => settled.push([key, ok]),
    });
    q.push('a', 'a');
    q.push('b', 'b');
    await tick();

    await c.fail('a');
    expect(settled).toEqual([['a', false]]);
    expect(c.started).toEqual(['a', 'b']);
  });

  it('de-duplicates by key, including while an item is in flight', async () => {
    const c = controllable();
    const q = createBoundedQueue({ concurrency: 1, run: c.run });
    expect(q.push('a', 'a')).toBe(true);
    expect(q.push('a', 'a')).toBe(false);
    await tick();
    // Still in flight — re-pushing must not queue a second copy.
    expect(q.push('a', 'a')).toBe(false);
    expect(q.pending).toBe(0);
  });

  it('does not retry a failed key immediately — the next unlock re-queues it', async () => {
    const c = controllable();
    const q = createBoundedQueue({ concurrency: 1, run: c.run });
    q.push('a', 'a');
    await tick();
    await c.fail('a');
    expect(q.push('a', 'a')).toBe(false);
    expect(c.started).toEqual(['a']);
  });

  it('resolves onIdle once everything drains', async () => {
    const c = controllable();
    const q = createBoundedQueue({ concurrency: 2, run: c.run });
    q.push('a', 'a');
    q.push('b', 'b');
    await tick();

    let idle = false;
    void q.onIdle().then(() => {
      idle = true;
    });
    await c.finish('a');
    expect(idle).toBe(false);
    await c.finish('b');
    expect(idle).toBe(true);
  });

  it('resolves onIdle immediately when already empty', async () => {
    const q = createBoundedQueue({ concurrency: 1, run: async () => undefined });
    await expect(q.onIdle()).resolves.toBeUndefined();
  });

  it('clear() drops queued work but leaves in-flight items alone', async () => {
    const c = controllable();
    const q = createBoundedQueue({ concurrency: 1, run: c.run });
    for (const k of ['a', 'b', 'c']) q.push(k, k);
    await tick();

    q.clear();
    expect(q.pending).toBe(0);
    expect(q.active).toBe(1);
    // Cleared keys become pushable again — a wallet switch should be able to
    // re-queue the new wallet's turns.
    expect(q.push('b', 'b')).toBe(true);
  });

  it('treats concurrency below 1 as 1 rather than stalling forever', async () => {
    const c = controllable();
    const q = createBoundedQueue({ concurrency: 0, run: c.run });
    q.push('a', 'a');
    await tick();
    expect(c.started).toEqual(['a']);
  });

  it('runs everything eventually, in order, under load', async () => {
    const done: string[] = [];
    const q = createBoundedQueue<string>({
      concurrency: 3,
      run: async (item) => {
        done.push(item);
      },
    });
    const keys = Array.from({ length: 25 }, (_, i) => `k${i}`);
    for (const k of keys) q.push(k, k);
    await q.onIdle();
    expect(done).toEqual(keys);
  });
});
