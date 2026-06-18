// Dev tool: discover the 0G provider's service endpoint + model for the app-sk
// token in .env.local, read-only (no wallet, no funds). Run: node scripts/discover-provider.mjs
import * as sdk from '@0gfoundation/0g-compute-ts-sdk';
import fs from 'node:fs';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const token = env.match(/^ZG_COMPUTE_API_KEY=(.*)$/m)?.[1]?.trim();
if (!token) throw new Error('ZG_COMPUTE_API_KEY not found in .env.local');

const raw = token.replace(/^app-sk-/, '');
const decoded = Buffer.from(raw, 'base64').toString('utf8');
const json = decoded.slice(0, decoded.lastIndexOf('|'));
const provider = JSON.parse(json).provider;
console.log('provider (from token):', provider);
console.log('sdk exports:', Object.keys(sdk).join(', '));

const createRO =
  sdk.createReadOnlyInferenceBroker ||
  sdk.createZGComputeNetworkBrokerReadOnly ||
  sdk.createReadOnlyBroker;

const RPCS = [
  ['mainnet', 'https://evmrpc.0g.ai'],
  ['testnet', 'https://evmrpc-testnet.0g.ai'],
];

for (const [name, rpc] of RPCS) {
  try {
    const broker = await createRO(rpc);
    const services = await broker.listService(0, 100, true).catch(() => broker.listService());
    const list = Array.isArray(services) ? services : (services?.services ?? []);
    const svc = list.find((s) => (s.provider ?? s[0] ?? '').toLowerCase?.() === provider.toLowerCase());
    console.log(`\n[${name}] services: ${list.length}; provider match: ${svc ? 'YES' : 'no'}`);
    if (svc) {
      console.log(JSON.stringify({
        provider: svc.provider,
        url: svc.url,
        model: svc.model,
        serviceType: svc.serviceType,
        verifiability: svc.verifiability,
        teeSignerAddress: svc.teeSignerAddress,
        teeSignerAcknowledged: svc.teeSignerAcknowledged,
      }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
      console.log(`\nNETWORK=${name}`);
      break;
    }
  } catch (e) {
    console.log(`[${name}] error:`, e?.message ?? e);
  }
}
