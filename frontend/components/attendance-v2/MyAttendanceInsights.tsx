'use client';

import { useState } from 'react';
import { CorrectionScreenshots } from '../attendance/CorrectionScreenshots';
import { AttendanceDialog } from './AttendanceDialog';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, CheckCircle2, Clock3, CircleAlert, ChevronRight, FilePenLine, History, Info, Plane, RefreshCw } from 'lucide-react';
import { getMyAttendanceFiscalYear, type MyAttendanceDayV2, type MyAttendanceOverviewV2 } from './my-attendance-v2-api';
import { getMyRegularizations, stageLabel, type Regularization } from '../attendance/regularization-api';
import { exceptionCopy, monthLabel, presentDay } from './status-presentation';
import { reviewRecords } from './insights-presentation';
import { usableFinancialYear } from './financial-year';
import { AttendanceTrend } from './AttendanceTrend';
import s from './insights.module.css';

export type InsightScope = 'month' | 'year';
const OUTCOMES = [
  { key: 'PRESENT', label: 'Present', color: '#16A34A' },
  { key: 'HALF_DAY', label: 'Half day', color: '#9462D9' },
  { key: 'ABSENT', label: 'Absent', color: '#DC2626' },
  { key: 'LEAVE', label: 'Leave', color: '#DC2626' },
  { key: 'LWP', label: 'Unpaid leave', color: '#DC2626' },
  { key: 'HOLIDAY', label: 'Holiday', color: '#F59E0B' },
  { key: 'WEEKLY_OFF', label: 'Weekly off', color: '#64748B' },
  { key: 'EXEMPT', label: 'Not applicable', color: '#64748B' },
];

