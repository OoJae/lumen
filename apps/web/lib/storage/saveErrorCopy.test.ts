import { describe, expect, it } from 'vitest';

import { ZG_MAINNET, ZG_TESTNET } from '@lumen/shared';

import { insufficientFundsRemedy } from './saveErrorCopy';

const ADDRESS = '0xbB05f3Fe1cC3bdB5CCC719C634f9bD0751007500';

describe('insufficientFundsRemedy — testnet', () => {
  it('points at the faucet, with the label derived from the href', () => {
    const remedy = insufficientFundsRemedy(ZG_TESTNET, ADDRESS);
    expect(remedy.link?.href).toBe('https://faucet.0g.ai');
    // Derived, so the visible text can never drift from where it actually goes.
    expect(remedy.link?.label).toBe('faucet.0g.ai');
    expect(remedy.text).toContain('0G testnet');
  });
});

describe('insufficientFundsRemedy — mainnet', () => {
  const remedy = insufficientFundsRemedy(ZG_MAINNET, ADDRESS);

  it('NEVER offers a faucet or mentions testnet — mainnet has neither', () => {
    const lower = `${remedy.text} ${remedy.link?.href ?? ''} ${remedy.link?.label ?? ''}`.toLowerCase();
    // No link at all, and none of the phrasing that would send someone hunting
    // for free tokens that do not exist on mainnet.
    expect(remedy.link).toBeUndefined();
    expect(lower).not.toContain('faucet.0g.ai');
    expect(lower).not.toContain('grab some');
    expect(lower).not.toContain('testnet');
    // Saying "has no faucet" IS allowed and deliberate: it closes off a dead end
    // for anyone arriving from the testnet build.
    expect(lower).toContain('has no faucet');
  });

  it('states the cost and shows the connected address to fund', () => {
    expect(remedy.text).toContain('0.001');
    expect(remedy.text).toContain('0G mainnet');
    expect(remedy.address).toBe(ADDRESS);
  });

  it('names no specific exchange or bridge — a claim that could go stale', () => {
    const lower = remedy.text.toLowerCase();
    for (const named of ['binance', 'coinbase', 'okx', 'uniswap', 'kraken']) {
      expect(lower).not.toContain(named);
    }
    expect(lower).toContain('from an exchange or bridge');
  });

  it('omits the address when no wallet is connected rather than printing null', () => {
    expect(insufficientFundsRemedy(ZG_MAINNET, null).address).toBeUndefined();
  });
});
