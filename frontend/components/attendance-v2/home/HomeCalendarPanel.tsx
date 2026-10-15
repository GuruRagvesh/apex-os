'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import { shouldRetryTransientQuery, transientQueryRetryDelay } from '@apex/shared-auth';
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, CalendarCheck, CalendarDays, ChevronDown,
  ChevronLeft, ChevronRight, Flame, Gauge, LogIn, LogOut, Minus, PencilLine, Sparkles, Star, Ticket, Timer, X,
} from 'lucide-react';
import { getMyAttendanceV2, type MyAttendanceDayV2 } from '../my-attendance-v2-api';
import { getMyPunchEvidence, type OwnPunchEvidence } from '../../attendance/punch-api';
import { getMyLeaveBalance, type PersonalLeaveType } from '../../attendance/leave-balance-api';
import { monthLabel, presentDay, formatTime } from '../status-presentation';
import { CorrectionDialog } from '../CorrectionDialog';
import { getHomeProductivity, type HomeProductivityDay } from './home-insights-api';
import { TinyPunchPhoto } from './TinyPunchPhoto';
import {
  addDays, attendanceStreak, attendanceWeek, clockLabel, datesBetween, hoursLabel, monthOf,
  hasActivity, pickWeek, productiveDays, productivityWeek, rangeLabel, shiftMonth,
  type WeekWindow,
} from './home-week';
import s from './home-calendar.module.css';

type Mode = 'attendance' | 'productivity';

