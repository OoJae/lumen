#!/usr/bin/env node
/**
 * Probe the live LumenCompanion contract — reads and REVERTS — without a wallet,
 * without signing, and without spending anything.
 *
 * `eth_call` executes against real state, so `simulateContract` returns the
 * contract's actual custom errors. That lets us verify the whole revert→copy
 * mapper against reality rather than against our own assumptions.
 *
 * Usage: node scripts/probe-companion.mjs [--network mainnet|testnet]
 */
import { createPublicClient, http } from 'viem';

const NETWORKS = {
  mainnet: { rpc: 'https://evmrpc.0g.ai', chainId: 16661, label: '0G mainnet' },
  testnet: { rpc: 'https://evmrpc-testnet.0g.ai', chainId: 16602, label: '0G testnet' },
};

const arg = process.argv.indexOf('--network');
const netKey = arg > -1 ? process.argv[arg + 1] : 'mainnet';
const net = NETWORKS[netKey];
if (!net) throw new Error(`Unknown network: ${netKey}`);

const CONTRACT = '0x0FD618664FFAc86ef734C0C46eFF23bD73CBd738';
const OWNER = '0x446106F3E5b94C297C5c45bC0958ACD86C861CcB'; // deploy wallet, owns token 1
const STRANGER = '0xbB05f3Fe1cC3bdB5CCC719C634f9bD0751007500';
const SOME_ROOT = '0x1111111111111111111111111111111111111111111111111111111111111111';
const WRONG_PREV = '0xdead000000000000000000000000000000000000000000000000000000000000';

// Minimal ABI — the script is standalone (scripts can't import workspace TS).
const ABI = [
  { type: 'function', name: 'companionOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'latestMemoryRoot', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'anchorCount', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ type: 'bytes32' }, { type: 'string' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'anchorMemoryRoot', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'bytes32' }, { type: 'bytes32' }], outputs: [] },
  { type: 'error', name: 'AlreadyHasCompanion', inputs: [{ type: 'address' }, { type: 'uint256' }] },
  { type: 'error', name: 'StaleAnchor', inputs: [{ type: 'uint256' }, { type: 'bytes32' }, { type: 'bytes32' }] },
  { type: 'error', name: 'SameRoot', inputs: [{ type: 'bytes32' }] },
  { type: 'error', name: 'NotTokenOwner', inputs: [{ type: 'uint256' }, { type: 'address' }] },
  { type: 'error', name: 'ZeroRoot', inputs: [] },
  { type: 'error', name: 'ERC721NonexistentToken', inputs: [{ type: 'uint256' }] },
];

const client = createPublicClient({ transport: http(net.rpc) });
let failures = 0;

function ok(label, detail) {
  console.log(`  ✅ ${label}${detail ? ` → ${detail}` : ''}`);
}
function bad(label, detail) {
  failures++;
  console.log(`  ❌ ${label}${detail ? ` → ${detail}` : ''}`);
}

/** Expect a simulate to revert with a specific custom error. */
async function expectRevert(label, params, expected) {
  try {
    await client.simulateContract({ address: CONTRACT, abi: ABI, ...params });
    bad(label, 'did NOT revert (unexpected)');
  } catch (err) {
    let name = null;
    let cause = err;
    for (let i = 0; i < 8 && cause && !name; i++) {
      name = cause.data?.errorName ?? null;
      cause = cause.cause;
    }
    if (name === expected) ok(label, name);
    else bad(label, `expected ${expected}, got ${name ?? err.shortMessage ?? err.message}`);
  }
}

console.log(`LumenCompanion probe — ${net.label} (chain ${net.chainId})`);
console.log(`contract ${CONTRACT}\n`);

console.log('reads:');
const strangerToken = await client.readContract({ address: CONTRACT, abi: ABI, functionName: 'companionOf', args: [STRANGER] });
strangerToken === 0n ? ok('companionOf(stranger)', '0 (no companion)') : bad('companionOf(stranger)', strangerToken);

const ownerToken = await client.readContract({ address: CONTRACT, abi: ABI, functionName: 'companionOf', args: [OWNER] });
ownerToken > 0n ? ok('companionOf(owner)', `#${ownerToken}`) : bad('companionOf(owner)', 'expected a token');

if (ownerToken > 0n) {
  const root = await client.readContract({ address: CONTRACT, abi: ABI, functionName: 'latestMemoryRoot', args: [ownerToken] });
  ok('latestMemoryRoot', root);
  const anchors = await client.readContract({ address: CONTRACT, abi: ABI, functionName: 'anchorCount', args: [ownerToken] });
  ok('anchorCount', String(anchors));

  console.log('\nreverts (the read gate):');
  // Proves latestMemoryRoot(0) really does revert — i.e. the UI's gate is load-bearing.
  await expectRevert('latestMemoryRoot(0)', { functionName: 'latestMemoryRoot', args: [0n] }, 'ERC721NonexistentToken');

  console.log('\nreverts (the error mapper, against live state):');
  await expectRevert(
    'mint by an owner',
    { functionName: 'mint', args: [SOME_ROOT, 'probe'], account: OWNER },
    'AlreadyHasCompanion',
  );
  await expectRevert(
    'anchor with a wrong expectedPrev',
    { functionName: 'anchorMemoryRoot', args: [ownerToken, SOME_ROOT, WRONG_PREV], account: OWNER },
    'StaleAnchor',
  );
  await expectRevert(
    'anchor the current root (SameRoot beats StaleAnchor)',
    { functionName: 'anchorMemoryRoot', args: [ownerToken, root, root], account: OWNER },
    'SameRoot',
  );
  await expectRevert(
    'anchor a zero root',
    { functionName: 'anchorMemoryRoot', args: [ownerToken, `0x${'0'.repeat(64)}`, root], account: OWNER },
    'ZeroRoot',
  );
  await expectRevert(
    'anchor by a non-owner',
    { functionName: 'anchorMemoryRoot', args: [ownerToken, SOME_ROOT, root], account: STRANGER },
    'NotTokenOwner',
  );
}

console.log(`\n${failures === 0 ? '✅ all probes matched' : `❌ ${failures} probe(s) failed`}`);
process.exitCode = failures === 0 ? 0 : 1;
