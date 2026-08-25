'use client';

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { LUMEN_COMPANION_DEPLOY_BLOCK, type ZgNetworkKey } from '@lumen/shared';

import { buildAnchorChain, type AnchorChain } from '@/lib/0g/anchorHistory';
import { readAnchorLogs, type LogReader } from '@/lib/0g/anchorLogs';
import { activeNetwork } from '@/lib/0g/network';
import {
  buildPracticeCalendar,
  dayDiff,
  seqsByDay,
  todayUtc,
  type PracticeCalendar,
} from '@/lib/0g/practice';
import type { Companion } from './useCompanion';

/**
 * A companion's on-chain history, read in the browser.
 *
 * Deliberately the SAME reader the public proof page uses on the server
 * (`readAnchorLogs`), which is what lets the in-app archive truthfully say it
 * shows exactly what a stranger sees. Two implementations could drift; one
 * cannot.
 *
 * It also supplies the only honest source for "days since your last seal".
 * A storage receipt's `savedAt` is this device's clock at save time, not the
 * moment the chain accepted an anchor — using it would be a quiet lie, so
 * before this hook resolves the seal nudge is given `null` and says nothing
 * about time.
 */

export interface AnchorArchive {
  status: 'idle' | 'loading' | 'ok' | 'error';
  chain: AnchorChain | null;
  calendar: PracticeCalendar | null;
  /** Whole UTC days since the most recent sealed day. null when unknown. */
  daysSinceLastSeal: number | null;
  /** null when the chain has not been read, or was read incompletely. */
  everSealed: boolean | null;
  /** The log set is provably short of what the contract reports. */
  partial: boolean;
  refetch: () => void;
}

/** Exported so every mount site shares one fetch through react-query's cache. */
export function anchorArchiveKey(network: ZgNetworkKey, tokenId: bigint | null): unknown[] {
  return ['lumen', 'anchor-archive', network, tokenId === null ? null : tokenId.toString()];
}

/** Wider than the proof page's 26: this is your own record, not a shared link. */
const ARCHIVE_MAX_WEEKS = 26;

export function useAnchorArchive(companion: Companion): AnchorArchive {
  const net = activeNetwork();
  // Undefined during SSR and until wagmi's config resolves (`ssr: true`), so
  // the query stays disabled rather than throwing.
  const publicClient = usePublicClient({ chainId: net.chainId });
  const tokenId = companion.tokenId;
  const address = companion.address;

  const enabled = Boolean(publicClient && address && tokenId !== null);

  const query = useQuery({
    queryKey: anchorArchiveKey(net.key, tokenId),
    enabled,
    staleTime: 60_000,
    gcTime: 600_000,
    retry: 1,
    queryFn: async (): Promise<AnchorChain> => {
      const { mint, anchors } = await readAnchorLogs(
        publicClient as unknown as LogReader,
        address as `0x${string}`,
        tokenId as bigint,
        LUMEN_COMPANION_DEPLOY_BLOCK[net.key],
      );
      return buildAnchorChain(mint, anchors);
    },
  });

  const chain = query.data ?? null;

  // Recomputed whenever the data refreshes rather than frozen at mount. Journal
  // never unmounts, so a pinned `today` meant that after the tab crossed UTC
  // midnight buildPracticeCalendar's `d <= today` guard silently DISCARDED a
  // genuine anchor dated the next day — dropping the seal the user just made.
  const today = useMemo(() => todayUtc(), [query.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const calendar = useMemo(
    () =>
      chain
        ? buildPracticeCalendar({
            practiceDays: chain.practiceDays,
            mintDay: chain.mintDay ?? null,
            seqsByDay: seqsByDay(chain),
            today,
            maxWeeks: ARCHIVE_MAX_WEEKS,
          })
        : null,
    [chain, today],
  );

  const daysSinceLastSeal = useMemo(() => {
    const last = calendar?.lastDay;
    if (!last) return null;
    // Never negative: a sealed day cannot be in the future, but a device clock
    // running behind the chain could make it look that way.
    return Math.max(0, dayDiff(last, today));
  }, [calendar, today]);

  /**
   * Did the log read actually see everything the contract says exists?
   *
   * `readAnchorLogs` swallows every error by design — a failed getLogs returns
   * `[]`, a failed getBlock returns timestamp 0 — so `query.isError` is
   * unreachable and a total RPC failure arrived here looking like a companion
   * that had simply never sealed. The archive then rendered an EMPTY grid under
   * "Read from 0G mainnet just now", above a panel asserting the record cannot
   * be altered. That is the most expensive kind of wrong this product can be.
   *
   * The contract's own anchorCount is an independent read, so a shortfall
   * against it proves the log set is incomplete. Same idea as the public proof
   * page's agreesWithContract cross-check.
   */
  const expectedAnchors = companion.anchorCount;
  const partial =
    chain !== null && expectedAnchors !== null && chain.links.length < expectedAnchors;

  /**
   * Stable across renders, and that is load-bearing rather than tidy.
   *
   * This used to be `() => void query.refetch()` — a fresh arrow every render.
   * PracticeArchive opens with `useEffect(() => { refetch() }, [refetch])`, so
   * the effect re-armed on every render, refetched, re-rendered, and re-armed:
   * a refetch loop hammering the RPC for as long as the archive was open.
   * TanStack's own `query.refetch` is already stable, so wrapping it is all
   * that was ever needed.
   */
  const queryRefetch = query.refetch;
  const refetch = useCallback(() => void queryRefetch(), [queryRefetch]);

  const status: AnchorArchive['status'] = !enabled
    ? 'idle'
    : query.isError || partial
      ? 'error'
      : chain
        ? 'ok'
        : 'loading';

  return {
    status,
    chain,
    calendar,
    partial,
    daysSinceLastSeal: status === 'ok' ? daysSinceLastSeal : null,
    // A companion that has never sealed has an empty record — but only say so
    // once the chain has been read COMPLETELY. An incomplete read that looks
    // empty must not become "nothing here is sealed yet".
    everSealed: status === 'ok' && chain ? chain.practiceDays.length > 0 : null,
    refetch,
  };
}
