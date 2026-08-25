import { Providers } from '../providers';

/**
 * Everything that can touch a wallet.
 *
 * wagmi, RainbowKit, TanStack Query and the memory-key context are ~260 KB of
 * JavaScript, and they used to sit in the root layout — so a visitor reading a
 * public proof page downloaded the entire wallet stack to look at read-only
 * text. This group is the boundary: routes under it can connect, sign and pay;
 * routes outside it cannot, and do not pay for the ability.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