const ATTENDANCE_LEGEND = [
  { label: 'Present', color: '#18B86B' },
  { label: 'Late / Short hours', color: '#F08A35' },
  { label: 'Absent / leave', color: '#EC5D78' },
  { label: 'Half day', color: '#9B6DE3' },
  { label: 'Regularized', color: '#54D36C' },
  { label: 'Holiday', color: '#E5B52E' },
  { label: 'Weekly off', color: '#4F8FD8' },
  { label: 'Needs review', color: '#8494AA' },
] as const;

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` };
}

/** First punch-in and last punch-out evidence per business date. */
function evidenceByDate(rows: OwnPunchEvidence[] | undefined) {
  const map = new Map<string, { in: OwnPunchEvidence | null; out: OwnPunchEvidence | null }>();
  for (const row of [...(rows ?? [])].sort((a, b) => a.serverOccurredAt.localeCompare(b.serverOccurredAt))) {
    const entry = map.get(row.businessDate) ?? { in: null, out: null };
    if (row.type === 'PUNCH_IN' && !entry.in) entry.in = row;
    if (row.type === 'PUNCH_OUT') entry.out = row;
    map.set(row.businessDate, entry);
  }
  return map;
}

function photoId(e: OwnPunchEvidence | null | undefined): string | null {
  return e?.photoAssetId ? e.id : null;
}

export function HomeCalendarPanel() {
  const today = localToday();
  const role = useAuthStore((state) => (state.user?.role as any)?.name ?? state.user?.role ?? '');
  const isIntern = String(role).toUpperCase() === 'INTERN';
  const [mode, setMode] = useState<Mode>('attendance');
  const [attendanceFilter, setAttendanceFilter] = useState<string | null>(null);
  const [month, setMonth] = useState(() => monthOf(today));
  const [popup, setPopup] = useState<{ date: string; anchor: HTMLElement } | null>(null);
  const [correctionDate, setCorrectionDate] = useState<string | null>(null);

  // Attendance: the displayed month, plus the months the weekly figures and
  // streak need (this month and the one before it). Same cache keys as the
  // My Attendance page, so moving between the two does not refetch.
  const months = useMemo(() => {
    const set = new Set([month, monthOf(today), shiftMonth(monthOf(today), -1)]);
    return Array.from(set);
  }, [month, today]);
  const attendance = useQueries({
    queries: months.map((m) => ({
      queryKey: ['my-attendance-v2', m],
      queryFn: () => getMyAttendanceV2(m),
      staleTime: 60_000,
      retry: shouldRetryTransientQuery,
      retryDelay: transientQueryRetryDelay,
    })),
  });
  const attendanceByDate = useMemo(() => {
    const map = new Map<string, MyAttendanceDayV2>();
    for (const q of attendance) for (const day of q.data?.month.days ?? []) map.set(day.date, day);
    return map;
  }, [attendance]);
  const correctionAllowed = attendance.find((q) => q.data)?.data?.today.correctionAllowed ?? false;
  const monthQuery = attendance[months.indexOf(month)];

  const evidence = useQuery({
    queryKey: ['my-punch-evidence-v2'],
    queryFn: () => getMyPunchEvidence(90),
    staleTime: 60_000,
    retry: shouldRetryTransientQuery,
    retryDelay: transientQueryRetryDelay,
  });
  const punches = useMemo(() => evidenceByDate(evidence.data), [evidence.data]);

  const week: WeekWindow = useMemo(() => pickWeek(today, attendanceByDate), [today, attendanceByDate]);

  // Productivity: the displayed month (for the calendar) and the two weeks the
  // side figures compare.
  const { start: monthStart, end: monthEnd } = monthBounds(month);
  const monthTo = monthEnd < today ? monthEnd : today;
  const monthProductivity = useQuery({
    queryKey: ['home-productivity', monthStart, monthTo],
    queryFn: () => getHomeProductivity(monthStart, monthTo),
    enabled: monthStart <= today,
    staleTime: 60_000,
    retry: shouldRetryTransientQuery,
    retryDelay: transientQueryRetryDelay,
  });
  const weekTo = week.end < today ? week.end : today;
  const weekProductivity = useQuery({
    queryKey: ['home-productivity', week.previousStart, weekTo],
    queryFn: () => getHomeProductivity(week.previousStart, weekTo),
    staleTime: 60_000,
    retry: shouldRetryTransientQuery,
    retryDelay: transientQueryRetryDelay,
  });
  const productivityByDate = useMemo(() => {
    const map = new Map<string, HomeProductivityDay>();
    for (const day of weekProductivity.data ?? []) map.set(day.date, day);
    for (const day of monthProductivity.data ?? []) map.set(day.date, day);
    return map;
  }, [weekProductivity.data, monthProductivity.data]);
  const highlight = useMemo(() => productiveDays(monthProductivity.data ?? []), [monthProductivity.data]);

  const canGoNext = month < monthOf(today);
  const [y, m] = month.split('-').map(Number);

  const openDay = (date: string, anchor: HTMLElement) => setPopup({ date, anchor });

  return (
    <section className={s.panel} aria-label="My calendar">
      <div className={`${s.card} ${s.calendar}`}>
        <header className={s.header}>
          <h2 className={s.title}>My {mode === 'attendance' ? 'Attendance' : 'Productivity'}</h2>
          <div className={s.toggle} role="group" aria-label="Calendar view">
            <button type="button" aria-pressed={mode === 'attendance'} onClick={() => { setMode('attendance'); setPopup(null); }}>
              <CalendarCheck size={14} aria-hidden="true" /> Attendance
            </button>
            <button type="button" aria-pressed={mode === 'productivity'} onClick={() => { setMode('productivity'); setPopup(null); }}>
              <Gauge size={14} aria-hidden="true" /> Productivity
            </button>
          </div>
          <div className={s.monthControls}>
            <button type="button" onClick={() => { setMonth(shiftMonth(month, -1)); setPopup(null); }} aria-label="Previous month"><ChevronLeft size={16} /></button>
            <label className={s.monthPicker}>
              <CalendarDays size={14} aria-hidden="true" />
              <span>{monthLabel(y, m)}</span>
              <ChevronDown size={14} aria-hidden="true" />
              <input
                type="month"
                aria-label="Select month"
                value={month}
                max={monthOf(today)}
                onChange={(e) => { if (e.target.value) { setMonth(e.target.value); setPopup(null); } }}
              />
            </label>
            <button type="button" onClick={() => { setMonth(shiftMonth(month, 1)); setPopup(null); }} disabled={!canGoNext} aria-label="Next month"><ChevronRight size={16} /></button>
          </div>
        </header>

        <div className={mode === 'attendance' ? s.attendanceCalendarLayout : undefined}>
          {mode === 'attendance' && (
            <aside className={s.attendanceLegend} aria-label="Attendance colour guide">
              <span className={s.legendTitle}>Day colours</span>
              {ATTENDANCE_LEGEND.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  aria-pressed={attendanceFilter === item.label}
                  onClick={() => { setAttendanceFilter(attendanceFilter === item.label ? null : item.label); setPopup(null); }}
                >
                  <i style={{ background: item.color }} aria-hidden="true" />{item.label}
                </button>
              ))}
              {attendanceFilter && <button type="button" className={s.clearFilter} onClick={() => setAttendanceFilter(null)}>Clear filter</button>}
            </aside>
          )}

          <div className={s.calendarMain}>
            {monthQuery?.isLoading ? (
              <div className={s.skeleton}>Loading your calendar…</div>
            ) : monthQuery?.isError ? (
              <div className={s.skeleton}>Your attendance could not be loaded. Refresh to try again.</div>
            ) : (
              <CalendarGrid
                month={month}
                today={today}
                mode={mode}
                attendanceFilter={mode === 'attendance' ? attendanceFilter : null}
                selected={popup?.date ?? null}
                attendanceByDate={attendanceByDate}
                punches={punches}
                productivityByDate={productivityByDate}
                highlight={highlight}
                onOpen={openDay}
              />
            )}
          </div>
        </div>

        {mode === 'productivity' && (
          <div className={s.legend} aria-label="Productivity legend">
            <>
              <span><i style={{ background: 'color-mix(in srgb, var(--color-success) 30%, transparent)' }} />More productive hours than your average</span>
              <span><Star size={11} style={{ color: 'var(--color-success)' }} aria-hidden="true" />Top 3 days this month</span>
              <span>{monthProductivity.isError ? 'Productivity data could not be loaded.' : 'Productive hours = time logged on tickets (breaks excluded).'}</span>
            </>
          </div>
        )}
      </div>

      {mode === 'attendance'
        ? <AttendanceSide today={today} week={week} byDate={attendanceByDate} isIntern={isIntern} />
        : <ProductivitySide week={week} byDate={productivityByDate} loading={weekProductivity.isLoading} failed={weekProductivity.isError} />}

      {mode === 'attendance' && !isIntern && <LeaveBalanceAnalysis />}

      {popup && (
        <DayPopup
          date={popup.date}
          anchor={popup.anchor}
          mode={mode}
          day={attendanceByDate.get(popup.date)}
          punch={punches.get(popup.date)}
          productivity={productivityByDate.get(popup.date)}
          highlight={highlight}
          correctionAllowed={correctionAllowed}
          onCorrection={() => { setCorrectionDate(popup.date); setPopup(null); }}
          onClose={() => setPopup(null)}
        />
      )}
      {correctionDate && correctionAllowed && <CorrectionDialog date={correctionDate} onClose={() => setCorrectionDate(null)} />}
    </section>
  );
}

// ── Calendar grid ────────────────────────────────────────────────────────────

function CalendarGrid({
  month, today, mode, attendanceFilter, selected, attendanceByDate, punches, productivityByDate, highlight, onOpen,
}: {
  month: string;
  today: string;
  mode: Mode;
  attendanceFilter: string | null;
  selected: string | null;
  attendanceByDate: Map<string, MyAttendanceDayV2>;
  punches: Map<string, { in: OwnPunchEvidence | null; out: OwnPunchEvidence | null }>;
  productivityByDate: Map<string, HomeProductivityDay>;
  highlight: ReturnType<typeof productiveDays>;
  onOpen: (date: string, el: HTMLElement) => void;
}) {
  const { start, end } = monthBounds(month);
  const lead = (new Date(`${start}T12:00:00.000Z`).getUTCDay());
  const cells = datesBetween(addDays(start, -lead), addDays(end, (6 - new Date(`${end}T12:00:00.000Z`).getUTCDay())));

  return (
    <div className={s.scroll}>
      <div className={s.weekdays}>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <span key={d}>{d}</span>)}</div>
      <div className={s.grid}>
        {cells.map((date) => {
          const inMonth = date >= start && date <= end;
          const future = date > today;
          const dayNum = Number(date.slice(8));
          if (!inMonth || future) {
            return (
              <div key={date} className={`${s.day} ${s.muted} ${attendanceFilter ? s.dimmedDay : ''}`} aria-hidden={!inMonth}>
                <div className={s.dayTop}><span className={s.dayNumber}>{inMonth ? dayNum : ''}</span></div>
              </div>
            );
          }
          const cls = [s.day, date === today ? s.today : '', selected === date ? s.selected : ''];
          if (mode === 'productivity') {
            const p = productivityByDate.get(date);
            const isTop = highlight.top.includes(date);
            if (isTop) cls.push(s.topDay); else if (highlight.aboveAverage.has(date)) cls.push(s.productive);
            const tickets = (p?.ticketsDone ?? 0) + (p?.ticketsSubmitted ?? 0);
            return (
              <button key={date} type="button" className={cls.join(' ')} onClick={(e) => onOpen(date, e.currentTarget)}
                aria-label={`${date}: ${hoursLabel(p?.ticketMinutes ?? 0)} productive${isTop ? ', top day' : ''}`}>
                <div className={s.dayTop}>
                  <span className={s.dayNumber}>{dayNum}</span>
                  {isTop && <span className={s.topBadge}><Star size={10} style={{ display: 'inline', verticalAlign: '-1px' }} aria-hidden="true" /> Top</span>}
                </div>
                <span className={s.prodHours}>{p && p.ticketMinutes > 0 ? hoursLabel(p.ticketMinutes) : '—'}</span>
                <span className={s.prodMeta}>{tickets > 0 ? `${p?.ticketsDone ?? 0} done · ${p?.ticketsSubmitted ?? 0} sent` : 'No ticket activity'}</span>
              </button>
            );
          }
          const day = attendanceByDate.get(date);
          const punch = punches.get(date);
          const status = day ? presentDay(day) : null;
          if (attendanceFilter && (!day || !matchesHomeAttendanceFilter(day, attendanceFilter))) cls.push(s.dimmedDay);
          return (
            <button key={date} type="button" className={cls.join(' ')}
              data-status={status?.label}
              style={{
                '--day-tint': day?.outcome && status ? status.tint : undefined,
                '--day-status': day?.outcome && status ? status.color : undefined,
              } as CSSProperties}
              onClick={(e) => onOpen(date, e.currentTarget)}
              aria-label={`${date}: ${status?.label ?? 'no attendance result'}`}>
              <div className={s.dayTop}>
                <span className={s.dayNumber}>{dayNum}</span>
                {status && day?.outcome && <span className={s.statusDot} style={{ background: status.color }} title={status.label} />}
              </div>
              {day?.punchInAt ? (
                <>
                  <span className={s.punchRow}>
                    <TinyPunchPhoto evidenceId={photoId(punch?.in)} label={`Punch in ${formatTime(day.punchInAt)}`} />
                    <span className={s.punchTime}>{formatTime(day.punchInAt)}</span>
                  </span>
                  <span className={s.punchRow}>
                    <TinyPunchPhoto evidenceId={photoId(punch?.out)} label={day.punchOutAt ? `Punch out ${formatTime(day.punchOutAt)}` : 'Not punched out'} />
                    <span className={s.punchTime}>{day.punchOutAt ? formatTime(day.punchOutAt) : (day.isInProgress ? 'Working' : '—')}</span>
                  </span>
                </>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function matchesHomeAttendanceFilter(day: MyAttendanceDayV2, filter: string): boolean {
  const lateOrShort = day.modifiers.some((value) => ['LATE', 'LATE_EXEMPTED', 'INSUFFICIENT_PRESENCE', 'INSUFFICIENT_EFFECTIVE_WORK'].includes(value));
  if (filter === 'Needs review') return day.evaluationState === 'NEEDS_REVIEW' || day.outcome === 'UNRESOLVED';
  if (filter === 'Late / Short hours') return lateOrShort;
  if (filter === 'Regularized') return day.modifiers.includes('REGULARIZED');
  if (filter === 'Present') return day.outcome === 'PRESENT' && !lateOrShort && !day.modifiers.includes('REGULARIZED');
  if (filter === 'Absent / leave') return ['ABSENT', 'LEAVE', 'LWP'].includes(day.outcome ?? '');
  if (filter === 'Half day') return day.outcome === 'HALF_DAY';
  if (filter === 'Holiday') return day.outcome === 'HOLIDAY';
  if (filter === 'Weekly off') return day.outcome === 'WEEKLY_OFF';
  return false;
}

// ── Side KPIs ────────────────────────────────────────────────────────────────

function Delta({ now, before, unit = 'min', invert = false }: { now: number | null; before: number | null; unit?: 'min' | 'count' | 'clock'; invert?: boolean }) {
  if (now == null || before == null) return <span className={`${s.delta} ${s.flat}`}>No comparison yet</span>;
  const diff = now - before;
  const threshold = unit === 'count' ? 0.5 : 5;
  if (Math.abs(diff) < threshold) return <span className={`${s.delta} ${s.flat}`}><Minus size={12} aria-hidden="true" />Same as before</span>;
  const better = invert ? diff < 0 : diff > 0;
  const text = unit === 'count' ? `${Math.abs(Math.round(diff))}` : unit === 'clock' ? `${Math.round(Math.abs(diff))} min ${diff < 0 ? 'earlier' : 'later'}` : hoursLabel(Math.abs(diff));
  return (
    <span className={`${s.delta} ${better ? s.up : s.down}`}>
      {diff > 0 ? <ArrowUpRight size={12} aria-hidden="true" /> : <ArrowDownRight size={12} aria-hidden="true" />}
      {unit === 'clock' ? text : `${text} ${diff > 0 ? 'more' : 'less'}`}
    </span>
  );
}

function KpiCard({ label, value, sub, icon, children }: { label: string; value: string; sub?: string; icon: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className={`${s.card} ${s.kpi}`}>
      <div className={s.kpiHead}>
        <span className={s.kpiLabel}>{label}</span>
        <span className={s.kpiIcon} aria-hidden="true">{icon}</span>
      </div>
      <div className={s.kpiValue}>{value}</div>
      {sub && <div className={s.kpiSub}>{sub}</div>}
      {children && <div style={{ marginTop: 6 }}>{children}</div>}
    </div>
  );
}

function weekName(week: WeekWindow) {
  return week.kind === 'this' ? 'This week' : 'Last week';
}

function KpiScoreMetric({ label, value, icon, detail, full = false }: {
  label: string;
  value: string;
  icon: React.ReactNode;
  detail?: string;
  full?: boolean;
}) {
  return (
    <article className={`${s.kpiScoreMetric} ${full ? s.kpiScoreMetricFull : ''}`}>
      <span className={s.kpiScoreMetricIcon} aria-hidden="true">{icon}</span>
      <div className={s.kpiScoreMetricCopy}>
        <span>{label}</span>
        <strong>{value}</strong>
        {detail && <small>{detail}</small>}
      </div>
    </article>
  );
}

function AttendanceKpiScore({ current, streak }: { current: ReturnType<typeof attendanceWeek>; streak: number }) {
  const level = Math.max(1, Math.ceil(Math.max(1, streak) / 5));
  const nextLevelAt = level * 5 + 5;
  const daysToNextLevel = Math.max(0, nextLevelAt - streak);

  return (
    <section className={`${s.card} ${s.kpiScore}`} aria-label="The Trailer">
      <header className={s.kpiScoreHead}>
        <div><h2>The Trailer</h2><p>Your work rhythm at a glance</p></div>
        <span className={s.kpiIcon} aria-hidden="true"><Gauge size={16} /></span>
      </header>
      <div className={s.kpiScoreGrid}>
        <KpiScoreMetric label="Avg working hours" value={hoursLabel(current.avgWorkMinutes)} icon={<Timer size={15} />} detail="Daily average" />
        <KpiScoreMetric label="Avg punch in" value={clockLabel(current.avgPunchInMinutes)} icon={<LogIn size={15} />} detail="Working days" />
        <KpiScoreMetric label="Avg punch out" value={clockLabel(current.avgPunchOutMinutes)} icon={<LogOut size={15} />} detail="Completed days" />
        <KpiScoreMetric label="Consistency streak" value={`${streak} day${streak === 1 ? '' : 's'}`} icon={<Flame size={15} />} detail={`Level ${level}${daysToNextLevel ? ` · ${daysToNextLevel} to next badge` : ' · Badge unlocked'}`} full />
      </div>
    </section>
  );
}

function LeaveBalanceAnalysis({ compactIntern = false }: { compactIntern?: boolean } = {}) {
  const role = useAuthStore((state) => (state.user?.role as any)?.name ?? state.user?.role ?? '');
  const isIntern = String(role).toUpperCase() === 'INTERN';
  const casual = useQuery({
    queryKey: ['my-leave-balance', 'CASUAL', 'role-policy-v2'],
    queryFn: () => getMyLeaveBalance('CASUAL' as PersonalLeaveType),
    staleTime: 300_000,
    retry: shouldRetryTransientQuery,
    retryDelay: transientQueryRetryDelay,
    refetchOnMount: 'always',
  });
  const emergency = useQuery({
    queryKey: ['my-leave-balance', 'EMERGENCY', 'role-policy-v2'],
    queryFn: () => getMyLeaveBalance('EMERGENCY' as PersonalLeaveType),
    enabled: !isIntern,
    staleTime: 300_000,
    retry: shouldRetryTransientQuery,
    retryDelay: transientQueryRetryDelay,
    refetchOnMount: 'always',
  });
  if (isIntern) return <InternPaidLeaveAnalysis query={casual} compact={compactIntern} />;

  const entries = [
    { key: 'casual', label: 'Casual Leave', query: casual, tone: 'blue' as const },
    { key: 'emergency', label: 'Emergency Leave', query: emergency, tone: 'amber' as const },
  ];

  return (
    <section className={`${s.card} ${s.leaveAnalysis}`} aria-label="Leave usage and allocation analysis">
      <header className={s.leaveAnalysisHeader}>
        <span className={s.leaveAnalysisIcon} aria-hidden="true"><CalendarDays size={19} /></span>
        <div>
          <h2>Leave usage &amp; allocation analysis</h2>
        </div>
        <span className={s.leavePeriod}>Current year · {new Date().getFullYear()}</span>
      </header>
      <div className={s.leaveAnalysisGrid}>
        {entries.map((entry) => {
          if (entry.query.isLoading) return <div key={entry.key} className={s.leaveAnalysisState}>Loading {entry.label.toLowerCase()}…</div>;
          if (entry.query.isError || !entry.query.data) return <div key={entry.key} className={s.leaveAnalysisState}>{entry.label} balance is unavailable.</div>;
          return <LeaveAnalysisCard key={entry.key} label={entry.label} tone={entry.tone} balance={entry.query.data} />;
        })}
      </div>
    </section>
  );
}

function InternPaidLeaveAnalysis({ query, compact = false }: { query: {
  data?: { allocation: number; approved: number; pending: number; balance: number };
  isLoading: boolean;
  isError: boolean;
}; compact?: boolean }) {
  const balance = query.data;
  const allocated = Math.max(0, balance?.allocation ?? 1);
  const used = Math.max(0, balance?.approved ?? 0);
  const pending = Math.max(0, balance?.pending ?? 0);
  const remaining = Math.max(0, balance?.balance ?? allocated - used);
  const usedPercent = allocated ? Math.min(100, (used / allocated) * 100) : 0;
  const pendingPercent = allocated ? Math.min(100 - usedPercent, (pending / allocated) * 100) : 0;
  const chart = `conic-gradient(#2563EB 0 ${usedPercent}%, #60A5FA ${usedPercent}% ${usedPercent + pendingPercent}%, #DCE9F8 ${usedPercent + pendingPercent}% 100%)`;

  return (
    <section className={`${s.card} ${s.internLeaveAnalysis} ${compact ? s.internLeaveSide : ''}`} aria-label="Monthly paid leave balance">
      <header className={s.internLeaveHeader}>
        <span className={s.leaveAnalysisIcon} aria-hidden="true"><CalendarCheck size={18} /></span>
        <div><h2>Paid leave balance</h2></div>
      </header>
      {query.isLoading ? <div className={s.internLeaveState}>Loading paid leave…</div>
        : query.isError || !balance ? <div className={s.internLeaveState}>Paid leave balance is unavailable.</div>
        : <div className={s.internLeaveBody}>
          <div className={s.internLeaveChart} style={{ background: chart }} role="img" aria-label={`${used} days used out of ${allocated} allocated`}>
            <div><strong>{remaining}</strong><span>left</span></div>
          </div>
          <div className={s.internLeaveStats}>
            <div><span>Allocated</span><strong>{allocated} day</strong></div>
            <div><span>Used</span><strong>{used} day{used === 1 ? '' : 's'}</strong></div>
            <div><span>Pending</span><strong>{pending} day{pending === 1 ? '' : 's'}</strong></div>
          </div>
        </div>}
    </section>
  );
}

