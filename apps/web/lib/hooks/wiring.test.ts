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
      // Handed to React or to a caller, which may write it for us. A hook that
      // returns its ref inside an object literal — `return { ref, progress }` —
      // counts: the consumer attaches it, and React does the writing.
      if (
        new RegExp(`ref=\\{${name}\\}|return\\s+${name}\\b|[(,]\\s*${name}\\s*[),]`).test(src) ||
        new RegExp(`return \\{[^}]*\\b${name}\\b[^}]*\\}`, 's').test(src)
      ) {
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

describe('hooks are called unconditionally', () => {
  // A hook after an early return runs on some renders and not others, and React
  // throws "rendered more hooks than during the previous render" the moment the
  // condition flips. StorageReceiptViewer shipped exactly that: the focus-trap
  // hook was inserted below `if (!receipt) return null;`, so it would have
  // crashed the dialog the first time a receipt arrived.
  //
  // Scoped per top-level function — one file holds several components, and an
  // early return in the first says nothing about hooks in the second.
  const COMPONENTS = join(process.cwd(), 'components');

  function bodies(src: string): Array<{ name: string; body: string }> {
    const heads = [...src.matchAll(/^(?:export )?function (\w+)\(/gm)];
    return heads.map((h, i) => ({
      name: h[1]!,
      body: src.slice(h.index!, i + 1 < heads.length ? heads[i + 1]!.index! : src.length),
    }));
  }

  it.each(readdirSync(COMPONENTS).filter((f) => f.endsWith('.tsx')))(
    '%s calls no hook after an early return',
    (file) => {
      const offenders: string[] = [];
      for (const { name, body } of bodies(readFileSync(join(COMPONENTS, file), 'utf8'))) {
        // Component bodies sit at 2-space indent; nested helpers are deeper.
        const early = /^ {2}if \([^\n]*\)\s*return\b/m.exec(body);
        if (!early) continue;
        for (const m of body.slice(early.index).matchAll(/^ {2}const .*?= (use[A-Z]\w*)[<(]/gm)) {
          offenders.push(`${name}:${m[1]!}`);
        }
      }
      expect(offenders, `${file}: hook(s) after an early return — ${offenders.join(', ')}`).toEqual(
        [],
      );
    },
  );
});

describe('cross-hook callbacks stay stable', () => {
  // useJournalMemory calls memoryKey.confirmKeyProven() from inside useCallbacks
  // whose dep arrays hold only render-stable values. Any callback on the key
  // context that changes identity is therefore captured on the FIRST render —
  // before a wallet exists — and silently no-ops forever. confirmKeyProven did
  // exactly that: a fresh-device recovery unlock never got promoted to 'proven'
  // even after a snapshot decrypted, so the UI kept asking for a restore the
  // user had already done.
  const src = readFileSync(join(HOOKS, 'useMemoryKey.tsx'), 'utf8');

  it.each(['confirmKeyProven', 'reportSnapshot', 'getKey'])(
    '%s is memoised with an empty dependency array',
    (name) => {
      const at = src.indexOf(`const ${name} = useCallback(`);
      expect(at, `${name}: not a useCallback`).toBeGreaterThan(-1);
      // The deps are the last bracketed list before the call closes. Take the
      // next `}, [...]);` or, for a one-liner, the trailing `, [...]);`.
      const deps = /,\s*(\[[^\]]*\])\s*\);/.exec(src.slice(at));
      expect(deps, `${name}: could not read deps`).not.toBeNull();
      expect(deps![1]!.replace(/\s/g, ''), `${name} deps`).toBe('[]');
    },
  );
});
