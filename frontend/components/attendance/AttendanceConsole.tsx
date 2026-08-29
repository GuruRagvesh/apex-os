'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ManualRecoveryForm } from './ManualRecoveryForm';
import { PayrollMonthClose } from './PayrollMonthClose';
import {
  finalizeDay,
  getConsoleAccess,
  getRegister,
  getRoster,
  getSummary,
  runEvaluation,
  type EvaluationResult,
} from './console-api';
import { formatMinutes, formatTime, presentStatus } from './attendance-status';

/**
 * HR / manager attendance console (HC-1).
 *
 * Practical, not analytical: what happened today, who needs attention, and the
 * controls to act. Every number shown is a stored evaluation result — this
 * screen never asks the server to compute attendance as a side effect of being
 * opened. Evaluation happens only when someone presses a button.
 */

const todayIso = () => new Date().toISOString().slice(0, 10);

export function AttendanceConsole() {
  const queryClient = useQueryClient();
  const [businessDate, setBusinessDate] = useState(todayIso());
  const [tab, setTab] = useState<'roster' | 'register' | 'payroll'>('roster');
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

  const { data: register } = useQuery({
    queryKey: ['console-register', businessDate],
    queryFn: () => getRegister(`${businessDate.slice(0, 7)}-01`, businessDate),
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
        <div className="flex items-end gap-2">
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

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Present" value={summary.present + summary.late} />
          <Kpi label="Leave" value={summary.leave + summary.lwp + summary.halfDay} />
          <Kpi label="Needs review" value={summary.needsReview} tone="warn" />
          {/* Kept visually distinct from absence on purpose: a day nobody has
              evaluated is not evidence that anyone was missing. */}
          <Kpi label="Not evaluated" value={summary.notEvaluated} tone="muted" />
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* Unknown and zero are shown differently on purpose: a dash means no
              evaluation has run for this date yet, not that nobody is blocked. */}
          <Kpi
            label="Config blocked"
            value={summary.exceptions.configurationBlocked}
            tone={summary.exceptions.configurationBlocked ? 'warn' : 'muted'}
          />
          <Kpi label="Finalized" value={summary.finalized} tone="muted" />
          <Kpi label="Corrections pending" value={summary.exceptions.regularizationPending} tone="muted" />
          <Kpi label="Employees" value={summary.expectedEmployees} tone="muted" />
        </div>
      )}

      {summary && (
        <div className="apex-card">
          <p className="apex-text text-sm font-semibold">Exceptions</p>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
            <Small label="Missing punch" value={summary.exceptions.missingPunch} />
            <Small label="Missing punch out" value={summary.exceptions.missingPunchOut} />
            <Small label="Outside geofence" value={summary.exceptions.outsideGeofence} />
            <Small label="Low accuracy" value={summary.exceptions.lowAccuracy} />
            <Small label="Partial leave funding" value={summary.exceptions.partialLeaveFunding} />
            <Small label="Corrections pending" value={summary.exceptions.regularizationPending} />
          </div>
        </div>
      )}

      <div className="flex gap-2">
        {/* Payroll is HR-only: it decides what Finance is told about pay. */}
        {(access.isHr
          ? (['roster', 'register', 'payroll'] as const)
          : (['roster', 'register'] as const)
        ).map((t) => (
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
            {t === 'roster' ? 'Day view' : t === 'register' ? 'Monthly register' : 'Payroll'}
          </button>
        ))}
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

      {tab === 'payroll' && access.isHr && <PayrollMonthClose />}

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

      {tab === 'register' && register && (
        <div className="apex-card overflow-x-auto">
          <p className="apex-text-muted mb-3 text-xs">
            {register.from} to {register.to} · {register.days} days
          </p>
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="apex-text-subtle text-[11px] uppercase tracking-wide">
                <th className="pb-2">Employee</th>
                <th className="pb-2">Present</th>
                <th className="pb-2">Leave</th>
                <th className="pb-2">LWP</th>
                <th className="pb-2">Half</th>
                <th className="pb-2">Off</th>
                <th className="pb-2">Review</th>
                <th className="pb-2">Not eval.</th>
                <th className="pb-2">%</th>
              </tr>
            </thead>
            <tbody>
              {register.rows.map((r: any) => (
                <tr key={r.employee.id} className="border-t border-[var(--border-primary)]">
                  <td className="apex-text py-2 font-medium">{r.employee.name}</td>
                  <td className="apex-text-muted py-2">{r.present}</td>
                  <td className="apex-text-muted py-2">{r.leave}</td>
                  <td className="apex-text-muted py-2">{r.lwp}</td>
                  <td className="apex-text-muted py-2">{r.halfDay}</td>
                  <td className="apex-text-muted py-2">{r.weeklyOff + r.holiday}</td>
                  <td className="apex-text-muted py-2">{r.needsReview}</td>
                  <td className="apex-text-muted py-2">{r.notEvaluated}</td>
                  <td className="apex-text py-2">
                    {/* Null, not 0%: nothing evaluated means nothing is known. */}
                    {r.attendancePercent == null ? '—' : `${r.attendancePercent}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

function Small({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span className="apex-text-subtle text-[11px] uppercase tracking-wide">{label}</span>
      <span className="apex-text ml-2 text-sm font-medium">{value}</span>
    </div>
  );
}
