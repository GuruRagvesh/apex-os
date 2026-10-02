'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMyAttendanceMonth, getMyAttendanceYear } from './my-attendance-api';
import type { MonthlyAttendanceSummaryRow } from './canonical-report-api';

/**
 * My Attendance: the official record, as payroll reads it.
 *
 * EVERY FIGURE HERE IS A FIELD ON THE RESPONSE. Nothing is summed, averaged or
 * classified in the browser. The same nineteen figures appear on the monthly
 * register, built by the same server-side builder, so an employee and the
 * payroll register cannot disagree about a month.
 *
 * THE YEAR IS TWELVE SUMMARIES, NOT 365 DAYS. A year view answers how the
 * months compare; fetching a year of days to render twelve numbers would move
 * thousands of rows nothing on screen would use.
 *
 * RELATIONSHIP TO THE CALENDAR BELOW IT. This panel shows the stored official
 * record. The calendar and its day drawer still read /attendance/daily, which
 * re-evaluates each day live and carries the operational detail -- sessions,
 * punch evidence, activity. The two answer different questions and the heading
 * says which is which, because an employee querying a figure needs to know
 * which one payroll used.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function Stat({
  label,
  value,
  hint,
  tone = 'normal',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'normal' | 'warn';
}) {
  return (
    <div>
      <dt className="apex-text-subtle text-xs font-medium">{label}</dt>
      <dd
        className={`mt-0.5 text-sm font-semibold ${
          tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'apex-text'
        }`}
      >
        {value}
      </dd>
      {hint && <p className="apex-text-subtle mt-0.5 text-[11px]">{hint}</p>}
    </div>
  );
}

/** Hours come back as numbers; one decimal is the register's own precision. */
function hours(value: number | null | undefined): string {
  return typeof value === 'number' ? `${value.toFixed(1)} h` : '—';
}

function days(value: number | null | undefined): string {
  return typeof value === 'number' ? String(value) : '—';
}

export function MyAttendanceSummary() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-indexed
  const [view, setView] = useState<'month' | 'year'>('month');

  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;

  const monthQuery = useQuery({
    queryKey: ['my-attendance-month', monthKey],
    queryFn: () => getMyAttendanceMonth(monthKey),
    staleTime: 60_000,
    enabled: view === 'month',
  });

  const yearQuery = useQuery({
    queryKey: ['my-attendance-year', year],
    queryFn: () => getMyAttendanceYear(String(year)),
    // A year is twelve server-side assemblies, so it is held longer than a
    // month and only fetched when the year view is actually open.
    staleTime: 5 * 60_000,
    enabled: view === 'year',
  });

  // Years offered: this year and the four before it. Not derived from a
  // joining date the client does not have -- a month before the employee
  // joined comes back with a null summary and renders as "not employed",
  // which is a truthful answer rather than a hidden option.
  const years = useMemo(
    () => Array.from({ length: 5 }, (_, i) => now.getFullYear() - i),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const summary = monthQuery.data?.summary ?? null;
  const cutoff = monthQuery.data?.metadata?.lateCutoff;

  return (
    <div className="apex-card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="apex-text text-base font-semibold">Official record</h2>
          <p className="apex-text-muted mt-0.5 text-sm">
            The attendance payroll reads. Figures are calculated once, on the server.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded-lg border border-[var(--border-primary)] p-0.5"
            role="tablist"
          >
            {(['month', 'year'] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={[
                  'rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors',
                  view === v
                    ? 'bg-[var(--accent)] text-white'
                    : 'apex-text-muted hover:apex-text',
                ].join(' ')}
              >
                {v}
              </button>
            ))}
          </div>

          {view === 'month' && (
            <select
              aria-label="Month"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="apex-input text-xs"
            >
              {MONTH_NAMES.map((name, i) => (
                <option key={name} value={i}>
                  {name}
                </option>
              ))}
            </select>
          )}

          <select
            aria-label="Year"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="apex-input text-xs"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {view === 'month' ? (
        <MonthView
          loading={monthQuery.isLoading}
          failed={monthQuery.isError}
          summary={summary}
          label={`${MONTH_NAMES[month]} ${year}`}
          cutoff={cutoff}
        />
      ) : (
        <YearView
          loading={yearQuery.isLoading}
          failed={yearQuery.isError}
          months={yearQuery.data?.months ?? []}
        />
      )}
    </div>
  );
}

