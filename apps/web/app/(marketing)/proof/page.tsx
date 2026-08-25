import type { Metadata } from 'next';
import Link from 'next/link';

import { activeNetwork } from '@/lib/0g/network';
import { MarketingHeader } from '@/components/marketing/MarketingHeader';
import { LumenMark } from '@/components/marketing/LumenMark';
import { AddressLookup } from '@/components/marketing/AddressLookup';
import { resolveCompanionAddress } from '@lumen/shared';

/**
 * The anti-marketing page.
 *
 * Every AI journal says "your data is encrypted." This is the page that says
 * what that does and does not mean, in the same breath, with the things you can
 * check separated from the things you have to take on trust. It exists because
 * the product's moat is provable privacy, and a moat you cannot inspect is a
 * marketing claim wearing a moat costume.
 *
 * The rule for every row below: if it is in the "checkable" column, a stranger
 * with no wallet and no account must be able to verify it from this page or one
 * click away. If it cannot survive that, it belongs in the other column.
 */

export const metadata: Metadata = {
  title: 'Check it yourself — Lumen',
  description:
    'What Lumen can prove, what it cannot, and how to check both. No wallet, no account, nothing to install.',
};

// Static: nothing here is per-visitor, and the contract address does not move.
export const dynamic = 'force-static';

interface Claim {
  claim: string;
  proven: string;
  /** The part most products leave out. Never empty — if it were, the claim
   *  would be overstated. */
  notProven: string;
  check?: { label: string; href: string; external?: boolean };
}

