// Dev tool: discover the provider for the app-sk token in .env.local, then run a
// real streaming chat completion against ${url}/v1/proxy and print tokens + chatID.
import * as sdk from '@0gfoundation/0g-compute-ts-sdk';
import fs from 'node:fs';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const token = env.match(/^ZG_COMPUTE_API_KEY=(.*)$/m)?.[1]?.trim();
const raw = token.replace(/^app-sk-/, '');
const dec = Buffer.from(raw, 'base64').toString('utf8');
const provider = JSON.parse(dec.slice(0, dec.lastIndexOf('|'))).provider;
console.log('provider:', provider);

let svc, network;
for (const [name, rpc] of [['mainnet', 'https://evmrpc.0g.ai'], ['testnet', 'https://evmrpc-testnet.0g.ai']]) {
  try {
    const b = await sdk.createReadOnlyInferenceBroker(rpc);
    const list = await b.listService(0, 100, true).catch(() => b.listService());
    const arr = Array.isArray(list) ? list : (list?.services ?? []);
    const m = arr.find((s) => (s.provider ?? '').toLowerCase() === provider.toLowerCase());
    if (m) { svc = m; network = name; break; }
  } catch (e) { console.log(`[${name}] discovery error:`, e?.message); }
}
if (!svc) { console.log('provider NOT found on-chain'); process.exit(1); }
console.log('network:', network, '| url:', svc.url, '| model:', svc.model, '| verif:', svc.verifiability, '| teeAck:', svc.teeSignerAcknowledged);

const url = `${svc.url}/v1/proxy/chat/completions`;
const ctrl = new AbortController();
const to = setTimeout(() => ctrl.abort(), 60000);
const t0 = Date.now();
let res;
try {
  res = await fetch(url, {
    method: 'POST',
    signal: ctrl.signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ model: svc.model, stream: true, messages: [{ role: 'user', content: 'Reply with one short, gentle sentence.' }] }),
  });
} catch (e) { console.log('FETCH FAILED:', e?.message, `(after ${Date.now() - t0}ms)`); process.exit(1); }

console.log('HTTP', res.status, '| ZG-Res-Key:', res.headers.get('zg-res-key') ?? '(none)', `| ttfb≈${Date.now() - t0}ms`);
if (!res.ok) { console.log((await res.text()).slice(0, 500)); process.exit(1); }

const reader = res.body.getReader();
const td = new TextDecoder();
let buf = '', id = null, text = '';
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += td.decode(value, { stream: true });
  const frames = buf.split('\n\n');
  buf = frames.pop() ?? '';
  for (const f of frames) {
    for (const line of f.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const d = line.slice(5).trim();
      if (d === '[DONE]') continue;
      try { const j = JSON.parse(d); id ||= j.id; const t = j.choices?.[0]?.delta?.content; if (t) { text += t; process.stdout.write(t); } } catch {}
    }
  }
}
clearTimeout(to);
console.log(`\n--- chatID: ${id} | chars: ${text.length} | total ${Date.now() - t0}ms`);
