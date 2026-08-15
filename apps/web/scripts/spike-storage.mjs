#!/usr/bin/env node
/**
 * Wave 2 spike: validate the 0G Storage SDK path end-to-end short of a funded tx.
 *   1. MemData (in-memory bytes) → merkle root, fully offline
 *   2. Indexer JSON-RPC liveness (sharded nodes)
 *   3. getFileLocations for the computed root (expect: not found — nothing uploaded)
 *   4. Optional: attempted upload with a throwaway unfunded wallet (proves signer
 *      plumbing + flow-contract auto-detection reach the chain; expected to fail
 *      with an insufficient-funds class error). Enable with --try-upload.
 *
 * Usage: node scripts/spike-storage.mjs [--try-upload]
 */
import { Indexer, MemData } from '@0gfoundation/0g-storage-ts-sdk';
import { JsonRpcProvider, Wallet } from 'ethers';

// Testnet params — mirror packages/shared/src/networks.ts (scripts can't import TS).
const INDEXER_RPC = 'https://indexer-storage-testnet-turbo.0g.ai';
const EVM_RPC = 'https://evmrpc-testnet.0g.ai';

const payload = new TextEncoder().encode(
  JSON.stringify({ spike: 'lumen-w2-storage', at: new Date().toISOString() }),
);

// 1. Offline merkle root
const file = new MemData(payload);
const [tree, treeErr] = await file.merkleTree();
if (treeErr || !tree) throw new Error(`merkleTree failed: ${treeErr}`);
const rootHash = tree.rootHash();
console.log('1. offline merkle root      :', rootHash);

// 2. Indexer liveness
const indexer = new Indexer(INDEXER_RPC);
const nodes = await indexer.getShardedNodes();
console.log('2. indexer live, trusted    :', nodes.trusted?.length ?? 0, 'nodes');

// 3. Locations for a never-uploaded root
try {
  const locations = await indexer.getFileLocations(rootHash);
  console.log('3. locations (expect none)  :', Array.isArray(locations) ? locations.length : locations);
} catch (err) {
  console.log('3. locations lookup errored (acceptable for unknown root):', err?.message ?? err);
}

// 4. Optional signer-plumbing probe
if (process.argv.includes('--try-upload')) {
  const throwaway = Wallet.createRandom().connect(new JsonRpcProvider(EVM_RPC));
  console.log('4. throwaway wallet         :', throwaway.address, '(unfunded, expect failure)');
  const started = Date.now();
  const [result, uploadErr] = await indexer.upload(file, EVM_RPC, throwaway);
  console.log('   upload result            :', result);
  console.log('   upload error             :', uploadErr?.message ?? uploadErr);
  console.log('   elapsed                  :', Date.now() - started, 'ms');
}

console.log('\nSpike complete.');
