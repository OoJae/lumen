import { describe, expect, it } from 'vitest';

import { activeNetwork, parseNetworkKey, resolveActiveNetwork } from './network';

describe('parseNetworkKey', () => {
  it('defaults to mainnet when unset or blank', () => {
    expect(parseNetworkKey(undefined)).toEqual({ key: 'mainnet' });
    expect(parseNetworkKey('')).toEqual({ key: 'mainnet' });
    expect(parseNetworkKey('   ')).toEqual({ key: 'mainnet' });
  });

  it('normalizes case and whitespace', () => {
    expect(parseNetworkKey('MAINNET').key).toBe('mainnet');
    expect(parseNetworkKey('  testnet ').key).toBe('testnet');
  });

  it('sends a typo to the DEFAULT and flags it — never to the other network', () => {
    // The old `x === 'mainnet' ? MAINNET : TESTNET` silently made 'mainet' testnet.
    const parsed = parseNetworkKey('mainet');
    expect(parsed.key).toBe('mainnet');
    expect(parsed.invalid).toBe('mainet');
  });
});

describe('resolveActiveNetwork', () => {
  it('defaults to a coherent mainnet: chain, RPC, indexer, explorer, no faucet', () => {
    const net = resolveActiveNetwork({});
    expect(net.key).toBe('mainnet');
    expect(net.chainId).toBe(16661);
    expect(net.label).toBe('0G mainnet');
    expect(net.rpcUrl).toBe('https://evmrpc.0g.ai');
    expect(net.storage.indexerRpc).toBe('https://indexer-storage-turbo.0g.ai');
    expect(net.explorerUrl).toBe('https://chainscan.0g.ai');
    expect(net.faucetUrl).toBeUndefined(); // gates every faucet string in the UI
  });

  it('resolves a coherent testnet, faucet included', () => {
    const net = resolveActiveNetwork({ network: 'testnet' });
    expect(net.chainId).toBe(16602);
    expect(net.label).toBe('0G testnet');
    expect(net.storage.indexerRpc).toContain('testnet');
    expect(net.explorerUrl).toBe('https://chainscan-galileo.0g.ai');
    expect(net.faucetUrl).toBe('https://faucet.0g.ai');
  });

  it('CANNOT be split-brained: one network never takes the other endpoints', () => {
    // The exact bug the old shape allowed — mainnet explorer + testnet indexer.
    const testnetBuild = resolveActiveNetwork({
      network: 'testnet',
      mainnetRpc: 'https://evmrpc.0g.ai',
      mainnetIndexerRpc: 'https://indexer-storage-turbo.0g.ai',
    });
    expect(testnetBuild.rpcUrl).toBe('https://evmrpc-testnet.0g.ai');
    expect(testnetBuild.storage.indexerRpc).toContain('testnet');

    const mainnetBuild = resolveActiveNetwork({
      network: 'mainnet',
      testnetRpc: 'https://evmrpc-testnet.0g.ai',
      testnetIndexerRpc: 'https://indexer-storage-testnet-turbo.0g.ai',
    });
    expect(mainnetBuild.rpcUrl).toBe('https://evmrpc.0g.ai');
    expect(mainnetBuild.storage.indexerRpc).not.toContain('testnet');
  });

  it('applies same-network overrides', () => {
    const net = resolveActiveNetwork({
      network: 'mainnet',
      mainnetRpc: 'https://rpc.example',
      mainnetIndexerRpc: 'https://indexer.example',
    });
    expect(net.rpcUrl).toBe('https://rpc.example');
    expect(net.storage.indexerRpc).toBe('https://indexer.example');
    expect(net.chainId).toBe(16661); // chainId is never env-driven
  });

  it('treats a blank override as unset (a blank dashboard field must not win)', () => {
    const net = resolveActiveNetwork({ network: 'mainnet', mainnetRpc: '', mainnetIndexerRpc: '' });
    expect(net.rpcUrl).toBe('https://evmrpc.0g.ai');
    expect(net.storage.indexerRpc).toBe('https://indexer-storage-turbo.0g.ai');
  });

  it('keeps identity fields tied to the key', () => {
    for (const key of ['mainnet', 'testnet'] as const) {
      const net = resolveActiveNetwork({ network: key });
      expect(net.key).toBe(key);
      expect(net.explorerApiUrl.startsWith(net.explorerUrl)).toBe(true);
      expect(net.nativeCurrency.symbol).toBe('0G');
    }
  });
});

describe('activeNetwork', () => {
  it('is a memoized, frozen singleton', () => {
    // Memoized: a fresh object per call would churn React dep arrays.
    expect(activeNetwork()).toBe(activeNetwork());
    // Frozen: a stray mutation would poison the uploader too.
    expect(Object.isFrozen(activeNetwork())).toBe(true);
    expect(Object.isFrozen(activeNetwork().storage)).toBe(true);
  });
});
