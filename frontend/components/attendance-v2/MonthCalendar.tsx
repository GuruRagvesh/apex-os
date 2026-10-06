'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { MyAttendanceDayV2 } from './my-attendance-v2-api';
import { BRAND, LEGEND, monthLabel, presentOutcome } from './status-presentation';

/**
 * The month grid.
 *
 * WHAT A CELL MAY SAY. A cell renders only what the backend sent for that date.
 * There is no inference here — no "weekend so probably weekly off", no "no
 * result so absent". A date with no evaluation is neutral and carries no
 * status, because a blank cell is honest and a red one would be a claim.
 *
 * FUTURE DATES. Neutral ground, no tint, no glyph, not selectable. A future day
 * has no attendance result and must not look like one.
 *
 * ABSENT vs NEEDS REVIEW. Different hue, different glyph, different label.
 * They are the pair most often confused, and they mean opposite things.
 *
 * NO PHOTOS. Punch photos never appear in this grid, at any size. A photo is
 * evidence, viewed deliberately inside the day drawer; a wall of thumbnails is
 * a different thing being shown to a different purpose.
 */
export function MonthCalendar({
  year,
  month,
  days,
  selectedDate,
  onSelect,
  onPrevMonth,
  onNextMonth,
  canGoNext,
}: {
  year: number;
  month: number;
  days: MyAttendanceDayV2[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  canGoNext: boolean;
}) {
  // Leading blanks so the 1st lands under its weekday. Monday-first.
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const leadingBlanks = (firstWeekday + 6) % 7;

  return (
    <section
      className="apex-card rounded-2xl border border-apex-border p-4 sm:p-6"
      style={{ boxShadow: '0 1px 2px rgba(1, 38, 106, 0.04), 0 8px 24px rgba(1, 38, 106, 0.05)' }}
    >
      <header className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight" style={{ color: BRAND.navy }}>
          {monthLabel(year, month)}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onPrevMonth}
            aria-label="Previous month"
            className="apex-text rounded-lg border border-apex-border p-1.5"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onNextMonth}
            aria-label="Next month"
            disabled={!canGoNext}
            className="apex-text rounded-lg border border-apex-border p-1.5 disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="grid grid-cols-7 gap-1 sm:gap-2" role="grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div
            key={d}
            className="pb-2 text-center text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: BRAND.blue }}
          >
            {d}
          </div>
        ))}

        {Array.from({ length: leadingBlanks }, (_, i) => (
          <div key={`blank-${i}`} aria-hidden="true" />
        ))}

        {days.map((day) => (
          <DayCell
            key={day.date}
            day={day}
            selected={day.date === selectedDate}
            onSelect={onSelect}
          />
        ))}
      </div>

      <footer className="mt-5 flex flex-wrap gap-x-4 gap-y-2 border-t border-apex-border pt-4">
        {LEGEND.map((entry) => (
          <span key={entry.outcome} className="apex-text-muted flex items-center gap-1.5 text-xs">
            <span
              className="inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold"
              style={{ background: entry.tint, color: entry.color }}
              aria-hidden="true"
            >
              {entry.glyph}
            </span>
            {entry.label}
          </span>
        ))}
      </footer>
    </section>
  );
}

function DayCell({
  day,
  selected,
  onSelect,
}: {
  day: MyAttendanceDayV2;
  selected: boolean;
  onSelect: (date: string) => void;
}) {
  const dayOfMonth = Number(day.date.slice(8, 10));
  const status = presentOutcome(day.outcome);
  const needsAttention = day.evaluationState === 'NEEDS_REVIEW';

  // A future date is inert: no status, no tint, not clickable.
  if (day.isFuture) {
    return (
      <div
        className="flex aspect-square flex-col items-center justify-center rounded-xl text-sm"
        style={{ background: '#FAFBFC', color: '#A1A1AA' }}
        aria-label={`${day.date}, no attendance result yet`}
      >
        {dayOfMonth}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(day.date)}
      aria-label={`${day.date}, ${status.label}${needsAttention ? ', needs review' : ''}`}
      aria-current={day.isToday ? 'date' : undefined}
      className="relative flex aspect-square flex-col items-center justify-center gap-0.5 rounded-xl border text-sm transition"
      style={{
        background: day.outcome ? status.tint : 'transparent',
        // Selection is a brand concern (interface), so it uses the brand ring
        // rather than borrowing a semantic colour and changing the cell's
        // apparent meaning.
        borderColor: selected ? BRAND.navy : day.isToday ? BRAND.lightBlue : 'transparent',
        borderWidth: selected || day.isToday ? 2 : 1,
      }}
    >
      <span className="text-sm font-semibold tabular-nums" style={{ color: status.color }}>
        {dayOfMonth}
      </span>
      {day.outcome ? (
        <span
          className="max-w-full truncate px-1 text-[10px] font-medium leading-none"
          style={{ color: status.color }}
        >
          {status.shortLabel}
        </span>
      ) : null}
      {needsAttention ? (
        <span
          className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full"
          style={{ background: '#B45309' }}
          aria-hidden="true"
        />
      ) : null}
    </button>
  );
}
