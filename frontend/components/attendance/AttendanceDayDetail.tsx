'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { workdayApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { DrawerFact, DrawerSection } from './AttendanceDrawer';
import { LeaveBalanceCard } from './LeaveBalanceCard';
import { PunchPhoto } from './PunchPhoto';
import { RequestCorrectionForm } from './RequestCorrectionForm';
import { assessPresence } from './attendance-presence';
import { exceptionText, formatMinutes, formatTime, presentStatus, reasonText } from './attendance-status';
import { getHolidayCalendar, holidayOn, upcomingHolidays } from './holiday-api';
import { presentLocation } from './location-presentation';
import { getMyPunchEvidence, type OwnPunchEvidence } from './punch-api';
import { stageLabel, type Regularization } from './regularization-api';
import type { AttendanceDay } from './attendance-api';

/**
 * One day of the employee's own attendance, shown inside the context drawer.
 *
 * Answers "what happened to me on this date, and why" — not a control panel.
 * Everything here is the employee's own record; nothing mutates attendance,
 * and the only action offered is REQUESTING a correction, which HR decides.
 *
 * The three durations are presented separately and never substituted for one
 * another, because they answer different questions and only the first is
 * policy:
 *
 *   Attendance presence  punch out − punch in     compared to the requirement
 *   Workday span         first start → last end   operational only
 *   Worked               session totals − breaks  operational only
 *
 * Collapsing them once turned a UI tidy-up into a policy change, so
 * assessPresence() owns the arithmetic and this file only renders it.
 */

function sessionsOn(history: any, businessDate: string): any[] {
  const rows: any[] = Array.isArray(history) ? history : (history?.sessions ?? []);
  return rows.filter((s: any) => String(s?.date ?? '').slice(0, 10) === businessDate);
}

