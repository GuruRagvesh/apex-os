'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plane,
} from 'lucide-react';
import type {
  AttendanceSummaryV2,
  MyAttendanceOverviewV2,
} from './my-attendance-v2-api';
import { getMyAttendanceFiscalYear } from './my-attendance-v2-api';
import {
  getMyCompOffCredits,
  getMyLeaveBalance,
} from '../attendance/leave-balance-api';
import { monthLabel } from './status-presentation';
import { usableFinancialYear } from './financial-year';
import { adjacentFinancialYearMonth, financialYearTitle } from './insights-presentation';
import { MonthCalendar } from './MonthCalendar';
import s from './my-attendance.module.css';

export type CalendarScope = 'month' | 'year';

export function AttendanceCalendarSection({
  overview,
  month,
  scope,
  selectedDate,
  canGoNext,
  onScopeChange,
  onMonthChange,
  onSelect,
  onPrevMonth,
  onNextMonth,
}: {
  overview: MyAttendanceOverviewV2;
  month: string;
  scope: CalendarScope;
  selectedDate: string | null;
  canGoNext: boolean;
  onScopeChange: (scope: CalendarScope) => void;
  onMonthChange: (month: string) => void;
  onSelect: (date: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}) {
  const [filter, setFilter] = useState<string | null>(null);
  const financialYear = usableFinancialYear(overview.financialYear);
  const effectiveScope: CalendarScope = financialYear ? scope : 'month';
  const annual = useQuery({
    queryKey: ['my-attendance-v2-fiscal-year', financialYear?.label ?? 'unavailable'],
    queryFn: () => getMyAttendanceFiscalYear(financialYear!.label),
    enabled: effectiveScope === 'year' && financialYear !== null,
    staleTime: 60_000,
    retry: false,
  });
  const annualBalance = useQuery({
    queryKey: ['my-leave-balance', 'ANNUAL'],
    queryFn: () => getMyLeaveBalance('ANNUAL'),
    staleTime: 300_000,
    retry: false,
  });
  const compOff = useQuery({
    queryKey: ['my-comp-off'],
    queryFn: getMyCompOffCredits,
    staleTime: 300_000,
    retry: false,
  });
  const summary = effectiveScope === 'month' ? overview.month.summary : annual.data?.summary;
  const currentMonth = overview.today.date.slice(0, 7);

  return (
    <section className={s.calendarSection} aria-labelledby="attendance-calendar-title">
      <header className={s.calendarSectionHeader}>
        <div>
          <span className={s.sectionKicker}>Your recorded days</span>
          <h2 id="attendance-calendar-title">Attendance Calendar</h2>
        </div>
        <div className={s.scopeTabs} aria-label="Attendance period">
          <button aria-pressed={effectiveScope === 'month'} onClick={() => onScopeChange('month')}>Month</button>
          <button aria-pressed={effectiveScope === 'year'} disabled={!financialYear} onClick={() => onScopeChange('year')}>Year</button>
        </div>
      </header>

      <div className={s.leaveBalanceKpis} aria-label="Leave balances">
        <div className={s.leaveBalanceLabel}>
          <span><Plane aria-hidden="true" /></span>
          <div><strong>Leave balance</strong><small>Available now</small></div>
        </div>
        <LeaveBalanceKpi
          label="Annual leave"
          value={annualBalance.data?.balance}
          loading={annualBalance.isPending}
          unavailable={annualBalance.isError}
        />
        <LeaveBalanceKpi
          label="Comp off"
          value={compOff.data?.length}
          loading={compOff.isPending}
          unavailable={compOff.isError}
        />
      </div>

      <div className={s.calendarToolbar}>
        {effectiveScope === 'month' ? (
          <>
            <h3>{monthLabel(overview.month.year, overview.month.month)}</h3>
            <div className={s.monthControls}>
              <button type="button" onClick={onPrevMonth} aria-label="Previous month"><ChevronLeft /></button>
              <label className={s.monthPicker}>
                <CalendarDays aria-hidden="true" />
                <span>{monthLabel(overview.month.year, overview.month.month)}</span>
                <ChevronDown aria-hidden="true" />
                <input
                  type="month"
                  aria-label="Select attendance month"
                  value={month}
                  max={currentMonth}
                  onChange={event => event.target.value && onMonthChange(event.target.value)}
                />
              </label>
              <button type="button" onClick={onNextMonth} disabled={!canGoNext} aria-label="Next month"><ChevronRight /></button>
            </div>
          </>
        ) : (
          <>
            <h3>{financialYearTitle(financialYear!)}</h3>
            <div className={s.monthControls} aria-label="Financial year navigation">
              <button type="button" aria-label="Previous financial year" onClick={() => {
                const target = adjacentFinancialYearMonth(financialYear!, -1, overview.today.date);
                if (target) onMonthChange(target);
              }}><ChevronLeft /></button>
              <span className={s.yearPicker}>{financialYearTitle(financialYear!)}</span>
              <button type="button" aria-label="Next financial year" disabled={adjacentFinancialYearMonth(financialYear!, 1, overview.today.date) === null} onClick={() => {
                const target = adjacentFinancialYearMonth(financialYear!, 1, overview.today.date);
                if (target) onMonthChange(target);
              }}><ChevronRight /></button>
            </div>
          </>
        )}
      </div>

      <CompactSummary
        summary={summary}
        loading={effectiveScope === 'year' && annual.isPending}
        activeFilter={filter}
        interactive={effectiveScope === 'month'}
        onFilter={value => setFilter(filter === value ? null : value)}
      />

      {effectiveScope === 'month' ? (
        <MonthCalendar
          year={overview.month.year}
          month={overview.month.month}
          days={overview.month.days}
          selectedDate={selectedDate}
          filter={filter}
          onFilterChange={setFilter}
          onSelect={onSelect}
        />
      ) : annual.isPending ? (
        <div className={s.yearLoading}>Loading the financial year…</div>
      ) : annual.isError ? (
        <div className={s.yearError} role="alert">
          <AlertCircle aria-hidden="true" />
          <span>The financial-year view could not be loaded.</span>
          <button onClick={() => annual.refetch()}>Try again</button>
        </div>
      ) : annual.data ? (
        <div className={s.yearGrid} aria-label={`Financial year ${annual.data.financialYear.label}`}>
          {annual.data.months.map(period => {
            const key = `${period.year}-${String(period.month).padStart(2, '0')}`;
            const upcoming = key > currentMonth;
            return (
              <button
                key={key}
                type="button"
                className={s.yearCard}
                onClick={() => {
                  onMonthChange(key);
                  onScopeChange('month');
                }}
              >
                <span className={s.yearCardHeading}>
                  <strong>{monthLabel(period.year, period.month).split(' ')[0]}</strong>
                  <small>{upcoming ? 'Upcoming' : `${period.summary.recordedDays} recorded`}</small>
                </span>
                {upcoming ? (
                  <span className={s.upcomingMonth}>Attendance not evaluated</span>
                ) : (
                  <>
                    <span className={s.yearCardNumbers}>
                      <span><b>{period.summary.present}</b> Present</span>
                      <span><b>{period.summary.leave}</b> Leave</span>
                      <span><b>{period.summary.needsReview}</b> Review</span>
                    </span>
                    <span className={s.yearDistribution} aria-hidden="true">
                      <i style={{ flex: period.summary.present, background: '#16A34A' }} />
                      <i style={{ flex: period.summary.halfDay, background: '#9333EA' }} />
                      <i style={{ flex: period.summary.leave + period.summary.lwp, background: '#0284C7' }} />
                      <i style={{ flex: period.summary.absent, background: '#DC2626' }} />
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

const SUMMARY_ITEMS = [
  { key: 'present', label: 'Present', tone: 'present', filter: 'Present' },
  { key: 'late', label: 'Late flags', tone: 'late', filter: 'Late / Short' },
  { key: 'halfDay', label: 'Half day', tone: 'half', filter: 'Half day' },
  { key: 'leave', label: 'Paid leave taken', tone: 'leave', filter: 'Approved leave' },
  { key: 'lwp', label: 'Unpaid leave', tone: 'unpaid', filter: 'Unpaid leave' },
  { key: 'absent', label: 'Absent', tone: 'absent', filter: 'Absent' },
  { key: 'holiday', label: 'Holidays', tone: 'holiday', filter: 'Holiday' },
  { key: 'needsReview', label: 'Needs review', tone: 'review', filter: 'Needs review' },
] as const;

function CompactSummary({
  summary,
  loading,
  activeFilter,
  interactive,
  onFilter,
}: {
  summary?: AttendanceSummaryV2;
  loading: boolean;
  activeFilter: string | null;
  interactive: boolean;
  onFilter: (filter: string) => void;
}) {
  return (
    <div className={s.compactSummary} aria-label="Attendance summary" aria-busy={loading}>
      {SUMMARY_ITEMS.map(item => {
        const value = summary?.[item.key];
        const content = (
          <>
            <span className={s.summaryDot} data-tone={item.tone} aria-hidden="true" />
            <span><small>{item.label}</small><strong>{loading || value === undefined ? '—' : value}</strong></span>
          </>
        );
        return interactive ? (
          <button
            key={item.key}
            type="button"
            className={s.summaryItem}
            data-tone={item.tone}
            data-zero={value === 0}
            aria-pressed={activeFilter === item.filter}
            onClick={() => onFilter(item.filter)}
          >{content}</button>
        ) : (
          <div key={item.key} className={s.summaryItem} data-tone={item.tone} data-zero={value === 0}>{content}</div>
        );
      })}
    </div>
  );
}

function LeaveBalanceKpi({
  label,
  value,
  loading,
  unavailable,
}: {
  label: string;
  value?: number;
  loading: boolean;
  unavailable: boolean;
}) {
  const known = Number.isFinite(value);
  return (
    <div className={s.leaveBalanceKpi} data-unavailable={unavailable || undefined}>
      <small>{label}</small>
      <strong>{loading || unavailable || !known ? '—' : value}</strong>
      <span>{unavailable ? 'Unavailable' : loading ? 'Loading' : known ? 'days' : 'Not recorded'}</span>
    </div>
  );
}
