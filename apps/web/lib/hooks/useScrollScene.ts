'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * One scroll value for one orchestrated scene.
 *
 * The whole landing page is a single light journey, so it needs a single
 * progress number rather than a dozen scattered observers. This returns 0 at the
 * moment the element's top reaches the viewport top and 1 when its bottom does,
 * clamped, updated on rAF so nothing reads layout inside a scroll handler.
 *
 * Returns 1 immediately (scene resolved, everything lit and legible) when the
 * visitor prefers reduced motion — the page must never depend on scroll to
 * become readable.
 */
export function useScrollScene<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [progress, setProgress] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      setReduced(query.matches);
      if (query.matches) setProgress(1);
    };
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (reduced) return;
    const el = ref.current;
    if (!el) return;

    let frame = 0;
    let last = -1;

    const measure = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      // A scene shorter than the viewport cannot be scrubbed; treat it as done
      // rather than dividing by zero and pinning the light at its start.
      const next = travel <= 0 ? 1 : Math.min(1, Math.max(0, -rect.top / travel));
      // Skip sub-pixel churn: this drives a shader uniform and a CSS variable.
      if (Math.abs(next - last) < 0.0005) return;
      last = next;
      setProgress(next);
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [reduced]);

  return { ref, progress, reduced };
}
