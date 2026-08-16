import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ethers, network } from 'hardhat';

/**
 * Post-deploy smoke: produces REAL on-chain activity from the deploy wallet and
 * prints a tx table for docs/0g-integration.md.
 *
 * The roots here are labelled smoke values — the meaningful anchors come from
 * real users' wallets through the app. This proves the contract works on the
 * live chain and that the honest reverts are honest.
 */
const EXPLORER: Record<string, string> = {
  mainnet: 'https://chainscan.0g.ai',
  galileo: 'https://chainscan-galileo.0g.ai',
};

async function main() {
  const manifestPath = join(__dirname, '..', 'deployments', `${network.name}.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { address: string };
  const explorer = EXPLORER[network.name] ?? '';

  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error('No signer available');
  const companion = await ethers.getContractAt('LumenCompanion', manifest.address, signer);

  console.log(`contract  : ${manifest.address}`);
  console.log(`caller    : ${signer.address}\n`);

  const txs: { label: string; hash: string; gas: string }[] = [];

  // 1. Mint (idempotent across re-runs: reuse the existing companion if present)
  let tokenId = await companion.companionOf(signer.address);
  if (tokenId === 0n) {
    const descriptor =
      'data:application/json,' +
      JSON.stringify({
        name: 'Lumen Companion (deploy smoke)',
        kind: 'lumen-companion',
        note: 'dataHash is a 0G Storage merkle root of client-encrypted memory',
      });
    const tx = await companion.mint(ethers.ZeroHash, descriptor);
    const receipt = await tx.wait();
    tokenId = await companion.companionOf(signer.address);
    txs.push({ label: `mint (token #${tokenId})`, hash: tx.hash, gas: `${receipt!.gasUsed}` });
    console.log(`minted token #${tokenId}`);
  } else {
    console.log(`token #${tokenId} already minted by this wallet — anchoring only`);
  }

  // 2. Two anchors so the CAS chain is visible on-chain
  for (const label of ['lumen-smoke-1', 'lumen-smoke-2']) {
    const current = await companion.latestMemoryRoot(tokenId);
    const next = ethers.keccak256(ethers.toUtf8Bytes(`${label}:${Date.now()}`));
    const tx = await companion.anchorMemoryRoot(tokenId, next, current);
    const receipt = await tx.wait();
    txs.push({ label: `anchor ${label}`, hash: tx.hash, gas: `${receipt!.gasUsed}` });
    console.log(`anchored ${next.slice(0, 12)}… (prev ${current.slice(0, 12)}…)`);
  }

  // 3. Prove the honest reverts really are on-chain behaviour
  console.log('\nrevert probes (no gas spent — static calls):');
  for (const [label, call] of [
    ['transferFrom', () => companion.transferFrom.staticCall(signer.address, signer.address, tokenId)],
    ['iTransfer', () => companion.iTransfer.staticCall(signer.address, tokenId, [])],
  ] as const) {
    try {
      await call();
      console.log(`  ⚠️  ${label}: did NOT revert (unexpected)`);
    } catch (err) {
      const data = (err as { data?: string }).data;
      const parsed = data ? companion.interface.parseError(data) : null;
      console.log(`  ✅ ${label} → ${parsed?.name ?? (err as Error).message.slice(0, 70)}`);
    }
  }

  // 4. Final state
  const data = await companion.intelligentDataOf(tokenId);
  console.log('\nfinal state:');
  console.log(`  tokenId       : ${tokenId}`);
  console.log(`  owner         : ${await companion.ownerOf(tokenId)}`);
  console.log(`  memory root   : ${data[0]!.dataHash}`);
  console.log(`  anchor count  : ${await companion.anchorCount(tokenId)}`);

  console.log('\n| action | tx | gas |');
  console.log('|---|---|---|');
  for (const t of txs) {
    console.log(`| ${t.label} | [\`${t.hash.slice(0, 12)}…\`](${explorer}/tx/${t.hash}) | ${t.gas} |`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
