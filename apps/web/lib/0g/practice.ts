/**
 * The practice record — pure calendar math over a companion's sealed days.
 *
 * DESIGN CONSTRAINTS, which are the feature, not decoration. Every journaling
 * app ships a streak; streaks work by loss aversion, and Duolingo had to invent
 * streak-freezes because breaking one devastated people. In a product about
 * writing down how you actually feel, a number you can fail is a liability. So:
 *
 *   1. No denominators, no percentages, no "X of Y days".
 *   2. NO consecutive-run computation exists anywhere in this module. There is
 *      deliberately no `longestStreak` export — if it existed, someone would
 *      render it.
 *   3. Gaps get no treatment. A three-month gap and a one-day gap look identical.
 *   4. No cells before the first seal or after today: the record cannot show you
 *      a void you failed to fill.
 *   5. The only superlative permitted is "first".
 *
 * Tests assert 1, 2 and 4 directly, so a future edit cannot quietly reintroduce
 * them.
 *
 * UTC throughout, and `today` is injected rather than read — the same history
 * must render identically for every viewer, and a pure module must not reach
 * for a clock.
 */
import type { AnchorChain } from './anchorHistory';

export type DayState = 'sealed' | 'minted' | 'empty' | 'future' | 'before-start';

export interface DayCell {
  /** 'YYYY-MM-DD', UTC. */
  day: string;
  state: DayState;
  /** Anchor seqs sealed that day, ascending. Empty for a mint-only day. */
  seqs: number[];
  /** Hover copy. Pure so it can be asserted on. */
  title: string;
}

export interface WeekColumn {
  /** 'YYYY-MM-DD' of the Monday that opens this column. */
  monday: string;
  /** Always 7, Monday first. */
  days: DayCell[];
  /** 'Aug' when this column opens a new month within the strip. */
  monthLabel: string | null;
}

export interface PracticeCalendar {
  columns: WeekColumn[];
  firstDay: string | null;
  lastDay: string | null;
  /** TOTAL sealed days, NOT the windowed count — the header must not shrink
   *  just because the strip was truncated. */
  sealedDays: number;
  sealedDaysInWindow: number;
  /**
   * A cell for EVERY sealed day, in order, regardless of the window.
   *
   * The windowed `columns` are for the grid; this is the source of truth for
   * counts and for the sparse view. Deriving the sparse view from `columns`
   * instead silently dropped sealed days that fell outside a truncated window
   * — a two-day-old record with maxWeeks 26 rendered "The record starts here"
   * above an empty list.
   */
  sealedCells: DayCell[];
  /** firstDay → today inclusive. Present for labelling only; never render this
   *  as a denominator (see constraint 1). */
  spanDays: number;
  truncated: boolean;
}

export interface PracticeCalendarInput {
  practiceDays: readonly string[];
  /** Rendered with a ring rather than a different colour — it is a sealed day
   *  that happens to be the first. */
  mintDay?: string | null;
  /** 'YYYY-MM-DD', UTC. Injected. */
  today: string;
  seqsByDay?: Readonly<Record<string, readonly number[]>>;
  maxWeeks?: number;
}

export const DEFAULT_MAX_WEEKS = 12;

/**
 * Below this, a grid is a mostly-empty rectangle with one or two dots, which
 * reads as broken rather than sparse. `archiveView` shows a card instead.
 */
export const GRID_MIN_SEALED_DAYS = 3;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

// ─── UTC day arithmetic: string in, string out, no Date library ─────────────

function toUtcMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const DAY_MS = 86_400_000;

export function addDays(day: string, delta: number): string {
  return fromUtcMs(toUtcMs(day) + delta * DAY_MS);
}

