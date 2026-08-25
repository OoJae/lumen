import { LumenMark } from './marketing/LumenMark';
import { ThemeToggle } from './ThemeToggle';
import { ConnectWallet } from './ConnectWallet';
import { NetworkBadge } from './NetworkBadge';

export function AppHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border/70 bg-canvas/85 backdrop-blur-sm">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3.5">
        {/*
          NOT a link, and that is deliberate.
          
          It was `href="/"` for one commit. `/` is now the marketing landing,
          which lives in a different route group — so following it unmounts
          <Providers> and with them MemoryKeyProvider, whose key lives in a ref
          by design. One tap on what looks like a logo therefore threw away any
          unsubmitted draft (the composer holds it in plain useState, and a
          client-side nav fires no beforeunload) and silently re-locked the
          journal, demanding a second wallet signature to see entries that were
          unlocked seconds earlier. A logo is not worth that.

          The wordmark keeps the app's reading serif rather than the marketing
          display face: this is a notebook, not a billboard. The marketing pages
          remain reachable from the footer, where a link looks like a link.
        */}
        <div className="flex items-baseline gap-2">
          <LumenMark size={13} className="translate-y-[1px] text-accent" title="Lumen" />
          <span className="font-serif text-xl tracking-tight text-ink">Lumen</span>
          <span className="hidden text-xs text-muted sm:inline">· private by proof</span>
        </div>
        <div className="flex items-center gap-2.5">
          <NetworkBadge />
          <ConnectWallet />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