function LeaveAnalysisCard({ label, tone, balance }: {
  label: string;
  tone: 'blue' | 'amber';
  balance: { allocation: number; approved: number; pending: number; balance: number };
}) {
  const allocated = Math.max(0, balance.allocation);
  const used = Math.max(0, balance.approved);
  const pending = Math.max(0, balance.pending);
  const remaining = Math.max(0, balance.balance);
  const denominator = Math.max(allocated, used + pending + remaining, 1);
  const usedPercent = Math.min(100, (used / denominator) * 100);
  const pendingPercent = Math.min(100 - usedPercent, (pending / denominator) * 100);
  const usagePercent = allocated ? Math.min(100, Math.round((used / allocated) * 100)) : 0;
  const usedColor = tone === 'amber' ? '#D97706' : '#2563EB';
  const pendingColor = tone === 'amber' ? '#FBBF24' : '#60A5FA';
  const chart = `conic-gradient(${usedColor} 0 ${usedPercent}%, ${pendingColor} ${usedPercent}% ${usedPercent + pendingPercent}%, #DCE9F8 ${usedPercent + pendingPercent}% 100%)`;

  return (
    <article className={s.leaveAnalysisCard} data-tone={tone}>
      <div className={s.leaveCardHeading}>
        <span className={s.leaveTypeIcon} aria-hidden="true"><CalendarCheck size={17} /></span>
        <div><h3>{label} analysis</h3></div>
      </div>
      <div className={s.leaveCardBody}>
        <div className={s.leaveFigures}>
          <div className={s.leaveAllocationRow}>
            <div><span>Allocated</span><strong>{allocated}<small> days</small></strong></div>
            <div><span>Remaining</span><strong>{remaining}<small> days</small></strong></div>
          </div>
          <div className={s.leaveUsageHead}><span>Usage progress</span><strong>{usagePercent}%</strong></div>
          <div className={s.leaveUsageTrack}><span style={{ width: `${usagePercent}%`, background: usedColor }} /></div>
          <div className={s.leaveBreakdown}>
            <span><i style={{ background: usedColor }} />Used <strong>{used}d</strong></span>
            <span><i style={{ background: pendingColor }} />Pending <strong>{pending}d</strong></span>
          </div>
        </div>
        <div className={s.leaveChartStage}>
          <div className={s.leaveChartShadow} aria-hidden="true" />
          <div className={s.leaveChart} style={{ background: chart }} role="img" aria-label={`${label}: ${used} days used out of ${allocated} allocated`}>
            <div><strong>{used}d</strong><span>used</span></div>
          </div>
          <p><strong>{remaining}d</strong> available</p>
        </div>
      </div>
    </article>
  );
}