/** Whole days from `from` to `to`. Negative when `to` precedes `from`. */
export function dayDiff(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

/** The Monday of this day's week. Weeks start Monday, so Sunday belongs to the
 *  week that began six days earlier. */
export function mondayOf(day: string): string {
  const dow = new Date(toUtcMs(day)).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

export function monthAbbrev(day: string): string {
  return MONTHS[Number(day.slice(5, 7)) - 1]!.slice(0, 3);
}

/** '19 August 2026'. Fixed month names, not a locale — the record must read the
 *  same for every viewer, exactly like the UTC day binning. */
export function longDate(day: string): string {
  return `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
}

/** The ONE place a clock is read. Everything else takes `today` as an argument. */
export function todayUtc(now: number = Date.now()): string {
  return fromUtcMs(now);
}

// ─── The calendar ───────────────────────────────────────────────────────────

/** Anchor seqs grouped by the UTC day they landed on. Undated anchors (a block
 *  we could not read) are skipped rather than bucketed into 1970. */
export function seqsByDay(chain: AnchorChain): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const link of chain.links) {
    if (link.timestamp <= 0) continue;
    const day = new Date(link.timestamp * 1000).toISOString().slice(0, 10);
    (out[day] ??= []).push(link.seq);
  }
  for (const seqs of Object.values(out)) seqs.sort((a, b) => a - b);
  return out;
}

function cellTitle(day: string, state: DayState, seqs: readonly number[]): string {
  const when = longDate(day);
  if (state === 'minted') return `${when} · companion minted`;
  if (state === 'sealed') {
    if (seqs.length > 1) return `${when} · sealed ${seqs.length} times`;
    return `${when} · sealed`;
  }
  // Never "missed". A day without a seal is a day without a seal.
  return `${when} · no seal`;
}

export function buildPracticeCalendar(input: PracticeCalendarInput): PracticeCalendar {
  const { today, mintDay = null, seqsByDay: seqs = {} } = input;
  const maxWeeks = Math.max(1, input.maxWeeks ?? DEFAULT_MAX_WEEKS);

  // Defensive: a day after today cannot be sealed, and would stretch the window
  // into a future the viewer has not reached.
  const sealed = [...new Set(input.practiceDays)].filter((d) => d <= today).sort();

  if (sealed.length === 0) {
    return {
      columns: [],
      firstDay: null,
      lastDay: null,
      sealedDays: 0,
      sealedDaysInWindow: 0,
      sealedCells: [],
      spanDays: 0,
      truncated: false,
    };
  }

  const firstDay = sealed[0]!;
  const lastDay = sealed[sealed.length - 1]!;
  const sealedSet = new Set(sealed);

  // Window: the week of the first seal → the week containing today. No floor,
  // so a two-week-old record renders as two small columns rather than a wide
  // strip of nothing (constraint 4).
  const firstMonday = mondayOf(firstDay);
  const lastMonday = mondayOf(today);
  const totalWeeks = Math.max(1, dayDiff(firstMonday, lastMonday) / 7 + 1);
  const weeks = Math.min(totalWeeks, maxWeeks);
  const truncated = totalWeeks > maxWeeks;
  // When truncated, keep the MOST RECENT columns.
  const startMonday = addDays(lastMonday, -(weeks - 1) * 7);

  const columns: WeekColumn[] = [];
  let previousMonth = '';
  let sealedDaysInWindow = 0;

  for (let w = 0; w < weeks; w++) {
    const monday = addDays(startMonday, w * 7);
    const days: DayCell[] = [];
    for (let d = 0; d < 7; d++) {
      const day = addDays(monday, d);
      const daySeqs = [...(seqs[day] ?? [])];
      let state: DayState;
      if (day > today) state = 'future';
      else if (day < firstDay) state = 'before-start';
      else if (mintDay && day === mintDay) state = 'minted';
      else if (sealedSet.has(day)) state = 'sealed';
      else state = 'empty';
      if (state === 'sealed' || state === 'minted') sealedDaysInWindow++;
      days.push({ day, state, seqs: daySeqs, title: cellTitle(day, state, daySeqs) });
    }
    const month = monthAbbrev(monday);
    columns.push({ monday, days, monthLabel: month === previousMonth ? null : month });
    previousMonth = month;
  }

  const sealedCells: DayCell[] = sealed.map((day) => {
    const daySeqs = [...(seqs[day] ?? [])];
    const state: DayState = mintDay && day === mintDay ? 'minted' : 'sealed';
    return { day, state, seqs: daySeqs, title: cellTitle(day, state, daySeqs) };
  });

  return {
    columns,
    firstDay,
    lastDay,
    sealedDays: sealed.length,
    sealedDaysInWindow,
    sealedCells,
    spanDays: dayDiff(firstDay, today) + 1,
    truncated,
  };
}

// ─── How to render it ───────────────────────────────────────────────────────

export type ArchiveView =
  | { mode: 'empty' }
  | { mode: 'first-days'; days: DayCell[] }
  | { mode: 'grid'; calendar: PracticeCalendar };

/**
 * A sparse record should look like a small honest object, not a stretched one.
 * Under GRID_MIN_SEALED_DAYS the grid is a rectangle with a dot in it — so show
 * the days themselves instead.
 */
export function archiveView(calendar: PracticeCalendar): ArchiveView {
  if (calendar.sealedDays === 0) return { mode: 'empty' };
  if (calendar.sealedDays < GRID_MIN_SEALED_DAYS) {
    // From sealedCells, NOT from the windowed columns: a sealed day older than
    // the window is still part of the record.
    return { mode: 'first-days', days: calendar.sealedCells };
  }
  return { mode: 'grid', calendar };
}

/**
 * One line above the record. No denominator, no run length, nothing to fail —
 * see constraints 1, 2 and 5.
 */
export function practiceSummary(calendar: PracticeCalendar): string {
  if (calendar.sealedDays === 0 || !calendar.firstDay || !calendar.lastDay) {
    return 'No sealed days yet.';
  }
  if (calendar.sealedDays === 1) {
    return `One sealed day — ${longDate(calendar.firstDay)}.`;
  }
  if (calendar.firstDay === calendar.lastDay) {
    return `${calendar.sealedDays} seals on ${longDate(calendar.firstDay)}.`;
  }
  return `${calendar.sealedDays} sealed days, from ${longDate(calendar.firstDay)} to ${longDate(calendar.lastDay)}.`;
}

/** The grid's single accessible label. Announcing 84 cells is hostile; the seal
 *  log rendered beneath it is the readable version. */
export function calendarLabel(calendar: PracticeCalendar): string {
  return practiceSummary(calendar);
}
