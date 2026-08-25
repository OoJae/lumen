'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { useScrollScene } from '@/lib/hooks/useScrollScene';
import { CipherReveal } from './CipherReveal';
import { LumenMark } from './LumenMark';

/**
 * One scene, four beats: open, write, the pass, the seal.
 *
 * The whole page is a single light journey driven by one scroll value. There is
 * deliberately no second animation system, no reveal-on-every-section, no
 * marquee — scattered motion is the tell, and the light is the only thing here
 * allowed to be loud.
 *
 * The 3D loads AFTER first paint (ssr:false, no loading state), so the largest
 * thing on screen at LCP is the headline text. If WebGL never arrives, or fails,
 * the page is complete without it: every word is already lit.
 */
const LampScene = dynamic(() => import('./LampScene'), { ssr: false });

export function Landing() {
  const { ref, progress, reduced } = useScrollScene<HTMLDivElement>();
  const [lampReady, setLampReady] = useState(false);

  /**
   * The scroll value reaches the scene through a REF, never a prop.
   *
   * Passing `progress` as a prop re-rendered <Canvas> on every scroll frame,
   * and r3f re-runs its configure + root.render on each of those — so the
   * "held in a ref so scroll does not re-render the tree" comment inside
   * LampScene was being defeated by the prop sitting next to it.
   */
  const progressRef = useRef(0);
  progressRef.current = progress;

  // Mount the canvas a beat after paint. `requestIdleCallback` where it exists,
  // because the headline should win the main thread first.
  useEffect(() => {
    if (reduced) return; // A static page needs no scene at all.
    const start = () => setLampReady(true);

    // Idle where it exists (Safari still lacks it), otherwise a short timeout.
    // Either way the headline gets the main thread first. Captured rather than
    // tested with `in`, which narrows `window` to never in the else branch.
    const idle: typeof window.requestIdleCallback | undefined = window.requestIdleCallback;
    if (idle) {
      const id = idle.call(window, start, { timeout: 1200 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(start, 300);
    return () => window.clearTimeout(timer);
  }, [reduced]);

  return (
    <div ref={ref} className="relative">
      {/* The scene is fixed behind everything and scrubbed by the scroll value.
          `-z-10` keeps it behind text without taking it out of the stacking
          context that the header sits above. */}
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
        {/* `!reduced` here as well as at mount: the media query has a change
            listener, and without this a visitor who turns reduced motion ON
            mid-visit kept a spinning scene. */}
        {lampReady && !reduced && <LampScene progressRef={progressRef} />}
      </div>

      {/* ── 01 OPEN ─────────────────────────────────────────────────────── */}
      <section className="relative flex min-h-[100svh] flex-col items-center justify-center px-5 text-center">
        <p className="mb-7 text-[11px] uppercase tracking-[0.14em] text-muted">
          Lumen · private by proof
        </p>

        <h1 className="font-display text-[clamp(2.75rem,8vw,7.5rem)] font-normal leading-[0.95] tracking-[-0.03em] text-ink">
          <Line delay={0}>Write the thing</Line>
          <Line delay={0.08}>you would not</Line>
          <Line delay={0.16}>say out loud.</Line>
        </h1>

        <p className="mt-9 max-w-md text-[clamp(1rem,1.1vw,1.15rem)] leading-relaxed text-muted">
          A private place to think. No wallet, no account, nothing to install.
        </p>

        <Link
          href="/write"
          className="group mt-9 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-[#100f0c] transition-[transform,opacity] duration-300 hover:-translate-y-0.5 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          Start writing
          <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-0.5">
            →
          </span>
        </Link>

        <p className="absolute bottom-8 text-[11px] uppercase tracking-[0.14em] text-muted/70">
          Scroll
        </p>
      </section>

      {/* ── 02 THE PASS ─────────────────────────────────────────────────── */}
      {/* Tall for scroll room, but the CONTENT is pinned: the copy holds still
          while the light and the substitution move through it. Scrolling past a
          static block left a screen of void below the paragraph and made the
          sweep feel like something happening somewhere else. */}
      <section className="relative min-h-[190svh] px-5">
        <div className="sticky top-0 flex min-h-[100svh] items-center justify-center">
          <div className="w-full max-w-2xl">
            <h2 className="mb-9 max-w-lg font-display text-[clamp(1.75rem,4vw,3.25rem)] leading-[1.05] tracking-[-0.02em] text-ink">
              Everything Lumen keeps, it keeps unreadable.
            </h2>
            <CipherReveal progress={progress} reduced={reduced} />
          </div>
        </div>
      </section>

      {/* ── 03 THE SEQUENCE ─────────────────────────────────────────────── */}
      <section className="relative px-5 py-[14svh]">
        <div className="mx-auto max-w-2xl">
          <h2 className="mb-12 max-w-lg font-display text-[clamp(1.75rem,4vw,3.25rem)] leading-[1.05] tracking-[-0.02em] text-ink">
            Three steps, and you can check every one.
          </h2>
          <ol className="space-y-0">
            {STEPS.map((step, i) => (
              <li
                key={step.title}
                className="grid grid-cols-[2.5rem_1fr] gap-x-5 border-t border-border/60 py-7 last:border-b sm:grid-cols-[4rem_1fr]"
              >
                <span className="font-mono text-xs text-accent/80">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <h3 className="font-serif text-lg leading-tight text-ink">{step.title}</h3>
                  <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── 04 THE SEAL ─────────────────────────────────────────────────── */}
      <section className="relative flex min-h-[85svh] flex-col items-center justify-center px-5 text-center">
        <LumenMark cut="display" size={44} className="mb-9 text-accent" />
        <h2 className="max-w-2xl font-display text-[clamp(1.75rem,4.5vw,3.5rem)] leading-[1.05] tracking-[-0.02em] text-ink">
          Now write the real one.
        </h2>
        <p className="mt-6 max-w-sm text-sm leading-relaxed text-muted">
          The proof is something you check, not something we assert. Start with one sentence.
        </p>
        <Link
          href="/write"
          className="group mt-9 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-[#100f0c] transition-[transform,opacity] duration-300 hover:-translate-y-0.5 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          Open the journal
          <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-0.5">
            →
          </span>
        </Link>

        <nav className="mt-16 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted">
          <Link href="/how-it-works" className="underline-offset-4 hover:text-ink hover:underline">
            How it works
          </Link>
          <Link href="/proof" className="underline-offset-4 hover:text-ink hover:underline">
            Check it yourself
          </Link>
          <a
            href="https://github.com/OoJae/lumen"
            className="underline-offset-4 hover:text-ink hover:underline"
          >
            Source
          </a>
        </nav>
      </section>
    </div>
  );
}

/**
 * A headline line, masked and lifted.
 *
 * Reveals by LINE, not by letter — letter-by-letter on a three-line headline is
 * the animation equivalent of shouting, and this page has already chosen where
 * it is loud. Pure CSS so it runs before any JavaScript scene is ready, and it
 * is `animation`, so `prefers-reduced-motion` in globals.css turns it off and
 * leaves the text exactly where it belongs.
 */
function Line({ children, delay }: { children: React.ReactNode; delay: number }) {
  return (
    <span className="block overflow-hidden">
      <span className="lumen-line block" style={{ animationDelay: `${delay}s` }}>
        {children}
      </span>
    </span>
  );
}

const STEPS = [
  {
    title: 'You write',
    body: 'Straight into the page, with nothing between you and it. No account, no wallet, no setup — the composer is the first thing on screen.',
  },
  {
    title: 'It reflects',
    body: 'Your entry is processed inside an attested enclave session, and your browser checks the enclave’s signature over the exact bytes it received. Tap the badge on any reply for the proof — and for who is inside that session, read from the provider’s own on-chain record.',
  },
  {
    title: 'You seal it',
    body: 'When it is worth keeping, one signature encrypts your journal with a key only your wallet can derive, and your wallet — not Lumen — saves it to 0G and owns it there.',
  },
];
