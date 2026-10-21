'use client';

import { CalendarDays, Clock3, Eye, Info } from 'lucide-react';
import type { MyAttendanceTodayV2 } from './my-attendance-v2-api';
import {
  formatMinutesOrUnknown,
  formatTime,
  isUnavailable,
  presentOutcome,
} from './status-presentation';
import s from './my-attendance.module.css';

export function TodaySummaryCard({
  today,
  sessionCount,
  breakCount,
  onViewDetails,
}: {
  today: MyAttendanceTodayV2;
  sessionCount: number | null;
  breakCount: number | null;
  onViewDetails: () => void;
}) {
  const status = presentOutcome(today.isInProgress ? 'IN_PROGRESS' : today.outcome);
  const date = new Date(today.date + 'T12:00:00Z');
  const percentage = isUnavailable(today, 'presenceProgressPercent')
    ? null
    : today.presenceProgressPercent;
  const fullDate = date.toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <section className={s.todayCard} aria-labelledby="today-workday-title">
      <header className={s.todayHeader}>
        <div>
          <span className={s.sectionKicker}>Today’s workday</span>
          <h2 id="today-workday-title"><CalendarDays aria-hidden="true" />{fullDate}</h2>
        </div>
        <span className={s.statusBadge} style={{ color: status.color, background: status.tint }}>
          <span aria-hidden="true">{status.glyph}</span>{status.label}
        </span>
      </header>

      <div className={s.todayContent}>
        <div className={s.primaryMetric}>
          <span>Presence</span>
          <strong>{isUnavailable(today, 'presenceMinutes') ? '—' : formatMinutesOrUnknown(today.presenceMinutes)}</strong>
          <small>{today.isInProgress ? 'Recorded so far today' : today.finalStatusAvailable ? 'Final recorded presence' : 'Status pending'}</small>
        </div>

        <dl className={s.metricRow}>
          <Metric label="Worked" value={isUnavailable(today, 'workedMinutes') ? '—' : formatMinutesOrUnknown(today.workedMinutes)} />
          <Metric label="Break time" value={isUnavailable(today, 'breakMinutes') ? 'Not recorded' : formatMinutesOrUnknown(today.breakMinutes)} />
          <Metric label="Breaks" value={breakCount === null ? '—' : String(breakCount)} />
          <Metric label="Sessions" value={sessionCount === null ? '—' : String(sessionCount)} />
          <Metric label="Required" value={isUnavailable(today, 'requiredMinutes') ? '—' : formatMinutesOrUnknown(today.requiredMinutes)} />
          <Metric label="Remaining" value={isUnavailable(today, 'presenceRemainingMinutes') ? '—' : formatMinutesOrUnknown(today.presenceRemainingMinutes)} />
        </dl>
      </div>

      <div className={s.progressBlock}>
        <div className={s.progressLabel}>
          <span>Presence progress</span>
          <strong>{percentage === null ? 'Unavailable' : `${percentage}%`}</strong>
        </div>
        <div
          className={s.progressTrack}
          role={percentage === null ? undefined : 'progressbar'}
          aria-label="Presence progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentage === null ? undefined : Math.max(0, Math.min(100, percentage))}
        >
          {percentage !== null && <span style={{ width: `${Math.max(0, Math.min(100, percentage))}%` }} />}
        </div>
      </div>

      <div className={s.todayFooter}>
        <div className={s.punches}>
          <Punch label="First punch" value={isUnavailable(today, 'firstPunchAt') ? '—' : formatTime(today.firstPunchAt)} />
          <Punch label="Last punch" value={isUnavailable(today, 'lastPunchAt') ? 'Pending' : formatTime(today.lastPunchAt)} />
        </div>
        <button type="button" className={s.primaryButton} onClick={onViewDetails}>
          <Eye aria-hidden="true" />View Day Details
        </button>
      </div>

      {today.banner && (
        <div className={today.isInProgress ? s.infoNote : s.attentionNote} role="status">
          <Info aria-hidden="true" />
          <span>{today.isInProgress
            ? 'Your workday is still in progress. Final attendance will be available after your day closes.'
            : `${today.banner.title}. ${today.banner.detail}`}</span>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function Punch({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className={s.punchIcon}><Clock3 aria-hidden="true" /></span>
      <span><small>{label}</small><strong>{value}</strong></span>
    </div>
  );
}
