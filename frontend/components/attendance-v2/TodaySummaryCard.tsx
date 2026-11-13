'use client';

import { CalendarDays, Clock3, Eye, FilePenLine, Info } from 'lucide-react';
import type { MyAttendanceTodayV2 } from './my-attendance-v2-api';
import {
  formatMinutesOrUnknown,
  formatTime,
  isUnavailable,
  presentOutcome,
  type StatusPresentation,
} from './status-presentation';
import s from './today-card.module.css';

/**
 * Today, in one row: the day, its status, progress against the requirement,
 * the first punch, and the two actions. Sessions, breaks and evidence live in
 * the day panel so the same figure is never shown twice.
 */
export function TodaySummaryCard({
  today,
  onViewDetails,
  onRequestCorrection,
}: {
  today: MyAttendanceTodayV2;
  onViewDetails: () => void;
  onRequestCorrection?: () => void;
}) {
  const status = todayStatus(today);
  const date = new Date(today.date + 'T12:00:00Z');
  const percentage = isUnavailable(today, 'presenceProgressPercent') ? null : today.presenceProgressPercent;
  const clamped = percentage === null ? null : Math.max(0, Math.min(100, percentage));
  const longDate = date.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dayNumber = date.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'UTC' });
  const monthYear = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
  const figure = (field: string, value: number | null) => (isUnavailable(today, field) ? '—' : formatMinutesOrUnknown(value));
  const note = today.isInProgress
    ? { title: 'Workday in progress', detail: 'Your final status will be available after your last punch today.' }
    : today.banner;

  return (
    <section className={s.card} aria-labelledby="today-title">
      <div className={s.day}>
        <h2 id="today-title">Today</h2>
        <p>{longDate}</p>
        <div className={s.dayRow}>
          <div className={s.dateTile} aria-hidden="true">
            <CalendarDays />
            <strong>{dayNumber}</strong>
            <small>{monthYear}</small>
          </div>
          <div className={s.status} style={{ color: status.color, background: status.tint === 'transparent' ? 'var(--bg-tertiary)' : status.tint }}>
            <span aria-hidden="true" className={today.isInProgress ? s.spin : undefined}>{status.glyph || '○'}</span>
            <span>
              <strong>{status.label}</strong>
              <small>{today.isInProgress ? 'In progress' : today.finalStatusAvailable ? 'Final' : 'May still change'}</small>
            </span>
          </div>
        </div>
      </div>

      <div className={s.progress}>
        <div className={s.progressHead}>
          <span>Presence progress</span>
          <strong>{clamped === null ? 'Unavailable' : `${clamped}%`}</strong>
        </div>
        <div
          className={s.track}
          role={clamped === null ? undefined : 'progressbar'}
          aria-label="Presence against today’s requirement"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={clamped ?? undefined}
        >
          {clamped !== null && <span style={{ width: `${clamped}%` }} />}
        </div>
        <dl className={s.metrics}>
          <div><dt>Worked</dt><dd><Clock3 aria-hidden="true" />{figure('workedMinutes', today.workedMinutes)}</dd></div>
          <div><dt>Required presence</dt><dd><Clock3 aria-hidden="true" />{figure('requiredMinutes', today.requiredMinutes)}</dd></div>
          <div><dt>Presence remaining</dt><dd><Clock3 aria-hidden="true" />{figure('presenceRemainingMinutes', today.presenceRemainingMinutes)}</dd></div>
        </dl>
      </div>

      <div className={s.punch}>
        <span className={s.punchIcon} aria-hidden="true"><Clock3 /></span>
        <div>
          <small>First punch</small>
          <strong>{isUnavailable(today, 'firstPunchAt') ? '—' : formatTime(today.firstPunchAt)}</strong>
          {note && (
            <p role="status"><Info aria-hidden="true" /><span><b>{note.title}.</b> {note.detail}</span></p>
          )}
        </div>
      </div>

      <div className={s.actions}>
        <button type="button" className={s.primary} onClick={onViewDetails}>
          <Eye aria-hidden="true" />View day details
        </button>
        {onRequestCorrection && today.correctionAllowed && (
          <button type="button" className={s.secondary} onClick={onRequestCorrection}>
            <FilePenLine aria-hidden="true" />Request correction
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * Today is never announced as Absent while it can still change (AT-04): a
 * calculated, unsettled absence on the current day reads "No punch yet".
 */
function todayStatus(today: MyAttendanceTodayV2): StatusPresentation {
  if (today.isInProgress) return presentOutcome('IN_PROGRESS');
  if (today.outcome === 'ABSENT' && today.evaluationState !== 'FINALIZED') {
    return { label: 'No punch yet', shortLabel: 'No punch', color: '#64748B', tint: '#F1F5F9', glyph: '○' };
  }
  return presentOutcome(today.outcome);
}
