import Link from 'next/link';

import { LumenMark } from './LumenMark';

/**
 * The marketing header.
 *
 * Deliberately NOT components/AppHeader — that one renders ConnectWallet, which
 * imports RainbowKit, which would pull the entire wallet stack back into a route
 * group whose whole purpose is not having it. Every link here is a plain
 * navigation; nothing in this subtree may connect anything.
 */
export function MarketingHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-30">
      <nav
        className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4 sm:px-8 sm:py-5"
        aria-label="Main"
      >
        <Link
          href="/"
          className="group inline-flex items-center gap-2.5 rounded-full text-ink/90 transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          <LumenMark cut="display" size={16} className="text-accent" title="Lumen" />
          <span className="font-display text-lg leading-none tracking-tight">Lumen</span>
        </Link>

        <div className="flex items-center gap-1">
          {/* Hidden below `sm`, where four items in a 375px row collapse into
              an unreadable strip. Both destinations are reachable from the
              footer nav at the end of the page, so nothing is lost — and the
              one action worth keeping in the corner is the one that starts you
              writing. */}
          <Link
            href="/how-it-works"
            className="hidden rounded-full px-3 py-1.5 text-xs text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:inline-block"
          >
            How it works
          </Link>
          <Link
            href="/proof"
            className="hidden rounded-full px-3 py-1.5 text-xs text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:inline-block"
          >
            Proof
          </Link>
          <Link
            href="/write"
            className="ml-1 rounded-full border border-accent/40 bg-accent-soft px-3.5 py-1.5 text-xs font-medium text-accent transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Start writing
          </Link>
        </div>
      </nav>
    </header>
  );
}
