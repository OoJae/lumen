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
      // `redirect: 'error'` rather than the default 'follow'. Every private-range
      // and allowlist check runs against the FIRST hop only, so a permitted host
      // answering 302 to http://169.254.169.254/ — or to any RFC1918 address —
      // would have been followed and its body returned to the caller, defeating
      // the SSRF guard entirely. JSON-RPC has no legitimate reason to redirect,
      // so treating one as a failure costs nothing and closes the hole.
      redirect: 'error',
    });
    const json = await upstream.json();
    return Response.json(rewriteNodeUrls(json, req.nextUrl.origin), { status: upstream.status });
  } catch (err) {
    console.error('[zg/node] upstream failed:', err instanceof Error ? err.message : err);
    return Response.json({ error: 'Could not reach the 0G storage node' }, { status: 502 });
  }
}
