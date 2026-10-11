'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Camera, MapPin, Clock3, BarChart3, FileText, ImageIcon, Activity, ShieldCheck, Gift, Plane } from 'lucide-react';
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
import { getMyAttendanceDayV2, type MyAttendanceDayV2 } from './my-attendance-v2-api';
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
}: {
  date: string | null;
  open: boolean;
  onClose: () => void;
  /** The month row, shown immediately while the detail request is in flight. */
  seed?: MyAttendanceDayV2;
}) {
  const requests = useQuery({
    queryKey: ['my-regularizations'],
    queryFn: getMyRegularizations,
    enabled: open,
    retry: false,
  });
  const pending = requests.data?.find(request => request.date.slice(0, 10) === date && (request.status === 'PENDING' || request.status === 'MANAGER_APPROVED'));
  const detail = useQuery({
    queryKey: ['my-attendance-v2-day', date],
    queryFn: () => getMyAttendanceDayV2(date as string),
    enabled: open && !!date,
    retry: false,
  });

  const evidence = useQuery({
    queryKey: ['my-punch-evidence-v2'],
    queryFn: () => getMyPunchEvidence(90),
    enabled: open,
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

  const dayEvidence = (evidence.data ?? []).filter((e) => e.businessDate === date);

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
            {pending && <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs">Correction {stageLabel(pending.status).toLowerCase()}</p>}
            <DaySummary day={day} />
            <StatusInsight day={day} />
            <Evidence
              items={dayEvidence}
              loading={evidence.isLoading}
              failed={evidence.isError}
            />
            <WorkdayActivity
              entries={activity.data ?? []}
              loading={activity.isLoading}
              failed={activity.isError}
            />
            <PolicyAndEvaluation day={day} />
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
        <div className={s.pairedFacts}>
          <Row label="Break" value={isUnavailable(day, 'breakMinutes') ? UNKNOWN_FIGURE : formatMinutesOrUnknown(day.breakMinutes)} />
          <Row label="Sessions" value={UNKNOWN_FIGURE} />
        </div>
      </dl>

      {presenceUnavailable || requiredUnavailable ? (
        <p className="apex-text-muted mt-3 text-xs">
          Some presence information is unavailable or does not apply to this day.
        </p>
      ) : null}
    </section>
  );
}

function StatusInsight({ day }: { day: MyAttendanceDayV2 }) {
  if (!day.explanation && day.exceptions.length === 0) return null;

  return (
    <section className={s.insight}>
      <SectionTitle>Status Insight</SectionTitle>
      {day.explanation ? <p className="apex-text text-xs font-semibold">{day.explanation}</p> : null}
      <p className="apex-text-muted mt-1 text-xs">Attendance presence and effective worked time are separate measures. Presence is evaluated against the presence requirement.</p>

      {day.exceptions.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {day.exceptions.map((code) => {
            const copy = exceptionCopy(code);
            return (
              <li
                key={code}
                className="rounded-lg border border-apex-border p-3"
                style={{ background: copy.actionable ? '#FEF3C7' : '#F4F4F5' }}
              >
                <p className="apex-text text-sm font-semibold">{copy.title}</p>
                <p className="apex-text-muted mt-0.5 text-sm">{copy.detail}</p>
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
    <section>
      <SectionTitle>Evidence</SectionTitle>
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
    </section>
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
 * What this section CAN show is the self-scoped attendance activity feed —
 * corrections requested, approved, rejected, and official revisions. What it
 * cannot yet show is the WorkSession timeline the approved design asks for
 * (start, break, resume, end, auto-close marker), because the only endpoints
 * carrying session rows are /workday/today, which covers today alone, and
 * /workday/history/:userId, which takes a user id and so is not self-scoped by
 * construction. Inventing a timeline from punch evidence would be a second
 * interpretation of the day, so the gap is stated instead.
 */
function WorkdayActivity({
  entries,
  loading,
  failed,
}: {
  entries: AttendanceActivityEntry[];
  loading: boolean;
  failed: boolean;
}) {
  return (
    <section>
      <SectionTitle>Workday Activity</SectionTitle>
      {failed ? (
        <Unavailable>This day&apos;s activity could not be loaded.</Unavailable>
      ) : loading ? (
        <p className="apex-text-muted text-sm">Loading activity…</p>
      ) : entries.length === 0 ? (
        <p className="apex-text-muted text-xs">No corrections or revisions recorded.</p>
      ) : (
        <ol className={s.timeline}>
          {entries.map((entry) => (
            <li key={entry.id} className="border-l-2 border-apex-border pl-3">
              <p className="apex-text text-sm font-semibold">{entry.label}</p>
              <p className="apex-text-muted text-xs">
                {formatTime(entry.at)} · {actorLabel(entry)}
              </p>
              {entry.reason ? (
                <p className="apex-text-muted mt-0.5 text-xs italic">{entry.reason}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      <p className="apex-text-muted mt-2 text-xs">
        Work-session start, break and end details are unavailable for this date.
      </p>
    </section>
  );
}

function PolicyAndEvaluation({ day }: { day: MyAttendanceDayV2 }) {
  return (
    <section>
      <SectionTitle>Policy &amp; Evaluation</SectionTitle>
      <dl className={s.policyGrid}>
        <Row label="Final status" value={day.isInProgress ? 'Pending' : day.evaluationState === 'FINALIZED' ? presentOutcome(day.outcome).label : 'Not finalized'} />
        <Row
          label="Review state"
          value={day.evaluationState === null ? UNKNOWN_FIGURE : day.evaluationState === 'NEEDS_REVIEW' ? 'Awaiting review' : 'No review pending'}
        />
        <Row
          label="Regularization"
          value={day.modifiers.includes('REGULARIZED') ? 'Applied' : 'None applied'}
        />
        <Row label="Deficiency" value={UNKNOWN_FIGURE} />
      </dl>
    </section>
  );
}


const SECTION_ICONS = { 'Day Summary': BarChart3, 'Status Insight': FileText, 'Evidence': ImageIcon, 'Workday Activity': Activity, 'Policy & Evaluation': ShieldCheck, 'Upcoming Holidays': Gift, 'Leave Balance': Plane };
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
