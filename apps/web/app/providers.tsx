'use client';

import '@rainbow-me/rainbowkit/styles.css';
import { useState, type ReactNode } from 'react';
import { RainbowKitProvider, getDefaultConfig, lightTheme } from '@rainbow-me/rainbowkit';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { zgTestnet, zgMainnet } from '@/lib/0g/chain';

// Wave 1 wallet is a non-transacting "save & own" stub. WalletConnect projectId
// is optional for injected wallets; a placeholder keeps the connector happy.
const wagmiConfig = getDefaultConfig({
  appName: 'Lumen',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'lumen-wavehack',
  chains: [zgTestnet, zgMainnet],
  ssr: true,
});

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          modalSize="compact"
          theme={lightTheme({
            accentColor: '#b45309',
            accentColorForeground: '#fffdf8',
            borderRadius: 'medium',
            fontStack: 'system',
          })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
