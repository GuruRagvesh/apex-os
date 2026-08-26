'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Camera, MapPin } from 'lucide-react';
import { workdayApi } from '@/lib/api';
import { compOffApi } from '@apex/workforce-leave/api';
import { getMyAttendanceToday } from './attendance-api';
import { getMyPunchEvidence, type OwnPunchEvidence } from './punch-api';
import { formatAccuracy, presentLocation } from './location-presentation';
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
 * The calendar below answers "what happened on a past day". This answers what
 * the employee opens the page with — where am I now, what did I actually do
 * today, and is anything wrong.
 *
 * THE MEASURE PROBLEM
 * -------------------
 * A day can hold several WorkSessions, and punch evidence covers only the
 * sessions that were punched. So "first punch 12:12, last punch 12:15" and
 * "worked 2h 38m" are both true and not contradictory — they measure different
 * things. An earlier version showed a 3-minute punch span against the
 * 540-minute requirement, which read as catastrophic failure on a day the
 * employee had worked most of.
 *
 * Three measures are therefore labelled apart and never merged:
 *
 *   Worked          summed across every session, breaks excluded
 *   Session span    first session start to last session end
 *   Punch span      first punch to last punch — evidence only
 *
 * The 540-minute requirement is shown against the session span, because that is
 * the day, and only when the day is actually finished.
 *
 * Read-only. Start Work, Break, Resume and End Day belong to WorkdayBar.
 * Every judgement shown is the server's.
 */

const PERMITTED_BREAK_MINUTES = 60;
const REQUIRED_PRESENCE_MINUTES = 540;

interface SessionRow {
  id: string;
  startWorkAt: string | null;
  logoutAt: string | null;
  status: string;
  autoClosed?: boolean;
  breakLogs?: Array<{
    id: string;
    breakType: string;
    startAt: string;
    endAt: string | null;
    durationMinutes: number | null;
  }>;
}

function minutesBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
}

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

/** One punch, with its evidence stated in the agreed terminology. */
function EvidenceRow({ evidence }: { evidence: OwnPunchEvidence }) {
  const location = presentLocation(evidence);
  const photoOk = evidence.photoVerification === 'CAPTURED';

  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-l-2 border-[var(--border-secondary)] py-1.5 pl-3">
      <span className="apex-text font-mono text-xs font-semibold">
        {formatTime(evidence.serverOccurredAt)}
      </span>
      <span className="apex-text text-xs font-medium">
        {evidence.type === 'PUNCH_IN' ? 'Punch in' : 'Punch out'}
      </span>
      <span
        className={`text-[11px] ${
          location.tone === 'warn'
            ? 'text-amber-600 dark:text-amber-400'
            : 'apex-text-muted'
        }`}
      >
        {location.headline}
        {location.detail && ` · ${location.detail}`}
      </span>
      <span className="apex-text-subtle text-[11px]">
        Photo {photoOk ? '✓' : '—'}
      </span>
    </li>
  );
}

