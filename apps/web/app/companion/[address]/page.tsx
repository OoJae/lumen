/**
 * The public proof page.
 *
 * Every AI journal on the market says "your data is encrypted." None of them
 * let you check. This page is the check: give it any wallet address and it
 * reads that companion's entire story off 0G mainnet — with no wallet, no
 * extension, no account, and nothing to install — then shows exactly what that
 * does and does not prove.
 *
 * Server-rendered on purpose. The verification a visitor cares about is the one
 * they didn't have to trust us to run.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { shortRoot, utcDay } from '@/lib/0g/anchorHistory';
import { loadCompanionProof, parseAddress, type CompanionProof } from '@/lib/0g/publicProof';

export const runtime = 'nodejs';
// Re-read the chain at most twice a minute. Long enough that the second visitor
// to a shared proof link gets it instantly, short enough that the page is still
// showing the chain rather than a snapshot of our opinion of it.
export const revalidate = 30;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}): Promise<Metadata> {
  const { address } = await params;
  const parsed = parseAddress(address);
  const short = parsed ? `${parsed.slice(0, 6)}…${parsed.slice(-4)}` : 'unknown wallet';
  return {
    title: `Lumen companion — ${short}`,
    description:
      'Verify a Lumen companion on 0G: who owns it, which encrypted memory root it points at, ' +
      'and whether its on-chain pointer history is an unbroken chain. No wallet required.',
  };
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-border/60 py-3 last:border-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <span className="text-sm text-ink sm:text-right">{children}</span>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface px-5 py-1 shadow-sm">
      {children}
    </section>
  );
}

function Heading({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-3 mt-8">
      <h2 className="font-serif text-xl text-ink">{children}</h2>
      {sub && <p className="mt-1 text-sm leading-relaxed text-muted">{sub}</p>}
    </div>
  );
}

/** Renders the anchor chain as a chain — each link showing what it continued. */
function ChainView({ proof }: { proof: CompanionProof }) {
  const { chain, explorerUrl } = proof;

  if (!chain.mint && chain.links.length === 0) {
    return (
      <p className="py-4 text-sm text-muted">
        No mint or anchor events found in the log for this token.
      </p>
    );
  }

  return (
    <ol className="py-1">
      {chain.mint && (
        <li className="border-b border-border/60 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-ink">Minted</span>
            <a
              href={`${explorerUrl}/tx/${chain.mint.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs text-muted underline hover:text-ink"
            >
              {shortRoot(chain.mint.txHash)} ↗
            </a>
          </div>
          <p className="mt-1 text-xs text-muted">
            block {chain.mint.blockNumber.toLocaleString('en-US')}
            {chain.mint.timestamp > 0 && ` · ${utcDay(chain.mint.timestamp)} UTC`}
          </p>
          <p className="mt-1 font-mono text-xs break-all text-ink">
            root at mint: {chain.mint.memoryRoot}
          </p>
        </li>
      )}

      {chain.links.map((link) => (
        <li key={`${link.seq}-${link.txHash}`} className="border-b border-border/60 py-3 last:border-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-ink">
              Anchor #{link.seq}{' '}
              {link.linked ? (
                <span className="text-accent">· continues the chain ✓</span>
              ) : (
                <span className="text-caution">· BREAKS the chain ✗</span>
              )}
            </span>
            <a
              href={`${explorerUrl}/tx/${link.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs text-muted underline hover:text-ink"
            >
              {shortRoot(link.txHash)} ↗
            </a>
          </div>
          <p className="mt-1 text-xs text-muted">
            block {link.blockNumber.toLocaleString('en-US')}
            {link.timestamp > 0 && ` · ${utcDay(link.timestamp)} UTC`}
          </p>
          <p className="mt-1 font-mono text-xs break-all text-muted">
            {shortRoot(link.prevRoot)} → <span className="text-ink">{shortRoot(link.newRoot)}</span>
          </p>
          {!link.linked && (
            <p className="mt-1 text-xs text-caution">
              Expected this anchor to replace {shortRoot(link.expectedPrev)}, but it claims to
              replace {shortRoot(link.prevRoot)}.
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

function StorageView({ proof }: { proof: CompanionProof }) {
  const { storage } = proof;
  if (storage.status === 'available') {
    return (
      <>
        <Row label="Retrievable now">
          <span className="text-accent">
            Yes — served by {storage.replicas} 0G Storage {storage.replicas === 1 ? 'node' : 'nodes'}
          </span>
        </Row>
        <Row label="Readable by them">
          <span className="text-ink">
            No. Those nodes hold AES-GCM ciphertext whose key is derived from the owner&apos;s
            wallet signature and never leaves their device.
          </span>
        </Row>
      </>
    );
  }
  if (storage.status === 'missing') {
    return (
      <Row label="Retrievable now">
        <span className="text-caution">
          The indexer reports no nodes currently serving this root.
        </span>
      </Row>
    );
  }
  return (
    <Row label="Retrievable now">
      <span className="text-muted">Not checked — {storage.reason}</span>
    </Row>
  );
}

export default async function CompanionProofPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address: raw } = await params;
  const address = parseAddress(raw);

  if (!address) {
    return (
      <main className="mx-auto min-h-screen max-w-2xl px-5 py-16">
        <h1 className="font-serif text-2xl text-ink">That isn&apos;t a wallet address</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          A Lumen proof page needs a 40-character hex address, like{' '}
          <span className="font-mono text-xs">0xB5609C73784Aa81De2eBe01cCC04Eb7ea4ce1a52</span>.
        </p>
        <Link href="/" className="mt-6 inline-block text-sm text-accent underline">
          ← Back to Lumen
        </Link>
      </main>
    );
  }

  const proof = await loadCompanionProof(address);
  const hasCompanion = proof.tokenId !== null;

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-5 py-12 sm:py-16">
      <header>
        <Link href="/" className="text-sm text-muted underline hover:text-ink">
          ← Lumen
        </Link>
        <h1 className="mt-4 font-serif text-3xl leading-tight text-ink">
          {hasCompanion ? `Companion #${proof.tokenId}` : 'No companion here'}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Everything below was read straight from {proof.networkLabel} (chain {proof.chainId}),
          no more than 30 seconds ago. You need no wallet, no account and no trust in Lumen to
          check it — and it reveals nothing about what the owner wrote.
        </p>
      </header>

      {proof.error && (
        <p className="mt-6 rounded-xl border border-caution/40 bg-caution/10 px-4 py-3 text-sm text-caution">
          {proof.error}
        </p>
      )}

      {!hasCompanion && !proof.error && (
        <p className="mt-6 rounded-xl border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-muted">
          <span className="font-mono text-xs text-ink">{address}</span> does not own a Lumen
          companion on {proof.networkLabel}. Companions are one per wallet and per network.
        </p>
      )}

      {hasCompanion && (
        <>
          <Heading sub="Who owns this companion and what it currently points at.">
            The companion
          </Heading>
          <Card>
            <Row label="Owner">
              <a
                href={`${proof.explorerUrl}/address/${proof.owner ?? address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs break-all underline hover:text-accent"
              >
                {proof.owner ?? address}
              </a>
            </Row>
            <Row label="Token">#{proof.tokenId} · soulbound (transfers revert)</Row>
            <Row label="Contract">
              <a
                href={`${proof.explorerUrl}/address/${proof.contractAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs break-all underline hover:text-accent"
              >
                {proof.contractAddress}
              </a>
            </Row>
            <Row label="Memory root">
              <span className="font-mono text-xs break-all">{proof.latestRoot ?? '—'}</span>
            </Row>
            <Row label="Times re-anchored">{proof.anchorCount}</Row>
          </Card>

          <Heading
            sub="Each anchor records the root it replaced, so the history is a chain: every link must continue the one before it. A rewritten or partial history shows up here as a break, not as a plausible-looking list."
          >
            The pointer history
          </Heading>
          <Card>
            <ChainView proof={proof} />
          </Card>
          <p
            className={`mt-3 rounded-xl border px-4 py-3 text-sm leading-relaxed ${
              proof.chain.intact && proof.logAgrees
                ? 'border-accent/40 bg-accent-soft text-ink'
                : 'border-caution/40 bg-caution/10 text-caution'
            }`}
          >
            {proof.chain.intact && proof.logAgrees ? (
              <>
                <b>Chain intact.</b> Every anchor continues the previous one, and the root the log
                ends on matches what the contract itself reports. Nothing has been rewritten.
              </>
            ) : !proof.chain.intact ? (
              <>
                <b>Chain broken at anchor #{proof.chain.brokenAtSeq}.</b> That anchor does not
                continue the previous root.
              </>
            ) : (
              <>
                <b>Incomplete log.</b> The events we could fetch end on a different root than the
                contract reports, which usually means the RPC returned a partial log rather than
                that anything is wrong with the companion.
              </>
            )}
          </p>

          {proof.chain.practiceDays.length > 0 && (
            <>
              <Heading sub="Days on which this owner signed an anchor. Not a streak and not a score — just a record that can't be back-dated, because each entry is a transaction in a block.">
                Proof of practice
              </Heading>
              <Card>
                <Row label="Days anchored">{proof.chain.practiceDays.length}</Row>
                <Row label="First">{proof.chain.practiceDays[0]}</Row>
                <Row label="Most recent">
                  {proof.chain.practiceDays[proof.chain.practiceDays.length - 1]}
                </Row>
              </Card>
            </>
          )}

          <Heading sub="The chain stores a pointer. This is the thing it points at.">
            The encrypted snapshot
          </Heading>
          <Card>
            <StorageView proof={proof} />
          </Card>

          <Heading>What this proves — and what it doesn&apos;t</Heading>
          <div className="rounded-2xl border border-border bg-surface px-5 py-4 text-sm leading-relaxed text-muted">
            <p className="mb-2 font-medium text-ink">Proven</p>
            <ul className="mb-4 list-disc space-y-1 pl-5">
              <li>This wallet owns companion #{proof.tokenId} on {proof.networkLabel}.</li>
              <li>
                It committed to each memory root at a specific block time — timestamps that cannot
                be back-dated.
              </li>
              <li>The pointer history is an unbroken, compare-and-swap chain.</li>
              <li>The snapshot the pointer names is real data on 0G Storage.</li>
            </ul>
            <p className="mb-2 font-medium text-ink">Not proven</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                That this is the owner&apos;s <em>newest</em> journal. Anchoring is a deliberate
                act; entries written since the last anchor aren&apos;t on-chain at all.
              </li>
              <li>Anything whatsoever about the contents. Nobody here can read them — including us.</li>
              <li>
                That the owner is a particular person. An address is a pseudonym until someone links
                it.
              </li>
            </ul>
          </div>
        </>
      )}

      <Heading sub="Don't take this page's word for it either.">Check it yourself</Heading>
      <div className="overflow-x-auto rounded-2xl border border-border bg-surface px-5 py-4">
        <pre className="text-xs leading-relaxed text-muted">
          <code>{`cast logs --rpc-url ${
            proof.chainId === 16661 ? 'https://evmrpc.0g.ai' : 'https://evmrpc-testnet.0g.ai'
          } \\
  --address ${proof.contractAddress} \\
  'MemoryRootAnchored(uint256,uint64,bytes32,bytes32)'`}</code>
        </pre>
      </div>

      <footer className="mt-10 border-t border-border pt-6 text-xs leading-relaxed text-muted">
        <p>
          Lumen is a private AI journaling companion on 0G. Reflections run inside a hardware TEE
          and are verified in your own browser; entries are encrypted on your device before they go
          anywhere.{' '}
          <Link href="/" className="underline hover:text-ink">
            Try it →
          </Link>
        </p>
      </footer>
    </main>
  );
}
