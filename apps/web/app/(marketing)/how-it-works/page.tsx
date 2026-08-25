import type { Metadata } from 'next';
import Link from 'next/link';

import { activeNetwork } from '@/lib/0g/network';
import { LumenMark } from '@/components/marketing/LumenMark';
import { MarketingHeader } from '@/components/marketing/MarketingHeader';

/**
 * Write, reflect, seal — at length.
 *
 * The three beats are the same three the app's own onboarding sheet uses, in the
 * same order and the same voice, because a marketing page that tells a different
 * story from the product is how the two drift apart. This one has room to say
 * what each step costs and what it does not do, which the sheet does not.
 */

export const metadata: Metadata = {
  title: 'How it works — Lumen',
  description:
    'Write, reflect, seal. What each step actually does, what it costs, and where the honest limits are.',
};

export const dynamic = 'force-static';

interface Step {
  n: string;
  title: string;
  lede: string;
  detail: string;
  /** The line most products would leave out. */
  limit: string;
}

const STEPS: Step[] = [
  {
    n: '01',
    title: 'You write',
    lede: 'Straight into the page. No account, no wallet, no setup.',
    detail:
      'The composer is the first thing on screen and it works immediately — the prompt of the day is a suggestion, not a form. Nothing is uploaded while you type. Until you choose to save, everything lives in this browser.',
    limit:
      'A journal that only lives in one browser is one cleared cache away from gone. That is why step three exists, and why it is your decision rather than a default.',
  },
  {
    n: '02',
    title: 'It reflects',
    lede: 'Inside a hardware enclave, and your browser checks the receipt.',
    detail:
      'Your entry goes to a 0G Compute provider running the model inside a TEE, so the operator of that hardware cannot read it. Then the interesting part: your browser fetches the enclave’s signature, hashes the exact bytes it received, recovers the signer, and compares it to the address that provider registered on-chain. Tap the badge on any reply to see all three checks and the recovered address.',
    limit:
      'For the length of that call, the request passes through Lumen’s own server in the clear. Verification proves the reply was not altered; it does not mean nobody saw the prompt. Removing us from that path needs browser-direct inference, which is designed and not shipped.',
  },
  {
    n: '03',
    title: 'You seal it',
    lede: 'One signature to encrypt. One transaction to own it.',
    detail:
      'A single wallet signature derives your key — free, not a transaction, and it never leaves your device. Everything you keep is encrypted with it first. Then your wallet, not Lumen, uploads the encrypted snapshot to 0G Storage and pays for it, and anchors its root on your companion. Restore it on any device with the same wallet.',
    limit:
      'Lose the wallet and the recovery key together and the journal is unrecoverable. There is no reset, because a reset is a back door with better manners. Export the recovery key the day you start.',
  },
];

export default function HowItWorksPage() {
  const net = activeNetwork();

  return (
    <>
      <MarketingHeader />
      <main id="main" className="px-5 pb-[14svh] pt-[22svh] sm:px-8">
        <div className="mx-auto max-w-2xl">
          <p className="mb-7 text-[11px] uppercase tracking-[0.14em] text-muted">How it works</p>
          <h1 className="font-display text-[clamp(2.25rem,6vw,4.5rem)] leading-[1.0] tracking-[-0.03em] text-ink">
            Three steps. Each one leaves evidence.
          </h1>
          <p className="mt-7 max-w-lg text-[clamp(1rem,1.1vw,1.15rem)] leading-relaxed text-muted">
            Nothing below is aspirational — it is what the app does today, including the parts
            that are not finished.
          </p>

          <ol className="mt-16 space-y-0">
            {STEPS.map((s) => (
              <li key={s.n} className="border-t border-border/60 py-9 last:border-b">
                <div className="grid grid-cols-[2.5rem_1fr] gap-x-5 sm:grid-cols-[4rem_1fr]">
                  <span className="pt-1.5 font-mono text-xs text-accent/80">{s.n}</span>
                  <div>
                    <h2 className="font-display text-[clamp(1.5rem,3vw,2.25rem)] leading-tight tracking-[-0.02em] text-ink">
                      {s.title}
                    </h2>
                    <p className="mt-2 font-serif text-[1.1rem] leading-relaxed text-ink/85">
                      {s.lede}
                    </p>
                    <p className="mt-5 text-sm leading-relaxed text-muted">{s.detail}</p>
                    <p className="mt-5 rounded-xl border border-border bg-canvas/40 px-4 py-3 text-sm leading-relaxed text-muted">
                      <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-caution">
                        The limit
                      </span>
                      {s.limit}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>

          <section className="mt-20">
            <h2 className="font-display text-[clamp(1.5rem,3.5vw,2.5rem)] leading-[1.1] tracking-[-0.02em] text-ink">
              What it costs
            </h2>
            <dl className="mt-7 space-y-0 text-sm">
              {[
                ['Writing and reflecting', 'Free. No wallet, no account, no limit worth mentioning.'],
                ['Deriving your key', 'Free. It is a signature, not a transaction — no gas.'],
                ['Saving to 0G Storage', `A storage fee your wallet pays, on ${net.label}. Cents, not dollars.`],
                ['Minting your companion', 'One transaction, once. Roughly ten times an anchor, because the token’s label is written on-chain.'],
                ['Anchoring a new root', 'One transaction each time you seal. The cheapest thing here.'],
              ].map(([term, def]) => (
                <div
                  key={term}
                  className="grid grid-cols-1 gap-1 border-b border-border/60 py-4 last:border-0 sm:grid-cols-[14rem_1fr] sm:gap-5"
                >
                  <dt className="text-ink/85">{term}</dt>
                  <dd className="text-muted">{def}</dd>
                </div>
              ))}
            </dl>
          </section>

          <div className="mt-20 flex flex-col items-center gap-6 text-center">
            <LumenMark cut="display" size={28} className="text-accent" />
            <p className="max-w-sm text-sm leading-relaxed text-muted">
              The proof is something you check, not something we assert.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/write"
                className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-[#100f0c] transition-[transform,opacity] duration-300 hover:-translate-y-0.5 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
              >
                Start writing
                <span aria-hidden>→</span>
              </Link>
              <Link
                href="/proof"
                className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm text-muted transition-colors hover:border-accent/40 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Check it yourself
              </Link>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