export function AttendanceToday() {
  const { data: day, isLoading } = useQuery({
    queryKey: ['my-attendance-today'],
    queryFn: getMyAttendanceToday,
    staleTime: 60_000,
    retry: false,
  });

  const { data: workday } = useQuery({
    queryKey: ['workday-today'],
    queryFn: () => workdayApi.getToday() as Promise<any>,
    refetchInterval: 60_000,
    retry: false,
  });

  const { data: evidence } = useQuery({
    queryKey: ['my-punch-evidence'],
    queryFn: () => getMyPunchEvidence(60),
    staleTime: 60_000,
    retry: false,
  });

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
  const sessions: SessionRow[] = Array.isArray(workday?.allSessions) ? workday.allSessions : [];
  const sessionCount: number = workday?.sessionCount ?? sessions.length;
  const sessionStatus: string = workday?.session?.status ?? 'OFFLINE';

  // Aggregate across every session — the authority for "how much did I work".
  const workedMinutes: number = workday?.elapsedWorkMinutes ?? day?.workedMinutes ?? 0;
  const breakMinutes: number = workday?.totalBreakMinutes ?? day?.breakMinutes ?? 0;
  const permittedBreak: number = workday?.allowedBreakMinutes ?? PERMITTED_BREAK_MINUTES;
  const overBreak = breakMinutes > permittedBreak;

  const firstSessionStart: string | null = workday?.firstStartTime ?? null;
  const lastSessionEnd: string | null =
    sessions.length > 0 ? (sessions[sessions.length - 1].logoutAt ?? null) : null;
  const sessionSpan = minutesBetween(firstSessionStart, lastSessionEnd);
  const dayFinished = !!lastSessionEnd && sessionStatus === 'LOGGED_OUT';

  // Today's punches only, oldest first, so the timeline reads forwards.
  const todayEvidence = (evidence ?? [])
    .filter((e) => !day?.businessDate || String(e.businessDate).startsWith(day.businessDate))
    .slice()
    .sort(
      (a, b) =>
        new Date(a.serverOccurredAt).getTime() - new Date(b.serverOccurredAt).getTime(),
    );

  const firstPunch = todayEvidence.find((e) => e.type === 'PUNCH_IN') ?? null;
  const lastPunch = [...todayEvidence].reverse().find((e) => e.type === 'PUNCH_OUT') ?? null;
  const punchSpan = minutesBetween(
    firstPunch?.serverOccurredAt ?? null,
    lastPunch?.serverOccurredAt ?? null,
  );

  // Sessions that predate punching explain why the two spans differ.
  const unpunchedSessions = sessions.filter(
    (s) => !todayEvidence.some((e) => e.workSessionId === s.id),
  ).length;

  const needsReview = day?.requiresReview || day?.evaluationState === 'NEEDS_REVIEW';
  const availableCredits = Array.isArray(credits) ? credits.length : null;
  const punchInLocation = presentLocation(firstPunch);

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
          <span className="apex-text-subtle text-xs">{liveLabel[sessionStatus] ?? sessionStatus}</span>
          <span className={`rounded-md px-2 py-1 text-xs font-medium ${look.chip}`}>
            {look.label}
          </span>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Stat
          label="Worked"
          value={formatMinutes(workedMinutes)}
          hint={sessionCount > 1 ? `across ${sessionCount} sessions` : undefined}
        />
        <Stat
          label="Break used"
          value={formatMinutes(breakMinutes)}
          hint={`${formatMinutes(permittedBreak)} permitted`}
          tone={overBreak ? 'warn' : 'normal'}
        />
        <Stat
          label="Session span"
          value={sessionSpan === null ? 'in progress' : formatMinutes(sessionSpan)}
          // The 540 rule measures the day, so it is only meaningful once the
          // day is over. Showing it mid-morning invites a false failure.
          hint={dayFinished ? `${formatMinutes(REQUIRED_PRESENCE_MINUTES)} required` : 'first start → last end'}
        />
        <Stat
          label="Sessions"
          value={String(sessionCount)}
          hint={firstSessionStart ? `from ${formatTime(firstSessionStart)}` : undefined}
        />
        <Stat label="First punch" value={formatTime(firstPunch?.serverOccurredAt ?? null)} />
        <Stat label="Last punch" value={formatTime(lastPunch?.serverOccurredAt ?? null)} />
        <Stat
          label="Punch span"
          value={punchSpan === null ? '—' : formatMinutes(punchSpan)}
          hint={
            unpunchedSessions > 0
              ? `${unpunchedSessions} session${unpunchedSessions === 1 ? '' : 's'} without a punch`
              : 'evidence only'
          }
        />
        <Stat
          label="Comp off credits"
          value={availableCredits === null ? '—' : String(availableCredits)}
          hint={availableCredits ? 'soonest expiry used first' : undefined}
        />
      </dl>

      {/* Location, in the agreed terminology: accuracy and distance apart. */}
      {firstPunch && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-[var(--border-secondary)] px-3 py-2">
          <span className="apex-text-subtle inline-flex items-center gap-1 text-[11px]">
            <MapPin size={11} />
            {punchInLocation.headline}
          </span>
          {firstPunch.distanceFromLocationMeters !== null && (
            <span className="apex-text-muted text-[11px]">
              Distance {Math.round(firstPunch.distanceFromLocationMeters)} m
            </span>
          )}
          <span className="apex-text-muted text-[11px]">
            GPS accuracy {formatAccuracy(firstPunch.accuracyMeters)}
          </span>
          {firstPunch.geofenceRadiusMeters !== null && (
            <span className="apex-text-subtle text-[11px]">
              Allowed {firstPunch.geofenceRadiusMeters} m
            </span>
          )}
        </div>
      )}

      {/* Session ledger — every session, never collapsed into one. */}
      {sessions.length > 0 && (
        <div>
          <h3 className="apex-text-subtle mb-1.5 text-xs font-semibold uppercase tracking-wide">
            Sessions
          </h3>
          <ul className="space-y-1">
            {sessions.map((s, i) => {
              const duration = minutesBetween(s.startWorkAt, s.logoutAt);
              const breaks = (s.breakLogs ?? []).filter((b) => b.breakType !== 'MEETING');
              const breakTotal = breaks.reduce((sum, b) => sum + (b.durationMinutes ?? 0), 0);
              return (
                <li
                  key={s.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-l-2 border-[var(--border-secondary)] py-1 pl-3"
                >
                  <span className="apex-text-subtle text-[11px] font-medium">#{i + 1}</span>
                  <span className="apex-text font-mono text-xs">
                    {formatTime(s.startWorkAt)} → {s.logoutAt ? formatTime(s.logoutAt) : 'open'}
                  </span>
                  <span className="apex-text-muted text-[11px]">
                    {duration === null ? 'in progress' : formatMinutes(duration)}
                  </span>
                  {breakTotal > 0 && (
                    <span className="apex-text-subtle text-[11px]">
                      {formatMinutes(breakTotal)} break
                    </span>
                  )}
                  {s.autoClosed && (
                    <span className="text-[11px] text-amber-600 dark:text-amber-400">
                      auto-closed
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Punch evidence, in time order. */}
      {todayEvidence.length > 0 && (
        <div>
          <h3 className="apex-text-subtle mb-1.5 text-xs font-semibold uppercase tracking-wide">
            Attendance evidence
          </h3>
          <ul className="space-y-1">
            {todayEvidence.map((e) => (
              <EvidenceRow key={e.id} evidence={e} />
            ))}
          </ul>
        </div>
      )}

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
            {day?.reason && <p className="mt-0.5">{reasonText(day.reason)}</p>}
            {day?.exceptions?.length > 0 && (
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {day.exceptions.map((flag) => (
                  <li key={flag}>{exceptionText(flag)}</li>
                ))}
              </ul>
            )}
            <p className="mt-1">Pick this date in the calendar below to request a correction.</p>
          </div>
        </div>
      )}

      {sessions.length === 0 && sessionStatus === 'OFFLINE' && (
        <p className="apex-text-subtle flex items-center gap-1.5 text-xs">
          <Camera size={12} />
          <MapPin size={12} />
          Start your workday from the dashboard — it captures your photo and location.
        </p>
      )}
    </div>
  );
}
