import { describe, expect, it } from 'vitest';

import { buildAnchorChain, type RawAnchorEvent, type RawMintEvent } from './anchorHistory';
import {
  addDays,
  archiveView,
  buildPracticeCalendar,
  calendarLabel,
  dayDiff,
  GRID_MIN_SEALED_DAYS,
  longDate,
  mondayOf,
  monthAbbrev,
  practiceSummary,
  seqsByDay,
  todayUtc,
  type PracticeCalendar,
} from './practice';

const TODAY = '2026-08-19'; // a Wednesday

function cal(days: string[], over: Partial<Parameters<typeof buildPracticeCalendar>[0]> = {}) {
  return buildPracticeCalendar({ practiceDays: days, today: TODAY, ...over });
}

function allCells(c: PracticeCalendar) {
  return c.columns.flatMap((column) => column.days);
}

describe('UTC day arithmetic', () => {
  it('adds and subtracts days across a month boundary', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('crosses a leap day correctly', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(dayDiff('2028-02-28', '2028-03-01')).toBe(2);
  });

  it('is UTC, not local — a DST weekend is still exactly 2 days', () => {
    // Under a local-Date implementation this returns 1 or 3 in most timezones.
    expect(dayDiff('2026-03-07', '2026-03-09')).toBe(2);
    expect(dayDiff('2026-10-24', '2026-10-26')).toBe(2);
  });

  it('gives a negative diff when the range runs backwards', () => {
    expect(dayDiff('2026-08-19', '2026-08-16')).toBe(-3);
  });

  it('resolves Monday for every day of one week, including Sunday', () => {
    expect(mondayOf('2026-08-17')).toBe('2026-08-17'); // Monday
    expect(mondayOf('2026-08-19')).toBe('2026-08-17'); // Wednesday
    expect(mondayOf('2026-08-23')).toBe('2026-08-17'); // Sunday belongs to the week that began
    expect(mondayOf('2026-08-24')).toBe('2026-08-24'); // next Monday
  });

  it('formats months and long dates without a locale', () => {
    expect(monthAbbrev('2026-08-19')).toBe('Aug');
    expect(longDate('2026-08-19')).toBe('19 August 2026');
    expect(longDate('2026-01-01')).toBe('1 January 2026');
  });

  it('todayUtc reads the injected instant, not the local calendar', () => {
    expect(todayUtc(Date.UTC(2026, 7, 16, 23, 30))).toBe('2026-08-16');
  });
});

