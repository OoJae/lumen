/**
 * The practice record, rendered.
 *
 * DELIBERATELY NOT a client component. It is rendered from the server-side
 * public proof page AND imported by the in-app archive modal, and adding a
 * 'use client' directive out of habit would break the former. Props only — no
 * hooks, no state, no clock (`today` is baked into the calendar upstream).
 *
 * The visual rules exist for the same reason the ones in lib/0g/practice.ts do:
 * this is a record, not a score. Sealed days are one flat colour with no
 * intensity ramp — sealing five times in a day is not "better" than once. Gaps
 * get no treatment. Nothing is ever red.
 */
import {
  archiveView,
  calendarLabel,
  longDate,
  type DayCell,
  type PracticeCalendar,
} from '@/lib/0g/practice';

const CELL = 'h-3 w-3 rounded-[3px]';

/** Monday-first, so index 0/2/4 are Mon/Wed/Fri. */
const RAIL = ['M', '', 'W', '', 'F', '', ''];

function cellClass(state: DayCell['state']): string {
  switch (state) {
    case 'minted':
      // A sealed day that happens to be the first — a ring, not a new colour.
      return `${CELL} bg-accent ring-1 ring-accent-strong ring-offset-1 ring-offset-surface`;
    case 'sealed':
      return `${CELL} bg-accent`;
    case 'empty':
      // Inert and low-contrast: this must read as paper, not as a hole.
      return `${CELL} bg-border/50`;
    default:
      // future / before-start — outside the record entirely.
      return `${CELL} bg-transparent`;
  }
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted">
      <span className="flex items-center gap-1.5">
        <span className={`${CELL} bg-accent`} aria-hidden />
        sealed
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className={`${CELL} bg-accent ring-1 ring-accent-strong ring-offset-1 ring-offset-surface`}
          aria-hidden
        />
        minted
      </span>
      <span className="flex items-center gap-1.5">
        <span className={`${CELL} bg-border/50`} aria-hidden />
        no seal
      </span>
    </div>
  );
}

/** Under three sealed days a grid is a rectangle with a dot in it. Name the
 *  days instead — a small honest object rather than a stretched one. */
function FirstDays({ days }: { days: DayCell[] }) {
  return (
    <ul className="space-y-2">
      {days.map((cell) => (
        <li key={cell.day} className="flex items-center gap-2.5 text-sm text-ink">
          <span className={cellClass(cell.state)} aria-hidden />
          <span>{longDate(cell.day)}</span>
          {cell.state === 'minted' && <span className="text-xs text-muted">· companion minted</span>}
          {cell.seqs.length > 1 && (
            <span className="text-xs text-muted">· sealed {cell.seqs.length} times</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function PracticeGrid({ calendar }: { calendar: PracticeCalendar }) {
  const view = archiveView(calendar);

  if (view.mode === 'empty') {
    return (
      <p className="text-sm leading-relaxed text-muted">
        Nothing sealed yet. A day appears here once this wallet signs a transaction committing to an
        encrypted snapshot.
      </p>
    );
  }

  if (view.mode === 'first-days') {
    return (
      <div>
        <p className="mb-3 text-xs uppercase tracking-wide text-muted">The record starts here</p>
        <FirstDays days={view.days} />
      </div>
    );
  }

  const { columns } = view.calendar;

  return (
    <div>
      <div className="overflow-x-auto">
        <div className="inline-block min-w-0">
          {/* Month labels sit above the column that opens each month. */}
          <div className="mb-1 flex gap-[3px] pl-5">
            {columns.map((column) => (
              <span
                key={`m-${column.monday}`}
                className="w-3 shrink-0 text-[10px] leading-none text-muted"
              >
                {column.monthLabel ?? ''}
              </span>
            ))}
          </div>

          <div className="flex gap-[3px]">
            {/* Day-of-week rail. Mon/Wed/Fri only — seven labels is noise. */}
            <div className="mr-0.5 flex w-4 shrink-0 flex-col gap-[3px]">
              {RAIL.map((label, i) => (
                <span
                  key={i}
                  className="flex h-3 items-center text-[10px] leading-none text-muted"
                  aria-hidden
                >
                  {label}
                </span>
              ))}
            </div>

            {/* One aria-label for the whole grid: announcing 84 cells is hostile,
                and the seal log rendered beneath this is the readable version. */}
            <div className="flex gap-[3px]" role="img" aria-label={calendarLabel(view.calendar)}>
              {columns.map((column) => (
                <div key={column.monday} className="flex shrink-0 flex-col gap-[3px]">
                  {column.days.map((cell) => (
                    <span
                      key={cell.day}
                      className={cellClass(cell.state)}
                      title={cell.title}
                      aria-hidden
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <Legend />

      {view.calendar.truncated && (
        <p className="mt-2 text-[11px] text-muted">
          Showing the most recent {columns.length} weeks. The counts below cover the whole record.
        </p>
      )}
    </div>
  );
}
