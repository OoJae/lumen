'use client';

import { useMemo } from 'react';
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
  /** null when the chain has not been read. */
  everSealed: boolean | null;
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

  // One clock read per mount, not per render — the calendar must not shift
  // underneath a rerender, and `practice.ts` takes `today` as an argument
  // precisely so it never reaches for one itself.
  const today = useMemo(() => todayUtc(), []);

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

  const status: AnchorArchive['status'] = !enabled
    ? 'idle'
    : query.isError
      ? 'error'
      : chain
        ? 'ok'
        : 'loading';

  return {
    status,
    chain,
    calendar,
    daysSinceLastSeal,
    // A companion that has never sealed has an empty record — but only say so
    // once the chain has actually been read.
    everSealed: chain ? chain.practiceDays.length > 0 : null,
    refetch: () => void query.refetch(),
  };
}
