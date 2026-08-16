import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ethers, network } from 'hardhat';

/**
 * Deploys LumenCompanion and writes a committed deployment manifest.
 * No constructor args by design — verification is a bare
 * `hardhat verify --network <net> <address>`.
 */
async function main() {
  if (!process.env.PRIVATE_KEY) {
    throw new Error('PRIVATE_KEY missing — copy contracts/.env.example to contracts/.env');
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error('No signer available');

  const net = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`network   : ${network.name} (chainId ${net.chainId})`);
  console.log(`deployer  : ${deployer.address}`);
  console.log(`balance   : ${ethers.formatEther(balance)} OG`);

  if (balance === 0n) {
    throw new Error(
      network.name === 'galileo'
        ? 'Deployer has 0 OG — fund it at https://faucet.0g.ai'
        : 'Deployer has 0 OG — send ~1 OG to the address above',
    );
  }

  const factory = await ethers.getContractFactory('LumenCompanion');
  const companion = await factory.deploy();
  console.log(`\ndeploy tx : ${companion.deploymentTransaction()?.hash}`);

  // Live networks: wait for chainscan to index before `hardhat verify`.
  // Local networks only mine on demand, so 5 confirmations would hang.
  const confirmations = network.name === 'hardhat' || network.name === 'localhost' ? 1 : 5;
  console.log(`waiting for ${confirmations} confirmation(s)…`);
  await companion.deploymentTransaction()?.wait(confirmations);

  const address = await companion.getAddress();
  const receipt = await ethers.provider.getTransactionReceipt(
    companion.deploymentTransaction()!.hash,
  );

  const manifest = {
    contract: 'LumenCompanion',
    address,
    deployer: deployer.address,
    txHash: companion.deploymentTransaction()!.hash,
    blockNumber: receipt?.blockNumber ?? null,
    gasUsed: receipt?.gasUsed.toString() ?? null,
    chainId: Number(net.chainId),
    network: network.name,
    solc: '0.8.24',
    evmVersion: 'cancun',
    optimizerRuns: 200,
    deployedAt: new Date().toISOString(),
  };

  const dir = join(__dirname, '..', 'deployments');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${network.name}.json`), `${JSON.stringify(manifest, null, 2)}\n`);

  const explorer =
    network.name === 'mainnet' ? 'https://chainscan.0g.ai' : 'https://chainscan-galileo.0g.ai';

  console.log(`\n✅ LumenCompanion deployed: ${address}`);
  console.log(`   ${explorer}/address/${address}`);
  console.log(`   manifest: contracts/deployments/${network.name}.json\n`);
  console.log('next:');
  console.log(`   pnpm --filter @lumen/contracts exec hardhat verify --network ${network.name} ${address}`);
  console.log(`   pnpm --filter @lumen/contracts smoke:${network.name}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
