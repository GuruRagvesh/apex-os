'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Camera, MapPin, Clock3, BarChart3, FileText, ImageIcon, Activity, ShieldCheck, Gift, Plane, ChevronDown, type LucideIcon } from 'lucide-react';
import { V2DrawerShell } from './V2DrawerShell';
import { presentLocation } from '../attendance/location-presentation';
import { getMyRegularizations, stageLabel } from '../attendance/regularization-api';
import s from './visual-fidelity.module.css';
import { PunchPhoto } from '../attendance/PunchPhoto';
import { getMyPunchEvidence, type OwnPunchEvidence } from '../attendance/punch-api';
import {
  actorLabel,
  getMyAttendanceActivity,
  type AttendanceActivityEntry,
} from '../attendance/activity-api';
import { getMyAttendanceDayV2, type MyAttendanceDayV2, type MyAttendanceWorkSessionV2 } from './my-attendance-v2-api';
import {
  UNKNOWN_FIGURE,
  exceptionCopy,
  formatLongDate,
  formatMinutesOrUnknown,
  formatTime,
  isUnavailable,
  modifierLabel,
  modifierTone,
  presentOutcome,
} from './status-presentation';

/**
 * The Attendance Day drawer.
 *
 * ONE day surface. The calendar opens this; nothing else renders a day inline.
 * Two places rendering the same day is how they drift apart, and the one below
 * the fold is the one nobody scrolls to.
 *
 * It reuses the existing AttendanceDrawer shell, PunchPhoto and
 * existing evidence components. Global account widgets live on the main page.
 *
 * PHOTOS ARE ON DEMAND. PunchPhoto fetches a short-lived signed URL when it
 * mounts, so it is mounted only after the viewer asks for it. Nothing is
 * prefetched, and no photo appears anywhere outside this evidence section.
 */
