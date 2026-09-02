'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@apex/core-identity';
import { canPrepare } from './import-presentation';
import { ManualRecoveryForm } from './ManualRecoveryForm';
import {
  downloadRegister,
  finalizeDay,
  getConsoleAccess,
  getRegister,
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
  const [downloading, setDownloading] = useState<'xlsx' | 'csv' | null>(null);
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
    data: register,
    isLoading: registerLoading,
    isError: registerFailed,
  } = useQuery({
    queryKey: ['console-register', month],
    queryFn: () => getRegister(range.from, range.to),
    enabled: !!access?.hasTeam && tab === 'register',
    staleTime: 60_000,
  });

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['console-summary'] });
    queryClient.invalidateQueries({ queryKey: ['console-roster'] });
    queryClient.invalidateQueries({ queryKey: ['console-register'] });
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
   * Both files come from the server, from the same call that produced the table
   * above. Nothing is recomputed here, so the download cannot disagree with
   * what HR is looking at.
   */
  const download = async (format: 'xlsx' | 'csv') => {
    setDownloading(format);
    try {
      await downloadRegister(month, format);
      setError(null);
    } catch {
      setError('The register could not be downloaded.');
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
                  {register?.workingDays ?? '—'}
                </p>
                {/* Leave runs April to March while this page is named after a
                    calendar month, so for January, February and March the two
                    disagree. A balance nobody can date is not a fact. */}
                {register && (
                  <p className="apex-text-subtle mt-0.5 text-[11px]">
                    Leave balance: FY {register.leaveBalanceFinancialYear}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => download('xlsx')}
                  disabled={!register || downloading !== null}
                  className="apex-text-muted rounded-lg border border-[var(--border-secondary)] px-3 py-2 text-sm disabled:opacity-40"
                >
                  {downloading === 'xlsx' ? 'Preparing…' : 'Download Excel'}
                </button>
                <button
                  onClick={() => download('csv')}
                  disabled={!register || downloading !== null}
                  className="apex-text-muted rounded-lg border border-[var(--border-secondary)] px-3 py-2 text-sm disabled:opacity-40"
                >
                  {downloading === 'csv' ? 'Preparing…' : 'Download CSV'}
                </button>
              </div>
            </div>
          </div>

          {register && !register.calendarResolved && (
            <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20">
              <p className="text-xs text-amber-800 dark:text-amber-300">
                No weekly-off policy could be resolved for this month, so weekends
                are being counted as working days. The working-day total and every
                percentage below it are unreliable until that is configured.
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

          {register && (
            <div className="apex-card overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="apex-text-subtle text-[11px] uppercase tracking-wide">
                    <th className="pb-2">Employee</th>
                    <th className="pb-2 text-right">Present</th>
                    <th className="pb-2 text-right">Absent</th>
                    <th className="pb-2 text-right">Half days</th>
                    <th className="pb-2 text-right">Leave balance</th>
                    <th className="pb-2 text-right">Late punch-ins</th>
                    <th className="pb-2 text-right">Attendance %</th>
                  </tr>
                </thead>
                <tbody>
                  {register.employees.map((e) => (
                    <tr key={e.userId} className="border-t border-[var(--border-primary)]">
                      <td className="apex-text py-2 font-medium">{e.name}</td>
                      <td className="apex-text-muted py-2 text-right">{e.daysPresent}</td>
                      <td className="apex-text-muted py-2 text-right">{e.daysAbsent}</td>
                      <td className="apex-text-muted py-2 text-right">{e.halfDays}</td>
                      <td className="apex-text-muted py-2 text-right">
                        {formatBalance(e.leaveBalance)}
                      </td>
                      <td className="apex-text-muted py-2 text-right">{e.latePunchIns}</td>
                      <td className="apex-text py-2 text-right">
                        {formatCompletion(e.attendanceCompletionPercentage)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {register.employees.length === 0 && (
                <p className="apex-text-muted py-6 text-center text-sm">
                  No employees in view.
                </p>
              )}
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
