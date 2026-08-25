import type { Metadata } from 'next';

import { Landing } from '@/components/marketing/Landing';
import { MarketingHeader } from '@/components/marketing/MarketingHeader';

export const metadata: Metadata = {
  title: 'Lumen — Own your mind. Prove your privacy.',
  description:
    'A private place to think. Your entries are encrypted on your device, your reflections run inside a hardware enclave, and you can check the proof yourself — no wallet, no account, nothing to install.',
};

export default function LandingPage() {
  return (
    <>
      <MarketingHeader />
      <main id="main">
        <Landing />
      </main>
    </>
  );
}
