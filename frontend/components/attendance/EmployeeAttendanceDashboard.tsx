'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Lock } from 'lucide-react';
import { useAuthStore } from '@apex/core-identity';
import { workdayStatusKeys } from '@/lib/workday-status-keys';
import { ManagerCompOffPanel } from './ManagerCompOffPanel';
import {
  compOffKeys,
  getMyCompOffCredits,
  getMyLeaveBalance,
  LEAVE_TYPE_LABEL,
  PERSONAL_LEAVE_TYPES,
  type PersonalLeaveType,
} from './leave-balance-api';
import {
  getEmployeeAttendanceSummary,
  getMyAttendanceSummary,
  type SummaryDay,
} from './employee-summary-api';
import {
  attentionItems,
  categoryLabel,
  compOffBuckets,
  completionDisplay,
  dayLabel,
  formatDateOnly,
  formatDurationMinutes,
  formatMonthLabel,
  formatPunchTime,
  leaveRow,
  lockNote,
  metricRows,
  monthKpis,
  monthLockState,
  monthOptions,
  sampleNote,
  tenureLabel,
  todayFrom,
  type DayTone,
} from './employee-summary-presentation';

/**
 * "How am I doing this month" for one employee.
 *
 * NOT the company Analytics screen. This answers three questions and no
 * others: how this month is going, what leave and comp off are in hand, and
 * whether anything about my own record is wrong.
 *
 * ONE COMPOSED READ. The month, the counts, the averages, today's completion
 * and the needs-attention list all arrive from
 * GET /attendance/employee/:id/summary in a single response, rather than this
 * screen assembling them out of a dozen queries and its own arithmetic. Leave
 * balance and comp off keep their own existing endpoints, because those are
 * already authoritative and already tested and a second copy of an entitlement
 * calculation is the one thing nobody notices until it disagrees.
 *
 * AUTHORITY IS THE SERVER'S. Passing an employeeId asks for that person's
 * month; whether the answer comes back is decided by the same canViewUser rule
 * the profile endpoint enforces. Nothing here infers permission from the route
 * that rendered it.
 *
 * WHOSE LEAVE IS SHOWN. The leave and comp off endpoints are self-scoped --
 * they answer for whoever is authenticated, with no id parameter. So those two
 * panels appear ONLY when the subject is the viewer. Rendering them while
 * looking at somebody else would print the viewer's own balances under that
 * person's name, which is worse than not showing them at all.
 */

function toneClass(tone: DayTone): string {
  if (tone === 'good') return 'text-green-600 dark:text-green-400';
  if (tone === 'warn') return 'text-amber-600 dark:text-amber-400';
  if (tone === 'bad') return 'text-rose-600 dark:text-rose-400';
  return 'apex-text-muted';
}

function chipClass(tone: DayTone): string {
  if (tone === 'good') return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300';
  if (tone === 'warn') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
  if (tone === 'bad') return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300';
  return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="apex-text-subtle text-[11px] font-medium">{label}</dt>
      <dd className="apex-text mt-0.5 text-sm">{value}</dd>
    </div>
  );
}

