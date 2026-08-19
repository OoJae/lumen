'use client';

/**
 * The companion INFT: reads its on-chain state, mints it, moves its anchor.
 *
 * Two rules run through this file:
 *
 *  1. **Reads are the source of truth and nothing is cached locally.** A stale
 *     cache can only fail in the lying direction ("you own #7" when the chain
 *     says otherwise); a failed read fails honestly ("couldn't check"). Reads
 *     are pinned to the build's chain, so a wrong-chain wallet never makes the
 *     companion state lie — only the write buttons change.
 *
 *  2. **A receipt is not a success.** viem returns reverted transactions as
 *     ordinary receipts and wagmi's `isSuccess` only means "a receipt arrived".
 *     Claiming a mint from that would print "Companion #7 is yours" for a
 *     transaction the contract rejected, so success requires BOTH
 *     `status === 'success'` and the decoded event.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseEventLogs } from 'viem';
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';

import {
  asMemoryRootBytes32,
  LUMEN_COMPANION_ABI,
  resolveCompanionAddress,
} from '@lumen/shared';

import { assertChainId, WrongChainError } from '@/lib/0g/chainGuard';
import {
  companionFailure,
  companionState,
  COMPANION_DATA_DESCRIPTION,
  isZeroRoot,
  sameRoot,
  ZERO_ROOT,
  type CompanionAction,
  type CompanionFailure,
  type CompanionReads,
  type CompanionState,
  type FailurePhase,
  type RawFailure,
} from '@/lib/0g/companion';
import { activeNetwork } from '@/lib/0g/network';
import type { JournalMemory } from './useJournalMemory';

// Literal member expression — Next only inlines NEXT_PUBLIC_* it can see statically.
const ADDRESS_OVERRIDE = process.env.NEXT_PUBLIC_LUMEN_INFT_ADDRESS;

/**
 * Price companion writes with LEGACY gas, the way 0G's own storage SDK does.
 *
 * 0G's base fee is ~7 wei and effectively the whole cost is the node's flat
 * 4 gwei tip suggestion. EIP-1559 estimation reads that near-zero base fee and
 * underprices the transaction, which is why the first real anchor sat until it
 * was manually bumped. Legacy pricing takes eth_gasPrice (the 4 gwei the node
 * actually wants), so the wallet shows a "site suggested" fee that confirms.
 */
const ZG_FEE = { type: 'legacy' } as const;

export type CompanionTxPhase =
  | 'idle'
  | 'signing'
  | 'pending'
  | 'confirmed'
  | 'reverted'
  | 'lost'
  | 'failed';

export interface CompanionTx {
  phase: CompanionTxPhase;
  action: CompanionAction | null;
  hash: `0x${string}` | null;
  explorerTxUrl: string | null;
  /** Set ONLY from an event decoded out of a status:'success' receipt. */
  mintedTokenId: bigint | null;
  anchoredRoot: string | null;
  failure: CompanionFailure | null;
}

export interface Companion {
  address: `0x${string}` | null;
  explorerContractUrl: string | null;
  state: CompanionState;
  /** null unless a read actually returned it — never a placeholder. */
  tokenId: bigint | null;
  onChainRoot: string | null;
  anchorCount: number | null;
  reads: CompanionReads;
  refetch: () => Promise<void>;
  tx: CompanionTx;
  /** Never throw — failures land in `tx.failure`. */
  mint: () => Promise<void>;
  anchor: () => Promise<void>;
  reset: () => void;
}

const IDLE_TX: CompanionTx = {
  phase: 'idle',
  action: null,
  hash: null,
  explorerTxUrl: null,
  mintedTokenId: null,
  anchoredRoot: null,
  failure: null,
};

/** Classify anything thrown by wallet/viem into the pure mapper's input. */
function classify(err: unknown): RawFailure {
  if (err instanceof WrongChainError) return { kind: 'wrong-chain', message: err.message };

  const name = (err as { name?: string })?.name ?? '';
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (
    name === 'UserRejectedRequestError' ||
    (err as { code?: unknown })?.code === 4001 ||
    lower.includes('user rejected') ||
    lower.includes('user denied')
  ) {
    return { kind: 'rejected' };
  }
  if (lower.includes('insufficient funds') || lower.includes('insufficient balance')) {
    return { kind: 'insufficient-funds' };
  }

  // viem nests the decoded custom error on the cause chain.
  let cause: unknown = err;
  for (let depth = 0; depth < 6 && cause; depth++) {
    const data = (cause as { data?: { errorName?: string; args?: readonly unknown[] } }).data;
    if (data?.errorName) return { kind: 'revert', errorName: data.errorName, args: data.args };
    cause = (cause as { cause?: unknown }).cause;
  }

  if (lower.includes('fetch') || lower.includes('network') || lower.includes('timeout')) {
    return { kind: 'network', message };
  }
  return { kind: 'unknown', message };
}

