import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Static wiring guards.
 *
 * This file exists because of a defect no unit test could have caught. The pure
 * function `unlockNotice` has three branches and all three were tested. But the
 * flag that selects between two of them — `hasSnapshotRef` in useMemoryKey —
 * was declared, read to make the decision, documented as "called by
 * useJournalMemory", and written by NOTHING. It was permanently false, so a
 * user with a journal anchored on-chain who opened Lumen on a new device was
 * told "This is a new journal on this device" and pointed at the wrong next
 * step. 500-odd passing tests, zero of them touching the wiring.
 *
 * The repo has no React Testing Library and no vi.mock by convention, so hooks
 * are not render-tested. These are source-level assertions instead: crude, but
 * they fail on exactly the thing that failed.
 */

const HOOKS = join(process.cwd(), 'lib', 'hooks');

function hookFiles(): string[] {
  return readdirSync(HOOKS).filter((f) => /\.tsx?$/.test(f) && !f.includes('.test.'));
}

describe('a ref that decides something must be written by something', () => {
  it.each(hookFiles())('%s has no read-only useRef', (file) => {
    const src = readFileSync(join(HOOKS, file), 'utf8');
    const declared = [...src.matchAll(/const\s+(\w+)\s*=\s*useRef[<(]/g)].map((m) => m[1]!);

    const unwritten = declared.filter((name) => {
      // Read to make a decision?
      const isRead = new RegExp(`\\b${name}\\.current\\b(?!\\s*=[^=])`).test(src);
      if (!isRead) return false;
      // Assigned directly?
      if (new RegExp(`\\b${name}\\.current\\s*=[^=]`).test(src)) return false;
      // Handed to React or to a caller, which may write it for us.
      if (new RegExp(`ref=\\{${name}\\}|return\\s+${name}\\b|[(,]\\s*${name}\\s*[),]`).test(src)) {
        return false;
      }
      return true;
    });

    expect(unwritten, `${file}: read but never written — ${unwritten.join(', ')}`).toEqual([]);
  });
});

describe('the unlock notice can actually reach its hasSnapshot branch', () => {
  const key = readFileSync(join(HOOKS, 'useMemoryKey.tsx'), 'utf8');

  it('derives the notice rather than capturing it at unlock time', () => {
    // `hasSnapshot` resolves from an async contract read that usually lands
    // AFTER the user unlocks. A notice captured in admit() would keep giving
    // the wrong advice for the rest of the session, which is why there is no
    // setNotice here any more.
    expect(key).not.toContain('setNotice');
    expect(key).toMatch(/const notice = useMemo\(/);
  });

  it('exposes a reporter, and something outside the provider calls it', () => {
    expect(key).toContain('reportSnapshot');

    const callers = ['useJournalMemory.ts', 'useSeal.ts', 'useCompanion.ts', 'useAnchorArchive.ts']
      .map((f) => {
        try {
          return readFileSync(join(HOOKS, f), 'utf8');
        } catch {
          return '';
        }
      })
      .concat(readFileSync(join(process.cwd(), 'components', 'Journal.tsx'), 'utf8'))
      .filter((src) => /reportSnapshot\(/.test(src));

    // Two independent halves must report: the local pointer (useJournalMemory)
    // and the on-chain anchored root (Journal). The second is the one with no
    // local pointer at all — the fresh-device case the branch exists for.
    expect(callers.length).toBeGreaterThanOrEqual(2);
  });

  it('folds the two halves without either being able to veto the other', () => {
    // Both report only `true`. A reporter that also wrote `false` would race
    // the other and flip the notice back and forth.
    const journal = readFileSync(join(process.cwd(), 'components', 'Journal.tsx'), 'utf8');
    const memory = readFileSync(join(HOOKS, 'useJournalMemory.ts'), 'utf8');
    for (const [name, src] of [['Journal.tsx', journal], ['useJournalMemory.ts', memory]] as const) {
      expect(src, `${name} must not report false`).not.toMatch(/reportSnapshot\(\s*false\s*\)/);
    }
  });
});
