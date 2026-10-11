'use client';

import { CalendarDays, Clock3, Eye, ChevronRight, FilePenLine } from 'lucide-react';
import type { MyAttendanceTodayV2 } from './my-attendance-v2-api';
import { formatMinutesOrUnknown, formatTime, presentOutcome, isUnavailable } from './status-presentation';
import s from './visual-fidelity.module.css';

export function TodaySummaryCard({ today, onViewDetails, onRequestCorrection }: {
  today: MyAttendanceTodayV2;
  onViewDetails: () => void;
  onRequestCorrection: () => void;
}) {
  const status = presentOutcome(today.isInProgress ? 'IN_PROGRESS' : today.outcome);
  const date = new Date(today.date + 'T12:00:00Z');
  const percentage = isUnavailable(today, 'presenceProgressPercent') ? null : today.presenceProgressPercent;
  return (
    <section className={s.today} aria-label="Today attendance">
      <div className={s.dateBlock}>
        <h2>Today</h2>
        <div className={s.dateRow}>
          <div className={s.dateTile}><CalendarDays aria-hidden="true" /><strong>{date.getUTCDate()}</strong><span>{date.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase()} {date.getUTCFullYear()}</span></div>
          <div className={s.statusTile} style={{ background: status.tint, color: status.color }}>
            <span className={today.isInProgress ? s.workingRing : s.statusGlyph} aria-hidden="true">{today.isInProgress ? '' : status.glyph}</span>
            <div><strong>{status.label}</strong>{today.isInProgress && <small>In progress</small>}</div>
          </div>
        </div>
      </div>
      <div className={s.presenceBlock}>
        <h3>Presence progress</h3>
        <div className={s.progressRow}>
          <div className={s.track} role={percentage === null ? undefined : 'progressbar'} aria-label="Presence progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage === null ? undefined : Math.max(0, Math.min(100, percentage))}>
            {percentage !== null && <span style={{ width: Math.max(0, Math.min(100, percentage)) + '%' }} />}
          </div><strong>{percentage === null ? '—' : percentage + '%'}</strong>
        </div>
        {percentage === null && <small className={s.muted}>Presence progress unavailable</small>}
        <dl className={s.todayMetrics}>
          <Metric label="Worked" value={isUnavailable(today, 'workedMinutes') ? '—' : formatMinutesOrUnknown(today.workedMinutes)} />
          <Metric label="Required presence" value={isUnavailable(today, 'requiredMinutes') ? '—' : formatMinutesOrUnknown(today.requiredMinutes)} />
          <Metric label="Presence remaining" value={isUnavailable(today, 'presenceRemainingMinutes') ? '—' : formatMinutesOrUnknown(today.presenceRemainingMinutes)} />
        </dl>
      </div>
      <div className={s.contextBlock}>
        <div><span className={s.roundIcon}><Clock3 aria-hidden="true" /></span><div><span>First punch</span><strong>{isUnavailable(today, 'firstPunchAt') ? '—' : formatTime(today.firstPunchAt)}</strong></div></div>
        <div><span className={s.roundIcon}><Clock3 aria-hidden="true" /></span><div><span>Last punch</span><strong>{isUnavailable(today, 'lastPunchAt') ? '—' : formatTime(today.lastPunchAt)}</strong></div></div>
      </div>
      <div className={s.actions}>
        <button className={s.primary} onClick={onViewDetails}><Eye aria-hidden="true" />View Day Details<ChevronRight aria-hidden="true" /></button>
        {today.correctionAllowed && <button className={s.outline} onClick={onRequestCorrection}><FilePenLine aria-hidden="true" />Request Correction</button>}
      </div>
    </section>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd><Clock3 aria-hidden="true" /><span aria-label={value === '—' ? 'Unavailable' : undefined}>{value}</span></dd></div>;
}