function DayRow({ day }: { day: SummaryDay }) {
  const look = dayLabel(day);
  return (
    <tr className="border-t border-[var(--border-secondary)]">
      <td className="apex-text whitespace-nowrap py-1.5 pr-3 font-mono text-xs">
        {day.businessDate.slice(8)}/{day.businessDate.slice(5, 7)}
        {day.locked && (
          <Lock size={9} className="apex-text-subtle ml-1 inline align-baseline" aria-label="closed" />
        )}
      </td>
      <td className="py-1.5 pr-3">
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${chipClass(look.tone)}`}>
          {look.label}
        </span>
      </td>
      <td className="apex-text-muted py-1.5 pr-3 font-mono text-xs tabular-nums">
        {formatPunchTime(day.punchInAt)}
      </td>
      <td className="apex-text-muted py-1.5 pr-3 font-mono text-xs tabular-nums">
        {formatPunchTime(day.punchOutAt)}
      </td>
      <td className="apex-text py-1.5 pr-3 text-xs tabular-nums">
        {formatDurationMinutes(day.officePresenceMinutes)}
      </td>
      <td className="apex-text-muted py-1.5 pr-3 text-xs tabular-nums">
        {formatDurationMinutes(day.workedMinutes)}
      </td>
      <td className="apex-text-subtle py-1.5 text-xs tabular-nums">
        {formatDurationMinutes(day.breakMinutes)}
      </td>
    </tr>
  );
}

export function EmployeeAttendanceDashboard({ employeeId }: { employeeId?: string }) {
  const viewerId = useAuthStore((s) => s.user?.id) ?? null;
  const subjectId = employeeId ?? viewerId;
  const isSelf = Boolean(viewerId) && subjectId === viewerId;
  // Null means "whatever month the server considers current" -- the company
  // month is the server's to decide, so the first read does not name one and
  // the selector is built from the date it answers with.
  const [month, setMonth] = useState<string | null>(null);

  const summaryQuery = useQuery({
    queryKey: workdayStatusKeys.employeeSummary(viewerId, subjectId, month ?? 'current'),
    queryFn: () =>
      employeeId && employeeId !== viewerId
        ? getEmployeeAttendanceSummary(employeeId, month ?? undefined)
        : getMyAttendanceSummary(month ?? undefined),
    enabled: Boolean(viewerId),
    staleTime: 60_000,
    retry: false,
  });

  // The same keys and the same fetchers the leave balance card already uses, so
  // the two share one cache entry per type instead of each holding its own copy
  // that a grant refreshes separately.
  const casual = useQuery({
    queryKey: ['my-leave-balance', viewerId ?? 'anonymous', 'CASUAL'],
    queryFn: () => getMyLeaveBalance('CASUAL' as PersonalLeaveType),
    enabled: Boolean(viewerId) && isSelf,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const emergency = useQuery({
    queryKey: ['my-leave-balance', viewerId ?? 'anonymous', 'EMERGENCY'],
    queryFn: () => getMyLeaveBalance('EMERGENCY' as PersonalLeaveType),
    enabled: Boolean(viewerId) && isSelf,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const compOff = useQuery({
    queryKey: compOffKeys.credits(viewerId),
    queryFn: getMyCompOffCredits,
    enabled: Boolean(viewerId) && isSelf,
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (summaryQuery.isLoading) {
    return (
      <div className="apex-card">
        <div className="apex-text-muted text-sm">Loading your attendance summary…</div>
      </div>
    );
  }

  if (summaryQuery.isError || !summaryQuery.data) {
    return (
      <div className="apex-card">
        <p className="apex-text text-sm font-medium">This summary could not be loaded.</p>
        <p className="apex-text-muted mt-1 text-xs">
          Your attendance records are unaffected — only this view failed. Try again shortly, or ask
          HR if it keeps happening.
        </p>
      </div>
    );
  }

  const summary = summaryQuery.data;
  const { employee } = summary;
  const shownMonth = month ?? summary.month;
  const tenure = tenureLabel(employee.tenure);
  const category = categoryLabel(employee.employmentCategory);
  const lockState = monthLockState(summary.days);
  const closedNote = lockNote(lockState);
  const attention = attentionItems(summary);
  const today = todayFrom(summary);
  const todayLook = today ? dayLabel(today) : null;
  const completion = completionDisplay(summary.today);
  const credits = compOffBuckets(compOff.data ?? [], new Date());
  const leaveRows = [
    leaveRow(LEAVE_TYPE_LABEL[PERSONAL_LEAVE_TYPES[0]], casual.data),
    leaveRow(LEAVE_TYPE_LABEL[PERSONAL_LEAVE_TYPES[1]], emergency.data),
  ];
  // Newest first: the days somebody is actually asking about are the recent ones.
  const rows = [...summary.days].reverse();

  return (
    <div className="space-y-3">
      {/* ── Who, and which month ─────────────────────────────────────────── */}
      <section className="apex-card space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="apex-text text-base font-semibold">{employee.name}</h2>
            <p className="apex-text-muted mt-0.5 text-xs">
              {[employee.designation, employee.department?.name, employee.employeeId]
                .filter(Boolean)
                .join(' · ') || 'No designation on record'}
            </p>
          </div>
          <label className="flex items-center gap-2">
            <span className="apex-text-subtle text-[11px] font-medium">Month</span>
            <select
              className="apex-input rounded-md border border-[var(--border-secondary)] bg-transparent px-2 py-1 text-xs"
              value={shownMonth}
              onChange={(e) => setMonth(e.target.value)}
            >
              {monthOptions(summary.today.businessDate).map((option) => (
                <option key={option} value={option}>
                  {formatMonthLabel(option)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          <Field label="Joined" value={formatDateOnly(employee.joiningDate)} />
          <Field
            label="Tenure"
            // Null tenure is never printed as a number. The joining date that
            // would have produced it is missing, and that is a master-data
            // problem the needs-attention panel below states outright.
            value={tenure ?? 'Not known'}
          />
          <Field label="Employment" value={category ?? 'Not set'} />
          <Field
            label={employee.lastWorkingDate ? 'Last working day' : 'Status'}
            value={
              employee.lastWorkingDate
                ? formatDateOnly(employee.lastWorkingDate)
                : employee.isActive
                  ? 'Currently employed'
                  : 'Inactive'
            }
          />
        </dl>

        {closedNote && (
          <p className="apex-text-subtle flex items-center gap-1.5 text-[11px]">
            <Lock size={11} />
            {closedNote}
          </p>
        )}
      </section>

      {/*
        Acting on somebody else's comp off.

        Hosted here rather than on a new screen: this is already the
        manager/HR scoped view of one employee, so it is where somebody is
        standing when they decide to recognise a weekend. The panel renders
        only if the SERVER lets the viewer read that employee's credits, which
        is the same authority the actions need -- no role check in the browser.
      */}
      {!isSelf && subjectId && <ManagerCompOffPanel employeeId={subjectId} />}

      {/* ── What is in hand: leave and comp off, self only ───────────────── */}
      {isSelf && (
        <div className="grid gap-3 sm:grid-cols-2">
          <section className="apex-card">
            <h3 className="apex-text mb-2 text-sm font-semibold">Leave balance</h3>
            <table className="w-full">
              <thead>
                <tr className="apex-text-subtle text-left text-[11px]">
                  <th className="font-medium">Type</th>
                  <th className="font-medium">Accrued</th>
                  <th className="font-medium">Used</th>
                  <th className="font-medium">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {leaveRows.map((row) => (
                  <tr key={row.label} className="border-t border-[var(--border-secondary)]">
                    <td className="apex-text-muted py-1.5 text-xs">{row.label}</td>
                    <td className="apex-text py-1.5 text-xs tabular-nums">{row.accrued ?? '—'}</td>
                    <td className="apex-text py-1.5 text-xs tabular-nums">{row.used ?? '—'}</td>
                    <td className="apex-text py-1.5 text-sm font-semibold tabular-nums">
                      {row.remaining ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="apex-text-subtle mt-2 text-[11px]">
              Your entitlement, as the leave module records it. Company holidays are separate.
            </p>
          </section>

          <section className="apex-card">
            <h3 className="apex-text mb-2 text-sm font-semibold">Comp off</h3>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
              <Field label="Available" value={compOff.isSuccess ? String(credits.available) : '—'} />
              <Field label="Taken" value={compOff.isSuccess ? String(credits.used) : '—'} />
              <Field label="Expired" value={compOff.isSuccess ? String(credits.expired) : '—'} />
              <Field
                label="Expiring soon"
                value={compOff.isSuccess ? String(credits.expiringSoon) : '—'}
              />
            </dl>
            {compOff.isSuccess && credits.expiringSoon > 0 && (
              <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
                Comp off is used soonest-expiry-first, so the ones expiring are the ones to plan
                around.
              </p>
            )}
          </section>
        </div>
      )}

      {/* ── The month ────────────────────────────────────────────────────── */}
      <section className="apex-card space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="apex-text text-sm font-semibold">{formatMonthLabel(shownMonth)}</h3>
          <span className="apex-text-subtle text-[11px]">
            {summary.requiredPresenceMinutes === null
              ? 'Required hours not configured'
              : `${formatDurationMinutes(summary.requiredPresenceMinutes)} required presence`}
          </span>
        </div>

        <dl className="grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-5 lg:grid-cols-7">
          {monthKpis(summary.counts).map((kpi) => (
            <div key={kpi.key}>
              <dt className="apex-text-subtle text-[11px] font-medium">{kpi.label}</dt>
              <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${toneClass(kpi.tone)}`}>
                {kpi.value}
              </dd>
              {kpi.hint && <p className="apex-text-subtle mt-0.5 text-[10px] leading-tight">{kpi.hint}</p>}
            </div>
          ))}
        </dl>

        <div className="grid gap-x-6 gap-y-1.5 border-t border-[var(--border-secondary)] pt-3 sm:grid-cols-2">
          {metricRows(summary.metrics).map((row) => (
            <div key={row.key} className="flex items-baseline justify-between gap-3">
              <span className="apex-text-muted text-xs">{row.label}</span>
              <span className="apex-text text-xs font-semibold tabular-nums">{row.value}</span>
            </div>
          ))}
        </div>
        <p className="apex-text-subtle text-[11px]">{sampleNote(summary.metrics)}</p>
      </section>

      {/* ── Today ────────────────────────────────────────────────────────── */}
      <section className="apex-card space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="apex-text text-sm font-semibold">Today</h3>
          {todayLook && (
            <span className={`rounded-md px-2 py-1 text-xs font-medium ${chipClass(todayLook.tone)}`}>
              {todayLook.label}
            </span>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          <Field label="Punch in" value={formatPunchTime(today?.punchInAt ?? null)} />
          <Field label="Punch out" value={formatPunchTime(today?.punchOutAt ?? null)} />
          <Field
            label="Office presence"
            value={formatDurationMinutes(today?.officePresenceMinutes ?? null)}
          />
          <Field label="Expected completion" value={completion.value} />
        </dl>
        {completion.explanation && (
          <p className="apex-text-muted text-[11px]">{completion.explanation}</p>
        )}
        {today && today.punchInAt && !today.punchOutAt && (
          <p className="apex-text-subtle text-[11px]">
            Your day is still open, so office presence is not measured yet — it is punch out minus
            punch in. Live session totals are in the Today panel below.
          </p>
        )}
        {shownMonth !== summary.today.businessDate.slice(0, 7) && (
          <p className="apex-text-subtle text-[11px]">
            You are viewing {formatMonthLabel(shownMonth)}. Today is not part of it.
          </p>
        )}
      </section>

      {/* ── Day by day ───────────────────────────────────────────────────── */}
      <section className="apex-card">
        <h3 className="apex-text mb-2 text-sm font-semibold">Day by day</h3>
        <div className="max-h-80 overflow-y-auto overflow-x-auto">
          <table className="w-full min-w-[34rem]">
            <thead>
              <tr className="apex-text-subtle text-left text-[11px]">
                <th className="pb-1 pr-3 font-medium">Date</th>
                <th className="pb-1 pr-3 font-medium">Status</th>
                <th className="pb-1 pr-3 font-medium">In</th>
                <th className="pb-1 pr-3 font-medium">Out</th>
                <th className="pb-1 pr-3 font-medium">Presence</th>
                <th className="pb-1 pr-3 font-medium">Work</th>
                <th className="pb-1 font-medium">Break</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((day) => (
                <DayRow key={day.businessDate} day={day} />
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <p className="apex-text-muted text-xs">Nothing recorded for this month yet.</p>
        )}
        <p className="apex-text-subtle mt-2 text-[11px]">
          Presence is punch out minus punch in; breaks are not deducted from it. Work is Workday’s
          own measure and is not the same figure.
        </p>
      </section>

      {/* ── What needs attention ─────────────────────────────────────────── */}
      <section className="apex-card">
        <h3 className="apex-text mb-2 text-sm font-semibold">Needs attention</h3>
        {attention.length === 0 ? (
          <p className="apex-text-muted flex items-center gap-1.5 text-xs">
            <CheckCircle2 size={13} className="text-green-600 dark:text-green-400" />
            Nothing on your record needs attention this month.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {attention.map((item) => (
              <li key={item.key} className="flex items-start gap-2">
                <AlertTriangle
                  size={12}
                  className={`mt-0.5 flex-shrink-0 ${
                    item.tone === 'bad'
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                />
                <div>
                  <p className="apex-text text-xs font-medium">{item.label}</p>
                  <p className="apex-text-muted text-[11px]">{item.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
