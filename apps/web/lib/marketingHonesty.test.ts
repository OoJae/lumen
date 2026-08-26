import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The marketing surface may not outrun the app's own honesty.
 *
 * This exists because it already happened. lib/0g/attestation.ts carries a
 * Wave 3 correction in its header — our provider's on-chain record reads
 * `ProviderType: centralized, ProviderIdentity: aliyun`, so the model runs at an
 * UPSTREAM HOST and the enclave is a sealed proxy; "earlier copy said the model
 * ran inside the enclave. It doesn't, so we don't say it." Three marketing pages
 * then shipped saying exactly that, with no mention of the upstream host
 * anywhere in the group. A whole session spent hunting overclaims, and the
 * retired one went on the front door.
 *
 * Static, because these are strings in server components with no seam to test
 * through. Crude beats absent: the failure mode is a sentence, so a sentence is
 * what gets checked.
 */

/**
 * The whole user-visible surface, not just the marketing pages.
 *
 * The first version of this guard covered app/(marketing) and
 * components/marketing only — and the app itself then said the retired thing in
 * THREE places that shipped: the attestation viewer's verified subtitle, the
 * journal's onboarding list, and the system prompt the model speaks from. A
 * scope that stops at the marketing folder is a guard that watches the door
 * while the window is open.
 */
const MARKETING = [
  join(process.cwd(), 'app'),
  join(process.cwd(), 'components'),
  join(process.cwd(), 'lib', 'prompts.ts'),
];

function sources(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // A file path rather than a directory — read it directly.
      out.push([dir.replace(process.cwd(), ''), readFileSync(dir, 'utf8')]);
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        out.push([full.replace(process.cwd(), ''), readFileSync(full, 'utf8')]);
      }
    }
  };
  MARKETING.forEach(walk);
  return out;
}

const FILES = sources();

describe('the marketing pages exist and are being read', () => {
  it('found source files — otherwise every check below is vacuous', () => {
    expect(FILES.length).toBeGreaterThan(4);
  });
});

describe('no page may claim the model runs inside the enclave', () => {
  // The claim attestation.ts explicitly retired. The enclave attests the
  // session; the upstream host does the processing.
  const BANNED = [
    /runs? inside a hardware enclave/i,
    /running the model inside/i,
    /model runs inside the enclave/i,
    /processed inside a hardware enclave/i,
  ];

  it.each(FILES)('%s', (_path, src) => {
    for (const pattern of BANNED) {
      expect(pattern.test(src), `matched ${pattern}`).toBe(false);
    }
  });
});

describe('no page may claim Lumen cannot see what you write', () => {
  // The gateway IS in the plaintext path. Same rule the system prompt carries.
  const BANNED = [
    /nobody at lumen/i,
    /no one at lumen/i,
    /not even lumen/i,
    /lumen (?:can ?not|cannot|can't) see/i,
    /we (?:can ?not|cannot|can't) see what you write/i,
  ];

  it.each(FILES)('%s', (_path, src) => {
    for (const pattern of BANNED) {
      expect(pattern.test(src), `matched ${pattern}`).toBe(false);
    }
  });
});

describe('no page may promise transfers or offline', () => {
  it.each(FILES)('%s', (_path, src) => {
    // Transfers revert; there is no service worker.
    expect(/transfer(?:able|s) (?:your|the) companion/i.test(src)).toBe(false);
    expect(/works offline|available offline|offline access/i.test(src)).toBe(false);
  });
});

describe('the pages that explain the model DO name the upstream host', () => {
  // The negative rules above are not enough: silence is its own overclaim. Any
  // page that describes how inference works owes the reader the full list of
  // who is inside the session.
  const EXPLAINERS = FILES.filter(
    ([path]) => path.includes('how-it-works') || path.includes('proof'),
  );

  it('there are pages to check', () => {
    expect(EXPLAINERS.length).toBe(2);
  });

  it.each(EXPLAINERS)('%s names the upstream model host', (_path, src) => {
    expect(/upstream (?:model )?host/i.test(src)).toBe(true);
  });

  it.each(EXPLAINERS)('%s names Lumen’s own server as a reader', (_path, src) => {
    expect(/in the clear/i.test(src)).toBe(true);
  });
});

describe('the lamp may not put text below AA', () => {
  /**
   * The lamp composites amber under the copy it lights, so the effective
   * background inside the pool is not --canvas. Shipped at 0.26 alpha over
   * rgb(16,15,12) that is about rgb(76,52,12), and the app's own --muted
   * measures 3.67:1 against it — under the 4.5 floor for normal text, on the
   * eyebrow and the hero subhead. These two numbers are load-bearing together:
   * raising either one alone puts it back under.
   */
  function luminance([r, g, b]: number[]): number {
    const f = (v: number) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
  }
  function ratio(a: number[], b: number[]): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  }
  function composite(fg: number[], alpha: number, bg: number[]): number[] {
    return fg.map((v, i) => Math.round(v * alpha + bg[i]! * (1 - alpha)));
  }

  const CANVAS = [16, 15, 12];
  const AMBER = [245, 158, 11];

  function shippedAlpha(): number {
    const src = readFileSync(join(process.cwd(), 'components/marketing/LampScene.tsx'), 'utf8');
    const m = /float alpha = glow \* ([\d.]+)/.exec(src);
    expect(m, 'could not read the lamp alpha from the shader').not.toBeNull();
    return Number(m![1]);
  }

  function shippedMuted(): number[] {
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    const block = css.slice(css.indexOf('.lumen-night {'));
    const m = /--muted:\s*#([0-9a-f]{6})/i.exec(block);
    expect(m, 'the marketing group must override --muted').not.toBeNull();
    const hex = m![1]!;
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }

  it('secondary text clears 4.5:1 at the brightest point of the lamp', () => {
    const inPool = composite(AMBER, shippedAlpha(), CANVAS);
    expect(ratio(shippedMuted(), inPool)).toBeGreaterThanOrEqual(4.5);
  });

  it('and still clears it out in the dark, where most of the page is', () => {
    expect(ratio(shippedMuted(), CANVAS)).toBeGreaterThanOrEqual(4.5);
  });
});
