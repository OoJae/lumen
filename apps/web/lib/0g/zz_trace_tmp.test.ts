import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PracticeGrid } from '../../components/PracticeGrid';
import { readAnchorLogs, type LogReader } from './anchorLogs';
import { buildAnchorChain } from './anchorHistory';
import { buildPracticeCalendar, seqsByDay } from './practice';

const ADDRESS = '0x0FD618664FFAc86ef734C0C46eFF23bD73CBd738' as const;
const OWNER = '0xB5609C73784Aa81De2eBe01cCC04Eb7ea4ce1a52';
const R1 = '0x1caeee295b94a8f28c09a19e32c243fa238f684476289f63bc06f1c2546eb6a2';

// RPC serves eth_getLogs, rate-limits eth_getBlockByNumber.
const reader: LogReader = {
  getContractEvents: (async ({ eventName }: { eventName?: string }) =>
    eventName === 'Minted'
      ? [{ args: { tokenId: 2n, owner: OWNER, memoryRoot: R1 }, transactionHash: '0xmint', blockNumber: 42_066_838n }]
      : []) as unknown as LogReader['getContractEvents'],
  getBlock: (async () => {
    throw new Error('429 Too Many Requests');
  }) as unknown as LogReader['getBlock'],
};

describe('TRACE: getLogs ok, getBlock rate-limited, mint only', () => {
  it('shows the mint row data and "Nothing sealed yet" together', async () => {
    const { mint, anchors } = await readAnchorLogs(reader, ADDRESS, 2n, 41_801_714n);
    console.log('mint =', mint);
    console.log('anchors =', anchors);

    const chain = buildAnchorChain(mint, anchors);
    console.log('practiceDays =', chain.practiceDays, 'mintDay =', chain.mintDay);
    console.log('intact =', chain.intact, 'latestRoot =', chain.latestRoot);

    // page.tsx: logAgrees uses the contract's latestMemoryRoot, which for a
    // mint with no anchors is exactly mint.memoryRoot.
    const logAgrees = chain.latestRoot?.toLowerCase() === R1.toLowerCase();
    console.log('logAgrees =', logAgrees);

    const calendar = buildPracticeCalendar({
      practiceDays: chain.practiceDays,
      mintDay: chain.mintDay ?? null,
      seqsByDay: seqsByDay(chain),
      today: '2026-08-19',
      maxWeeks: 26,
    });
    console.log('sealedDays =', calendar.sealedDays);

    const html = renderToStaticMarkup(createElement(PracticeGrid, { calendar }));
    console.log('PRACTICE HTML =', html);

    // ChainView renders the Minted row whenever chain.mint is truthy:
    console.log('ChainView renders Minted row =', Boolean(chain.mint));
    console.log('ChainView block label = block', mint?.blockNumber.toLocaleString('en-US'));
    console.log('ChainView shows a date =', (mint?.timestamp ?? 0) > 0);

    expect(html).toContain('Nothing sealed yet');
    expect(chain.mint).not.toBeNull();
  });
});