function AttendanceSide({ today, week, byDate, isIntern }: { today: string; week: WeekWindow; byDate: Map<string, MyAttendanceDayV2>; isIntern: boolean }) {
  const current = attendanceWeek(week.start, week.end, byDate);
  const earliest = Array.from(byDate.keys()).sort()[0] ?? today;
  const streak = attendanceStreak(today, byDate, earliest);

  return (
    <aside className={s.side} aria-label={`${weekName(week)} attendance`}>
      <AttendanceKpiScore current={current} streak={streak} />
      {isIntern && <LeaveBalanceAnalysis compactIntern />}
    </aside>
  );
}

function ProductivitySide({ week, byDate, loading, failed }: { week: WeekWindow; byDate: Map<string, HomeProductivityDay>; loading: boolean; failed: boolean }) {
  if (loading) return <aside className={s.side}><div className={`${s.card} ${s.kpi}`}><span className={s.kpiSub}>Loading productivity…</span></div></aside>;
  if (failed) return <aside className={s.side}><div className={`${s.card} ${s.kpi}`}><span className={s.kpiSub}>Productivity could not be loaded. Refresh to try again.</span></div></aside>;

  const current = productivityWeek(week.start, week.end, byDate);
  const previous = productivityWeek(week.previousStart, week.previousEnd, byDate);
  const doneDiff = current.ticketsDone - previous.ticketsDone;
  const minutesDiff = current.totalProductiveMinutes - previous.totalProductiveMinutes;
  const improving = doneDiff > 0 || (doneDiff === 0 && minutesDiff > 30);
  const slipping = doneDiff < 0 || (doneDiff === 0 && minutesDiff < -30);
  const nothingYet = current.totalProductiveMinutes === 0 && current.ticketsDone === 0 && current.ticketsSubmitted === 0;
  const headline = nothingYet
    ? `No ticket activity recorded for ${weekName(week).toLowerCase()} yet.`
    : improving
    ? `${weekName(week)} your productivity went up: ${current.ticketsDone} ticket${current.ticketsDone === 1 ? '' : 's'} done${doneDiff > 0 ? `, ${doneDiff} more than the week before` : ''}. Keep going!`
    : slipping
      ? `${weekName(week)} you closed ${Math.abs(doneDiff) || 'fewer'} ${Math.abs(doneDiff) === 1 ? 'ticket' : 'tickets'} fewer than the week before.`
      : `${weekName(week)} you kept the same pace as the week before.`;
  const nudge = nothingYet
    ? 'Time logged on tickets and tickets you finish will show up here.'
    : slipping
    ? `Try to close ${Math.max(1, Math.abs(doneDiff))} more next week to get back on track.`
    : current.ticketsSubmitted > current.ticketsDone
      ? `${current.ticketsSubmitted} ticket${current.ticketsSubmitted === 1 ? ' is' : 's are'} waiting for review. Follow up to get them closed.`
      : 'Set yourself a target for next week and beat it.';

  return (
    <aside className={s.side} aria-label={`${weekName(week)} productivity`}>
      <KpiCard label={`Avg productive hours · ${weekName(week)}`} value={hoursLabel(current.avgProductiveMinutes)} sub={`${hoursLabel(current.totalProductiveMinutes)} total · ${rangeLabel(week.start, week.end)}`} icon={<Timer size={16} />}>
        <Delta now={current.avgProductiveMinutes} before={previous.avgProductiveMinutes} />
      </KpiCard>
      <KpiCard label={`Tickets solved · ${weekName(week)}`} value={String(current.ticketsDone)} sub={`${current.ticketsSubmitted} sent for review`} icon={<Ticket size={16} />}>
        <Delta now={current.ticketsDone} before={previous.ticketsDone} unit="count" />
      </KpiCard>
      <div className={`${s.card} ${s.summary}`}>
        <div className={s.kpiHead} style={{ marginBottom: 8 }}>
          <span className={s.kpiLabel}>Weekly summary</span>
          <span className={s.kpiIcon} aria-hidden="true"><Sparkles size={16} /></span>
        </div>
        <p>{headline}</p>
        <small>{nudge}</small>
      </div>
    </aside>
  );
}

