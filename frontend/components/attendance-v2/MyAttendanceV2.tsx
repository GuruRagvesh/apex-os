'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';
import { getMyAttendanceV2 } from './my-attendance-v2-api';
import { BRAND } from './status-presentation';
import { DayDetailDrawer } from './DayDetailDrawer';
import { MonthCalendar } from './MonthCalendar';
import { StatusBanner } from './StatusBanner';
import { TodaySummaryCard } from './TodaySummaryCard';

/**
 * My Attendance V2 — the whole screen.
 *
 * HIDDEN ROUTE. Mounted at /attendance-v2 with no navigation entry. The live
 * /attendance page is untouched, so this can be withdrawn by deleting a folder.
 *
 * THE ERROR CONTRACT. This is the rule the page is built around: a failed
 * request produces an ERROR STATE, never a zero. There is no `?? 0` anywhere in
 * this component tree, and no figure is defaulted. An employee who cannot reach
 * the server is told the view failed; they are never shown a day that says they
 * worked no hours, because that reads as an accusation and it would be one the
 * system cannot support.
 *
 * NO ATTENDANCE ARITHMETIC. Every outcome, modifier, exception, figure, banner
 * and explanation arrives from the backend. This file arranges and selects; it
 * does not judge. The month string is the only thing it computes, and a month
 * is not an attendance verdict.
 */
export function MyAttendanceV2() {
  const [month, setMonth] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const overview = useQuery({
    queryKey: ['my-attendance-v2', month],
    queryFn: () => getMyAttendanceV2(month),
    retry: false,
  });

  const seed = useMemo(
    () => overview.data?.month.days.find((d) => d.date === selectedDate),
    [overview.data, selectedDate],
  );

  // Forward navigation stops at the current month: there is nothing to show in
  // a month that has not started, and offering the move implies there is.
  const canGoNext = month < new Date().toISOString().slice(0, 7);

  const openDay = (date: string) => {
    setSelectedDate(date);
    setDrawerOpen(true);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-1 sm:px-0">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: BRAND.navy }}>
          My Attendance
        </h1>
        <p className="mt-1.5 text-sm" style={{ color: BRAND.blue }}>
          Your recorded attendance for each day, and why it looks the way it does.
        </p>
      </header>

      {overview.isError ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border p-4"
          style={{ background: '#FEF4F1', borderColor: '#F2C7BB' }}
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" style={{ color: '#B91C1C' }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: '#7F1D1D' }}>
              Your attendance could not be loaded
            </p>
            <p className="apex-text-muted mt-0.5 text-sm">
              This is a problem reaching the server, not a change to your attendance. Nothing has
              been recorded as absent or as zero hours.
            </p>
            <button
              type="button"
              onClick={() => overview.refetch()}
              className="apex-text mt-3 rounded-lg border border-apex-border px-3 py-1.5 text-sm font-semibold"
            >
              Try again
            </button>
          </div>
        </div>
      ) : overview.isLoading ? (
        <>
          <Skeleton className="h-44" />
          <Skeleton className="h-96" />
        </>
      ) : overview.data ? (
        <>
          <TodaySummaryCard
            today={overview.data.today}
            onViewDetails={() => openDay(overview.data.today.date)}
            onRequestCorrection={() => openDay(overview.data.today.date)}
          />

          <StatusBanner banner={overview.data.today.banner} />

          <MonthCalendar
            year={overview.data.month.year}
            month={overview.data.month.month}
            days={overview.data.month.days}
            selectedDate={selectedDate}
            onSelect={openDay}
            onPrevMonth={() => setMonth(shiftMonth(month, -1))}
            onNextMonth={() => setMonth(shiftMonth(month, 1))}
            canGoNext={canGoNext}
          />
        </>
      ) : null}

      <DayDetailDrawer
        date={selectedDate}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        seed={seed}
      />
    </div>
  );
}

function Skeleton({ className }: { className: string }) {
  return (
    <div
      className={`animate-pulse rounded-2xl border border-apex-border ${className}`}
      style={{ background: '#F0F7FF' }}
      aria-hidden="true"
    />
  );
}

/** Month arithmetic in UTC, so a timezone cannot shift which month is shown. */
function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const d = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