export function useCompanion(memory: JournalMemory): Companion {
  const net = activeNetwork();
  const { address: connected } = useAccount();
  const contract = resolveCompanionAddress(net.key, ADDRESS_OVERRIDE);

  const [tx, setTx] = useState<CompanionTx>(IDLE_TX);
  const [writing, setWriting] = useState<CompanionAction | null>(null);

  const readOpts = { chainId: net.chainId } as const;
  const query = { staleTime: 15_000, gcTime: 300_000, retry: 2 } as const;

  const companionOf = useReadContract({
    ...readOpts,
    address: contract ?? undefined,
    abi: LUMEN_COMPANION_ABI,
    functionName: 'companionOf',
    args: connected ? [connected] : undefined,
    query: { ...query, enabled: Boolean(contract && connected) },
  });

  const tokenId = companionOf.data as bigint | undefined;
  const hasToken = typeof tokenId === 'bigint' && tokenId > 0n;

  // latestMemoryRoot calls _requireOwned, so it REVERTS for token 0 — gate it.
  const rootRead = useReadContract({
    ...readOpts,
    address: contract ?? undefined,
    abi: LUMEN_COMPANION_ABI,
    functionName: 'latestMemoryRoot',
    args: hasToken ? [tokenId] : undefined,
    query: { ...query, enabled: Boolean(contract && hasToken) },
  });

  const anchorsRead = useReadContract({
    ...readOpts,
    address: contract ?? undefined,
    abi: LUMEN_COMPANION_ABI,
    functionName: 'anchorCount',
    args: hasToken ? [tokenId] : undefined,
    query: { ...query, enabled: Boolean(contract && hasToken) },
  });

  const reads: CompanionReads = useMemo(() => {
    const failed =
      companionOf.isError || (hasToken && (rootRead.isError || anchorsRead.isError));
    const settled =
      companionOf.isSuccess && (!hasToken || (rootRead.isSuccess && anchorsRead.isSuccess));
    return {
      status: failed ? 'error' : settled ? 'ok' : 'loading',
      tokenId: tokenId ?? 0n,
      root: (rootRead.data as string | undefined) ?? ZERO_ROOT,
      anchorCount: Number((anchorsRead.data as bigint | undefined) ?? 0n),
    };
  }, [
    companionOf.isError,
    companionOf.isSuccess,
    rootRead.isError,
    rootRead.isSuccess,
    rootRead.data,
    anchorsRead.isError,
    anchorsRead.isSuccess,
    anchorsRead.data,
    hasToken,
    tokenId,
  ]);

  const refetch = useCallback(async () => {
    await companionOf.refetch();
    if (hasToken) await Promise.all([rootRead.refetch(), anchorsRead.refetch()]);
  }, [companionOf, rootRead, anchorsRead, hasToken]);

  const { writeContractAsync } = useWriteContract();
  const wait = useWaitForTransactionReceipt({
    hash: tx.hash ?? undefined,
    chainId: net.chainId,
    confirmations: 1,
    timeout: 90_000,
    query: { enabled: Boolean(tx.hash) },
  });

  // Resolve a pending tx — the receipt-truth check lives here.
  const settledHash = useRef<string | null>(null);
  useEffect(() => {
    if (!tx.hash || settledHash.current === tx.hash) return;

    if (wait.isError) {
      settledHash.current = tx.hash;
      setWriting(null);
      setTx((t) => ({
        ...t,
        phase: 'lost',
        failure: companionFailure(
          { kind: 'lost', hash: t.hash ?? '' },
          { action: t.action ?? 'mint', phase: 'submit', networkLabel: net.label },
        ),
      }));
      return;
    }
    if (!wait.data) return;

    settledHash.current = tx.hash;
    setWriting(null);

    // A receipt arriving is NOT success. Require the mined status AND the event
    // — the event requirement also catches a misconfigured contract address.
    const action = tx.action ?? 'mint';
    const eventName = action === 'mint' ? 'Minted' : 'MemoryRootAnchored';
    const logs =
      wait.data.status === 'success'
        ? parseEventLogs({ abi: LUMEN_COMPANION_ABI, eventName, logs: wait.data.logs })
        : [];

    if (wait.data.status !== 'success') {
      // Genuinely mined and reverted — the fee was spent.
      setTx((t) => ({
        ...t,
        phase: 'reverted',
        failure: companionFailure(
          { kind: 'unknown', message: '' },
          { action, phase: 'onchain', networkLabel: net.label },
        ),
      }));
      void refetch();
      return;
    }

    if (logs.length === 0) {
      // Succeeded, but the event we expect isn't in it — most likely a
      // misconfigured contract address or ABI drift. Do NOT call this a revert:
      // the transaction worked, we simply can't confirm what it did.
      setTx((t) => ({
        ...t,
        phase: 'reverted',
        failure: companionFailure(
          {
            kind: 'unknown',
            message:
              `Your transaction succeeded on ${net.label}, but Lumen couldn't find the expected ` +
              `${eventName} event in it — the contract address may be misconfigured. Lumen has ` +
              `not changed anything on its side; check the transaction before retrying.`,
          },
          { action, phase: 'onchain', networkLabel: net.label },
        ),
      }));
      void refetch();
      return;
    }

    const args = (logs[0] as { args: Record<string, unknown> }).args;
    setTx((t) => ({
      ...t,
      phase: 'confirmed',
      mintedTokenId: action === 'mint' ? ((args.tokenId as bigint) ?? null) : t.mintedTokenId,
      anchoredRoot: action === 'anchor' ? ((args.newRoot as string) ?? null) : t.anchoredRoot,
    }));
    void refetch();
  }, [tx.hash, tx.action, wait.isError, wait.data, net.label, refetch]);

  const fail = useCallback(
    (raw: RawFailure, action: CompanionAction, phase: FailurePhase = 'submit') => {
      setWriting(null);
      setTx((t) => ({
        ...t,
        phase: raw.kind === 'rejected' ? 'idle' : 'failed',
        action,
        failure: companionFailure(raw, { action, phase, networkLabel: net.label }),
      }));
    },
    [net.label],
  );

  const walletChainId = useAccount().chainId;

  const send = useCallback(
    async (action: CompanionAction, run: () => Promise<`0x${string}`>) => {
      setTx({ ...IDLE_TX, phase: 'signing', action });
      setWriting(action);
      try {
        assertChainId(walletChainId ?? -1, net.chainId);
        const hash = await run();
        settledHash.current = null;
        setTx((t) => ({
          ...t,
          phase: 'pending',
          hash,
          explorerTxUrl: `${net.explorerUrl}/tx/${hash}`,
        }));
      } catch (err) {
        fail(classify(err), action);
      }
    },
    [walletChainId, net.chainId, net.explorerUrl, fail],
  );

  const mint = useCallback(async () => {
    const receipt = memory.save.receipt;
    if (!contract || !receipt) return;

    // Don't pop a wallet for a mint that will certainly revert.
    const fresh = await companionOf.refetch();
    if (typeof fresh.data === 'bigint' && fresh.data > 0n) {
      fail({ kind: 'revert', errorName: 'AlreadyHasCompanion', args: [connected, fresh.data] }, 'mint');
      return;
    }

    let root: `0x${string}`;
    try {
      root = asMemoryRootBytes32(receipt.rootHash);
    } catch (err) {
      fail({ kind: 'unknown', message: (err as Error).message }, 'mint');
      return;
    }

    await send('mint', () =>
      writeContractAsync({
        address: contract,
        abi: LUMEN_COMPANION_ABI,
        functionName: 'mint',
        args: [root, COMPANION_DATA_DESCRIPTION],
        // Makes wagmi raise ChainMismatchError rather than broadcast anywhere else.
        chainId: net.chainId,
        ...ZG_FEE,
      }),
    );
  }, [contract, memory.save.receipt, companionOf, connected, fail, send, writeContractAsync, net.chainId]);

  const anchor = useCallback(async () => {
    const receipt = memory.save.receipt;
    if (!contract || !receipt || !hasToken) return;

    // The CAS operand MUST come from a fresh read. Using component state here
    // is a self-inflicted StaleAnchor within a single React tick.
    const fresh = await rootRead.refetch();
    if (fresh.isError || fresh.data === undefined) {
      fail({ kind: 'network' }, 'anchor');
      return;
    }
    const expectedPrev = fresh.data as `0x${string}`;

    let newRoot: `0x${string}`;
    try {
      newRoot = asMemoryRootBytes32(receipt.rootHash);
    } catch (err) {
      fail({ kind: 'unknown', message: (err as Error).message }, 'anchor');
      return;
    }
    if (isZeroRoot(newRoot)) {
      fail({ kind: 'revert', errorName: 'ZeroRoot' }, 'anchor');
      return;
    }
    // Pre-empt the guaranteed revert rather than spending a wallet popup on it.
    if (sameRoot(expectedPrev, newRoot)) {
      fail({ kind: 'revert', errorName: 'SameRoot', args: [newRoot] }, 'anchor');
      return;
    }

    await send('anchor', () =>
      writeContractAsync({
        address: contract,
        abi: LUMEN_COMPANION_ABI,
        functionName: 'anchorMemoryRoot',
        args: [tokenId as bigint, newRoot, expectedPrev],
        chainId: net.chainId,
        ...ZG_FEE,
      }),
    );
  }, [
    contract,
    memory.save.receipt,
    hasToken,
    rootRead,
    tokenId,
    fail,
    send,
    writeContractAsync,
    net.chainId,
  ]);

  const reset = useCallback(() => {
    settledHash.current = null;
    setTx(IDLE_TX);
    setWriting(null);
  }, []);

  const state = companionState({
    wallet: memory.wallet,
    unlocked: memory.keyState === 'unlocked',
    contractConfigured: Boolean(contract),
    reads,
    receipt: memory.save.receipt,
    writing,
  });

  return {
    address: contract,
    explorerContractUrl: contract ? `${net.explorerUrl}/address/${contract}` : null,
    state,
    tokenId: reads.status === 'ok' && reads.tokenId > 0n ? reads.tokenId : null,
    onChainRoot: reads.status === 'ok' && !isZeroRoot(reads.root) ? reads.root : null,
    anchorCount: reads.status === 'ok' && reads.tokenId > 0n ? reads.anchorCount : null,
    reads,
    refetch,
    tx,
    mint,
    anchor,
    reset,
  };
}
