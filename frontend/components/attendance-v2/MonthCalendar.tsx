'use client';

import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Gift,
  MinusCircle,
  Plane,
  XCircle,
} from 'lucide-react';
import type { MyAttendanceDayV2 } from './my-attendance-v2-api';
import { exceptionCopy, presentDay } from './status-presentation';
import s from './my-attendance.module.css';

const LEGEND: ReadonlyArray<{ label: string; color: string; warning?: boolean; secondary?: boolean }> = [
  { label: 'Present', color: '#16A34A' },
  { label: 'Late / Short', color: '#EA580C' },
  { label: 'Half day', color: '#9333EA' },
  { label: 'Approved leave', color: '#0284C7' },
  { label: 'Unpaid leave', color: '#0369A1' },
  { label: 'Absent', color: '#DC2626' },
  { label: 'Holiday', color: '#D97706' },
  { label: 'Weekly off', color: '#64748B' },
  { label: 'Needs review', color: '#475569', warning: true },
  { label: 'Regularized', color: '#22C55E', secondary: true },
];

export function MonthCalendar({
  year,
  month,
  days,
  selectedDate,
  filter,
  onFilterChange,
  onSelect,
}: {
  year: number;
  month: number;
  days: MyAttendanceDayV2[];
  selectedDate: string | null;
  filter: string | null;
  onFilterChange: (filter: string | null) => void;
  onSelect: (date: string) => void;
}) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const size = Math.ceil((first.getUTCDay() + count) / 7) * 7;
  const byDate = new Map(days.map(day => [day.date, day]));
  const cells = Array.from(
    { length: size },
    (_, index) => new Date(Date.UTC(year, month - 1, 1 - first.getUTCDay() + index)),
  );

  return (
    <div className={s.monthCalendar}>
      <div className={s.legendPanel}>
        <div className={s.legendHeading}>
          <span>Filter calendar</span>
          {filter && <button type="button" className={s.clearFilter} onClick={() => onFilterChange(null)}>Clear filter</button>}
        </div>
        <div className={s.legend} aria-label="Attendance status legend">
          {LEGEND.map(item => (
            <button
              key={item.label}
              type="button"
              aria-pressed={filter === item.label}
              data-secondary={item.secondary || undefined}
              onClick={() => onFilterChange(filter === item.label ? null : item.label)}
            >
              <i style={{ background: item.color }} aria-hidden="true">
                {item.warning ? '!' : item.secondary ? '✓' : ''}
              </i>
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className={s.calendarScroll}>
        <div className={s.weekdays}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(label => <span key={label}>{label}</span>)}
        </div>
        <div className={s.calendarGrid}>
          {cells.map(date => {
            const key = date.toISOString().slice(0, 10);
            const day = byDate.get(key);
            if (date.getUTCMonth() !== month - 1 || !day || day.isFuture) {
              return (
                <div
                  key={key}
                  className={`${s.day} ${s.neutralDay} ${filter ? s.dimmedDay : ''}`}
                  aria-label={`${key}, ${day?.isFuture ? 'future date' : 'outside current month'}`}
                >
                  <span className={s.dayNumber}>{date.getUTCDate()}</span>
                </div>
              );
            }
            return (
              <DayCell
                key={key}
                day={day}
                selected={selectedDate === key}
                dimmed={filter !== null && !matchesFilter(day, filter)}
                onSelect={onSelect}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DayCell({
  day,
  selected,
  dimmed,
  onSelect,
}: {
  day: MyAttendanceDayV2;
  selected: boolean;
  dimmed: boolean;
  onSelect: (date: string) => void;
}) {
  const status = presentDay(day);
  const Icon = day.outcome === 'HOLIDAY' ? Gift
    : day.outcome === 'PRESENT' && status.label !== 'Present' ? Clock3
    : day.outcome === 'PRESENT' ? CheckCircle2
    : day.outcome === 'WEEKLY_OFF' || day.outcome === 'EXEMPT' ? MinusCircle
    : day.outcome === 'ABSENT' ? XCircle
    : day.outcome === 'UNRESOLVED' ? AlertTriangle
    : day.outcome === 'LEAVE' || day.outcome === 'LWP' ? Plane
    : CircleDashed;
  const review = day.evaluationState === 'NEEDS_REVIEW' || day.outcome === 'UNRESOLVED';
  const secondary = getSecondaryLabels(day, review);
  const label = day.isInProgress ? 'Working' : status.shortLabel || status.label;

  return (
    <button
      type="button"
      onClick={() => onSelect(day.date)}
      className={[
        s.day,
        dimmed ? s.dimmedDay : '',
        day.isToday ? s.todayDay : '',
        selected && !day.isToday ? s.selectedDay : '',
      ].join(' ')}
      style={{ background: status.tint, borderColor: day.outcome === 'HOLIDAY' ? '#E4B75E' : undefined }}
      aria-label={`${day.date}, ${label}${secondary.length ? `, ${secondary.join(', ')}` : ''}`}
      aria-current={day.isToday ? 'date' : undefined}
      aria-pressed={selected}
    >
      <span className={s.dayTop}>
        <span className={s.dayNumber}>{Number(day.date.slice(8))}</span>
        {day.isToday && <span className={s.todayTag}>Today</span>}
      </span>
      <span className={s.dayStatus}>
        <Icon aria-hidden="true" style={{ color: status.color }} />
        <span><strong>{label}</strong>{day.isInProgress && <small>In progress</small>}</span>
      </span>
      {secondary.slice(0, 2).map(value => (
        <span
          key={value}
          className={value === 'Regularized' ? s.regularizedBadge : review && value !== 'Worked' ? s.reviewBadge : s.secondaryBadge}
        >
          {value}
        </span>
      ))}
    </button>
  );
}

function getSecondaryLabels(day: MyAttendanceDayV2, review: boolean): string[] {
  const labels: string[] = [];
  if (day.modifiers.includes('REGULARIZED')) labels.push('Regularized');
  if (day.modifiers.includes('LATE_EXEMPTED')) labels.push('Exempted');
  if (day.modifiers.includes('WORKED_ON_HOLIDAY') || day.modifiers.includes('WORKED_ON_WEEKLY_OFF')) labels.push('Worked');
  if (review) labels.push(day.exceptions[0] ? exceptionCopy(day.exceptions[0]).title : 'Needs review');
  return labels;
}

function matchesFilter(day: MyAttendanceDayV2, filter: string): boolean {
  if (filter === 'Needs review') return day.evaluationState === 'NEEDS_REVIEW' || day.outcome === 'UNRESOLVED';
  if (filter === 'Late / Short') {
    return day.modifiers.some(value => ['LATE', 'LATE_EXEMPTED', 'INSUFFICIENT_PRESENCE', 'INSUFFICIENT_EFFECTIVE_WORK'].includes(value));
  }
  if (filter === 'Regularized') return day.modifiers.includes('REGULARIZED');
  const outcomes: Record<string, string[]> = {
    Present: ['PRESENT'],
    'Half day': ['HALF_DAY'],
    'Approved leave': ['LEAVE'],
    'Unpaid leave': ['LWP'],
    Absent: ['ABSENT'],
    Holiday: ['HOLIDAY'],
    'Weekly off': ['WEEKLY_OFF', 'EXEMPT'],
  };
  return !day.isInProgress && outcomes[filter]?.includes(day.outcome ?? '');
}
