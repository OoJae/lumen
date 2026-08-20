/**
 * Same-origin relay for 0G Storage nodes — pure helpers, unit-tested.
 *
 * WHY THIS EXISTS: 0G's storage nodes serve plain HTTP only (verified live:
 * `https://<node>:5678` refuses the connection, `http://<node>:5678` answers).
 * Lumen is served over HTTPS, and browsers block secure→insecure subresource
 * requests as mixed content — unconditionally, with no CORS or code override.
 * So the browser cannot hand encrypted bytes to a storage node, and cannot read
 * them back either: uploads, restores and "Prove I own it" all fail identically.
 *
 * The fix is a same-origin HTTPS route that forwards to the node. Lumen relays
 * ciphertext it cannot read; the wallet still signs and pays the on-chain
 * transaction, so ownership is unchanged. This is disclosed in
 * docs/privacy-model.md rather than glossed over.
 */

/** 0G storage nodes speak JSON-RPC on this port. Pinned, never taken from input. */
export const ZG_NODE_PORT = 5678;

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * A syntactically valid DNS hostname and nothing else.
 *
 * THIS CHECK IS THE WHOLE GUARD. Without it the suffix test below was trivially
 * bypassable, because `host` is interpolated straight into a URL string: any
 * character that terminates the authority component ends the real hostname
 * early while leaving `.0g.ai` in the fragment or query, where it still
 * satisfies `endsWith`. All of these passed and connected elsewhere:
 *
 *   'evil.com#.0g.ai'          -> evil.com
 *   '127.0.0.1#.0g.ai'         -> 127.0.0.1
 *   '169.254.169.254#.0g.ai'   -> the cloud metadata endpoint
 *   'user@evil.com#.0g.ai'     -> evil.com   (userinfo)
 *
 * Restricting to [A-Za-z0-9.-] removes '#', '?', '/', '@', ':', backslash,
 * whitespace and every other delimiter in one rule, so what `endsWith` sees is
 * necessarily what `fetch` will resolve.
 */
function isSyntacticHostname(host: string): boolean {
  if (!host || host.length > 253) return false;
  if (!/^[A-Za-z0-9.-]+$/.test(host)) return false;
  if (host.startsWith('.') || host.endsWith('.')) return false;
  if (host.includes('..')) return false;
  return host
    .split('.')
    .every((label) => label.length > 0 && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-'));
}

/**
 * Only forward to hosts that could plausibly be a 0G storage node, and never to
 * anything inside our own network. An unguarded forwarder is an SSRF hole: it
 * would let anyone use this deployment to probe private addresses.
 */
export function isAllowedNodeHost(host: string): boolean {
  // Syntax first — everything below assumes `host` cannot contain a delimiter.
  if (!isSyntacticHostname(host)) return false;
  if (host.endsWith('.0g.ai')) return true;

  const m = IPV4.exec(host);
  if (!m) return false;

  const [a, b] = [Number(m[1]), Number(m[2])];
  const octets = [a, b, Number(m[3]), Number(m[4])];
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return false;

  // Block loopback, link-local, and every private / special-use range.
  if (a === 0 || a === 127 || a === 10) return false;
  if (a === 169 && b === 254) return false; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // RFC1918
  if (a === 192 && b === 168) return false; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return false; // RFC6598 carrier-grade NAT
  if (a === 192 && b === 0) return false; // RFC6890 special-purpose
  if (a === 198 && (b === 18 || b === 19)) return false; // RFC2544 benchmarking
  if (a >= 224) return false; // multicast / reserved
  return true;
}

export function nodeTargetUrl(host: string): string {
  const url = `http://${host}:${ZG_NODE_PORT}`;
  // Belt and braces: prove the string we built actually resolves to the host we
  // checked. If a future edit weakens isAllowedNodeHost, this still refuses to
  // send the request rather than sending it somewhere else.
  const parsed = new URL(url);
  if (parsed.hostname !== host.toLowerCase() || parsed.port !== String(ZG_NODE_PORT)) {
    throw new Error(`Refusing to relay: ${host} does not parse as its own hostname`);
  }
  return url;
}

/**
 * Rewrite the node URLs an indexer response hands back so the SDK talks to our
 * relay instead of an unreachable http:// address. Applied to the whole JSON
 * body because node URLs appear under several shapes (`trusted[]`,
 * `discovered[]`, file-location lists).
 */
export function rewriteNodeUrls<T>(payload: T, origin: string): T {
  const pattern = /^https?:\/\/([^/:]+):(\d+)$/;

  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const m = pattern.exec(value);
      if (m && Number(m[2]) === ZG_NODE_PORT && isAllowedNodeHost(m[1]!)) {
        return `${origin}/api/zg/node/${m[1]}`;
      }
      return value;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
    }
    return value;
  };

  return walk(payload) as T;
}
