'use client';

/**
 * Is the wallet on the network this build writes to?
 *
 * Only WRITES are gated. Connecting, unlocking, writing entries and reflecting
 * all work on any chain — `personal_sign` is chain-agnostic and derives the same
 * key everywhere, so blocking unlock would assert something untrue and lock
 * people out of their own local entries for no reason.
 */
import { useCallback, useEffect, useState } from 'react';
import { UserRejectedRequestError } from 'viem';
import { useAccount, useSwitchChain } from 'wagmi';

import { chainLabel } from '@/lib/0g/chainGuard';
import { activeNetwork } from '@/lib/0g/network';

export type ChainGuardStatus = 'unknown' | 'no-wallet' | 'ok' | 'wrong-chain' | 'switching';

export interface ChainGuard {
  status: ChainGuardStatus;
  expectedChainId: number;
  expectedLabel: string;
  walletChainId: number | null;
  walletChainLabel: string | null;
  /** True when a 0G write must not be attempted right now. */
  blocked: boolean;
  error: string | null;
  switchToExpected: () => Promise<void>;
}

export function useChainGuard(): ChainGuard {
  const net = activeNetwork();
  // useAccount().chainId reports the wallet's ACTUAL chain, including chains
  // absent from our config — useChainId() would fall back to the configured
  // chain and mask exactly the state we are trying to detect.
  const { isConnected, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  const [mounted, setMounted] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // With ssr: true the server renders disconnected; stay 'unknown' until mount
  // so the banner and badge never hydrate against a mismatched tree.
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (chainId === net.chainId) setError(null);
  }, [chainId, net.chainId]);

  const switchToExpected = useCallback(async () => {
    setSwitching(true);
    setError(null);
    try {
      await switchChainAsync({ chainId: net.chainId });
    } catch (err) {
      const rejected =
        err instanceof UserRejectedRequestError ||
        (err as { cause?: unknown })?.cause instanceof UserRejectedRequestError;
      setError(
        rejected
          ? `Switch cancelled — your wallet is still on ${
              chainId ? chainLabel(chainId) : 'another network'
            }.`
          : `Your wallet couldn't switch to ${net.label}. Add it manually: chain ${net.chainId}, RPC ${net.rpcUrl}.`,
      );
    } finally {
      setSwitching(false);
    }
  }, [switchChainAsync, net.chainId, net.label, net.rpcUrl, chainId]);

  let status: ChainGuardStatus;
  if (!mounted) status = 'unknown';
  else if (switching) status = 'switching';
  else if (!isConnected || chainId === undefined) status = 'no-wallet';
  else status = chainId === net.chainId ? 'ok' : 'wrong-chain';

  return {
    status,
    expectedChainId: net.chainId,
    expectedLabel: net.label,
    walletChainId: chainId ?? null,
    walletChainLabel: chainId === undefined ? null : chainLabel(chainId),
    blocked: status === 'wrong-chain' || status === 'switching',
    error,
    switchToExpected,
  };
}
