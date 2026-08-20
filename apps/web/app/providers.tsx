'use client';

import '@rainbow-me/rainbowkit/styles.css';
import { useEffect, useState, type ReactNode } from 'react';
import { RainbowKitProvider, getDefaultConfig, lightTheme } from '@rainbow-me/rainbowkit';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { activeChain } from '@/lib/0g/chain';
import { MemoryKeyProvider } from '@/lib/hooks/useMemoryKey';
import { auditMutationCache, leakReport } from '@/lib/crypto/cacheAudit';

// Exactly ONE chain is registered — the network this build talks to. Offering a
// second chain in the switcher would invite users into the wrong-chain state we
// then have to nag them out of, and it makes RainbowKit's own `chain.unsupported`
// meaningless. `switchChain` still works because the target IS the configured chain.
const chain = activeChain();

const wagmiConfig = getDefaultConfig({
  appName: 'Lumen',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'lumen-wavehack',
  chains: [chain],
  ssr: true,
});

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  /**
   * A standing check that the wallet signature never reaches the cache.
   *
   * docs/privacy-model.md says the signature "never leaves the signing
   * ceremony"; it used to sit in the MutationCache for five minutes after every
   * unlock, because useSignMessage is a useMutation wrapper. The fix was to
   * call wagmi's signMessage action directly. This makes that fix load-bearing
   * rather than incidental: reintroduce a signing hook and the console says so.
   * Dev only — it is a guard for us, not a runtime cost for users.
   */
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const cache = queryClient.getMutationCache();
    return cache.subscribe(() => {
      const report = leakReport(
        auditMutationCache(
          cache.getAll().map((m) => ({
            mutationKey: m.options.mutationKey,
            data: m.state.data,
            variables: m.state.variables,
          })),
        ),
      );
      if (report) console.error(report);
    });
  }, [queryClient]);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          initialChain={chain}
          modalSize="compact"
          theme={lightTheme({
            accentColor: '#b45309',
            accentColorForeground: '#fffdf8',
            borderRadius: 'medium',
            fontStack: 'system',
          })}
        >
          <MemoryKeyProvider>{children}</MemoryKeyProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
