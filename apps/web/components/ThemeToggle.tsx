'use client';

import { useEffect, useState } from 'react';
import { SunIcon, MoonIcon } from './icons';

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setMounted(true);
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggle() {
    setDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle('dark', next);
      try {
        localStorage.setItem('lumen-theme', next ? 'dark' : 'light');
      } catch {
        /* ignore storage errors */
      }
      return next;
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="grid h-9 w-9 place-items-center rounded-full border border-border text-muted transition-colors hover:text-ink hover:border-accent/40"
    >
      {/* Render the icon only after mount to avoid a hydration mismatch. */}
      {mounted ? (dark ? <SunIcon /> : <MoonIcon />) : <span className="h-[18px] w-[18px]" />}
    </button>
  );
}
