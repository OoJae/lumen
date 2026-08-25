'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';

/**
 * The wallet control.
 *
 * This used to be a stub, and the comment saying so outlived it by two waves:
 * connecting now derives the key that encrypts the journal, signs and pays for
 * every 0G Storage upload, and mints and anchors the companion INFT. Reflection
 * still needs no wallet at all — that stays deliberate, and is why this control
 * is quiet rather than a gate.
 */
export function ConnectWallet() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;
        return (
          <div
            style={{ opacity: ready ? 1 : 0 }}
            aria-hidden={!ready}
            className="transition-opacity"
          >
            {connected && chain.unsupported ? (
              // Never render a normal-looking address while the wallet is on a
              // chain Lumen doesn't write to.
              <button
                type="button"
                onClick={openChainModal}
                className="rounded-full border border-caution/50 bg-caution/10 px-3.5 py-1.5 text-sm font-medium text-caution transition-colors hover:border-caution"
              >
                Wrong network
              </button>
            ) : connected ? (
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
                title="Connect a wallet to encrypt and save your journal to 0G, and to mint your companion"
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
