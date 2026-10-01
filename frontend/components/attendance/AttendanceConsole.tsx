'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@apex/core-identity';
import { canPrepare } from './import-presentation';
import { ManualRecoveryForm } from './ManualRecoveryForm';
import {
  finalizeDay,
  getConsoleAccess,
  getRoster,
  getSummary,
  runEvaluation,
  type EvaluationResult,
} from './console-api';
import { formatMinutes, formatTime, presentStatus } from './attendance-status';
import {
  currentMonth,
  formatBalance,
  formatCompletion,
  isFutureMonth,
  monthLabel,
  monthRange,
  shiftMonth,
} from './register-month';
import {
  downloadAttendance,
  getAttendanceReport,
  type DailyAttendanceReportRow,
  type MonthlyAttendanceSummaryRow,
} from './canonical-report-api';

/**
 * HR / manager attendance console (HC-1).
 *
 * Practical, not analytical: what happened today, who needs attention, and the
 * controls to act. Every number shown is a stored evaluation result — this
 * screen never asks the server to compute attendance as a side effect of being
 * opened. Evaluation happens only when someone presses a button.
 */

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Deep links from the exception queue name the day they are about, so a
 * "Resolve" click lands on that day rather than on today.
 *
 * Read from the URL directly instead of through useSearchParams, which would
 * require wrapping this client component in a Suspense boundary to prerender.
 */
function initialBusinessDate() {
  if (typeof window === 'undefined') return todayIso();
  const value = new URLSearchParams(window.location.search).get('businessDate');
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayIso();
}

/**
 * Two questions, two tabs.
 *
 *   Daily Review     what happened on this day, and what needs acting on
 *   Monthly Register how everyone did this month, and the file to send on
 *
 * Exceptions and Payroll were removed from this console deliberately. Their
 * backends are untouched -- this is a decision about what HR should be looking
 * at, not about deleting the machinery behind it.
 */
const TAB_LABEL = {
  roster: 'Daily Review',
  register: 'Monthly Register',
} as const;

