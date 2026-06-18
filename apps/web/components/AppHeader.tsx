import { ThemeToggle } from './ThemeToggle';
import { ConnectWallet } from './ConnectWallet';

export function AppHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border/70 bg-canvas/85 backdrop-blur-sm">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3.5">
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-xl tracking-tight text-ink">Lumen</span>
          <span className="hidden text-xs text-muted sm:inline">· private by proof</span>
        </div>
        <div className="flex items-center gap-2.5">
          <ConnectWallet />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
