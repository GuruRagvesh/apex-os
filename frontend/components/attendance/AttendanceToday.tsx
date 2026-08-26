'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Camera, Clock, MapPin } from 'lucide-react';
import { workdayApi } from '@/lib/api';
import { compOffApi } from '@apex/workforce-leave/api';
import { getMyAttendanceToday } from './attendance-api';
import {
  exceptionText,
  formatMinutes,
  formatTime,
  presentStatus,
  reasonText,
} from './attendance-status';

/**
 * Today, at the top of My Attendance.
 *
 * The calendar below answers "what happened on a past day". This answers the
 * question an employee actually opens the page with — am I present right now,
 * when did I punch, how much break have I used, and is anything wrong — without
 * making them click into a date to find out.
 *
 * It reads only. Start Work, Break, Resume and End Day belong to WorkdayBar,
 * which is the single surface allowed to run the Workday lifecycle; duplicating
 * those controls here would be a second action path for one lifecycle.
 *
 * Every judgement shown is the server's. Status, reason and exception flags all
 * come from the evaluator, so this cannot drift from what HR sees.
 */

/** Company policy figure, shown so a break total has something to mean. */
const PERMITTED_BREAK_MINUTES = 60;
/** Required attendance SPAN, not effective work. */
const REQUIRED_PRESENCE_MINUTES = 540;

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

export function AttendanceToday() {
  const { data: day, isLoading } = useQuery({
    queryKey: ['my-attendance-today'],
    queryFn: getMyAttendanceToday,
    staleTime: 60_000,
    retry: false,
  });

  // The live session, for the part of "today" that is still moving.
  const { data: workday } = useQuery({
    queryKey: ['workday-today'],
    queryFn: () => workdayApi.getToday() as Promise<any>,
    refetchInterval: 60_000,
    retry: false,
  });

  // Comp off is funded by earned credits and nothing else, so the balance is
  // worth seeing next to attendance rather than only inside the leave form.
  const { data: credits } = useQuery({
    queryKey: ['comp-off-mine'],
    queryFn: () => compOffApi.mine() as Promise<any[]>,
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="apex-card">
        <div className="apex-text-muted text-sm">Loading today…</div>
      </div>
    );
  }

  const look = presentStatus(day?.status ?? null);
  const sessionStatus: string = workday?.session?.status ?? 'OFFLINE';
  const breakMinutes = day?.breakMinutes ?? workday?.totalBreakMinutes ?? 0;
  const workedMinutes = day?.workedMinutes ?? workday?.elapsedWorkMinutes ?? 0;
  const overBreak = breakMinutes > PERMITTED_BREAK_MINUTES;

  const punchIn = day?.punchInAt ?? workday?.firstStartTime ?? null;
  const punchOut = day?.punchOutAt ?? null;

  // Presence span is punch-out minus punch-in — a different measure from
  // worked minutes, which excludes counted breaks.
  const presenceMinutes =
    punchIn && punchOut
      ? Math.max(0, Math.round((new Date(punchOut).getTime() - new Date(punchIn).getTime()) / 60000))
      : null;

  const needsReview = day?.requiresReview || day?.evaluationState === 'NEEDS_REVIEW';
  const availableCredits = Array.isArray(credits) ? credits.length : null;

  const liveLabel: Record<string, string> = {
    WORKING: 'Working',
    ON_BREAK: 'On break',
    LOGGED_IN: 'Logged in',
    LOGGED_OUT: 'Day ended',
    AUTO_CLOSED: 'Auto-closed',
    ON_LEAVE: 'On leave',
    OFFLINE: 'Not started',
  };

  return (
    <div className="apex-card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="apex-text text-sm font-semibold">Today</h2>
          <p className="apex-text-muted mt-0.5 text-xs">
            {day?.businessDate
              ? new Date(`${day.businessDate}T00:00:00Z`).toLocaleDateString([], {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  timeZone: 'UTC',
                })
              : '—'}
            {day && !day.official && ' · provisional'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="apex-text-subtle inline-flex items-center gap-1 text-xs">
            <Clock size={12} />
            {liveLabel[sessionStatus] ?? sessionStatus}
          </span>
          <span className={`rounded-md px-2 py-1 text-xs font-medium ${look.chip}`}>
            {look.label}
          </span>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Stat label="First punch in" value={formatTime(punchIn)} />
        <Stat label="Last punch out" value={formatTime(punchOut)} />
        <Stat
          label="Presence span"
          value={presenceMinutes === null ? '—' : formatMinutes(presenceMinutes)}
          hint={`${formatMinutes(REQUIRED_PRESENCE_MINUTES)} required`}
        />
        <Stat label="Worked" value={formatMinutes(workedMinutes)} />
        <Stat
          label="Break used"
          value={formatMinutes(breakMinutes)}
          hint={`${formatMinutes(PERMITTED_BREAK_MINUTES)} permitted`}
          tone={overBreak ? 'warn' : 'normal'}
        />
        <Stat
          label="Photo evidence"
          value={punchIn ? (day?.photoCaptured ? 'Captured' : 'Missing') : '—'}
          tone={punchIn && !day?.photoCaptured ? 'warn' : 'normal'}
        />
        <Stat
          label="Location evidence"
          value={punchIn ? (day?.locationException ? 'Needs review' : 'Verified') : '—'}
          tone={day?.locationException ? 'warn' : 'normal'}
        />
        <Stat
          label="Comp off credits"
          value={availableCredits === null ? '—' : String(availableCredits)}
          hint={availableCredits ? 'soonest expiry used first' : undefined}
        />
      </dl>

      {day && (day.isLeave || day.leaveDeducted > 0 || day.lwpDeducted > 0) && (
        <p className="apex-text-muted text-xs">
          {day.lwpDeducted > 0
            ? `${day.lwpDeducted} day unpaid leave applied.`
            : `${day.leaveDeducted} day leave applied.`}
        </p>
      )}

      {needsReview && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-900/20">
          <AlertTriangle
            size={13}
            className="mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-400"
          />
          <div className="text-xs text-amber-800 dark:text-amber-300">
            <p className="font-semibold">This day needs review.</p>
            {/* The evaluator's own reason and flags — never re-derived here. */}
            {day?.reason && <p className="mt-0.5">{reasonText(day.reason)}</p>}
            {day?.exceptions?.length > 0 && (
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {day.exceptions.map((flag) => (
                  <li key={flag}>{exceptionText(flag)}</li>
                ))}
              </ul>
            )}
            <p className="mt-1">
              Pick this date in the calendar below to request a correction.
            </p>
          </div>
        </div>
      )}

      {!punchIn && sessionStatus === 'OFFLINE' && (
        <p className="apex-text-subtle flex items-center gap-1.5 text-xs">
          <Camera size={12} />
          <MapPin size={12} />
          Start your workday from the dashboard — it captures your photo and location.
        </p>
      )}
    </div>
  );
}
