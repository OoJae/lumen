/**
 * Relay for a single 0G Storage node.
 *
 * Storage nodes are HTTP-only, so an HTTPS page cannot reach them at all. This
 * route forwards JSON-RPC to one node over plain HTTP, which a server may do
 * freely. Only ENCRYPTED segments pass through — Lumen holds no key and cannot
 * read them, and the wallet still signs and pays the on-chain transaction.
 *
 * The host is validated against an allowlist: an unguarded forwarder would let
 * anyone use this deployment to probe private networks (SSRF).
 */
import type { NextRequest } from 'next/server';

import { isAllowedNodeHost, nodeTargetUrl, rewriteNodeUrls } from '@/lib/0g/nodeProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ host: string }> },
): Promise<Response> {
  const { host } = await params;

  if (!isAllowedNodeHost(host)) {
    return Response.json({ error: 'Not a permitted 0G storage node' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Expected a JSON-RPC body' }, { status: 400 });
  }

  try {
    const upstream = await fetch(nodeTargetUrl(host), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    const json = await upstream.json();
    return Response.json(rewriteNodeUrls(json, req.nextUrl.origin), { status: upstream.status });
  } catch (err) {
    console.error('[zg/node] upstream failed:', err instanceof Error ? err.message : err);
    return Response.json({ error: 'Could not reach the 0G storage node' }, { status: 502 });
  }
}