// ── Day popup ────────────────────────────────────────────────────────────────

function DayPopup({
  date, anchor, mode, day, punch, productivity, highlight, correctionAllowed, onCorrection, onClose,
}: {
  date: string;
  anchor: HTMLElement;
  mode: Mode;
  day: MyAttendanceDayV2 | undefined;
  punch: { in: OwnPunchEvidence | null; out: OwnPunchEvidence | null } | undefined;
  productivity: HomeProductivityDay | undefined;
  highlight: ReturnType<typeof productiveDays>;
  correctionAllowed: boolean;
  onCorrection: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ top: 12, left: 12, maxHeight: 400, placement: 'bottom' as 'top' | 'bottom', ready: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      const margin = 12;
      const gap = 10;
      const width = el.offsetWidth;
      const maxHeight = Math.max(220, window.innerHeight - margin * 2);
      const height = Math.min(el.scrollHeight, maxHeight);
      const below = window.innerHeight - rect.bottom - margin - gap;
      const above = rect.top - margin - gap;
      const placement: 'top' | 'bottom' = below >= Math.min(height, 300) || below >= above ? 'bottom' : 'top';
      const desiredTop = placement === 'bottom' ? rect.bottom + gap : rect.top - height - gap;
      const top = Math.max(margin, Math.min(desiredTop, window.innerHeight - height - margin));
      const desiredLeft = rect.left + rect.width / 2 - width / 2;
      const left = Math.max(margin, Math.min(desiredLeft, window.innerWidth - width - margin));

      setPos((current) => {
        const next = { top, left, maxHeight, placement, ready: true };
        return current.top === next.top && current.left === next.left && current.maxHeight === next.maxHeight && current.placement === next.placement && current.ready
          ? current
          : next;
      });
    };

    updatePosition();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updatePosition) : null;
    observer?.observe(el);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchor, mode, date]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const title = new Date(`${date}T12:00:00.000Z`).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const status = day ? presentDay(day) : null;
  const active = hasActivity(productivity);
  const isTop = highlight.top.includes(date);
  const isAbove = highlight.aboveAverage.has(date);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={ref}
      className={s.popup}
      data-placement={pos.placement}
      style={{ top: pos.top, left: pos.left, maxHeight: pos.maxHeight, visibility: pos.ready ? 'visible' : 'hidden' }}
      role="dialog"
      aria-modal="false"
      aria-label={`${title} details`}
    >
      <div className={s.popupHead}>
        <div>
          <div className={s.popupEyebrow}>{mode === 'attendance' ? 'Attendance details' : 'Productivity details'}</div>
          <div className={s.popupTitle}>{title}</div>
          {mode === 'attendance'
            ? status && <div className={s.popupStatus} style={{ color: status.color, background: `color-mix(in srgb, ${status.color} 10%, #FFFFFF)` }}><i style={{ background: status.color }} />{status.label}</div>
            : <div className={s.popupStatus} data-tone={isTop || isAbove ? 'positive' : 'neutral'}>{isTop ? 'One of your top days' : isAbove ? 'Above your daily average' : active ? 'Below your daily average' : 'No ticket activity'}</div>}
        </div>
        <button type="button" className={s.popupClose} onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>

      {mode === 'attendance' ? (
        <>
          <div className={s.punchPair}>
            <div className={s.punchCard}>
              <TinyPunchPhoto large evidenceId={photoId(punch?.in)} label={`Punch in ${formatTime(day?.punchInAt ?? null)}`} />
              <div><span className={s.punchLabel}>Punch in</span><strong>{formatTime(day?.punchInAt ?? null)}</strong></div>
            </div>
            <div className={s.punchCard}>
              <TinyPunchPhoto large evidenceId={photoId(punch?.out)} label={`Punch out ${formatTime(day?.punchOutAt ?? null)}`} />
              <div><span className={s.punchLabel}>Punch out</span><strong>{day?.punchOutAt ? formatTime(day.punchOutAt) : day?.isInProgress ? 'Working' : '—'}</strong></div>
            </div>
          </div>
          <div className={s.stats}>
            <div className={s.stat}><span>Working hours</span><strong>{hoursLabel(day?.presenceMinutes ?? day?.workedMinutes)}</strong></div>
            <div className={s.stat}><span>Break time</span><strong>{hoursLabel(day?.breakMinutes)}</strong></div>
          </div>
          <div className={s.actions}>
            <Link href="/attendance" className={s.primaryAction}>Open full day <ArrowRight size={13} aria-hidden="true" /></Link>
            {correctionAllowed && day?.outcome && (
              <button type="button" className={s.secondaryAction} onClick={onCorrection}><PencilLine size={13} aria-hidden="true" />Request correction</button>
            )}
          </div>
        </>
      ) : (
        <>
          <div className={s.stats}>
            <div className={s.stat}><span>Productive hours</span><strong>{hoursLabel(productivity?.ticketMinutes ?? 0)}</strong></div>
            <div className={s.stat}><span>Working hours</span><strong>{hoursLabel(day?.presenceMinutes ?? day?.workedMinutes)}</strong></div>
            <div className={s.stat}><span>Tickets done</span><strong>{productivity?.ticketsDone ?? 0}</strong></div>
            <div className={s.stat}><span>Sent for review</span><strong>{productivity?.ticketsSubmitted ?? 0}</strong></div>
          </div>
          {isAbove && productivity && (
            <div className={s.why}>
              <p>Why this day was productive</p>
              <ul>
                {productivity.ticketsDone > highlight.averageDone && <li>{productivity.ticketsDone} ticket{productivity.ticketsDone === 1 ? '' : 's'} done, against your usual {highlight.averageDone.toFixed(1)}.</li>}
                {productivity.ticketMinutes > highlight.averageMinutes && <li>{hoursLabel(productivity.ticketMinutes)} on tickets, {hoursLabel(productivity.ticketMinutes - highlight.averageMinutes)} more than your average day.</li>}
                {productivity.ticketsSubmitted > 0 && <li>{productivity.ticketsSubmitted} ticket{productivity.ticketsSubmitted === 1 ? '' : 's'} sent for review.</li>}
              </ul>
            </div>
          )}
          {!isAbove && <SlowerDay day={day} productivity={productivity} averageMinutes={highlight.averageMinutes} />}
          {productivity && productivity.doneTickets.length > 0 && (
            <div className={s.ticketList}>
              {productivity.doneTickets.slice(0, 4).map((t) => (
                <Link key={t.id} href={`/tickets/${t.id}`}><span className={s.ticketId}>{t.ticketId}</span><span>{t.title}</span></Link>
              ))}
              {productivity.doneTickets.length > 4 && <span className={s.prodMeta}>+{productivity.doneTickets.length - 4} more</span>}
            </div>
          )}
          <div className={s.actions}>
            <Link href="/tickets?status=DONE" className={s.secondaryAction}>View my tickets <ArrowRight size={13} aria-hidden="true" /></Link>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}

/** A kind, factual note for days that were not above average. */
function SlowerDay({ day, productivity, averageMinutes }: { day: MyAttendanceDayV2 | undefined; productivity: HomeProductivityDay | undefined; averageMinutes: number }) {
  const outcome = day?.outcome;
  if (outcome === 'WEEKLY_OFF' || outcome === 'HOLIDAY') return <div className={s.whySlow}><p>{outcome === 'HOLIDAY' ? 'Holiday' : 'Weekly off'}: no work expected.</p></div>;
  if (outcome === 'LEAVE' || outcome === 'LWP') return <div className={s.whySlow}><p>You were on leave this day.</p></div>;
  if (day?.isToday) return <div className={s.whySlow}><p>Today is still in progress.</p></div>;
  const minutes = productivity?.ticketMinutes ?? 0;
  const presence = day?.presenceMinutes ?? day?.workedMinutes ?? null;
  const lines: string[] = [];
  if (averageMinutes > 0) lines.push(`${hoursLabel(minutes)} on tickets, ${hoursLabel(Math.max(0, averageMinutes - minutes))} less than your average day.`);
  if (presence != null && presence > 0 && minutes < presence / 2) {
    lines.push(`You were at work for ${hoursLabel(presence)}, but most of it was not logged on a ticket. Reviews, meetings and other untracked work don't count here yet.`);
  }
  if (!day?.punchInAt && !minutes) lines.push('No punch-in or ticket time was recorded.');
  if (lines.length === 0) return null;
  return (
    <div className={s.whySlow}>
      <p>Why this day was slower</p>
      <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul>
    </div>
  );
}