export default function ProofPage() {
  const net = activeNetwork();
  const contract = resolveCompanionAddress(net.key, process.env.NEXT_PUBLIC_LUMEN_INFT_ADDRESS);
  const explorer = contract ? `${net.explorerUrl}/address/${contract}` : net.explorerUrl;

  const claims: Claim[] = [
    {
      claim: 'This reflection came out of an attested enclave session.',
      proven:
        'Your browser fetches the enclave signature for the response, hashes the exact bytes it received, recovers the signing address, and compares it to the TEE signer that provider registered on-chain. All three have to agree. It runs for every visitor, with no wallet — tap the badge on any reply to watch it.',
      notProven:
        'That only the enclave saw your words. Two parties do. Lumen’s own server relays the prompt in the clear for the length of the call. And our provider’s on-chain record reads `centralized / aliyun` — the enclave is a sealed proxy attesting the request, response and TLS session to an upstream model host, which processes your words inside that session. The enclave operator cannot read them; the upstream host does. Verification catches tampering; it does not shorten that list.',
      check: { label: 'Read the privacy model', href: 'https://github.com/OoJae/lumen/blob/main/docs/privacy-model.md', external: true },
    },
    {
      claim: 'What Lumen stores, it cannot read.',
      proven:
        'Entries are encrypted on your device with AES-GCM before anything is written or uploaded — you can watch it happen on the home page, and you can open DevTools on the journal and read the store yourself: every entry and every embedding is ciphertext. What sits beside them in the clear is bookkeeping, not content — ids, timestamps, deletion markers and the storage pointer that is already public on 0G. The key comes from one wallet signature and never leaves the browser.',
      notProven:
        'That the encryption is unbreakable, or that you cannot lose the key. Lose both your wallet and your recovery key and the journal is gone — there is no reset, because a reset is just a back door with better manners.',
      check: { label: 'Watch it encrypt', href: '/' },
    },
    {
      claim: 'You own the companion, not Lumen.',
      proven:
        'The contract has zero admin keys: no owner, no pause, no upgrade, no mint fee, no settable verifier. It is deployed and source-verified on mainnet, so you can read every line of it rather than believe this sentence.',
      notProven:
        'That you can transfer or sell it. Transfers revert. A compliant ERC-7857 transfer has to re-encrypt the memory to the new owner through a TEE oracle, none is live, and shipping a transfer we could not honour would be worse than not shipping one.',
      check: { label: 'Read the contract', href: explorer, external: true },
    },
    {
      claim: 'The anchor history has not been rewritten.',
      proven:
        'Every anchor event names the root it replaced, so the whole history replays from the log with no gaps and nothing can be inserted or reordered. Both write paths are owner-only, so nobody else can extend it.',
      notProven:
        'That every link went through the compare-and-swap call. The ERC-7857 `update` alias performs no such check and emits a byte-identical event, so a replayer cannot tell them apart. The chain is unbroken and owner-only; that is the honest claim, and it is narrower than the one we could have made.',
      check: { label: 'Replay a real one', href: '/companion/0xB5609C73784Aa81De2eBe01cCC04Eb7ea4ce1a52' },
    },
  ];

  return (
    <>
      <MarketingHeader />
      <main id="main" className="px-5 pb-[14svh] pt-[22svh] sm:px-8">
        <div className="mx-auto max-w-2xl">
          <p className="mb-7 text-[11px] uppercase tracking-[0.14em] text-muted">
            Check it yourself
          </p>
          <h1 className="font-display text-[clamp(2.25rem,6vw,4.5rem)] leading-[1.0] tracking-[-0.03em] text-ink">
            Everything here is checkable by a stranger.
          </h1>
          <p className="mt-7 max-w-lg text-[clamp(1rem,1.1vw,1.15rem)] leading-relaxed text-muted">
            That is the whole point. Below is what Lumen can prove and what it cannot, side by
            side — because a claim you cannot inspect is just a claim.
          </p>

          <ol className="mt-16 space-y-0">
            {claims.map((c, i) => (
              <li key={c.claim} className="border-t border-border/60 py-9 last:border-b">
                <div className="grid grid-cols-[2.5rem_1fr] gap-x-5 sm:grid-cols-[4rem_1fr]">
                  <span className="pt-1 font-mono text-xs text-accent/80">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <h2 className="font-serif text-[1.35rem] leading-snug text-ink">{c.claim}</h2>

                    <p className="mt-5 text-[11px] uppercase tracking-[0.14em] text-accent/90">
                      What you can check
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-ink/85">{c.proven}</p>

                    <p className="mt-6 text-[11px] uppercase tracking-[0.14em] text-muted">
                      What this does not prove
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-muted">{c.notProven}</p>

                    {c.check && (
                      <Link
                        href={c.check.href}
                        {...(c.check.external
                          ? { target: '_blank', rel: 'noreferrer noopener' }
                          : {})}
                        className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs text-muted transition-colors hover:border-accent/40 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        {c.check.label}
                        <span aria-hidden>→</span>
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>

          <section className="mt-20">
            <h2 className="font-display text-[clamp(1.5rem,3.5vw,2.5rem)] leading-[1.1] tracking-[-0.02em] text-ink">
              Look up any companion.
            </h2>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted">
              Paste any wallet address. It reads that companion&apos;s whole story off{' '}
              {net.label} — owner, memory root, every anchor and the day it landed — with no
              wallet, no extension and no account. It reveals nothing about what the owner wrote,
              because there is nothing readable to reveal.
            </p>
            <div className="mt-7">
              <AddressLookup />
            </div>
          </section>

          <section className="mt-20 border-t border-border/60 pt-9">
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted">The contract</p>
            <p className="mt-3 break-all font-mono text-sm text-ink/85">{contract ?? '—'}</p>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Source-verified on {net.label} (chain {net.chainId}). Zero admin keys, one companion
              per wallet, soulbound.{' '}
              <a
                href={explorer}
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-4 hover:text-ink"
              >
                Read it on the explorer
              </a>
              .
            </p>
          </section>

          <div className="mt-20 flex flex-col items-center gap-6 text-center">
            <LumenMark cut="display" size={28} className="text-accent" />
            <Link
              href="/write"
              className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-[#100f0c] transition-[transform,opacity] duration-300 hover:-translate-y-0.5 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
            >
              Start writing
              <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