/** Personal record exploration. Summaries count canonical rows, never evaluate attendance policy. */
export function MyAttendanceInsights({ month, overview, onMonthChange, onSelect, onRequestCorrection, scope, onScopeChange }: {
  month: string;
  scope: InsightScope;
  onScopeChange: (scope: InsightScope) => void;
  overview: MyAttendanceOverviewV2;
  onMonthChange: (month: string) => void;
  onSelect: (date: string) => void;
  onRequestCorrection: (date: string) => void;
}) {
  const [correctionsOpen, setCorrectionsOpen] = useState(false);
  const [correctionPickerOpen, setCorrectionPickerOpen] = useState(false);
  const fiscalYear = usableFinancialYear(overview.financialYear);
  const effectiveScope: InsightScope = fiscalYear ? scope : 'month';
  const annual = useQuery({
    queryKey: ['my-attendance-v2-fiscal-year', fiscalYear?.label ?? 'unavailable'],
    enabled: effectiveScope === 'year' && fiscalYear !== null,
    staleTime: 60_000,
    retry: false,
    queryFn: () => getMyAttendanceFiscalYear(fiscalYear!.label),
  });
  const corrections = useQuery({
    queryKey: ['my-regularizations'],
    queryFn: getMyRegularizations,
    retry: false,
  });
  const periods = effectiveScope === 'year'
    ? annual.data?.months.map(value => ({
        month: `${value.year}-${String(value.month).padStart(2, '0')}`,
        days: value.days,
        summary: value.summary,
      })) ?? []
    : [{ month, days: overview.month.days, summary: overview.month.summary }];
  const loading = effectiveScope === 'year' && annual.isPending;
  const incomplete = effectiveScope === 'year' && annual.isError;
  const days = periods.flatMap(period => period.days);
  const review = reviewRecords(days);
  const summary = effectiveScope === 'year' ? annual.data?.summary : overview.month.summary;
  const count = (outcome: string) => {
    if (!summary || loading || incomplete) return null;
    switch (outcome) {
      case 'PRESENT': return summary.present;
      case 'HALF_DAY': return summary.halfDay;
      case 'ABSENT': return summary.absent;
      case 'LEAVE': return summary.leave;
      case 'LWP': return summary.lwp;
      case 'HOLIDAY': return summary.holiday;
      case 'WEEKLY_OFF': return summary.weeklyOff;
      default: return 0;
    }
  };
  const late = summary && !loading && !incomplete ? summary.late : null;
  const companyDate = overview.today.date;
  const rangeLabel = effectiveScope === 'month' ? monthLabel(overview.month.year, overview.month.month) : `FY ${fiscalYear!.label}`;
  const periodMonths = new Set(effectiveScope === 'year' ? fiscalYear!.months : [month]);
  const requestRows = corrections.data?.filter(row => periodMonths.has(row.date.slice(0, 7)));
  const correctionDays = [...days]
    .filter(day => day.correctionAllowed)
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <section className={s.dashboard} aria-label="Personal attendance dashboard">
      <header className={s.header}>
        <div><div className={s.eyebrow}><span />YOUR PERSONAL OVERVIEW</div><h2>More than a single day.</h2><p>Your record, patterns and anything that needs a second look.</p></div>
        <div className={s.scopeTabs} aria-label="Attendance insight period">
          {(['month', 'year'] as InsightScope[]).map(value => <button key={value} disabled={value === 'year' && !fiscalYear} aria-pressed={effectiveScope === value} onClick={() => onScopeChange(value)}>{value === 'month' ? 'Month' : 'Year'}</button>)}
        </div>
      </header>
      <div className={s.periodLine}>
        <span><CalendarDays size={15} /><strong>{rangeLabel}</strong></span>
        {effectiveScope === 'month' ? <label className={s.periodInput}>Change month<input aria-label="Dashboard month" type="month" value={month} max={companyDate.slice(0, 7)} onChange={event => { if (event.target.value && event.target.value <= companyDate.slice(0, 7)) onMonthChange(event.target.value); }} /></label> :
          <span className={s.periodInput} aria-label="Financial year">FY {fiscalYear!.label}</span>}
      </div>

          {incomplete && <div className={s.notice} role="alert"><CircleAlert size={17} /><span>Some months could not be loaded. Period totals are unavailable; the chart shows only the records received.</span><button onClick={() => annual.refetch()}><RefreshCw size={14} />Retry</button></div>}
          <div className={s.stats} aria-busy={loading}>
            <Stat icon={<CheckCircle2 />} label="Present" value={count('PRESENT')} note="Recorded days, including late" tone="green" loading={loading} />
            <Stat icon={<Clock3 />} label="Late flags" value={late} note="Recorded assessments · exemptions included" tone="orange" loading={loading} />
            <Stat icon={<Plane />} label="Leave" value={count('LEAVE')} note="Recorded Leave outcomes" tone="blue" loading={loading} />
            <Stat icon={<CircleAlert />} label="Needs review" value={loading || incomplete || !summary ? null : summary.needsReview} note="Closed days with review flags" tone="neutral" loading={loading} />
          </div>
          {loading ? <div className={s.loading} role="status"><RefreshCw size={18} />Loading this year’s recorded attendance…</div> : (
            <>
              {effectiveScope === 'year' && <div className={s.yearGrid} aria-label="Year attendance months">
                {periods.map(period => <button key={period.month} onClick={() => { onMonthChange(period.month); onScopeChange('month'); }}>
                  <strong>{monthLabel(Number(period.month.slice(0, 4)), Number(period.month.slice(5))).split(' ')[0].slice(0, 3)}</strong>
                  <span>{period.summary.recordedDays} recorded</span>
                  <div className={s.miniStrip}>{period.days.filter(day => !day.isFuture).map(day => <i key={day.date} style={{ background: day.outcome ? presentDay(day).color : '#E9EEF6' }} />)}</div>
                </button>)}
              </div>}
              <div className={s.distribution}>
                <div><h3>Attendance record</h3><span>{incomplete || !summary ? 'Partial coverage' : summary.recordedDays + ' recorded days · ' + summary.finalizedDays + ' finalized'} · open days stay provisional</span></div>
                {effectiveScope === 'month' ? <div className={s.dayStrip} aria-label="Monthly attendance strip">
                  {overview.month.days.map(day => <button key={day.date} disabled={day.isFuture} style={{ '--day-color': day.outcome && !day.isFuture ? presentDay(day).color : '#E7EDF6' } as React.CSSProperties}
                    aria-label={day.date + ', ' + (day.isFuture ? 'Future date' : presentDay(day).label)} title={day.date + ' · ' + (day.isFuture ? 'Future date' : presentDay(day).label)}
                    onClick={() => onSelect(day.date)}><i /><span>{Number(day.date.slice(8))}</span></button>)}
                </div> : null}
                <div className={s.outcomeCounts}>{OUTCOMES.map(outcome => <span key={outcome.key}><i style={{ background: outcome.color }} />{outcome.label}<b>{count(outcome.key) ?? '—'}</b></span>)}</div>
              </div>
              <div className={s.panels}>
                <AttendanceTrend days={days} partial={incomplete} onSelect={onSelect} />
                <Attention days={review} incomplete={incomplete} onSelect={onSelect} />
              </div>
            </>
          )}

      <div className={s.bottomRow}>
        <button className={s.actionButton} onClick={() => setCorrectionPickerOpen(true)}><FilePenLine size={20} />Request Correction</button>
        <button className={s.actionButton} onClick={() => setCorrectionsOpen(true)}><FileLabel />My Corrections</button>
        {correctionPickerOpen && <AttendanceDialog title="Request a Correction" onClose={() => setCorrectionPickerOpen(false)}>
          <div className={s.correctionBody}>
            <p>Select the attendance day you want reviewed.</p>
            {correctionDays.length ? correctionDays.map(day => <button key={day.date} className={s.correctionRow} onClick={() => { setCorrectionPickerOpen(false); requestAnimationFrame(() => onRequestCorrection(day.date)); }}>
              <span><b>{new Date(day.date + 'T12:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })}</b><small>{presentDay(day).label}{day.reason ? ` · ${day.reason}` : ''}</small></span>
              <ChevronRight size={15} />
            </button>) : <p>No attendance days in this period are currently eligible for correction.</p>}
          </div>
        </AttendanceDialog>}
        {correctionsOpen && <AttendanceDialog title="My Corrections" onClose={() => setCorrectionsOpen(false)}>
          <CorrectionList rows={requestRows} failed={corrections.isError} loading={corrections.isPending} onSelect={date => { setCorrectionsOpen(false); requestAnimationFrame(() => onSelect(date)); }} retry={() => corrections.refetch()} />
        </AttendanceDialog>}
        <details className={s.explanation}><summary><Info size={16} />About these numbers</summary><p>Counts, attendance percentage and the April-to-March financial-year range come from the attendance API. Late flags may overlap Present. No shift target, streak or payroll eligibility is calculated here. Punch-in times use your browser timezone; worked time is the separately recorded effective-work value. Missing values remain unavailable.</p></details>
      </div>
    </section>
  );
}

function Stat({ icon, label, value, note, tone, loading }: { icon: React.ReactNode; label: string; value: number | null; note: string; tone: string; loading: boolean }) {
  return <div className={s.stat} data-tone={tone}><span className={s.statIcon}>{icon}</span><span className={s.statLabel}>{label}</span><strong aria-label={value === null ? 'Unavailable' : undefined}>{loading ? '…' : value ?? '—'}</strong><small>{note}</small></div>;
}
function FileLabel() { return <History size={20} />; }

function Attention({ days, incomplete, onSelect }: { days: MyAttendanceDayV2[]; incomplete: boolean; onSelect: (date: string) => void }) {
  const [open, setOpen] = useState(false);
  const ordered = [...days].sort((a, b) => b.date.localeCompare(a.date));
  return <aside className={s.attention}>
    <div><h3><CircleAlert size={19} />Needs a second look</h3><p>{incomplete ? 'Review coverage is incomplete. Retry the missing months.' : ordered.length ? ordered.length + ' days have review flags.' : 'No closed-day review flags returned.'}</p><p>Check the record before requesting a change. A review flag is not an absence verdict.</p></div>
    {ordered.length > 0 && <button className={s.actionButton} onClick={() => setOpen(true)}>View all {ordered.length} flagged days <ChevronRight size={17} /></button>}
    {open && <AttendanceDialog title="Flagged days" onClose={() => setOpen(false)}><div className={s.flaggedList}>
      {ordered.map(day => <button key={day.date} onClick={() => { setOpen(false); requestAnimationFrame(() => onSelect(day.date)); }}><span className={s.attentionDate}>{new Date(day.date + 'T12:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })}</span><span><strong>{day.exceptions.length ? exceptionCopy(day.exceptions[0]).title : 'Attendance needs review'}</strong><small>Review day details</small></span><ChevronRight size={17} /></button>)}
    </div></AttendanceDialog>}
  </aside>;
}

function CorrectionList({ rows, failed, loading, onSelect, retry }: { rows?: Regularization[]; failed: boolean; loading: boolean; onSelect: (date: string) => void; retry: () => void }) {
  const [filter, setFilter] = useState('all');
  const filtered = (rows ?? []).filter(row => filter === 'all' || (filter === 'pending' ? row.status === 'PENDING' || row.status === 'STALE_REVIEW_REQUIRED' || row.status === 'MANAGER_APPROVED' : filter === 'approved' ? row.status === 'APPROVED' || row.status === 'HR_APPROVED' : row.status === 'REJECTED'));
  return <div className={s.correctionBody}>
    <div className={s.smallTabs} aria-label="Correction request status">{['all', 'pending', 'approved', 'rejected'].map(value => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div>
    {failed ? <p role="alert">Requests could not be loaded. <button onClick={retry}>Try again</button></p> : loading ? <p>Loading requests…</p> :
      filtered.length ? [...filtered].sort((a, b) => b.date.localeCompare(a.date)).map(row => <div key={row.id}><button className={s.correctionRow} onClick={() => onSelect(row.date.slice(0, 10))}><span><b>{row.date.slice(0, 10)}</b><small>{row.reason || 'Open request details'}{row.decidedBy?.name ? ` · ${row.status === 'REJECTED' ? 'Rejected' : 'Approved'} by ${row.decidedBy.name}${row.decidedByRole ? ` (${row.decidedByRole.replaceAll('_', ' ')})` : ''}` : ''}{row.decisionReason ? ` · ${row.decisionReason}` : ''}</small></span><span>{stageLabel(row.status, row.applicationStatus)}</span><ChevronRight size={15} /></button><CorrectionScreenshots requestId={row.id} files={row.screenshots ?? []} /></div>) : <p>No {filter === 'all' ? '' : filter + ' '}correction requests in this period.</p>}
  </div>;
}