export function DayDetailDrawer({
  date,
  open,
  onClose,
  seed,
  onRequestCorrection,
}: {
  date: string | null;
  open: boolean;
  onClose: () => void;
  /** The month row, shown immediately while the detail request is in flight. */
  seed?: MyAttendanceDayV2;
  onRequestCorrection: (date: string) => void;
}) {
  const requests = useQuery({
    queryKey: ['my-regularizations'],
    queryFn: getMyRegularizations,
    enabled: open,
    retry: false,
  });
  const requestsForDay = requests.data
    ?.filter(request => request.date.slice(0, 10) === date)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pending = requestsForDay?.find(request =>
    request.status === 'PENDING'
    || request.status === 'STALE_REVIEW_REQUIRED'
    || request.status === 'MANAGER_APPROVED'
  );
  const latestRequest = requestsForDay?.[0];
  const detail = useQuery({
    queryKey: ['my-attendance-v2-day', date],
    queryFn: () => getMyAttendanceDayV2(date as string),
    enabled: open && !!date,
    retry: false,
  });

  const evidence = useQuery({
    queryKey: ['my-punch-evidence-v2', date],
    queryFn: () => getMyPunchEvidence(200, date as string),
    enabled: open && !!date,
    staleTime: 60_000,
    retry: false,
  });

  const activity = useQuery({
    queryKey: ['my-attendance-activity-v2', date],
    queryFn: () => getMyAttendanceActivity(date as string),
    enabled: open && !!date,
    retry: false,
  });

  const day = detail.data ?? seed;
  if (!date) return null;

  const dayEvidence = (evidence.data ?? []).filter((e) => e.businessDate.slice(0, 10) === date);

  return (
    <V2DrawerShell
      open={open}
      title={formatLongDate(date)}
      onClose={onClose}
    >
      <div className={s.drawerBody}>
        {/* The detail request failing must not blank the day or zero it out. */}
        {detail.isError ? (
          <Unavailable>
            This day&apos;s details could not be loaded. Nothing has changed about your attendance —
            only this view failed.
          </Unavailable>
        ) : null}

        {day ? (
          <>
            <Badges day={day} />
            <DaySummary day={day} />
            <DrawerDisclosure title="Evidence" icon={ImageIcon} count={evidence.isLoading ? undefined : dayEvidence.length}>
              <Evidence
                items={dayEvidence}
                loading={evidence.isLoading}
                failed={evidence.isError}
              />
            </DrawerDisclosure>
            <DrawerDisclosure
              title="Workday Activity"
              icon={Activity}
              count={detail.data ? (detail.data.workSessions ?? []).length : undefined}
              defaultOpen
            >
              <WorkdayActivity
                sessions={detail.data?.workSessions ?? []}
                entries={activity.data ?? []}
                loading={activity.isLoading}
                failed={activity.isError}
              />
            </DrawerDisclosure>
            <DrawerDisclosure title="Policy & Evaluation" icon={ShieldCheck}>
              <PolicyAndEvaluation day={day} request={latestRequest} />
            </DrawerDisclosure>

            {(latestRequest || day.correctionAllowed) ? (
              <div className={s.drawerActionBar}>
                <div className="min-w-0">
                  {latestRequest ? (
                    <p role="status" className="apex-text text-xs font-semibold">
                      {pending ? 'Correction' : 'Latest request'} {stageLabel(latestRequest.status, latestRequest.applicationStatus).toLowerCase()}
                    </p>
                  ) : (
                    <p className="apex-text text-xs font-semibold">Something looks wrong?</p>
                  )}
                  <p className="apex-text-muted mt-0.5 text-[11px]">
                    {pending
                      ? 'Your submitted correction is already in review.'
                      : 'Attendance changes are submitted for review; the recorded day is not edited directly.'}
                  </p>
                </div>
                {day.correctionAllowed && !pending ? (
                  <button type="button" className={s.outline} onClick={() => onRequestCorrection(date)}>Request correction</button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : detail.isLoading ? (
          <p className="apex-text-muted text-sm">Loading this day…</p>
        ) : null}

      </div>
    </V2DrawerShell>
  );
}

function Badges({ day }: { day: MyAttendanceDayV2 }) {
  const status = presentOutcome(day.isInProgress ? 'IN_PROGRESS' : day.outcome);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
        style={{ background: day.outcome === 'PRESENT' && !day.isInProgress ? '#00A04A' : status.tint, color: day.outcome === 'PRESENT' && !day.isInProgress ? '#FFFFFF' : status.color }}
      >
        <span aria-hidden="true">{status.glyph}</span>
        {status.label}
      </span>
      {day.evaluationState ? (
        <span className="rounded-full px-2.5 py-1 text-xs" style={{ background: day.evaluationState === 'FINALIZED' ? '#E0FBEA' : '#F0F7FF', color: day.evaluationState === 'FINALIZED' ? '#008B41' : '#2666C4' }}>
          {day.evaluationState === 'NEEDS_REVIEW'
            ? 'Needs review'
            : day.evaluationState === 'FINALIZED'
              ? 'Finalized'
              : 'Calculated'}
        </span>
      ) : null}
      {day.dataSource === 'HISTORICAL_RECORD' && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">Historical record</span>}
      {day.modifiers.map((m) => {
        const tone = modifierTone(m);
        return (
          <span
            key={m}
            className="rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={
              tone
                ? { background: tone.tint, color: tone.color }
                : { border: '1px solid #E4E7EC', color: '#52525B' }
            }
          >
            {modifierLabel(m)}
          </span>
        );
      })}
    </div>
  );
}

export function DaySummary({ day }: { day: MyAttendanceDayV2 }) {
  const presenceUnavailable = isUnavailable(day, 'presenceMinutes');
  const requiredUnavailable = isUnavailable(day, 'requiredMinutes');

  return (
    <section>
      <SectionTitle>Day Summary</SectionTitle>
      <dl className={s.summaryGrid}>
        <Row label="Punch in" value={isUnavailable(day, 'punchInAt') ? UNKNOWN_FIGURE : formatTime(day.punchInAt)} />
        <Row label="Punch out" value={isUnavailable(day, 'punchOutAt') ? UNKNOWN_FIGURE : formatTime(day.punchOutAt)} />
        <Row
          label="Attendance presence"
          value={presenceUnavailable ? 'Not available' : formatMinutesOrUnknown(day.presenceMinutes)}
        />
        <Row
          label="Required presence"
          value={requiredUnavailable ? 'Not available' : formatMinutesOrUnknown(day.requiredMinutes)}
        />
        <Row label="Worked" value={isUnavailable(day, 'workedMinutes') ? UNKNOWN_FIGURE : formatMinutesOrUnknown(day.workedMinutes)} />
        <Row label="Break" value={isUnavailable(day, 'breakMinutes') ? 'Not recorded' : formatMinutesOrUnknown(day.breakMinutes)} />
        <Row label="Late" value={isUnavailable(day, 'lateMinutes') ? 'Not assessed' : day.lateMinutes === null ? UNKNOWN_FIGURE : day.lateMinutes > 0 ? formatMinutesOrUnknown(day.lateMinutes) : 'No'} />
      </dl>

      {presenceUnavailable || requiredUnavailable ? (
        <p className="apex-text-muted mt-3 text-xs">
          Some presence information is unavailable or does not apply to this day.
        </p>
      ) : null}
      {day.exceptions.length > 0 ? (
        <ul className="mt-3 space-y-2" aria-label="Attendance issues">
          {day.exceptions.map((code) => {
            const copy = exceptionCopy(code);
            return (
              <li
                key={code}
                className="rounded-lg border p-3 text-xs"
                style={{ background: copy.actionable ? '#FFFBEB' : '#F8FAFC', borderColor: copy.actionable ? '#F59E0B' : '#CBD5E1' }}
              >
                <p className="apex-text font-semibold">{copy.title}</p>
                <p className="apex-text-muted mt-0.5">{copy.detail}</p>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Punch evidence.
 *
 * Location facts are shown as the server recorded them. The photo is never
 * loaded until the viewer asks: a signed URL is a grant, and granting ten of
 * them because somebody opened a drawer is not the same as granting one because
 * somebody wanted to look.
 */
function Evidence({
  items,
  loading,
  failed,
}: {
  items: OwnPunchEvidence[];
  loading: boolean;
  failed: boolean;
}) {
  return (
    <div>
      {failed ? (
        <Unavailable>Your punch evidence could not be loaded.</Unavailable>
      ) : loading ? (
        <p className="apex-text-muted text-sm">Loading evidence…</p>
      ) : items.length === 0 ? (
        <p className="apex-text-muted text-sm">No punch evidence was recorded for this day.</p>
      ) : (
        <ul className={s.evidenceGrid}>
          {items.map((item) => (
            <EvidenceRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

function EvidenceRow({ item }: { item: OwnPunchEvidence }) {
  const [showPhoto, setShowPhoto] = useState(false);

  return (
    <li className={s.evidenceCard}>
      <div className="flex items-center justify-between gap-2">
        <span className="apex-text text-sm font-semibold">
          {item.type === 'PUNCH_IN' ? 'Punch In' : 'Punch Out'}
        </span>
        <span className="apex-text-muted text-sm tabular-nums">
          {formatTime(item.serverOccurredAt)}
        </span>
      </div>

      <div className="apex-text-muted mt-2 space-y-1 text-xs">
        <p className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {presentLocation(item).headline}
        </p>
        {item.accuracyMeters !== null ? (
          <p>GPS accuracy ±{Math.round(item.accuracyMeters)} m</p>
        ) : (
          <p className="text-amber-500">GPS accuracy unavailable — sent for HR review</p>
        )}
        {item.altitudeMeters !== null && item.altitudeMeters !== undefined ? (
          <p>Altitude {Math.round(item.altitudeMeters)} m</p>
        ) : (
          <p>Altitude unavailable</p>
        )}
        {item.policyContextStatus === 'POLICY_SETUP_PENDING' ? (
          <p className="text-amber-500">Attendance policy setup pending — raw punch recorded for review</p>
        ) : null}
        <p>
          Device: {item.deviceLabel || 'Not recorded'}
          {item.captureChannel === 'PHONE_HANDOFF' ? ' · Phone handoff' : item.captureChannel === 'CURRENT_DEVICE' ? ' · This device' : ''}
        </p>
        {item.deviceType === 'UNKNOWN' ? (
          <p className="text-amber-500">Device ID unavailable — kept for HR review; punch remains recorded</p>
        ) : null}
        {item.distanceFromLocationMeters !== null ? (
          <p>{Math.round(item.distanceFromLocationMeters)} m from the registered location</p>
        ) : null}
      </div>

      <div className="mt-2">
        {item.photoAssetId === null ? (
          <p className="apex-text-muted text-xs">Photo unavailable</p>
        ) : showPhoto ? (
          <PunchPhoto
            evidenceId={item.id}
            captured
            label={item.type === 'PUNCH_IN' ? 'Punch In photo' : 'Punch Out photo'}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowPhoto(true)}
            className={s.photoButton}
          >
            <Camera className="h-3.5 w-3.5" aria-hidden="true" />
            View photo
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * Workday Activity.
 *
 * Session rows come from the self-scoped day-detail response. Times, durations,
 * ticket work, notes and breaks are all stored facts; missing values are named
 * instead of reconstructed from punch evidence.
 */
function WorkdayActivity({
  sessions,
  entries,
  loading,
  failed,
}: {
  sessions: MyAttendanceWorkSessionV2[];
  entries: AttendanceActivityEntry[];
  loading: boolean;
  failed: boolean;
}) {
  return (
    <div className={s.workdayActivity}>
      {sessions.length === 0 ? (
        <p className="apex-text-muted text-sm">No work sessions were recorded for this day.</p>
      ) : (
        <ol className={s.sessionList} aria-label="Recorded work sessions">
          {sessions.map((session, index) => (
            <SessionCard key={session.id} session={session} index={index} />
          ))}
        </ol>
      )}

      <div className={s.activityChanges}>
        <p className="apex-text text-xs font-semibold">Attendance changes</p>
        {failed ? (
          <p className="apex-text-muted text-xs">Correction and revision activity could not be loaded.</p>
        ) : loading ? (
          <p className="apex-text-muted text-xs">Loading changes…</p>
        ) : entries.length === 0 ? (
          <p className="apex-text-muted text-xs">No corrections or revisions recorded.</p>
        ) : (
          <ol className={s.timeline}>
            {entries.map((entry) => (
              <li key={entry.id}>
                <p className="apex-text text-sm font-semibold">{entry.label}</p>
                <p className="apex-text-muted text-xs">{formatTime(entry.at)} · {actorLabel(entry)}</p>
                {entry.reason ? <p className="apex-text-muted mt-0.5 text-xs italic">{entry.reason}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function SessionCard({ session, index }: { session: MyAttendanceWorkSessionV2; index: number }) {
  const sessionEnd = session.endedAt
    ? formatTime(session.endedAt)
    : session.autoClosedAt
      ? `Auto-closed ${formatTime(session.autoClosedAt)}`
      : session.status === 'COMPLETED' || session.status === 'LOGGED_OUT'
        ? 'End not recorded'
        : 'In progress';

  return (
    <li className={s.sessionCard}>
      <div className={s.sessionHeader}>
        <div>
          <p className="apex-text text-sm font-semibold">Session {index + 1}</p>
          <p className={s.sessionTime}>
            <Clock3 aria-hidden="true" />
            <span>{session.startedAt ? formatTime(session.startedAt) : 'Start not recorded'}</span>
            <span aria-hidden="true">→</span>
            <span>{sessionEnd}</span>
            <span aria-hidden="true">·</span>
            <span>{session.workedMinutes === null ? 'Duration not recorded' : `${formatMinutesOrUnknown(session.workedMinutes)} worked`}</span>
          </p>
        </div>
        <span className={session.autoClosed ? s.sessionAutoClosed : s.sessionStatus}>
          {session.autoClosed ? 'Auto-closed' : session.endedAt ? 'Completed' : 'Open'}
        </span>
      </div>

      <div className={s.sessionDetailRows}>
        <div>
          <span className={s.sessionDetailLabel}>Work</span>
        {session.workItems.length > 0 ? (
          <ul className={s.workItemList}>
            {session.workItems.map((item) => (
              <li key={item.id}>
                <span className={s.workItemTitle}>{item.ticketId} · {item.title}</span>
                <span>{formatTime(item.startedAt)} → {item.endedAt ? formatTime(item.endedAt) : 'In progress'}</span>
              </li>
            ))}
          </ul>
        ) : session.notes.length === 0 ? (
          <p className="apex-text-muted text-xs">Purpose not recorded.</p>
        ) : null}
        {session.notes.map((note) => (
          <p key={note.id} className={s.sessionNote}>{note.content}</p>
        ))}
        </div>

      {session.breaks.length > 0 ? (
        <div>
          <span className={s.sessionDetailLabel}>{session.breaks.length === 1 ? 'Break' : 'Breaks'}</span>
          <ul>
            {session.breaks.map((entry) => (
              <li key={entry.id}>
                <span className={s.breakType}>{humanizeCode(entry.type)}</span>
                <span>{formatTime(entry.startedAt)} → {entry.endedAt ? formatTime(entry.endedAt) : 'In progress'}</span>
                <span>{entry.durationMinutes === null ? 'Duration not recorded' : `${formatMinutesOrUnknown(entry.durationMinutes)} break`}</span>
                {entry.purpose || entry.note ? <span className={s.breakReason}>{entry.purpose ?? entry.note}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      </div>

      {session.autoClosed && session.closureReason ? (
        <p className={s.autoCloseReason}>Auto-close reason: {humanizeCode(session.closureReason)}</p>
      ) : null}
    </li>
  );
}

function humanizeCode(value: string) {
  return value.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function PolicyAndEvaluation({ day, request }: { day: MyAttendanceDayV2; request?: Awaited<ReturnType<typeof getMyRegularizations>>[number] }) {
  return (
    <div>
      <dl className={s.policyGrid}>
        <Row label="Final status" value={day.isInProgress ? 'Pending' : day.evaluationState === 'FINALIZED' ? presentOutcome(day.outcome).label : 'Not finalized'} />
        <Row
          label="Review state"
          value={day.evaluationState === null ? UNKNOWN_FIGURE : day.evaluationState === 'NEEDS_REVIEW' ? 'Awaiting review' : 'No review pending'}
        />
        <Row
          label="Regularization"
          value={request ? stageLabel(request.status, request.applicationStatus) : day.modifiers.includes('REGULARIZED') ? 'Applied' : 'None applied'}
        />
      </dl>
      {request && <div className="mt-3 rounded-lg border border-apex-border p-3 text-xs"><p className="font-semibold">Submitted request</p><p className="mt-1">{request.reason}</p><p className="apex-text-muted mt-1">{stageLabel(request.status, request.applicationStatus)} · submitted {new Date(request.createdAt).toLocaleDateString()}</p>{request.decidedBy?.name ? <p className="apex-text-muted mt-1">Decided by {request.decidedBy.name}{request.decidedByRole ? ` (${request.decidedByRole.replaceAll('_', ' ')})` : ''}</p> : null}{request.decisionReason ? <p className="apex-text-muted mt-1">{request.decisionReason}</p> : null}</div>}
    </div>
  );
}

function DrawerDisclosure({
  title,
  icon: Icon,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  icon: LucideIcon;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className={s.drawerDisclosure} open={defaultOpen || undefined}>
      <summary>
        <span className={s.disclosureTitle}>
          <Icon aria-hidden="true" />
          {title}
        </span>
        <span className={s.disclosureMeta}>
          {count !== undefined ? <span>{count}</span> : null}
          <ChevronDown aria-hidden="true" />
        </span>
      </summary>
      <div className={s.disclosureBody}>{children}</div>
    </details>
  );
}


const SECTION_ICONS = { 'Day Summary': BarChart3, 'Evidence': ImageIcon, 'Workday Activity': Activity, 'Policy & Evaluation': ShieldCheck, 'Upcoming Holidays': Gift, 'Leave Balance': Plane };
function SectionTitle({ children }: { children: React.ReactNode }) {
  const Icon = SECTION_ICONS[String(children) as keyof typeof SECTION_ICONS] ?? FileText;
  return <h3 className={s.sectionTitle}><Icon aria-hidden="true" />{children}</h3>;
}
function Row({ label, value }: { label: string; value: string }) {
  return <div className={s.fact}><Clock3 aria-hidden="true" /><div><dt>{label}</dt><dd>{value === UNKNOWN_FIGURE ? <span aria-label="not available">{value}</span> : value}</dd></div></div>;
}

function Unavailable({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-lg border p-3 text-sm"
      style={{ background: '#FEF4F1', borderColor: '#F2C7BB', color: '#7F1D1D' }}
    >
      {children}
    </p>
  );
}
