/**
 * Resurfacing — the one retention mechanic worth copying.
 *
 * Across the journaling category the strongest signal is Day One's "On This
 * Day": users describe it as a reason to open the app, where a reminder is an
 * obligation to. The difference matters here more than most places, because a
 * journal that nags is a journal you start avoiding.
 *
 * So this never produces a prompt, a goal, or a count. It answers one question
 * — "is there something from your past worth seeing today?" — and returns
 * nothing at all when the honest answer is no. A journal two days old has no
 * past to show, and inventing one ("you wrote yesterday!") would be filler.
 *
 * Pure: `today` is injected, all comparisons are on the ISO date prefix, and no
 * clock is read.
 */
import type { JournalTurn } from '@lumen/shared';

export type ResurfaceKind = 'on-this-day' | 'a-year-ago' | 'months-ago' | 'first-entry';

export interface Resurfaced {
  kind: ResurfaceKind;
  /** Human label, e.g. "A year ago today". Never exhorts. */
  label: string;
  turn: JournalTurn;
  /** Other entries from the same calendar day in past years, newest first. */
  also: JournalTurn[];
}

/** Below this the journal has no past worth surfacing. */
export const MIN_AGE_DAYS_FOR_FIRST_ENTRY = 14;
/** How far either side of "N months ago" still counts as that month. */
const MONTH_WINDOW_DAYS = 3;

const DAY_MS = 86_400_000;

function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / DAY_MS);
}

/** 'MM-DD' — the calendar day irrespective of year. */
function monthDay(day: string): string {
  return day.slice(5);
}

function yearsBetween(fromDay: string, toDay: string): number {
  return Number(toDay.slice(0, 4)) - Number(fromDay.slice(0, 4));
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Something from the past worth seeing today, or null.
 *
 * Preference order, strongest first:
 *   1. The same calendar day in a previous year — the real "on this day".
 *   2. An entry from roughly N months ago (±3 days).
 *   3. The first entry, once the journal is old enough for that to feel like
 *      history rather than scrolling up.
 */
export function resurface(
  turns: readonly JournalTurn[],
  today: string,
  options: { minAgeDaysForFirst?: number } = {},
): Resurfaced | null {
  if (turns.length === 0) return null;
  const minAge = options.minAgeDaysForFirst ?? MIN_AGE_DAYS_FOR_FIRST_ENTRY;

  // Newest first throughout, so "the most recent match" is always turns[0].
  const byRecency = [...turns].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const target = monthDay(today);

  // 1. Same calendar day, an earlier year.
  const sameDay = byRecency.filter((turn) => {
    const day = dayOf(turn.createdAt);
    return monthDay(day) === target && yearsBetween(day, today) >= 1;
  });
  if (sameDay.length > 0) {
    const turn = sameDay[0]!;
    const years = yearsBetween(dayOf(turn.createdAt), today);
    return {
      kind: years === 1 ? 'a-year-ago' : 'on-this-day',
      label: years === 1 ? 'A year ago today' : `${plural(years, 'year')} ago today`,
      turn,
      also: sameDay.slice(1),
    };
  }

  // 2. Roughly N months ago. Walk outward from the oldest sensible month so the
  //    label is the largest true one ("six months ago" beats "a month ago").
  const oldest = dayOf(byRecency[byRecency.length - 1]!.createdAt);
  // Include the window in the ceiling. Flooring bare days/30 makes an entry 28
  // days old — squarely inside the ±3-day window around one month — produce
  // maxMonths = 0, so the loop never runs and the commonest case never fires.
  const maxMonths = Math.floor((daysBetween(oldest, today) + MONTH_WINDOW_DAYS) / 30);
  for (let months = maxMonths; months >= 1; months--) {
    const wanted = months * 30;
    const match = byRecency.find(
      (turn) => Math.abs(daysBetween(dayOf(turn.createdAt), today) - wanted) <= MONTH_WINDOW_DAYS,
    );
    if (match) {
      return {
        kind: 'months-ago',
        label: months === 1 ? 'A month ago' : `${plural(months, 'month')} ago`,
        turn: match,
        also: [],
      };
    }
  }

  // 3. The first entry, once it is genuinely history.
  const first = byRecency[byRecency.length - 1]!;
  if (daysBetween(dayOf(first.createdAt), today) >= minAge) {
    return { kind: 'first-entry', label: 'Where you started', turn: first, also: [] };
  }

  // Nothing honest to show. Show nothing.
  return null;
}
