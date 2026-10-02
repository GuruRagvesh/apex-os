'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMyAttendanceYear } from './my-attendance-api';
import type { MonthlyAttendanceSummaryRow } from './canonical-report-api';

/**
 * Twelve monthly summaries for one year.
 *
 * ONLY THE YEAR. The month view belongs to EmployeeAttendanceDashboard, which
 * is the richer, already-tested surface -- it carries the KPIs, today's live
 * state, leave balance, comp off and the manager/HR scoped variant. This panel
 * exists because that dashboard answers "how is this month going" and nothing
 * answered "how did my months compare".
 *
 * NOT A SECOND CALENDAR, and not 365 days. A year of days would move thousands
 * of rows to render twelve numbers, and nothing on screen would use the rest.
 * Picking a month here is how you get to the month view.
 *
 * EVERY FIGURE IS A FIELD ON THE RESPONSE. The twelve rows are built by the
 * same server-side summary builder the payroll register uses, so a month shown
 * here and the same month in the register cannot disagree.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function MyAttendanceYear() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['my-attendance-year', year],
    queryFn: () => getMyAttendanceYear(String(year)),
    // A year is twelve server-side assemblies, so it is held longer than a
    // month view would be.
    staleTime: 5 * 60_000,
    retry: false,
  });

  // This year and the four before it. Deliberately not derived from a joining
  // date the client does not have: a year before the employee joined comes
  // back as twelve "not employed" rows, which is a truthful answer rather than
  // a hidden option.
  const years = useMemo(
    () => Array.from({ length: 5 }, (_, i) => thisYear - i),
    [thisYear],
  );

  return (
    <div className="apex-card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="apex-text text-base font-semibold">Year at a glance</h2>
          <p className="apex-text-muted mt-0.5 text-sm">
            Twelve months of your official record, as payroll reads it.
          </p>
        </div>

        <label className="flex items-center gap-2">
          <span className="apex-text-subtle text-[11px] font-medium">Year</span>
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
        </label>
      </div>

      {isLoading && <p className="apex-text-muted text-sm">Loading {year}…</p>}
      {isError && (
        <p className="apex-text-muted text-sm">
          {year} could not be loaded. Nothing has changed; try again.
        </p>
      )}

      {!isLoading && !isError && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Monthly attendance summary for {year}
            </caption>
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
              {(data?.months ?? []).map(({ month, summary }) => (
                <MonthRow key={month} month={month} summary={summary} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MonthRow({
  month,
  summary,
}: {
  month: string;
  summary: MonthlyAttendanceSummaryRow | null;
}) {
  const name = MONTH_NAMES[Number(month.slice(5, 7)) - 1];

  if (!summary) {
    // Distinguished from a month of zeros on purpose. Somebody who joined in
    // June did not have a blank May; they had no May here at all.
    return (
      <tr className="border-b border-[var(--border-primary)] last:border-0">
        <th scope="row" className="apex-text-muted py-2 pr-3 font-normal">
          {name}
        </th>
        <td className="apex-text-subtle py-2 text-xs" colSpan={7}>
          Not employed
        </td>
      </tr>
    );
  }

  const warn = (n: number) =>
    n > 0 ? 'text-amber-600 dark:text-amber-400' : 'apex-text-muted';

  return (
    <tr className="border-b border-[var(--border-primary)] last:border-0">
      <th scope="row" className="apex-text py-2 pr-3 font-medium">
        {name}
      </th>
      <td className="apex-text-muted py-2 pr-3 text-right tabular-nums">
        {summary.workingDays}
      </td>
      <td className="apex-text py-2 pr-3 text-right tabular-nums">{summary.presentDays}</td>
      <td className={`py-2 pr-3 text-right tabular-nums ${warn(summary.absentDays)}`}>
        {summary.absentDays}
      </td>
      <td className="apex-text-muted py-2 pr-3 text-right tabular-nums">
        {summary.leaveDays}
      </td>
      <td className={`py-2 pr-3 text-right tabular-nums ${warn(summary.lateDays)}`}>
        {summary.lateDays}
      </td>
      <td className={`py-2 pr-3 text-right tabular-nums ${warn(summary.daysBelowNineHours)}`}>
        {summary.daysBelowNineHours}
      </td>
      <td className="apex-text-muted py-2 text-right tabular-nums">
        {summary.totalPresenceHours.toFixed(1)} h
      </td>
    </tr>
  );
}
