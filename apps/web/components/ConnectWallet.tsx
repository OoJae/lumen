'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';

/**
 * Wave 1 wallet stub. Connecting does nothing yet — it's the "save & own" moment
 * we convert on in Wave 2 (encrypted storage) and Wave 3 (mint your companion as
 * an ERC-7857 INFT). Kept deliberately quiet in the UI.
 */
export function ConnectWallet() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openConnectModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;
        return (
          <div
            style={{ opacity: ready ? 1 : 0 }}
            aria-hidden={!ready}
            className="transition-opacity"
          >
            {connected ? (
              <button
                type="button"
                onClick={openAccountModal}
                className="rounded-full border border-accent/40 bg-accent-soft px-3.5 py-1.5 text-sm font-medium text-accent transition-colors hover:border-accent"
              >
                {account.displayName}
              </button>
            ) : (
              <button
                type="button"
                onClick={openConnectModal}
                title="Connect a wallet to save & own your companion (Wave 2–3)"
                className="rounded-full border border-border px-3.5 py-1.5 text-sm font-medium text-muted transition-colors hover:border-accent/50 hover:text-ink"
              >
                Save &amp; own
              </button>
            )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
