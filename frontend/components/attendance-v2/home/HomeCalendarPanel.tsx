'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import { workdayApi } from '@/lib/api';
import { shouldRetryTransientQuery, transientQueryRetryDelay, pollWhileHealthy } from '@apex/shared-auth';
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, CalendarCheck, CalendarDays, ChevronDown,
  ChevronLeft, ChevronRight, Flame, Gauge, GitFork, LogIn, LogOut, Minus, PencilLine, Star, Ticket, Timer, UserRound, UsersRound, X,
} from 'lucide-react';
import { getMyAttendanceV2, type MyAttendanceDayV2 } from '../my-attendance-v2-api';
import { getMyPunchEvidence, type OwnPunchEvidence } from '../../attendance/punch-api';
import { getMyLeaveBalance, getUserLeaveBalance, type PersonalLeaveType } from '../../attendance/leave-balance-api';
import { monthLabel, presentDay, formatTime } from '../status-presentation';
import { CorrectionDialog } from '../CorrectionDialog';
import { getHomePersonalHighlights, getHomeProductivity, type HomeProductivityDay } from './home-insights-api';
import { TinyPunchPhoto } from './TinyPunchPhoto';
import {
  addDays, attendanceStreak, attendanceWeek, clockLabel, datesBetween, hoursLabel, monthOf,
  hasActivity, pickWeek, productiveDays, productivityWeek, rangeLabel, shiftMonth,
  type WeekWindow,
} from './home-week';
import s from './home-calendar.module.css';

