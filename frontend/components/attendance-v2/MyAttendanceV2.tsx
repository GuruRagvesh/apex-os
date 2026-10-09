'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';
import { getMyAttendanceV2 } from './my-attendance-v2-api';
import { BRAND } from './status-presentation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth.store';
import s from './visual-fidelity.module.css';
import { DayDetailDrawer } from './DayDetailDrawer';
import { MonthCalendar } from './MonthCalendar';
import { StatusBanner } from './StatusBanner';
import { TodaySummaryCard } from './TodaySummaryCard';
import { CorrectionDialog } from './CorrectionDialog';
import { AttendanceAccountOverview } from './AttendanceAccountOverview';
import { MyAttendanceInsights, type InsightScope } from './MyAttendanceInsights';

/**
 * My Attendance V2 â€” the whole screen.
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
 * and explanation arrives from the backend. Insights count existing finalized
 * records and plot recorded measures; they do not assign attendance verdicts.
 */
export function MyAttendanceV2() {
  const [month, setMonth] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [insightScope, setInsightScope] = useState<InsightScope>('month');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [correctionDate, setCorrectionDate] = useState<string | null>(null);
  const user = useAuthStore(state => state.user);
  const role = typeof user?.role === 'string' ? user.role : user?.role?.name;
  const canReviewLeave = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(role ?? '');

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

  const openDay = (date: string, correction = false) => {
    if (correction) { setDrawerOpen(false); setCorrectionDate(date); return; }
    setCorrectionDate(null);
    setSelectedDate(date);
    setDrawerOpen(true);
  };

  return (
    <div className={[s.page, drawerOpen ? s.withDrawer : ''].join(' ')}>
      <header className={s.pageHeader}><div>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: BRAND.navy }}>
          My Attendance
        </h1>

      </div><details className={s.leaveMenu}><summary>Leave options</summary><nav aria-label="Leave options">
        <Link href="/leave">Apply / view my leave</Link>
        {canReviewLeave && <Link href="/leave">Leave approvals</Link>}
      </nav></details></header>

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
            onRequestCorrection={() => openDay(overview.data.today.date, true)}
          />

          <StatusBanner banner={overview.data.today.banner} />

          <MyAttendanceInsights
            scope={insightScope}
            onScopeChange={setInsightScope}
            month={month}
            overview={overview.data}
            onMonthChange={setMonth}
            onSelect={openDay}
          />

          <AttendanceAccountOverview />

          <MonthCalendar
            year={overview.data.month.year}
            month={overview.data.month.month}
            days={overview.data.month.days}
            selectedDate={selectedDate}
            onSelect={openDay}
            onPrevMonth={() => setMonth(shiftMonth(month, -1))}
            onNextMonth={() => setMonth(shiftMonth(month, 1))}
            onMonthChange={setMonth}
            canGoNext={canGoNext}
          />
        </>
      ) : null}

      {correctionDate && overview.data?.today.correctionAllowed && <CorrectionDialog date={correctionDate} onClose={() => setCorrectionDate(null)} />}

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