function isoOf(value: any): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function AttendanceDayDetail({
  businessDate,
  day,
  correction,
  requesting,
  onRequest,
  onRequestDone,
}: {
  businessDate: string;
  day: AttendanceDay | undefined;
  correction: Regularization | null;
  requesting: boolean;
  onRequest: () => void;
  onRequestDone: () => void;
}) {
  const userId = useAuthStore((s) => s.user?.id);

  // Own evidence for the whole visible window; React Query dedupes this with
  // the today panel's identical key rather than fetching twice.
  const { data: allEvidence } = useQuery({
    queryKey: ['my-punch-evidence'],
    queryFn: () => getMyPunchEvidence(90),
    staleTime: 60_000,
    retry: false,
  });

  const { data: history } = useQuery({
    queryKey: ['my-workday-history', userId],
    queryFn: () => workdayApi.getHistory(userId as string) as Promise<any>,
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const { data: calendar } = useQuery({
    queryKey: ['holiday-calendar'],
    queryFn: () => getHolidayCalendar(),
    staleTime: 30 * 60_000,
    retry: false,
  });

  const evidence: OwnPunchEvidence[] = useMemo(
    () => (allEvidence ?? []).filter((e) => e.businessDate?.slice(0, 10) === businessDate),
    [allEvidence, businessDate],
  );
  const punchIn = evidence.find((e) => e.type === 'PUNCH_IN') ?? null;
  const punchOut = evidence.find((e) => e.type === 'PUNCH_OUT') ?? null;

  const sessions = useMemo(() => sessionsOn(history, businessDate), [history, businessDate]);

  const presence = useMemo(() => {
    const starts = sessions.map((s) => isoOf(s.startWorkAt)).filter(Boolean) as string[];
    const ends = sessions.map((s) => isoOf(s.endWorkAt)).filter(Boolean) as string[];
    const evidencedSessionIds = new Set(
      evidence.map((e) => e.workSessionId).filter(Boolean) as string[],
    );
    return assessPresence({
      punchInAt: day?.punchInAt ?? null,
      punchOutAt: day?.punchOutAt ?? null,
      workedMinutes: day?.workedMinutes ?? 0,
      firstSessionStart: starts.length ? starts.sort()[0] : null,
      lastSessionEnd: ends.length ? ends.sort()[ends.length - 1] : null,
      sessionCount: sessions.length,
      unevidencedSessions: sessions.filter((s) => !evidencedSessionIds.has(s.id)).length,
    });
  }, [day, sessions, evidence]);

  const holiday = holidayOn(calendar, businessDate);
  const upcoming = upcomingHolidays(calendar, 4);

  const dayKind = day?.isHoliday
    ? holiday
      ? `Company holiday — ${holiday.name}`
      : 'Company holiday'
    : day?.isWeeklyOff
      ? 'Weekly off'
      : 'Working day';

  if (!day) {
    return (
      <>
        <DrawerSection title="Day">
          <p className="apex-text-muted text-sm">No attendance record for this date.</p>
          <p className="apex-text-subtle mt-1 text-xs">{dayKind}</p>
        </DrawerSection>
        <UpcomingHolidays upcoming={upcoming} />
        <DrawerSection title="Leave balance">
          <LeaveBalanceCard compact />
        </DrawerSection>
      </>
    );
  }

  const status = presentStatus(day.status);

  return (
    <>
      {/* ── A. Day summary ───────────────────────────────────────────── */}
      <DrawerSection title="Summary">
        <div className="mb-3 flex items-center gap-2">
          <span className={`rounded-md px-2 py-1 text-xs font-medium ${status.chip}`}>
            {status.label}
          </span>
          <span className="apex-text-subtle text-xs">
            {day.official ? 'Finalized' : 'Provisional'}
          </span>
        </div>
        <p className="apex-text-muted mb-3 text-xs">{reasonText(day.reason)}</p>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <DrawerFact label="Punch in" value={formatTime(day.punchInAt)} />
          <DrawerFact label="Punch out" value={formatTime(day.punchOutAt)} />

          {/* The policy figure. Null until BOTH punches exist — an absent
              answer, never a failing one. */}
          <DrawerFact
            label="Attendance presence"
            value={
              presence.presenceMinutes === null
                ? 'Cannot finalize'
                : formatMinutes(presence.presenceMinutes)
            }
            tone={
              presence.meetsRequirement === null
                ? 'warn'
                : presence.meetsRequirement
                  ? 'good'
                  : 'warn'
            }
          />
          <DrawerFact label="Required" value={formatMinutes(presence.requiredMinutes)} />

          {/* Operational only. Never compared to the requirement. */}
          <DrawerFact label="Worked" value={formatMinutes(presence.workedMinutes)} />
          <DrawerFact
            label="Workday span"
            value={
              presence.sessionSpanMinutes === null
                ? '—'
                : formatMinutes(presence.sessionSpanMinutes)
            }
          />
          <DrawerFact label="Breaks" value={formatMinutes(day.breakMinutes)} />
          <DrawerFact label="Sessions" value={String(presence.sessionCount)} />
          {day.lateMinutes > 0 && (
            <DrawerFact label="Late by" value={formatMinutes(day.lateMinutes)} tone="warn" />
          )}
          {(day.leaveDeducted > 0 || day.lwpDeducted > 0) && (
            <DrawerFact
              label="Leave"
              value={
                day.lwpDeducted > 0 ? `${day.lwpDeducted} unpaid` : `${day.leaveDeducted} day`
              }
            />
          )}
        </dl>
        <p className="apex-text-subtle mt-2 text-[11px]">
          Attendance presence is punch out minus punch in. Worked time and Workday span are
          operational and are not compared to the requirement.
        </p>
      </DrawerSection>

      {/* ── B. Evidence ──────────────────────────────────────────────── */}
      <DrawerSection title="Evidence">
        {evidence.length === 0 ? (
          <p className="apex-text-muted text-sm">No punch evidence recorded for this date.</p>
        ) : (
          <div className="space-y-3">
            {([['Punch in', punchIn], ['Punch out', punchOut]] as const).map(([label, e]) =>
              !e ? (
                <div key={label}>
                  <p className="apex-text-subtle text-xs font-medium">{label}</p>
                  <p className="apex-text-muted text-xs">Not recorded</p>
                </div>
              ) : (
                <div key={label} className="rounded-lg border border-[var(--border-secondary)] p-2.5">
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <span className="apex-text text-xs font-semibold">{label}</span>
                    <span className="apex-text-subtle text-xs tabular-nums">
                      {formatTime(e.serverOccurredAt)}
                    </span>
                  </div>
                  <LocationLine evidence={e} />
                  {/* Keyed to the EVIDENCE record, so a photo uploaded for a
                      punch that was then refused can never be presented as
                      official attendance evidence — it has no evidence row. */}
                  <div className="mt-2">
                    <PunchPhoto
                      evidenceId={e.id}
                      captured={Boolean(e.photoAssetId)}
                      label={`${label} photo`}
                    />
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </DrawerSection>

      {/* ── C. Workday activity ──────────────────────────────────────── */}
      <DrawerSection title="Workday activity">
        {sessions.length === 0 ? (
          <p className="apex-text-muted text-sm">No Workday sessions on this date.</p>
        ) : (
          <ul className="space-y-1.5">
            {sessions.map((s: any) => (
              <li
                key={s.id}
                className="flex items-baseline justify-between gap-3 text-xs"
              >
                <span className="apex-text tabular-nums">
                  {formatTime(isoOf(s.startWorkAt))} — {formatTime(isoOf(s.endWorkAt))}
                </span>
                <span className="apex-text-subtle tabular-nums">
                  {formatMinutes(s.totalWorkMinutes ?? 0)}
                  {s.breakLogs?.length ? ` · ${s.breakLogs.length} break` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}

        {presence.evidenceMismatch && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
            <AlertTriangle size={13} className="mt-px shrink-0" />
            <span>
              Some Workday activity occurred outside the evidence-backed attendance window.
              Workday activity is operational time; attendance presence is evidence-backed punch
              time.
            </span>
          </p>
        )}
      </DrawerSection>

      {/* ── D. Review ────────────────────────────────────────────────── */}
      {(day.requiresReview || day.exceptions.length > 0 || correction) && (
        <DrawerSection title="Review">
          {day.exceptions.length > 0 && (
            <ul className="mb-2 space-y-0.5">
              {day.exceptions.map((f) => (
                <li key={f} className="text-xs text-amber-700 dark:text-amber-400">
                  · {exceptionText(f)}
                </li>
              ))}
            </ul>
          )}

          {correction ? (
            <div className="rounded-lg border border-[var(--border-secondary)] p-2.5">
              <p className="apex-text text-xs font-semibold">
                Correction requested · {stageLabel(correction.status)}
              </p>
              {correction.reason && (
                <p className="apex-text-muted mt-0.5 text-xs">{correction.reason}</p>
              )}
              <p className="apex-text-subtle mt-1 text-[11px]">
                HR is the final authority for attendance corrections.
              </p>
            </div>
          ) : day.requiresReview && !requesting ? (
            <button
              onClick={onRequest}
              className="rounded-lg border border-[var(--border-secondary)] px-3 py-1.5 text-sm font-medium apex-text"
            >
              Request correction
            </button>
          ) : null}

          {requesting && (
            <RequestCorrectionForm
              businessDate={businessDate}
              onDone={onRequestDone}
              onCancel={onRequestDone}
            />
          )}
        </DrawerSection>
      )}

      {/* ── E. Day / holiday information ─────────────────────────────── */}
      <DrawerSection title="Calendar">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <DrawerFact label="This date" value={dayKind} />
          {holiday && <DrawerFact label="Holiday" value={holiday.name} />}
        </dl>
      </DrawerSection>

      <UpcomingHolidays upcoming={upcoming} />

      {/* ── F. Personal leave balance ────────────────────────────────── */}
      <DrawerSection title="Leave balance">
        <LeaveBalanceCard compact />
      </DrawerSection>
    </>
  );
}

function LocationLine({ evidence }: { evidence: OwnPunchEvidence }) {
  const loc = presentLocation(evidence);
  const colour =
    loc.tone === 'good'
      ? 'text-emerald-600 dark:text-emerald-400'
      : loc.tone === 'warn'
        ? 'text-amber-600 dark:text-amber-400'
        : 'apex-text-muted';
  return (
    <div>
      <p className={`text-xs font-medium ${colour}`}>{loc.headline}</p>
      {loc.detail && <p className="apex-text-subtle text-[11px]">{loc.detail}</p>}
    </div>
  );
}

function UpcomingHolidays({ upcoming }: { upcoming: ReturnType<typeof upcomingHolidays> }) {
  if (upcoming.length === 0) return null;
  return (
    <DrawerSection title="Upcoming holidays">
      <ul className="space-y-1">
        {upcoming.map((h) => (
          <li key={h.id} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="apex-text">{h.name}</span>
            <span className="apex-text-subtle tabular-nums">
              {new Date(`${h.date}T00:00:00Z`).toLocaleDateString([], {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                timeZone: 'UTC',
              })}
            </span>
          </li>
        ))}
      </ul>
    </DrawerSection>
  );
}
