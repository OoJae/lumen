import Link from 'next/link';

import { LumenMark } from './marketing/LumenMark';
import { ThemeToggle } from './ThemeToggle';
import { ConnectWallet } from './ConnectWallet';
import { NetworkBadge } from './NetworkBadge';

export function AppHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border/70 bg-canvas/85 backdrop-blur-sm">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3.5">
        {/* The mark, so the journal and the landing are visibly the same
            product — and a way back, which the journal did not have. The
            wordmark deliberately keeps the app's reading serif rather than the
            marketing display face: this is a notebook, not a billboard. */}
        <Link href="/" className="group flex items-baseline gap-2 rounded-full">
          <LumenMark size={13} className="translate-y-[1px] text-accent" title="Lumen — home" />
          <span className="font-serif text-xl tracking-tight text-ink">Lumen</span>
          <span className="hidden text-xs text-muted sm:inline">· private by proof</span>
        </Link>
        <div className="flex items-center gap-2.5">
          <NetworkBadge />
          <ConnectWallet />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
