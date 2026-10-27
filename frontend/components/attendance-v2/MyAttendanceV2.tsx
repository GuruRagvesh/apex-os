'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ChevronDown, History, Palmtree } from 'lucide-react';
import { useAuthStore } from '@apex/core-identity';
import { workdayApi } from '@/lib/api';
import { getMyAttendanceV2 } from './my-attendance-v2-api';
import { getMyRegularizations, stageLabel } from '../attendance/regularization-api';
import { AttendanceDialog } from './AttendanceDialog';
import { DayDetailDrawer } from './DayDetailDrawer';
import { CorrectionDialog } from './CorrectionDialog';
import { TodaySummaryCard } from './TodaySummaryCard';
import { AttendanceCalendarSection, type CalendarScope } from './AttendanceCalendarSection';
import s from './my-attendance.module.css';

/**
 * The employee attendance surface has two primary sections: the live workday
 * and the attendance calendar. Detailed evidence, requests and annual context
 * remain available on demand instead of competing with those two questions.
 */
export function MyAttendanceV2() {
  const [month, setMonth] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calendarScope, setCalendarScope] = useState<CalendarScope>('month');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [correctionDate, setCorrectionDate] = useState<string | null>(null);
  const [correctionsOpen, setCorrectionsOpen] = useState(false);
  const user = useAuthStore(state => state.user);
  const role = typeof user?.role === 'string' ? user.role : user?.role?.name;
  const canReviewLeave = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(role ?? '');

  const overview = useQuery({
    queryKey: ['my-attendance-v2', month],
    queryFn: () => getMyAttendanceV2(month ?? undefined),
    retry: false,
  });
  const workday = useQuery({
    queryKey: ['workday-today'],
    queryFn: () => workdayApi.getToday() as Promise<WorkdayTodayProjection>,
    staleTime: 60_000,
    retry: false,
  });
  const corrections = useQuery({
    queryKey: ['my-regularizations'],
    queryFn: getMyRegularizations,
    enabled: correctionsOpen,
    retry: false,
  });

  const seed = useMemo(
    () => overview.data?.month.days.find(day => day.date === selectedDate),
    [overview.data, selectedDate],
  );
  const displayedMonth = overview.data
    ? `${overview.data.month.year}-${String(overview.data.month.month).padStart(2, '0')}`
    : month;
  const canGoNext = !!displayedMonth && displayedMonth < (overview.data?.today.date.slice(0, 7) ?? displayedMonth);
  const sessions = Array.isArray(workday.data?.allSessions) ? workday.data.allSessions : null;
  const sessionCount = typeof workday.data?.sessionCount === 'number'
    ? workday.data.sessionCount
    : sessions?.length ?? null;
  const breakCount = typeof workday.data?.breakCount === 'number'
    ? workday.data.breakCount
    : sessions?.reduce(
      (total, session) => total + (session.breakLogs ?? []).filter(item => item.breakType !== 'MEETING').length,
      0,
    ) ?? null;

  const openDay = (date: string, correction = false) => {
    if (correction) {
      setDrawerOpen(false);
      setCorrectionDate(date);
      return;
    }
    setCorrectionDate(null);
    setSelectedDate(date);
    setDrawerOpen(true);
  };

  return (
    <div className={[s.page, drawerOpen ? s.withDrawer : ''].join(' ')}>
      <header className={s.pageHeader}>
        <div>
          <h1>My Attendance</h1>
          <p>Today’s workday and your recorded attendance.</p>
        </div>
        <div className={s.headerActions}>
          <button type="button" className={s.textAction} onClick={() => setCorrectionsOpen(true)}>
            <History aria-hidden="true" />My Corrections
          </button>
          <details className={s.leaveMenu}>
            <summary><Palmtree aria-hidden="true" />Leave &amp; Balance<ChevronDown aria-hidden="true" /></summary>
            <nav aria-label="Leave and balance options">
              <Link href="/leave">Apply for leave and view balance</Link>
              {canReviewLeave && <Link href="/leave">Review leave requests</Link>}
            </nav>
          </details>
        </div>
      </header>

      {overview.isError ? (
        <div role="alert" className={s.errorState}>
          <AlertCircle aria-hidden="true" />
          <div>
            <strong>Your attendance could not be loaded</strong>
            <p>This view is unavailable. No attendance value has been replaced with zero.</p>
            <button type="button" onClick={() => overview.refetch()}>Try again</button>
          </div>
        </div>
      ) : overview.isLoading ? (
        <div className={s.loadingStack} aria-label="Loading attendance">
          <Skeleton className={s.todaySkeleton} />
          <Skeleton className={s.calendarSkeleton} />
        </div>
      ) : overview.data ? (
        <main className={s.content}>
          <TodaySummaryCard
            today={overview.data.today}
            sessionCount={sessionCount}
            breakCount={breakCount}
            onViewDetails={() => openDay(overview.data.today.date)}
          />
          <AttendanceCalendarSection
            overview={overview.data}
            month={displayedMonth as string}
            scope={calendarScope}
            selectedDate={selectedDate}
            canGoNext={canGoNext}
            onScopeChange={setCalendarScope}
            onMonthChange={setMonth}
            onSelect={openDay}
            onPrevMonth={() => displayedMonth && setMonth(shiftMonth(displayedMonth, -1))}
            onNextMonth={() => displayedMonth && setMonth(shiftMonth(displayedMonth, 1))}
          />
        </main>
      ) : null}

      {correctionsOpen && (
        <AttendanceDialog title="My Corrections" onClose={() => setCorrectionsOpen(false)}>
          <div className={s.correctionList}>
            {corrections.isError ? (
              <p role="alert">Correction requests could not be loaded. <button onClick={() => corrections.refetch()}>Try again</button></p>
            ) : corrections.isPending ? (
              <p>Loading correction requests…</p>
            ) : corrections.data?.length ? (
              [...corrections.data].sort((a, b) => b.date.localeCompare(a.date)).map(request => (
                <button key={request.id} onClick={() => {
                  setCorrectionsOpen(false);
                  requestAnimationFrame(() => openDay(request.date.slice(0, 10)));
                }}>
                  <span><strong>{request.date.slice(0, 10)}</strong><small>{request.reason || 'Attendance correction'}</small></span>
                  <span>{stageLabel(request.status)}</span>
                </button>
              ))
            ) : <p>No correction requests were found.</p>}
          </div>
        </AttendanceDialog>
      )}

      {correctionDate && <CorrectionDialog date={correctionDate} onClose={() => setCorrectionDate(null)} />}
      <DayDetailDrawer
        date={selectedDate}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        seed={seed}
        onRequestCorrection={date => openDay(date, true)}
      />
    </div>
  );
}

interface WorkdayTodayProjection {
  sessionCount?: number;
  breakCount?: number;
  allSessions?: Array<{
    breakLogs?: Array<{ breakType?: string }>;
  }>;
}

function Skeleton({ className }: { className: string }) {
  return <div className={`${s.skeleton} ${className}`} aria-hidden="true" />;
}

function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
