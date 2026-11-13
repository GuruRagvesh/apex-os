'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getConsoleAccess } from '../console-api';
import { currentMonth, monthLabel } from '../register-month';
import {
  companyToday, currentFyStartYear, financialYearMonths, fyLabel, lastMonths,
} from './analytics-data';
import { DailyAnalytics } from './DailyAnalytics';
import { MonthlyAnalytics, OverallAnalytics, YearlyAnalytics } from './PeriodAnalytics';
import { Empty, Skeleton } from './AnalyticsUi';
import s from './analytics.module.css';

type Period = 'daily' | 'monthly' | 'yearly' | 'overall';
const PERIODS: Array<{ key: Period; label: string }> = [
  { key: 'daily', label: 'Daily' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly', label: 'Yearly' },
  { key: 'overall', label: 'Overall' },
];

/**
 * Attendance analytics inside the Attendance Console (decision: Option A).
 *
 * Read-only. Scope comes from the server on every call: HR and Admin see the
 * company, managers and team leads see their teams, and the top-bar department
 * filter narrows both. Every number is a count of stored results; there is no
 * attendance percentage or score until those definitions are approved.
 */
export function AttendanceAnalytics({ onOpenReviews }: { onOpenReviews: () => void }) {
  const today = companyToday();
  const [period, setPeriod] = useState<Period>('daily');
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(() => currentMonth());
  const [fyStart, setFyStart] = useState(() => currentFyStartYear(today));

  const access = useQuery({ queryKey: ['console-access'], queryFn: getConsoleAccess, staleTime: 5 * 60_000, retry: false });
  const fyOptions = useMemo(() => [0, 1, 2].map(i => currentFyStartYear(today) - i), [today]);
  const monthOptions = useMemo(() => lastMonths(24, today).reverse(), [today]);

  if (access.isLoading) return <Skeleton height={320} />;
  if (!access.data?.hasTeam) {
    return <Empty title="No team to show" text="Attendance analytics is available to HR, Admins and people who manage a team." />;
  }
  const isHr = access.data.isHr;

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h2>Attendance Analytics</h2>
          <p>{isHr ? 'Company-wide attendance, read from official records.' : 'Your teams’ attendance, read from official records.'}</p>
        </div>
        <div className={s.segment} role="tablist" aria-label="Period">
          {PERIODS.map(p => (
            <button key={p.key} type="button" role="tab" aria-selected={period === p.key} onClick={() => setPeriod(p.key)}>{p.label}</button>
          ))}
        </div>
      </div>

      <div className={s.filterCard}>
        {period === 'daily' && (
          <label className={s.field}>
            <span>Date</span>
            <input className={s.input} type="date" value={date} max={today} onChange={e => e.target.value && setDate(e.target.value)} />
          </label>
        )}
        {period === 'monthly' && (
          <label className={s.field}>
            <span>Month</span>
            <select className={s.input} value={month} onChange={e => setMonth(e.target.value)}>
              {monthOptions.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </label>
        )}
        {period === 'yearly' && (
          <label className={s.field}>
            <span>Financial year</span>
            <select className={s.input} value={fyStart} onChange={e => setFyStart(Number(e.target.value))}>
              {fyOptions.map(y => <option key={y} value={y}>{fyLabel(y)} (Apr–Mar)</option>)}
            </select>
          </label>
        )}
        {period === 'overall' && (
          <div className={s.field}><span>Period</span><span className={s.input} style={{ display: 'flex', alignItems: 'center' }}>Last 12 months</span></div>
        )}
        <p className={s.filterNote}>
          {isHr ? 'Use the department filter in the top bar to narrow every view.' : 'Showing only the people you manage.'}
        </p>
      </div>

      {period === 'daily' && <DailyAnalytics date={date} isHr={isHr} onOpenReviews={onOpenReviews} />}
      {period === 'monthly' && <MonthlyAnalytics month={month} />}
      {period === 'yearly' && <YearlyAnalytics months={financialYearMonths(fyStart, today)} label={fyLabel(fyStart)} />}
      {period === 'overall' && <OverallAnalytics months={lastMonths(12, today)} />}
    </div>
  );
}