describe('buildPracticeCalendar', () => {
  it('returns an empty calendar for no sealed days', () => {
    const c = cal([]);
    expect(c.columns).toEqual([]);
    expect(c.sealedDays).toBe(0);
    expect(c.firstDay).toBeNull();
  });

  it('counts sealed DAYS, not anchors', () => {
    const c = cal(['2026-08-17', '2026-08-19'], {
      seqsByDay: { '2026-08-17': [1, 2, 3], '2026-08-19': [4] },
    });
    expect(c.sealedDays).toBe(2);
  });

  it('windows from the first seal to today and never earlier', () => {
    const c = cal(['2026-08-17']);
    // First seal is Mon 17th, today is Wed 19th — exactly one column.
    expect(c.columns).toHaveLength(1);
    expect(c.columns[0]!.monday).toBe('2026-08-17');
  });

  it('marks days before the first seal as before-start, and only in column 1', () => {
    const c = cal(['2026-08-19']); // Wednesday — Mon/Tue precede it
    const cells = allCells(c);
    expect(cells.filter((x) => x.state === 'before-start').map((x) => x.day)).toEqual([
      '2026-08-17',
      '2026-08-18',
    ]);
    const firstColumn = c.columns[0]!.days;
    expect(firstColumn.some((x) => x.state === 'before-start')).toBe(true);
    for (const column of c.columns.slice(1)) {
      expect(column.days.some((x) => x.state === 'before-start')).toBe(false);
    }
  });

  it('marks days after today as future, and only in the last column', () => {
    const c = cal(['2026-08-17']);
    const cells = allCells(c);
    expect(cells.filter((x) => x.state === 'future').map((x) => x.day)).toEqual([
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
      '2026-08-23',
    ]);
    for (const column of c.columns.slice(0, -1)) {
      expect(column.days.some((x) => x.state === 'future')).toBe(false);
    }
  });

  it('never emits a cell outside [firstDay, today] as sealed', () => {
    const c = cal(['2026-07-06', '2026-08-19']);
    for (const cell of allCells(c)) {
      if (cell.state === 'sealed' || cell.state === 'minted') {
        expect(cell.day >= c.firstDay!).toBe(true);
        expect(cell.day <= TODAY).toBe(true);
      }
    }
  });

  it('gives the mint day its own state while still counting it', () => {
    const c = cal(['2026-08-14', '2026-08-19'], { mintDay: '2026-08-14' });
    const cells = allCells(c);
    expect(cells.find((x) => x.day === '2026-08-14')!.state).toBe('minted');
    expect(cells.find((x) => x.day === '2026-08-19')!.state).toBe('sealed');
    expect(c.sealedDays).toBe(2);
    expect(c.sealedDaysInWindow).toBe(2);
  });

  it('ignores a sealed day in the future rather than stretching the window', () => {
    const c = cal(['2026-08-19', '2027-01-01']);
    expect(c.sealedDays).toBe(1);
    expect(c.lastDay).toBe('2026-08-19');
  });

  it('deduplicates repeated days', () => {
    expect(cal(['2026-08-19', '2026-08-19']).sealedDays).toBe(1);
  });

  it('gives every column exactly 7 days, Monday first', () => {
    const c = cal(['2026-06-01', '2026-08-19']);
    for (const column of c.columns) {
      expect(column.days).toHaveLength(7);
      expect(column.days[0]!.day).toBe(column.monday);
      expect(mondayOf(column.monday)).toBe(column.monday);
    }
  });

  it('labels a month only on the column that opens it', () => {
    const c = cal(['2026-07-01', '2026-08-19'], { maxWeeks: 52 });
    const labels = c.columns.map((x) => x.monthLabel).filter(Boolean);
    expect(labels).toEqual(['Jun', 'Jul', 'Aug']);
  });

  it('truncates to the MOST RECENT weeks', () => {
    const c = cal(['2026-01-05', '2026-08-19'], { maxWeeks: 3 });
    expect(c.truncated).toBe(true);
    expect(c.columns).toHaveLength(3);
    expect(c.columns[c.columns.length - 1]!.monday).toBe(mondayOf(TODAY));
  });

  it('keeps sealedDays as the TOTAL when truncated, so the header cannot shrink', () => {
    const c = cal(['2026-01-05', '2026-08-19'], { maxWeeks: 3 });
    expect(c.sealedDays).toBe(2);
    expect(c.sealedDaysInWindow).toBe(1);
  });

  it('attaches anchor seqs to their day', () => {
    const c = cal(['2026-08-19'], { seqsByDay: { '2026-08-19': [4, 5] } });
    expect(allCells(c).find((x) => x.day === '2026-08-19')!.seqs).toEqual([4, 5]);
  });
});

describe('seqsByDay', () => {
  function anchor(seq: number, timestamp: number): RawAnchorEvent {
    return { seq, prevRoot: '0x1', newRoot: '0x2', txHash: `0x${seq}`, blockNumber: seq, timestamp };
  }
  const mint: RawMintEvent = {
    tokenId: '2', owner: '0xabc', memoryRoot: '0x1',
    txHash: '0xmint', blockNumber: 1, timestamp: Date.UTC(2026, 7, 14) / 1000,
  };

  it('groups and sorts seqs by UTC day', () => {
    const chain = buildAnchorChain(mint, [
      anchor(2, Date.UTC(2026, 7, 19, 21) / 1000),
      anchor(1, Date.UTC(2026, 7, 19, 9) / 1000),
      anchor(3, Date.UTC(2026, 7, 20, 9) / 1000),
    ]);
    expect(seqsByDay(chain)).toEqual({ '2026-08-19': [1, 2], '2026-08-20': [3] });
  });

  it('skips undated anchors rather than bucketing them into 1970', () => {
    const chain = buildAnchorChain(mint, [anchor(1, 0)]);
    expect(seqsByDay(chain)).toEqual({});
  });
});

