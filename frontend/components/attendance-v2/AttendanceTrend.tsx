'use client';

import { useState } from 'react';
import { Clock3, TrendingUp } from 'lucide-react';
import type { MyAttendanceDayV2 } from './my-attendance-v2-api';
import { formatMinutesOrUnknown, formatTime, presentDay } from './status-presentation';
import { recordedTrendValue, type TrendMeasure } from './insights-presentation';
import s from './insights.module.css';

export function AttendanceTrend({ days, partial, onSelect }: {
  days: MyAttendanceDayV2[];
  partial: boolean;
  onSelect: (date: string) => void;
}) {
  const [measure, setMeasure] = useState<TrendMeasure>('punch');
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [showRecords, setShowRecords] = useState(false);
  const ordered = days.filter(day => !day.isFuture).sort((a, b) => a.date.localeCompare(b.date));
  const points = ordered.map((day, index) => ({ day, index, value: recordedTrendValue(day, measure) }));
  const measured = points.filter(point => point.value !== null);
  const values = measured.map(point => point.value as number);
  const low = values.length ? Math.max(0, Math.floor(Math.min(...values) / 60) * 60 - 30) : 0;
  const high = values.length ? Math.max(low + 120, Math.ceil(Math.max(...values) / 60) * 60 + 30) : 120;
  const x = (index: number) => 53 + index / Math.max(1, points.length - 1) * 615;
  const y = (value: number) => 144 - (value - low) / (high - low) * 118;
  const active = measured.find(point => point.day.date === activeDate);
  const axisLabel = (value: number) => measure === 'worked'
    ? (value / 60).toFixed(value % 60 === 0 ? 0 : 1) + 'h'
    : String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(Math.round(value % 60)).padStart(2, '0');
  const dateLabel = (date: string) => new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const valueLabel = (day: MyAttendanceDayV2) => measure === 'punch' ? formatTime(day.punchInAt) : formatMinutesOrUnknown(day.workedMinutes);
  const lines = points.flatMap((point, index) => {
    const previous = points[index - 1];
    // Missing dates/values break the line. No interpolation across absent evidence.
    if (!previous || point.value === null || previous.value === null) return [];
    const nextDate = new Date(previous.day.date + 'T12:00:00Z');
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    if (nextDate.toISOString().slice(0, 10) !== point.day.date) return [];
    return [<line key={point.day.date} x1={x(previous.index)} y1={y(previous.value)} x2={x(point.index)} y2={y(point.value)} stroke="#9CC7FA" strokeWidth="2" />];
  });

  return (
    <section className={s.trend} aria-label="Personal attendance trend">
      <div className={s.panelHeading}>
        <div><h3><TrendingUp size={17} />Your time, over time</h3><p>Recorded values. No estimated punches.</p></div>
        <div className={s.smallTabs} aria-label="Trend measure">
          <button aria-pressed={measure === 'punch'} onClick={() => { setMeasure('punch'); setActiveDate(null); }}>Punch-in</button>
          <button aria-pressed={measure === 'worked'} onClick={() => { setMeasure('worked'); setActiveDate(null); }}>Worked time</button>
        </div>
      </div>
      {measured.length ? (
        <>
          <div className={s.chartCaption} aria-live="polite">
            {active ? <><strong>{dateLabel(active.day.date)} · {valueLabel(active.day)}</strong><span>{presentDay(active.day).label}{active.day.evaluationState === 'FINALIZED' ? ' · Finalized' : ' · Provisional'}</span></> :
              <><strong>{measured.length} recorded {measure === 'punch' ? 'first punches' : 'worked-time values'}</strong><span>Choose a point to review that day</span></>}
          </div>
          <div className={s.chartScroll}><svg viewBox="0 0 700 179" className={s.chart} role="group" aria-label={measure === 'punch' ? 'Recorded first punch times' : 'Recorded effective worked time'}>
            {[low, (low + high) / 2, high].map(tick => <g key={tick}>
              <line x1="53" x2="668" y1={y(tick)} y2={y(tick)} stroke="#E8EEF8" strokeDasharray="4 5" />
              <text x="43" y={y(tick) + 4} textAnchor="end" fontSize="12" fill="#496080">{axisLabel(tick)}</text>
            </g>)}
            {lines}
            {measured.map(point => {
              const late = point.day.modifiers.includes('LATE') || point.day.modifiers.includes('LATE_EXEMPTED');
              return <g key={point.day.date} role="button" tabIndex={0} aria-label={dateLabel(point.day.date) + ', ' + valueLabel(point.day) + (late ? ', late flag' : '')}
                onMouseEnter={() => setActiveDate(point.day.date)} onFocus={() => setActiveDate(point.day.date)}
                onClick={() => onSelect(point.day.date)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(point.day.date); } }}>
                <circle cx={x(point.index)} cy={y(point.value as number)} r="9" fill="transparent" />
                <circle cx={x(point.index)} cy={y(point.value as number)} r={activeDate === point.day.date ? 5 : 3.5} fill={late && measure === 'punch' ? '#EB8A1C' : '#2666C4'} stroke="#fff" strokeWidth="1.5" />
                <title>{dateLabel(point.day.date)} · {valueLabel(point.day)}{late ? ' · Late flag' : ''}</title>
              </g>;
            })}
            {points.filter((_, index) => index === 0 || index === Math.floor((points.length - 1) / 2) || index === points.length - 1).map(point =>
              <text key={point.day.date} x={x(point.index)} y="172" textAnchor="middle" fontSize="12" fill="#496080">{dateLabel(point.day.date)}</text>)}
          </svg></div>
        </>
      ) : <div className={s.emptyTrend}><Clock3 size={25} /><strong>No recorded {measure === 'punch' ? 'first punches' : 'worked-time values'} in this period</strong><p>Missing values stay blank. They are never plotted as zero.</p></div>}
      <div className={s.chartFoot}>
        <span>{partial ? 'Partial period · some months unavailable. ' : ''}{measure === 'punch' ? <>Times in your browser timezone <span className={s.chartLegend}><i aria-hidden="true" />API late flag</span></> : 'Effective work only · open days excluded'}</span>
        <button onClick={() => setShowRecords(value => !value)} aria-expanded={showRecords}>{showRecords ? 'Hide records' : 'View records'}</button>
      </div>
      {showRecords && <div className={s.recordList}>
        {measured.length ? measured.map(point => <button key={point.day.date} onClick={() => onSelect(point.day.date)}><span>{dateLabel(point.day.date)}</span><strong>{valueLabel(point.day)}</strong><span>{presentDay(point.day).label}</span></button>) : <p>No values available for this measure.</p>}
      </div>}
    </section>
  );
}
