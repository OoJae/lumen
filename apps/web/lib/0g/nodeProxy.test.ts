import { describe, expect, it } from 'vitest';

import { isAllowedNodeHost, nodeTargetUrl, rewriteNodeUrls, ZG_NODE_PORT } from './nodeProxy';

describe('isAllowedNodeHost', () => {
  it('allows real 0G node addresses', () => {
    // Actual hosts the mainnet indexer returned.
    expect(isAllowedNodeHost('34.169.236.186')).toBe(true);
    expect(isAllowedNodeHost('34.60.163.4')).toBe(true);
    expect(isAllowedNodeHost('indexer-storage-turbo.0g.ai')).toBe(true);
  });

  it('BLOCKS private and loopback ranges — this route must not become an SSRF hole', () => {
    for (const host of [
      '127.0.0.1',
      '10.0.0.1',
      '192.168.1.1',
      '172.16.0.1',
      '172.31.255.255',
      '169.254.169.254', // cloud metadata — the classic SSRF target
      '0.0.0.0',
      '224.0.0.1',
    ]) {
      expect(isAllowedNodeHost(host)).toBe(false);
    }
  });

  it('rejects anything that is not an IPv4 address or a 0g.ai host', () => {
    for (const host of ['', 'localhost', 'evil.com', 'node.0g.ai.evil.com', '1.2.3', '1.2.3.4.5']) {
      expect(isAllowedNodeHost(host)).toBe(false);
    }
    expect(isAllowedNodeHost('999.1.1.1')).toBe(false);
  });

  it('pins the port rather than taking it from input', () => {
    expect(nodeTargetUrl('34.169.236.186')).toBe(`http://34.169.236.186:${ZG_NODE_PORT}`);
  });
});

describe('rewriteNodeUrls', () => {
  const origin = 'https://lumen-snowy-two.vercel.app';

  it('rewrites the node URLs an indexer response actually returns', () => {
    const response = {
      jsonrpc: '2.0',
      result: {
        trusted: [
          { url: 'http://34.169.236.186:5678', shardId: 0 },
          { url: 'http://34.60.163.4:5678', shardId: 1 },
        ],
      },
    };
    const out = rewriteNodeUrls(response, origin);
    expect(out.result.trusted[0]!.url).toBe(`${origin}/api/zg/node/34.169.236.186`);
    expect(out.result.trusted[1]!.url).toBe(`${origin}/api/zg/node/34.60.163.4`);
    expect(out.result.trusted[0]!.shardId).toBe(0); // untouched
  });

  it('leaves anything that is not a storage-node URL alone', () => {
    const payload = {
      docs: 'https://docs.0g.ai',
      rpc: 'https://evmrpc.0g.ai',
      other: 'http://34.169.236.186:9999', // not the node port
      internal: 'http://127.0.0.1:5678', // blocked host — must NOT be relayed
      text: 'no url here',
    };
    expect(rewriteNodeUrls(payload, origin)).toEqual(payload);
  });

  it('walks nested arrays and objects', () => {
    const payload = { a: [{ b: { url: 'http://34.1.2.3:5678' } }] };
    expect(rewriteNodeUrls(payload, origin).a[0]!.b.url).toBe(`${origin}/api/zg/node/34.1.2.3`);
  });
});

describe('SSRF: a host may not smuggle a different destination', () => {
  it('rejects delimiters that end the authority before the .0g.ai suffix', () => {
    // Every one of these passed the old suffix check and connected elsewhere —
    // the third reaches the cloud metadata endpoint.
    for (const evil of [
      'evil.com#.0g.ai',
      'evil.com?.0g.ai',
      'evil.com/.0g.ai',
      '127.0.0.1#.0g.ai',
      '169.254.169.254#.0g.ai',
      'user@evil.com#.0g.ai',
      'evil.com:80#.0g.ai',
      'evil.com\\\\.0g.ai',
      'evil.com .0g.ai',
    ]) {
      expect(isAllowedNodeHost(evil), evil).toBe(false);
    }
  });

  it('still accepts genuine node hosts', () => {
    expect(isAllowedNodeHost('indexer-storage-turbo.0g.ai')).toBe(true);
    expect(isAllowedNodeHost('34.66.131.173')).toBe(true);
  });

  it('rejects malformed hostnames', () => {
    for (const bad of ['', '.', '..', '.0g.ai', 'a..b.0g.ai', '-bad.0g.ai', 'bad-.0g.ai', 'a'.repeat(64) + '.0g.ai']) {
      expect(isAllowedNodeHost(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('blocks the special-use ranges the original guard missed', () => {
    for (const ip of ['100.64.0.1', '100.127.255.254', '192.0.0.1', '198.18.0.1', '198.19.255.255']) {
      expect(isAllowedNodeHost(ip), ip).toBe(false);
    }
  });

  it('nodeTargetUrl refuses to build a URL that resolves elsewhere', () => {
    expect(nodeTargetUrl('34.66.131.173')).toBe('http://34.66.131.173:5678');
    expect(() => nodeTargetUrl('evil.com#.0g.ai')).toThrow(/does not parse as its own hostname/);
  });
});