function MonthView({
  loading,
  failed,
  summary,
  label,
  cutoff,
}: {
  loading: boolean;
  failed: boolean;
  summary: MonthlyAttendanceSummaryRow | null;
  label: string;
  cutoff?: { clock: string; source: string };
}) {
  if (loading) return <p className="apex-text-muted text-sm">Loading {label}…</p>;
  if (failed) {
    return (
      <p className="apex-text-muted text-sm">
        {label} could not be loaded. Nothing has changed; try again.
      </p>
    );
  }
  if (!summary) {
    // Distinguished from a month of zeros on purpose. Somebody who joined in
    // June did not have a blank May; they had no May here at all.
    return (
      <p className="apex-text-muted text-sm">
        You were not employed during {label}, so there is no record for it.
      </p>
    );
  }

  return (
    <>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Stat label="Working days" value={days(summary.workingDays)} />
        <Stat label="Present" value={days(summary.presentDays)} />
        <Stat
          label="Absent"
          value={days(summary.absentDays)}
          tone={summary.absentDays > 0 ? 'warn' : 'normal'}
        />
        <Stat label="Leave" value={days(summary.leaveDays)} />
        <Stat
          label="Late"
          value={days(summary.lateDays)}
          hint={cutoff ? `after ${cutoff.clock}` : undefined}
          tone={summary.lateDays > 0 ? 'warn' : 'normal'}
        />
        <Stat
          label="Below nine hours"
          value={days(summary.daysBelowNineHours)}
          tone={summary.daysBelowNineHours > 0 ? 'warn' : 'normal'}
        />
        <Stat label="Half days" value={days(summary.halfDays)} />
        <Stat
          label="Needs resolving"
          value={days(summary.unresolvedDays)}
          hint={summary.unresolvedDays > 0 ? 'open a day below to see why' : undefined}
          tone={summary.unresolvedDays > 0 ? 'warn' : 'normal'}
        />
        <Stat label="Total presence" value={hours(summary.totalPresenceHours)} />
        <Stat label="Worked" value={hours(summary.totalWorkHours)} />
        <Stat label="Breaks" value={hours(summary.totalBreakHours)} />
        <Stat label="Unpaid (LWP)" value={days(summary.lwpUnpaidDays)} />
      </dl>

      {cutoff?.source === 'INVALID_CONFIGURED_VALUE' && (
        // Surfaced rather than swallowed: the configured cutoff is not a time,
        // so everyone is being judged against the company default. Somebody
        // should know.
        <p className="text-xs text-amber-600 dark:text-amber-400">
          The configured late cutoff is not a valid time, so {cutoff.clock} was used instead.
          Ask HR to correct the attendance setting.
        </p>
      )}
    </>
  );
}

function YearView({
  loading,
  failed,
  months,
}: {
  loading: boolean;
  failed: boolean;
  months: Array<{ month: string; summary: MonthlyAttendanceSummaryRow | null }>;
}) {
  if (loading) return <p className="apex-text-muted text-sm">Loading the year…</p>;
  if (failed) {
    return <p className="apex-text-muted text-sm">The year could not be loaded. Try again.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="apex-text-subtle border-b border-[var(--border-primary)] text-xs">
            <th scope="col" className="py-2 pr-3 font-medium">Month</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Working</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Present</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Absent</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Leave</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Late</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">&lt; 9h</th>
            <th scope="col" className="py-2 text-right font-medium">Presence</th>
          </tr>
        </thead>
        <tbody>
          {months.map(({ month, summary }) => {
            const name = MONTH_NAMES[Number(month.slice(5, 7)) - 1];
            if (!summary) {
              return (
                <tr key={month} className="border-b border-[var(--border-primary)] last:border-0">
                  <th scope="row" className="apex-text-muted py-2 pr-3 font-normal">
                    {name}
                  </th>
                  <td className="apex-text-subtle py-2 text-xs" colSpan={7}>
                    Not employed
                  </td>
                </tr>
              );
            }
            return (
              <tr key={month} className="border-b border-[var(--border-primary)] last:border-0">
                <th scope="row" className="apex-text py-2 pr-3 font-medium">
                  {name}
                </th>
                <td className="apex-text-muted py-2 pr-3 text-right tabular-nums">
                  {summary.workingDays}
                </td>
                <td className="apex-text py-2 pr-3 text-right tabular-nums">
                  {summary.presentDays}
                </td>
                <td
                  className={`py-2 pr-3 text-right tabular-nums ${
                    summary.absentDays > 0
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'apex-text-muted'
                  }`}
                >
                  {summary.absentDays}
                </td>
                <td className="apex-text-muted py-2 pr-3 text-right tabular-nums">
                  {summary.leaveDays}
                </td>
                <td
                  className={`py-2 pr-3 text-right tabular-nums ${
                    summary.lateDays > 0
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'apex-text-muted'
                  }`}
                >
                  {summary.lateDays}
                </td>
                <td
                  className={`py-2 pr-3 text-right tabular-nums ${
                    summary.daysBelowNineHours > 0
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'apex-text-muted'
                  }`}
                >
                  {summary.daysBelowNineHours}
                </td>
                <td className="apex-text-muted py-2 text-right tabular-nums">
                  {summary.totalPresenceHours.toFixed(1)} h
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
