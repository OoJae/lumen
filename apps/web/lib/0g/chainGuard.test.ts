import { describe, expect, it } from 'vitest';

import { assertChainId, chainLabel, WrongChainError } from './chainGuard';

const MAINNET = 16661;
const TESTNET = 16602;

describe('chainLabel', () => {
  it('names the 0G chains from the shared constants', () => {
    expect(chainLabel(MAINNET)).toBe('0G mainnet');
    expect(chainLabel(TESTNET)).toBe('0G testnet');
  });

  it('names common chains a user might actually be on', () => {
    expect(chainLabel(1)).toBe('Ethereum');
    expect(chainLabel(8453)).toBe('Base');
  });

  it('renders an unknown chain as its number rather than guessing', () => {
    expect(chainLabel(99999)).toBe('chain 99999');
  });
});

describe('assertChainId', () => {
  it('passes when the wallet is on the expected chain', () => {
    expect(() => assertChainId(MAINNET, MAINNET)).not.toThrow();
  });

  it('throws WrongChainError carrying both chain ids', () => {
    try {
      assertChainId(1, MAINNET);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(WrongChainError);
      const wrong = err as WrongChainError;
      expect(wrong.expectedChainId).toBe(MAINNET);
      expect(wrong.actualChainId).toBe(1);
      expect(wrong.name).toBe('WrongChainError');
    }
  });

  it('tells the user, in the message, that no transaction was sent', () => {
    // A wrong-chain save can burn a fee on the wrong chain, so the reassurance
    // that nothing was broadcast is load-bearing, not decoration.
    const err = new WrongChainError(MAINNET, 1, '0G mainnet');
    expect(err.message).toContain('Ethereum');
    expect(err.message).toContain('0G mainnet');
    expect(err.message).toContain('chain 16661');
    expect(err.message).toMatch(/Nothing was sent\.$/);
  });

  it('reads correctly for the 0G-testnet-while-expecting-mainnet case', () => {
    const err = new WrongChainError(MAINNET, TESTNET, '0G mainnet');
    expect(err.message).toContain('Your wallet is on 0G testnet');
  });
});