type Mode = 'attendance' | 'productivity';
type AttendanceScope = 'personal' | 'team';

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
  const normalizedRole = String(role).toUpperCase();
  const isIntern = normalizedRole === 'INTERN';
  const hasPersonalHighlights = ['INTERN', 'EMPLOYEE', 'TEAM_LEAD', 'MANAGER'].includes(normalizedRole);
  const canViewTeamAttendance = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(normalizedRole);
  const [mode, setMode] = useState<Mode>('attendance');
  const [attendanceScope, setAttendanceScope] = useState<AttendanceScope>('personal');
  const [showAttendanceMap, setShowAttendanceMap] = useState(false);
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
  const personalHighlights = useQuery({
    queryKey: ['home-personal-highlights', month],
    queryFn: () => getHomePersonalHighlights(month),
    enabled: hasPersonalHighlights,
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
    <section className={s.panel} aria-label="Attendance">
      <div className={`${s.card} ${s.calendar} ${attendanceScope === 'team' ? s.teamCalendar : ''}`}>
        <header className={s.header}>
          {mode === 'attendance' && canViewTeamAttendance ? (
            <div className={s.titleBranchWrap}>
              <button type="button" className={s.title} onClick={() => setShowAttendanceMap((open) => !open)} aria-haspopup="menu" aria-expanded={showAttendanceMap}>
                Attendance <GitFork size={14} aria-hidden="true" />
              </button>
              {showAttendanceMap && (
                <AttendanceBranchMap
                  selected={attendanceScope}
                  onSelect={(scope) => { setAttendanceScope(scope); setMode('attendance'); setPopup(null); setShowAttendanceMap(false); }}
                  onClose={() => setShowAttendanceMap(false)}
                />
              )}
            </div>
          ) : (
            <h2 className={s.title}>{mode === 'attendance' ? 'Attendance' : 'Productivity'}</h2>
          )}
          {attendanceScope === 'team' && <h3 className={s.teamViewTitle}>My Team</h3>}
          {attendanceScope === 'personal' && <div className={s.toggle} role="group" aria-label="Calendar view">
            <button type="button" aria-pressed={mode === 'attendance'} onClick={() => { setMode('attendance'); setPopup(null); }}>
              <CalendarCheck size={14} aria-hidden="true" /> Attendance
            </button>
            <button type="button" aria-pressed={mode === 'productivity'} onClick={() => { setMode('productivity'); setPopup(null); }}>
              <Gauge size={14} aria-hidden="true" /> Productivity
            </button>
          </div>}
          {attendanceScope === 'personal' && <div className={s.monthControls}>
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
          </div>}
          {attendanceScope === 'team' && <span className={s.liveIndicator}><i />Updates every 15 seconds</span>}
        </header>

        {attendanceScope === 'team' ? (
          <TeamAttendanceTable />
        ) : <div className={mode === 'attendance' ? s.attendanceCalendarLayout : undefined}>
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
        </div>}

        {attendanceScope === 'personal' && mode === 'productivity' && (
          <div className={s.legend} aria-label="Productivity legend">
            <>
              <span><i style={{ background: 'color-mix(in srgb, var(--color-success) 36%, transparent)' }} />Productive day</span>
              <span><i style={{ background: 'color-mix(in srgb, var(--color-danger) 30%, transparent)' }} />Lower-productivity day</span>
              <span>{monthProductivity.isError ? 'Productivity data could not be loaded.' : 'Productive hours = time logged on tickets (breaks excluded).'}</span>
            </>
          </div>
        )}
      </div>

      {attendanceScope === 'personal' && (mode === 'attendance'
        ? <AttendanceSide today={today} week={week} byDate={attendanceByDate} isIntern={isIntern} averageBreakMinutes={personalHighlights.data?.averageBreakMinutes ?? null} showAverageBreak={hasPersonalHighlights} />
        : <ProductivitySide week={week} byDate={productivityByDate} loading={weekProductivity.isLoading} failed={weekProductivity.isError} month={{ start: monthStart, end: monthTo, label: monthLabel(y, m), days: monthProductivity.data, loading: monthProductivity.isLoading, failed: monthProductivity.isError, future: monthStart > today }} />)}

      {attendanceScope === 'personal' && mode === 'attendance' && <LeaveBalanceAnalysis />}

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

type TeamMember = {
  id: string;
  name: string;
  avatar?: string | null;
  photoUrl?: string | null;
  role?: { name?: string } | string | null;
  department?: { name?: string } | null;
  workStatus?: string | null;
  todaySession?: { status?: string; logoutAt?: string | null; breakLogs?: Array<{ breakType?: string; endAt?: string | null }> } | null;
  startTime?: string | null;
  endTime?: string | null;
  hasOpenSession?: boolean;
  onLeaveToday?: boolean;
  leaveType?: string | null;
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '—';
}

function liveStatus(member: TeamMember): { label: string; tone: string } {
  if (member.onLeaveToday) return { label: member.leaveType ? `On leave · ${member.leaveType.toLowerCase()}` : 'On leave', tone: 'leave' };
  const openBreak = member.todaySession?.breakLogs?.find((item) => !item.endAt);
  if (openBreak?.breakType === 'MEETING') return { label: 'In meeting', tone: 'meeting' };
  if (openBreak) return { label: 'On break', tone: 'break' };
  if (member.hasOpenSession && member.workStatus === 'IDLE') return { label: 'Idle', tone: 'idle' };
  if (member.hasOpenSession) return { label: 'Working', tone: 'working' };
  if (member.endTime || member.todaySession?.logoutAt) return { label: 'Day completed', tone: 'complete' };
  return { label: 'Not started', tone: 'offline' };
}

function TeamAttendanceTable() {
  const pageSize = 10;
  const [page, setPage] = useState(0);
  const team = useQuery({
    queryKey: ['workday-team', 'home-attendance'],
    queryFn: () => workdayApi.getTeam() as Promise<TeamMember[]>,
    refetchInterval: pollWhileHealthy(15_000),
    staleTime: 10_000,
    retry: shouldRetryTransientQuery,
    retryDelay: transientQueryRetryDelay,
  });
  const members = team.data ?? [];
  const pageCount = Math.max(1, Math.ceil(members.length / pageSize));
  const pageStart = page * pageSize;
  const visibleMembers = members.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);

  const balances = useQueries({
    queries: visibleMembers.map((member) => ({
      queryKey: ['leave-balance', member.id],
      queryFn: () => getUserLeaveBalance(member.id),
      staleTime: 60_000,
      retry: shouldRetryTransientQuery,
      retryDelay: transientQueryRetryDelay,
    })),
  });

  if (team.isLoading) return <div className={s.teamState}>Loading today’s team attendance…</div>;
  if (team.isError) return <div className={s.teamState}>Team attendance could not be loaded. Refresh to try again.</div>;
  if (!members.length) return <div className={s.teamState}>No active team members are assigned to you.</div>;

  return (
    <div className={s.teamTableWrap}>
      <div className={s.teamTableViewport}>
        <div className={s.teamTable} role="table" aria-label="Today’s team attendance">
          <div className={s.teamTableHeader} role="row">
            <span role="columnheader">Name</span><span role="columnheader">Punch in</span><span role="columnheader">Punch out</span><span role="columnheader">Status</span><span role="columnheader">Leave balance</span>
          </div>
          {visibleMembers.map((member, index) => {
            const status = liveStatus(member);
            const balance = balances[index]?.data;
            const role = typeof member.role === 'string' ? member.role : member.role?.name;
            const photo = member.photoUrl || member.avatar;
            return (
              <div key={member.id} className={s.teamTableRow} role="row">
                <div className={s.teamPerson} role="cell">
                  <span className={s.teamAvatar}>{photo ? <img src={photo} alt="" /> : initials(member.name)}</span>
                  <span><strong>{member.name}</strong><small>{[role?.replace('_', ' '), member.department?.name].filter(Boolean).join(' · ')}</small></span>
                </div>
                <span className={s.teamTime} role="cell"><LogIn size={15} />{formatTime(member.startTime ?? null)}</span>
                <span className={s.teamTime} role="cell"><LogOut size={15} />{formatTime(member.endTime ?? member.todaySession?.logoutAt ?? null)}</span>
                <span role="cell"><i className={s.teamStatus} data-tone={status.tone}>{status.label}</i></span>
                <span className={s.teamLeave} role="cell">
                  {balance ? <><strong>{balance.balance}</strong><small> left · {balance.approved} used / {balance.allocation} allocated</small></> : balances[index]?.isError ? <small>Unavailable</small> : <small>Loading…</small>}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <nav className={s.teamPagination} aria-label="Team attendance pages">
        <span>Showing {pageStart + 1}–{Math.min(pageStart + pageSize, members.length)} of {members.length}</span>
        <div>
          <button type="button" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0} aria-label="Previous 10 team members"><ChevronLeft size={15} />Previous</button>
          <span>Page {page + 1} of {pageCount}</span>
          <button type="button" onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={page >= pageCount - 1} aria-label="Next 10 team members">Next<ChevronRight size={15} /></button>
        </div>
      </nav>
      </div>
  );
}

function AttendanceBranchMap({ selected, onSelect, onClose }: { selected: AttendanceScope; onSelect: (scope: AttendanceScope) => void; onClose: () => void }) {
  const mapRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const closeOnKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    const closeOutside = (event: MouseEvent) => {
      if (mapRef.current && !mapRef.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener('keydown', closeOnKey);
    window.addEventListener('mousedown', closeOutside);
    return () => {
      window.removeEventListener('keydown', closeOnKey);
      window.removeEventListener('mousedown', closeOutside);
    };
  }, [onClose]);

  return (
    <section ref={mapRef} className={s.branchMap} role="menu" aria-label="Attendance views">
      <div className={s.branchRoot}><CalendarCheck size={15} />Attendance</div>
      <div className={s.branchStem} aria-hidden="true" />
      <div className={s.branchChoices}>
        <button type="button" role="menuitemradio" aria-checked={selected === 'personal'} data-selected={selected === 'personal'} onClick={() => onSelect('personal')}><UserRound size={18} /><span><strong>My Attendance</strong><small>Your calendar and punches</small></span></button>
        <button type="button" role="menuitemradio" aria-checked={selected === 'team'} data-selected={selected === 'team'} onClick={() => onSelect('team')}><UsersRound size={18} /><span><strong>My Team</strong><small>Today’s live team status</small></span></button>
      </div>
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
            const active = hasActivity(p);
            const isTop = highlight.top.includes(date);
            if (isTop) cls.push(s.topDay);
            else if (highlight.aboveAverage.has(date)) cls.push(s.productive);
            else if (highlight.belowAverage.has(date)) cls.push(s.lessProductive);
            const tickets = (p?.ticketsDone ?? 0) + (p?.ticketsSubmitted ?? 0);
            return (
              <button key={date} type="button" className={cls.join(' ')} onClick={(e) => onOpen(date, e.currentTarget)}
                aria-label={`${date}: ${hoursLabel(p?.ticketMinutes ?? 0)} productive${isTop ? ', top day' : ''}`}>
                <div className={s.dayTop}>
                  <span className={s.dayNumber}>{dayNum}</span>
                  {isTop && <span className={s.topBadge}><Star size={10} style={{ display: 'inline', verticalAlign: '-1px' }} aria-hidden="true" /> Top</span>}
                </div>
                {active && <span className={s.prodHours}>{hoursLabel(p?.ticketMinutes ?? 0)}</span>}
                {active && tickets > 0 && <span className={s.prodMeta}>{p?.ticketsDone ?? 0} solved · {p?.ticketsSubmitted ?? 0} sent</span>}
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

function AttendanceKpiScore({ current, streak, averageBreakMinutes, showAverageBreak }: { current: ReturnType<typeof attendanceWeek>; streak: number; averageBreakMinutes: number | null; showAverageBreak: boolean }) {
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
        {showAverageBreak && <KpiScoreMetric label="Avg break time" value={hoursLabel(averageBreakMinutes)} icon={<Timer size={15} />} detail="Selected month · meetings excluded" />}
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
  // Phase 3: 10 Casual + 4 Sick from the versioned policy, for interns too.
  const sick = useQuery({
    queryKey: ['my-leave-balance', 'SICK', 'role-policy-v2'],
    queryFn: () => getMyLeaveBalance('SICK' as PersonalLeaveType),
    staleTime: 300_000,
    retry: shouldRetryTransientQuery,
    retryDelay: transientQueryRetryDelay,
    refetchOnMount: 'always',
  });
  void isIntern;
  void compactIntern;

  const entries = [
    { key: 'casual', label: 'Casual Leave', query: casual, tone: 'blue' as const },
    { key: 'sick', label: 'Sick Leave', query: sick, tone: 'amber' as const },
  ];

  return (
    <section className={`${s.card} ${s.leaveAnalysis}`} aria-label="Leave usage and allocation analysis">
      <header className={s.leaveAnalysisHeader}>
        <span className={s.leaveAnalysisIcon} aria-hidden="true"><CalendarDays size={19} /></span>
        <div>
          <h2>Leave Usage &amp; Allocation Analysis</h2>
        </div>
        <span className={s.leavePeriod}>Current year · {new Date().getFullYear()}</span>
      </header>
      <div className={s.leaveAnalysisGrid}>
        {entries.map((entry) => {
          if (entry.query.isLoading) return <div key={entry.key} className={s.leaveAnalysisState}>Loading {entry.label.toLowerCase()}…</div>;
          if (entry.query.isError || !entry.query.data) return <div key={entry.key} className={s.leaveAnalysisState}>{entry.label} balance is unavailable.</div>;
          const data = entry.query.data;
          // Phase 3: no applicable leave policy yet. Said plainly; never an invented number.
          if (data.allocation === null || data.balance === null) return <div key={entry.key} className={s.leaveAnalysisState}>{entry.label}: leave setup is pending with HR.</div>;
          return <LeaveAnalysisCard key={entry.key} label={entry.label} tone={entry.tone} balance={{ ...data, allocation: data.allocation, balance: data.balance }} />;
        })}
      </div>
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
        <div><h3>{label} Analysis</h3></div>
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

function AttendanceSide({ today, week, byDate, isIntern, averageBreakMinutes, showAverageBreak }: { today: string; week: WeekWindow; byDate: Map<string, MyAttendanceDayV2>; isIntern: boolean; averageBreakMinutes: number | null; showAverageBreak: boolean }) {
  const current = attendanceWeek(week.start, week.end, byDate);
  const earliest = Array.from(byDate.keys()).sort()[0] ?? today;
  const streak = attendanceStreak(today, byDate, earliest);

  return (
    <aside className={s.side} aria-label={`${weekName(week)} attendance`}>
      <AttendanceKpiScore current={current} streak={streak} averageBreakMinutes={averageBreakMinutes} showAverageBreak={showAverageBreak} />
    </aside>
  );
}

/** The calendar's selected month, so "Created vs Solved" follows the month filter. */
interface SelectedMonthProductivity {
  start: string;
  end: string;
  label: string;
  days: HomeProductivityDay[] | undefined;
  loading: boolean;
  failed: boolean;
  future: boolean;
}

function ProductivitySide({ week, byDate, loading, failed, month }: { week: WeekWindow; byDate: Map<string, HomeProductivityDay>; loading: boolean; failed: boolean; month: SelectedMonthProductivity }) {
  if (loading) return <aside className={s.side}><div className={`${s.card} ${s.kpi}`}><span className={s.kpiSub}>Loading productivity…</span></div></aside>;
  if (failed) return <aside className={s.side}><div className={`${s.card} ${s.kpi}`}><span className={s.kpiSub}>Productivity could not be loaded. Refresh to try again.</span></div></aside>;

  const current = productivityWeek(week.start, week.end, byDate);
  const previous = productivityWeek(week.previousStart, week.previousEnd, byDate);
  const monthByDate = new Map((month.days ?? []).map((day) => [day.date, day] as const));
  const monthTotals = productivityWeek(month.start, month.end, monthByDate);
  const chartMax = Math.max(1, monthTotals.ticketsCreated, monthTotals.ticketsDone);

  return (
    <aside className={s.side} aria-label={`${weekName(week)} productivity`}>
      <KpiCard label={`Avg productive hours · ${weekName(week)}`} value={hoursLabel(current.avgProductiveMinutes)} sub={`${hoursLabel(current.totalProductiveMinutes)} total · ${rangeLabel(week.start, week.end)}`} icon={<Timer size={16} />}>
        <Delta now={current.avgProductiveMinutes} before={previous.avgProductiveMinutes} />
      </KpiCard>
      <KpiCard label={`Tickets solved · ${weekName(week)}`} value={String(current.ticketsDone)} sub={`${current.ticketsSubmitted} sent for review`} icon={<Ticket size={16} />}>
        <Delta now={current.ticketsDone} before={previous.ticketsDone} unit="count" />
      </KpiCard>
      <div className={`${s.card} ${s.ticketChart}`}>
        <div className={s.kpiHead} style={{ marginBottom: 8 }}>
          <span className={s.kpiLabel}>Tickets Created vs Solved</span>
          <span className={s.kpiIcon} aria-hidden="true"><Ticket size={16} /></span>
        </div>
        {month.future ? (
          <small className={s.ticketChartCaption}>{month.label} has not started yet.</small>
        ) : month.loading ? (
          <small className={s.ticketChartCaption}>Loading {month.label}…</small>
        ) : month.failed ? (
          <small className={s.ticketChartCaption}>Ticket counts for {month.label} could not be loaded.</small>
        ) : (
          <>
            <div className={s.ticketChartPlot} role="img" aria-label={`${monthTotals.ticketsCreated} tickets created and ${monthTotals.ticketsDone} tickets solved in ${month.label}`}>
              <div><span>Created</span><i><b style={{ width: `${monthTotals.ticketsCreated / chartMax * 100}%` }} /></i><strong>{monthTotals.ticketsCreated}</strong></div>
              <div><span>Solved</span><i><b style={{ width: `${monthTotals.ticketsDone / chartMax * 100}%` }} /></i><strong>{monthTotals.ticketsDone}</strong></div>
            </div>
            <small className={s.ticketChartCaption}>{month.label} · {rangeLabel(month.start, month.end)}</small>
          </>
        )}
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
