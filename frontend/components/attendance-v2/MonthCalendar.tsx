'use client';

import { useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ChevronDown, CheckCircle2, MinusCircle, Gift, AlertTriangle, XCircle, Plane, Clock3, CircleDashed } from 'lucide-react';
import type { MyAttendanceDayV2 } from './my-attendance-v2-api';
import { monthLabel, presentDay, presentOutcome, modifierLabel, exceptionCopy } from './status-presentation';
import s from './visual-fidelity.module.css';

const legend = [
  { label: 'Present', color: '#00BF58' }, { label: 'Late / Short hours', color: '#FF7900' },
  { label: 'Absent', color: '#FF3545' }, { label: 'Half day', color: '#933BFF' },
  { label: 'Leave', color: '#60ABFF' }, { label: 'Holiday', color: '#FFBD00' },
  { label: 'Weekly off', color: '#9AA7C1' }, { label: 'Needs review', color: '#454C59' },
];
export function MonthCalendar({ year, month, days, selectedDate, onSelect, onPrevMonth, onNextMonth, onMonthChange, canGoNext }: {
  year: number; month: number; days: MyAttendanceDayV2[]; selectedDate: string | null;
  onSelect: (date: string) => void; onPrevMonth: () => void; onNextMonth: () => void;
  onMonthChange: (month: string) => void; canGoNext: boolean;
}) {
  const [filter, setFilter] = useState<string | null>(null);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const size = Math.ceil((first.getUTCDay() + count) / 7) * 7;
  const byDate = new Map(days.map(day => [day.date, day]));
  const cells = Array.from({ length: size }, (_, index) => new Date(Date.UTC(year, month - 1, 1 - first.getUTCDay() + index)));
  return (
    <section className={s.calendar} aria-label="Attendance calendar">
      <header className={s.calendarHeader}>
        <h2>{monthLabel(year, month)}</h2>
        <div className={s.legend} aria-label="Attendance status legend">{legend.map(item => <button key={item.label} aria-pressed={filter === item.label} onClick={() => setFilter(filter === item.label ? null : item.label)}><i style={{ background: item.color }} aria-hidden="true" />{item.label}</button>)}{filter && <button onClick={() => setFilter(null)}>Clear filter</button>}</div>
        <div className={s.monthControls}>
          <button onClick={onPrevMonth} aria-label="Previous month"><ChevronLeft /></button>
          <label className={s.monthPicker}><CalendarDays aria-hidden="true" /><span>{monthLabel(year, month)}</span><ChevronDown aria-hidden="true" /><input type="month" aria-label="Select attendance month" value={year + '-' + String(month).padStart(2, '0')} max={new Date().toISOString().slice(0, 7)} onChange={e => { if (e.target.value) onMonthChange(e.target.value); }} /></label>
          <button onClick={onNextMonth} disabled={!canGoNext} aria-label="Next month"><ChevronRight /></button>
        </div>
      </header>
      <div className={s.calendarScroll}>
        <div className={s.weekdays}>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(label => <span key={label}>{label}</span>)}</div>
        <div className={s.calendarGrid}>
          {cells.map(date => {
            const key = date.toISOString().slice(0, 10);
            const day = byDate.get(key);
            if (date.getUTCMonth() !== month - 1 || !day || day.isFuture) {
              return <div key={key} className={s.day + ' ' + s.neutralDay + (filter ? ' ' + s.dimmedDay : '')} aria-label={key + ', no attendance result'}><span>{date.getUTCDate()}</span></div>;
            }
            return <DayCell key={key} dimmed={filter !== null && !matchesFilter(day, filter)} day={day} selected={selectedDate === key} onSelect={onSelect} />;
          })}
        </div>
      </div>
    </section>
  );
}
function DayCell({ day, selected, onSelect, dimmed }: { dimmed: boolean; day: MyAttendanceDayV2; selected: boolean; onSelect: (date: string) => void }) {
  const status = presentDay(day);
  const base = presentOutcome(day.outcome);
  const Icon = day.outcome === 'HOLIDAY' ? Gift : day.outcome === 'PRESENT' && status.label !== 'Present' ? Clock3
    : day.outcome === 'PRESENT' ? CheckCircle2 : day.outcome === 'WEEKLY_OFF' ? MinusCircle
    : day.outcome === 'ABSENT' ? XCircle : day.outcome === 'UNRESOLVED' ? AlertTriangle
    : day.outcome === 'LEAVE' || day.outcome === 'LWP' ? Plane : CircleDashed;
  const filled = status.label === 'Present' || day.outcome === 'WEEKLY_OFF' || day.outcome === 'ABSENT';
  const review = day.evaluationState === 'NEEDS_REVIEW' && day.outcome !== 'UNRESOLVED';
  return (
    <button onClick={() => onSelect(day.date)} className={[s.day, dimmed ? s.dimmedDay : '', day.isToday ? s.todayDay : '', selected && !day.isToday ? s.selectedDay : ''].join(' ')} style={{ background: day.outcome ? status.tint : undefined }} aria-label={day.date + ', ' + status.label} aria-current={day.isToday ? 'date' : undefined} aria-pressed={selected}>
      <span className={s.dayNumber}>{Number(day.date.slice(8))}</span>
      {day.isToday && <span className={s.todayTag}>Today</span>}
      {(day.outcome || day.isInProgress) && <div className={s.dayStatus}>
        <span className={day.isInProgress ? s.workingRing : s.statusGlyph} style={{ color: status.color }} aria-hidden="true">{!day.isInProgress && <Icon size={23} fill={filled ? status.color : 'none'} stroke={filled ? '#FFFFFF' : 'currentColor'} />}</span>
        <div><strong style={{ color: day.isInProgress ? '#006BFF' : undefined }}>{day.isInProgress ? 'Working now' : status.label}</strong>{day.isInProgress && <small>In progress</small>}</div>
      </div>}
      {day.exceptions.map(code => <small className={s.cellModifier} key={code}>{exceptionCopy(code).title}</small>)}
      {review && <small className={s.review}>⚠ Needs review</small>}
      {day.modifiers.filter(m => m !== 'LATE' && m !== 'LATE_EXEMPTED' && m !== 'INSUFFICIENT_PRESENCE' && m !== 'INSUFFICIENT_EFFECTIVE_WORK').map(m => <small key={m} className={m === 'REGULARIZED' ? s.regularized : s.cellModifier}>{modifierLabel(m)}</small>)}
      {status.label !== base.label && <span className={s.srOnly}>Final outcome: {base.label}</span>}
    </button>
  );
}

/** Filter only canonical outcomes/modifiers; never evaluate punch times. */
function matchesFilter(day: MyAttendanceDayV2, filter: string) {
  if (filter === 'Needs review') return day.evaluationState === 'NEEDS_REVIEW' || day.outcome === 'UNRESOLVED';
  if (filter === 'Late / Short hours') return day.modifiers.some(value => ['LATE', 'LATE_EXEMPTED', 'INSUFFICIENT_PRESENCE', 'INSUFFICIENT_EFFECTIVE_WORK'].includes(value));
  const outcomes: Record<string, string[]> = { Present: ['PRESENT'], Absent: ['ABSENT'], 'Half day': ['HALF_DAY'], Leave: ['LEAVE', 'LWP'], Holiday: ['HOLIDAY'], 'Weekly off': ['WEEKLY_OFF'] };
  return !day.isInProgress && outcomes[filter]?.includes(day.outcome ?? '');
}