export function AttendanceConsole() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [businessDate, setBusinessDate] = useState(initialBusinessDate);
  const [tab, setTab] = useState<keyof typeof TAB_LABEL>('roster');
  const [month, setMonth] = useState(() => currentMonth());
  const [downloading, setDownloading] = useState<'xlsx' | null>(null);
  // Filters the daily rows by name or employee id. Client-side on purpose:
  // the month is already in memory, so a round trip per keystroke would be
  // slower and could show a different dataset from the one being filtered.
  const [search, setSearch] = useState('');
  // The employee whose day is being recovered by hand, if any.
  const [recovering, setRecovering] = useState<{
    id: string;
    name: string;
    punchInAt: string | null;
    punchOutAt: string | null;
  } | null>(null);
  const [lastRun, setLastRun] = useState<EvaluationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: access, isLoading: accessLoading } = useQuery({
    queryKey: ['console-access'],
    queryFn: getConsoleAccess,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const { data: summary } = useQuery({
    queryKey: ['console-summary', businessDate],
    queryFn: () => getSummary(businessDate),
    enabled: !!access?.hasTeam,
    staleTime: 30_000,
  });

  const { data: roster } = useQuery({
    queryKey: ['console-roster', businessDate],
    queryFn: () => getRoster({ businessDate, limit: 100 }),
    enabled: !!access?.hasTeam && tab === 'roster',
    staleTime: 30_000,
  });

  // The register asks for the WHOLE month. The server clamps its calculations
  // to elapsed working days, so requesting September on September 1st does not
  // manufacture twenty-one absences.
  const range = monthRange(month);
  const {
    data: report,
    isLoading: registerLoading,
    isError: registerFailed,
  } = useQuery({
    // CANONICAL. Was getRegister(), which ran a second, independent monthly
    // calculation against /attendance/console/register. The table and the
    // download now read the same service method, so they cannot disagree.
    queryKey: ['attendance-report', month],
    queryFn: () => getAttendanceReport(month),
    enabled: !!access?.hasTeam && tab === 'register',
    staleTime: 60_000,
  });

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['console-summary'] });
    queryClient.invalidateQueries({ queryKey: ['console-roster'] });
    queryClient.invalidateQueries({ queryKey: ['attendance-report'] });
  };

  const evaluate = useMutation({
    mutationFn: (body: Parameters<typeof runEvaluation>[0]) => runEvaluation(body),
    onSuccess: (result) => {
      setError(null);
      setLastRun(result);
      refreshAll();
    },
    onError: (err: any) =>
      setError(err?.response?.data?.message ?? 'The evaluation could not be run.'),
  });

  const finalize = useMutation({
    mutationFn: (input: { userId: string; businessDate: string }) =>
      finalizeDay(input.userId, input.businessDate),
    onSuccess: (out: any) => {
      setError(
        out?.finalized
          ? null
          : out?.reason === 'NEEDS_REVIEW'
            ? 'That day still needs review, so it cannot be finalized yet.'
            : 'That day was already final.',
      );
      refreshAll();
    },
    onError: (err: any) =>
      setError(err?.response?.data?.message ?? 'The day could not be finalized.'),
  });

  /**
   * ONE DOWNLOAD.
   *
   * The file comes from the server, from the canonical report service, and the
   * frontend builds no spreadsheet of its own. There was previously an xlsx and
   * a CSV rendered by a second, independent report stack; both are gone and
   * this returns the approved two-sheet workbook.
   */
  const download = async () => {
    setDownloading('xlsx');
    try {
      await downloadAttendance(month);
      setError(null);
    } catch {
      setError('The attendance file could not be downloaded.');
    } finally {
      setDownloading(null);
    }
  };

  if (accessLoading) {
    return <p className="apex-text-muted py-8 text-center text-sm">Loading…</p>;
  }
  if (!access?.hasTeam) {
    return (
      <div className="apex-card">
        <p className="apex-text text-sm font-semibold">Not available</p>
        <p className="apex-text-muted mt-1 text-sm">
          This console is for HR and for managers with reporting employees.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="apex-text text-xl font-semibold">Attendance</h1>
          <p className="apex-text-muted mt-1 text-sm">
            {access.isHr ? 'Company-wide' : 'Your team'} · stored results only
          </p>
        </div>
        <div className={`flex items-end gap-2 ${tab === 'roster' ? '' : 'hidden'}`}>
          <div>
            <label className="apex-text-subtle text-[11px] uppercase tracking-wide">Date</label>
            <input
              type="date"
              className="apex-input mt-1"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
            />
          </div>
          {access.isHr && (
            <button
              onClick={() => evaluate.mutate({ businessDate })}
              disabled={evaluate.isPending}
              className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--text-inverse)] disabled:opacity-50"
            >
              {evaluate.isPending ? 'Running…' : 'Run evaluation'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20">
          <p className="text-xs text-amber-800 dark:text-amber-300">{error}</p>
        </div>
      )}

      {lastRun && (
        <div className="apex-card">
          <p className="apex-text text-sm font-semibold">Last evaluation run</p>
          <p className="apex-text-muted mt-1 text-xs">
            {lastRun.requested} employee-day(s) · {lastRun.evaluated} written ·{' '}
            {lastRun.unchanged} unchanged · {lastRun.skipped} skipped ·{' '}
            {lastRun.failed.length} failed
          </p>
          {lastRun.failed.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {lastRun.failed.slice(0, 8).map((f, i) => (
                <li key={i} className="text-xs text-red-600 dark:text-red-400">
                  · {f.businessDate}: {f.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Day-scoped, so it belongs to Daily Review and nowhere else. The
          geofence / accuracy / corrections strip that used to sit here fed the
          Exceptions tab; with that gone it was noise on a managerial screen. */}
      {summary && tab === 'roster' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Present" value={summary.present + summary.late} />
          <Kpi label="Leave" value={summary.leave + summary.lwp + summary.halfDay} />
          <Kpi label="Needs review" value={summary.needsReview} tone="warn" />
          {/* Kept visually distinct from absence on purpose: a day nobody has
              evaluated is not evidence that anyone was missing. */}
          <Kpi label="Not evaluated" value={summary.notEvaluated} tone="muted" />
          <Kpi label="Finalized" value={summary.finalized} tone="muted" />
          <Kpi label="Employees" value={summary.expectedEmployees} tone="muted" />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {(['roster', 'register'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                tab === t
                  ? 'bg-[var(--accent)] text-[var(--text-inverse)]'
                  : 'apex-text-muted border border-[var(--border-secondary)]',
              ].join(' ')}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>

        {/* An ACTION, not a third tab.
            Importing is occasional, deliberate work with its own multi-step
            flow; a permanent tab would put it beside the two questions HR
            actually asks daily, and the console was deliberately reduced to
            those two. It is styled as a link so it does not read as a tab. */}
        {canPrepare(user as any) && (
          <Link
            href="/attendance/import"
            className="apex-text-muted text-sm underline underline-offset-2"
          >
            Import / Update Data →
          </Link>
        )}
      </div>

      {recovering && (
        <ManualRecoveryForm
          employee={{ id: recovering.id, name: recovering.name }}
          businessDate={businessDate}
          existing={{ punchInAt: recovering.punchInAt, punchOutAt: recovering.punchOutAt }}
          actorIsHr={access.isHr}
          onClose={() => setRecovering(null)}
        />
      )}

      {tab === 'roster' && roster && (
        <div className="apex-card overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="apex-text-subtle text-[11px] uppercase tracking-wide">
                <th className="pb-2">Employee</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">In</th>
                <th className="pb-2">Out</th>
                <th className="pb-2">Worked</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {roster.rows.map((r) => (
                <tr key={r.employee.id} className="border-t border-[var(--border-primary)]">
                  <td className="py-2">
                    <span className="apex-text font-medium">{r.employee.name}</span>
                    {r.requiresReview && (
                      <span className="ml-2 text-[10px] font-medium text-orange-600 dark:text-orange-400">
                        ● review
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    {r.evaluationState === 'NOT_EVALUATED' ? (
                      <span className="apex-text-subtle text-xs">Not evaluated</span>
                    ) : (
                      <span
                        className={`rounded-md px-2 py-0.5 text-xs font-medium ${presentStatus(r.status as any).chip}`}
                      >
                        {presentStatus(r.status as any).label}
                      </span>
                    )}
                  </td>
                  <td className="apex-text-muted py-2 text-xs">{formatTime(r.punchInAt)}</td>
                  <td className="apex-text-muted py-2 text-xs">{formatTime(r.punchOutAt)}</td>
                  <td className="apex-text-muted py-2 text-xs">
                    {r.workedMinutes == null ? '—' : formatMinutes(r.workedMinutes)}
                  </td>
                  <td className="py-2 text-right">
                    <div className="flex justify-end gap-1.5">
                      {/* Managers see this for their own reports; the server
                          decides scope, and a refusal is surfaced by the form
                          rather than hidden. Employees never reach this table. */}
                      <button
                        onClick={() =>
                          setRecovering({
                            id: r.employee.id,
                            name: r.employee.name,
                            punchInAt: r.punchInAt,
                            punchOutAt: r.punchOutAt,
                          })
                        }
                        className="apex-text-muted rounded-lg border border-[var(--border-secondary)] px-2 py-1 text-xs"
                      >
                        Manual recovery
                      </button>

                      {access.isHr && (
                        <button
                          onClick={() =>
                            finalize.mutate({ userId: r.employee.id, businessDate })
                          }
                          disabled={
                            finalize.isPending ||
                            r.evaluationState === 'NOT_EVALUATED' ||
                            r.evaluationState === 'NEEDS_REVIEW'
                          }
                          className="apex-text-muted rounded-lg border border-[var(--border-secondary)] px-2 py-1 text-xs disabled:opacity-40"
                        >
                          Finalize
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {roster.rows.length === 0 && (
            <p className="apex-text-muted py-6 text-center text-sm">No employees in view.</p>
          )}
        </div>
      )}

      {tab === 'register' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setMonth(shiftMonth(month, -1))}
                className="apex-text-muted rounded-lg border border-[var(--border-secondary)] px-2.5 py-1.5 text-sm"
                aria-label="Previous month"
              >
                ‹
              </button>
              <span className="apex-text min-w-[9.5rem] text-center text-sm font-semibold">
                {monthLabel(month)}
              </span>
              <button
                onClick={() => setMonth(shiftMonth(month, 1))}
                // A month that has not begun holds nothing to review.
                disabled={isFutureMonth(shiftMonth(month, 1))}
                className="apex-text-muted rounded-lg border border-[var(--border-secondary)] px-2.5 py-1.5 text-sm disabled:opacity-40"
                aria-label="Next month"
              >
                ›
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <div className="text-right">
                <p className="apex-text-subtle text-[11px] uppercase tracking-wide">
                  Working days
                </p>
                {/* The full scheduled month, not the elapsed part of it. What
                    HR is asked at the end of the month is how many working days
                    it contained, and that answer does not change on the 2nd. */}
                <p className="apex-text text-2xl font-semibold leading-tight">
                  {report?.summaryRows?.[0]?.workingDays ?? '—'}
                </p>
                {/* Leave runs April to March while this page is named after a
                    calendar month, so for January, February and March the two
                    disagree. A balance nobody can date is not a fact. */}
                {report && (
                  <p className="apex-text-subtle mt-0.5 text-[11px]">
                    {report.metadata.employees} employees · {report.metadata.days} days
                    {report.metadata.unresolvedDays > 0 &&
                      ` · ${report.metadata.unresolvedDays} unresolved`}
                  </p>
                )}
              </div>
              {/* ONE ACTION. There were two buttons rendering two different
                  files from two different report stacks. */}
              <div className="flex gap-2">
                <button
                  onClick={() => download()}
                  disabled={!report || downloading !== null}
                  className="apex-text-muted rounded-lg border border-[var(--border-secondary)] px-3 py-2 text-sm disabled:opacity-40"
                >
                  {downloading ? 'Preparing…' : 'Download Attendance'}
                </button>
              </div>
            </div>
          </div>

{/* The canonical row says so per day rather than per month: an
              unconfirmed calendar reads "Calendar not confirmed" on the day
              itself, so uncertainty is visible where it applies instead of as a
              banner over figures that may be fine. */}
          {report && report.dailyRows.some((d) => d.attendanceStatus === 'Calendar not confirmed') && (
            <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20">
              <p className="text-xs text-amber-800 dark:text-amber-300">
                Some days could not be classified as working or non-working, so no
                weekly-off policy resolved for them. Those rows read “Calendar not
                confirmed” and are counted as unresolved rather than as absence.
              </p>
            </div>
          )}

          {registerLoading && (
            <p className="apex-text-muted py-8 text-center text-sm">Loading register…</p>
          )}
          {registerFailed && (
            <p className="apex-text-muted py-8 text-center text-sm">
              The register could not be loaded.
            </p>
          )}

{/* MONTHLY SUMMARY -- the approved 19 columns, rendered from the
              canonical summary rows. Every figure is already decided
              server-side; nothing here recomputes one. Leave Balance and
              Attendance % are gone: neither is in the approved contract, and
              both were derived by the retired register stack. */}
          {report && (
            <div className="apex-card overflow-x-auto">
              <table className="w-full min-w-[1180px] text-left text-sm">
                <thead>
                  <tr className="apex-text-subtle text-[11px] uppercase tracking-wide">
                    <th className="pb-2">Employee</th>
                    <th className="pb-2">ID</th>
                    <th className="pb-2">Department</th>
                    <th className="pb-2">Designation</th>
                    <th className="pb-2">Type</th>
                    <th className="pb-2 text-right">Working</th>
                    <th className="pb-2 text-right">Present</th>
                    <th className="pb-2 text-right">Absent</th>
                    <th className="pb-2 text-right">Half</th>
                    <th className="pb-2 text-right">Leave</th>
                    <th className="pb-2 text-right">Late</th>
                    <th className="pb-2 text-right">&lt;9h</th>
                    <th className="pb-2 text-right">Presence h</th>
                    <th className="pb-2 text-right">Work h</th>
                    <th className="pb-2 text-right">Break h</th>
                    <th className="pb-2 text-right">CL</th>
                    <th className="pb-2 text-right">LWP</th>
                    <th className="pb-2 text-right">Deductions</th>
                    <th className="pb-2 text-right">Unresolved</th>
                  </tr>
                </thead>
                <tbody>
                  {report.summaryRows.map((s: MonthlyAttendanceSummaryRow) => (
                    <tr key={s.userId} className="border-t border-[var(--border-primary)]">
                      <td className="apex-text py-2 font-medium">{s.employeeName}</td>
                      <td className="apex-text-muted py-2">{s.employeeId}</td>
                      <td className="apex-text-muted py-2">{s.department}</td>
                      <td className="apex-text-muted py-2">{s.designation}</td>
                      <td className="apex-text-muted py-2">{s.employeeType}</td>
                      <td className="apex-text-muted py-2 text-right">{s.workingDays}</td>
                      <td className="apex-text-muted py-2 text-right">{s.presentDays}</td>
                      <td className="apex-text-muted py-2 text-right">{s.absentDays}</td>
                      <td className="apex-text-muted py-2 text-right">{s.halfDays}</td>
                      <td className="apex-text-muted py-2 text-right">{s.leaveDays}</td>
                      <td className="apex-text-muted py-2 text-right">{s.lateDays}</td>
                      <td className="apex-text-muted py-2 text-right">{s.daysBelowNineHours}</td>
                      <td className="apex-text-muted py-2 text-right">{s.totalPresenceHours}</td>
                      <td className="apex-text-muted py-2 text-right">{s.totalWorkHours}</td>
                      <td className="apex-text-muted py-2 text-right">{s.totalBreakHours}</td>
                      <td className="apex-text-muted py-2 text-right">{s.clUsed}</td>
                      <td className="apex-text-muted py-2 text-right">{s.lwpUnpaidDays}</td>
                      <td className="apex-text-muted py-2 text-right">{s.attendanceDeductions}</td>
                      {/* Marked in the table, not only in the file. */}
                      <td
                        className={`py-2 text-right ${
                          s.unresolvedDays > 0 ? 'font-semibold text-amber-600' : 'apex-text-muted'
                        }`}
                      >
                        {s.unresolvedDays}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {report.summaryRows.length === 0 && (
                <p className="apex-text-muted py-6 text-center text-sm">
                  No employees in view.
                </p>
              )}
            </div>
          )}

          {/* DAILY ATTENDANCE -- the same canonical rows the workbook's first
              sheet carries. A subset of the 26 columns is shown; the file holds
              them all, and both come from this one fetch. */}
          {report && report.dailyRows.length > 0 && (
            <div className="apex-card overflow-x-auto">
              <div className="mb-2 flex items-center justify-between gap-4">
                <p className="apex-text text-sm font-semibold">Daily attendance</p>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter by name or ID"
                  className="apex-text rounded-lg border border-[var(--border-secondary)] bg-transparent px-2.5 py-1.5 text-sm"
                />
              </div>
              <table className="w-full min-w-[1100px] text-left text-sm">
                <thead>
                  <tr className="apex-text-subtle text-[11px] uppercase tracking-wide">
                    <th className="pb-2">Employee</th>
                    <th className="pb-2">Date</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2">In</th>
                    <th className="pb-2">Out</th>
                    <th className="pb-2">Presence</th>
                    <th className="pb-2">Worked</th>
                    <th className="pb-2">Break</th>
                    <th className="pb-2">Late</th>
                    <th className="pb-2">9h</th>
                    <th className="pb-2">Missing</th>
                    <th className="pb-2">Correction</th>
                    <th className="pb-2">Source</th>
                    <th className="pb-2">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {report.dailyRows
                    .filter((d: DailyAttendanceReportRow) =>
                      search.trim() === ''
                        ? true
                        : d.employeeName.toLowerCase().includes(search.trim().toLowerCase()) ||
                          d.employeeId.toLowerCase().includes(search.trim().toLowerCase()),
                    )
                    .map((d: DailyAttendanceReportRow) => (
                      <tr
                        key={`${d.userId}|${d.date}`}
                        className="border-t border-[var(--border-primary)]"
                      >
                        <td className="apex-text py-2 font-medium">{d.employeeName}</td>
                        <td className="apex-text-muted py-2 text-xs">{d.date}</td>
                        <td className="apex-text py-2 text-xs">{d.attendanceStatus}</td>
                        <td className="apex-text-muted py-2 text-xs">{d.punchIn}</td>
                        <td className="apex-text-muted py-2 text-xs">{d.punchOut}</td>
                        <td className="apex-text-muted py-2 text-xs">{d.totalPresenceTime}</td>
                        <td className="apex-text-muted py-2 text-xs">{d.hoursWorked}</td>
                        <td className="apex-text-muted py-2 text-xs">{d.breakTime}</td>
                        <td className="apex-text-muted py-2 text-xs">{d.lateArrival}</td>
                        <td className="apex-text-muted py-2 text-xs">{d.completion}</td>
                        <td className="apex-text-muted py-2 text-xs">{d.missingPunch}</td>
                        <td className="apex-text-muted py-2 text-xs">{d.manualCorrection}</td>
                        <td className="apex-text-muted py-2 text-xs">{d.dataSource}</td>
                        <td className="apex-text-muted py-2 text-xs">{d.remarks}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  tone = 'normal',
}: {
  label: string;
  /** null renders as a dash: "not worked out", which is not the same as zero. */
  value: number | null;
  tone?: 'normal' | 'warn' | 'muted';
}) {
  const colour =
    tone === 'warn'
      ? 'text-orange-600 dark:text-orange-400'
      : tone === 'muted'
        ? 'apex-text-subtle'
        : 'apex-text';
  return (
    <div className="apex-card">
      <p className="apex-text-subtle text-[11px] uppercase tracking-wide">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${colour}`}>{value ?? '—'}</p>
    </div>
  );
}
