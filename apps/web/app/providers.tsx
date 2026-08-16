'use client';

import '@rainbow-me/rainbowkit/styles.css';
import { useState, type ReactNode } from 'react';
import { RainbowKitProvider, getDefaultConfig, lightTheme } from '@rainbow-me/rainbowkit';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { activeChain } from '@/lib/0g/chain';
import { MemoryKeyProvider } from '@/lib/hooks/useMemoryKey';

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
