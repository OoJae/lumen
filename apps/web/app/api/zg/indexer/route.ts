/**
 * Relay for the 0G Storage indexer.
 *
 * The indexer itself is HTTPS and CORS-open, so the browser could call it
 * directly — but it hands back node URLs like `http://34.x.x.x:5678`, which an
 * HTTPS page can never talk to (mixed content). Forwarding it here lets us
 * rewrite those URLs to our own relay so the SDK's whole flow works unchanged.
 */
import type { NextRequest } from 'next/server';
import { ZG_MAINNET, ZG_TESTNET } from '@lumen/shared';

import { rewriteNodeUrls } from '@/lib/0g/nodeProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function indexerUrl(network: string | null): string {
  const net = network === 'testnet' ? ZG_TESTNET : ZG_MAINNET;
  return net.storage.indexerRpc;
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Expected a JSON-RPC body' }, { status: 400 });
  }

  const target = indexerUrl(req.nextUrl.searchParams.get('network'));

  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const json = await upstream.json();
    const origin = req.nextUrl.origin;
    return Response.json(rewriteNodeUrls(json, origin), { status: upstream.status });
  } catch (err) {
    console.error('[zg/indexer] upstream failed:', err instanceof Error ? err.message : err);
    return Response.json({ error: 'Could not reach the 0G indexer' }, { status: 502 });
  }
}