describe('archiveView', () => {
  it('is empty with no sealed days', () => {
    expect(archiveView(cal([])).mode).toBe('empty');
  });

  it('shows the days themselves below the grid threshold', () => {
    const view = archiveView(cal(['2026-08-18', '2026-08-19']));
    expect(view.mode).toBe('first-days');
    if (view.mode === 'first-days') expect(view.days.map((d) => d.day)).toEqual(['2026-08-18', '2026-08-19']);
  });

  it('switches to the grid at exactly GRID_MIN_SEALED_DAYS', () => {
    const days = ['2026-08-17', '2026-08-18', '2026-08-19'];
    expect(days).toHaveLength(GRID_MIN_SEALED_DAYS);
    expect(archiveView(cal(days.slice(0, -1))).mode).toBe('first-days');
    expect(archiveView(cal(days)).mode).toBe('grid');
  });
});

describe('copy is a record, never a score', () => {
  const shapes: PracticeCalendar[] = [
    cal([]),
    cal(['2026-08-19']),
    cal(['2026-08-17', '2026-08-18', '2026-08-19']),
    cal(['2026-05-04', '2026-06-02', '2026-08-19'], { maxWeeks: 12 }),
    cal(['2026-01-05', '2026-08-19'], { maxWeeks: 3 }),
  ];

  it('never contains a denominator or a percentage', () => {
    for (const c of shapes) {
      const s = practiceSummary(c);
      expect(s, s).not.toMatch(/\d+\s*(\/|of|out of)\s*\d+/i);
      expect(s, s).not.toContain('%');
    }
  });

  it('never uses streak, shame or exhortation language', () => {
    const banned =
      /streak|in a row|consecutive|missed|broke|keep it up|don't break|don’t break|goal|target|on track|behind/i;
    for (const c of shapes) {
      expect(practiceSummary(c), practiceSummary(c)).not.toMatch(banned);
      expect(calendarLabel(c)).not.toMatch(banned);
      for (const cell of allCells(c)) expect(cell.title, cell.title).not.toMatch(banned);
    }
  });

  it('describes an unsealed day neutrally', () => {
    const empty = allCells(cal(['2026-08-17', '2026-08-19'])).find((x) => x.day === '2026-08-18')!;
    expect(empty.state).toBe('empty');
    expect(empty.title).toBe('18 August 2026 · no seal');
  });

  it('names a multi-seal day without ranking it', () => {
    const c = cal(['2026-08-19'], { seqsByDay: { '2026-08-19': [1, 2] } });
    expect(allCells(c).find((x) => x.day === '2026-08-19')!.title).toBe(
      '19 August 2026 · sealed 2 times',
    );
  });

  it('summarises the ordinary case readably', () => {
    expect(practiceSummary(cal(['2026-08-17', '2026-08-18', '2026-08-19']))).toBe(
      '3 sealed days, from 17 August 2026 to 19 August 2026.',
    );
    expect(practiceSummary(cal(['2026-08-19']))).toBe('One sealed day — 19 August 2026.');
    expect(practiceSummary(cal([]))).toBe('No sealed days yet.');
  });
});

describe('no run-length computation is reachable', () => {
  it('exports nothing that could be rendered as a streak', async () => {
    const mod = await import('./practice');
    for (const name of Object.keys(mod)) {
      expect(name, name).not.toMatch(/streak|consecutive|run|combo/i);
    }
  });
});
