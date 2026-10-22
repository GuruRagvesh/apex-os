'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import { workdayApi } from '@/lib/api';
import { shouldRetryTransientQuery, transientQueryRetryDelay, pollWhileHealthy } from '@apex/shared-auth';
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, CalendarCheck, CalendarDays, ChevronDown,
  ChevronLeft, ChevronRight, Gauge, GitFork, LogIn, LogOut, Minus, PencilLine, Star, Ticket, Timer, UserRound, UsersRound, X,
} from 'lucide-react';
import { getMyAttendanceV2, type MyAttendanceDayV2 } from '../my-attendance-v2-api';
import { getMyPunchEvidence, type OwnPunchEvidence } from '../../attendance/punch-api';
import { getMyLeaveBalance, getUserLeaveBalance, LEAVE_TYPE_LABEL, type PersonalLeaveType } from '../../attendance/leave-balance-api';
import { compOffApi, leaveApi } from '@apex/workforce-leave/api';
import { monthLabel, presentDay, formatTime } from '../status-presentation';
import { CorrectionDialog } from '../CorrectionDialog';
import { getHomePersonalHighlights, getHomeProductivity, type HomeProductivityDay } from './home-insights-api';
import { TinyPunchPhoto } from './TinyPunchPhoto';
import {
  addDays, attendanceWeek, clockLabel, datesBetween, hoursLabel, monthOf,
  hasActivity, pickWeek, productiveDays, productivityWeek, rangeLabel, shiftMonth,
  type WeekWindow,
} from './home-week';
import s from './home-calendar.module.css';

type Mode = 'attendance' | 'productivity';
type AttendanceScope = 'personal' | 'team';
type AttendanceKpiFilter = 'Total late marks' | 'Total present days' | 'Less working hours';

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
type AttendanceFilter = typeof ATTENDANCE_LEGEND[number]['label'] | AttendanceKpiFilter;

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

export function HomeCalendarPanel({ onAttendanceScopeChange }: { onAttendanceScopeChange?: (scope: AttendanceScope) => void } = {}) {
  const today = localToday();
  const userId = useAuthStore((state) => state.user?.id ?? '');
  const role = useAuthStore((state) => (state.user?.role as any)?.name ?? state.user?.role ?? '');
  const normalizedRole = String(role).toUpperCase();
  const isIntern = normalizedRole === 'INTERN';
  const hasPersonalHighlights = ['INTERN', 'EMPLOYEE', 'TEAM_LEAD', 'MANAGER'].includes(normalizedRole);
  const canViewTeamAttendance = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(normalizedRole);
  const [mode, setMode] = useState<Mode>('attendance');
  const [attendanceScope, setAttendanceScope] = useState<AttendanceScope>('personal');
  const [showAttendanceMap, setShowAttendanceMap] = useState(false);
  const [attendanceFilter, setAttendanceFilter] = useState<AttendanceFilter | null>(null);
  const [month, setMonth] = useState(() => monthOf(today));
  const [teamDate, setTeamDate] = useState(today);
  const [teamDatePickerOpen, setTeamDatePickerOpen] = useState(false);
  const [popup, setPopup] = useState<{ date: string; anchor: HTMLElement } | null>(null);
  const [correctionDate, setCorrectionDate] = useState<string | null>(null);
  const [leaveAnalysisOpen, setLeaveAnalysisOpen] = useState(false);
  const [leaveRange, setLeaveRange] = useState<{ startDate: string; endDate: string } | null>(null);
  const calendarCardRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const compOffCredits = useQuery({
    queryKey: ['comp-off-mine'],
    queryFn: () => compOffApi.mine() as Promise<any[]>,
    staleTime: 60_000,
    retry: false,
  });

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

  const latestCalendarMonth = shiftMonth(monthOf(today), 12);
  const canGoNext = month < latestCalendarMonth;
  const [y, m] = month.split('-').map(Number);

  const openDay = (date: string, anchor: HTMLElement) => setPopup({ date, anchor });
  const selectLeaveRangeDate = (date: string, anchor: HTMLElement) => {
    setLeaveRange((current) => {
      if (!current || current.startDate !== current.endDate) return { startDate: date, endDate: date };
      return date < current.startDate
        ? { startDate: date, endDate: current.startDate }
        : { startDate: current.startDate, endDate: date };
    });
    setPopup({ date, anchor });
  };
  const selectTeamDate = (value: string) => {
    if (value && value <= today && value !== teamDate) setTeamDate(value);
    setTeamDatePickerOpen(false);
  };
  const selectAttendanceKpi = (filter: AttendanceKpiFilter) => {
    const selecting = attendanceFilter !== filter;
    setAttendanceFilter(selecting ? filter : null);
    setPopup(null);
    if (selecting) requestAnimationFrame(() => calendarCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <section className={s.panel} aria-label="Attendance">
      <div ref={calendarCardRef} className={`${s.card} ${s.calendar} ${attendanceScope === 'team' ? s.teamCalendar : ''}`}>
        <header className={s.header}>
          {mode === 'attendance' && canViewTeamAttendance ? (
            <div className={s.titleBranchWrap}>
              <button type="button" className={s.title} onClick={() => setShowAttendanceMap((open) => !open)} aria-haspopup="menu" aria-expanded={showAttendanceMap}>
                Attendance <GitFork size={14} aria-hidden="true" />
              </button>
              {showAttendanceMap && (
                <AttendanceBranchMap
                  selected={attendanceScope}
                  onSelect={(scope) => { setAttendanceScope(scope); onAttendanceScopeChange?.(scope); setMode('attendance'); setPopup(null); setShowAttendanceMap(false); }}
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
            <MonthPickerControl selected={month} today={today} maxMonth={latestCalendarMonth} onSelect={(value) => { setMonth(value); setPopup(null); }} />
            <button type="button" onClick={() => { setMonth(shiftMonth(month, 1)); setPopup(null); }} disabled={!canGoNext} aria-label="Next month"><ChevronRight size={16} /></button>
          </div>}
          {attendanceScope === 'team' && <div className={s.teamDateControls}>
            <div className={s.teamDatePickerWrap} onMouseDown={(event) => event.stopPropagation()}>
              <button
                type="button"
                className={s.teamDatePicker}
                onClick={() => setTeamDatePickerOpen((open) => !open)}
                aria-label="Open team attendance date filter"
                aria-haspopup="dialog"
                aria-expanded={teamDatePickerOpen}
              >
                <CalendarDays size={14} aria-hidden="true" />
                <span>{teamDate === today ? 'Today' : new Date(`${teamDate}T12:00:00.000Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</span>
                <ChevronDown size={14} aria-hidden="true" />
              </button>
              {teamDatePickerOpen && <TeamDatePicker selected={teamDate} today={today} onSelect={selectTeamDate} onClose={() => setTeamDatePickerOpen(false)} />}
            </div>
            {teamDate === today
              ? <span className={s.liveIndicator}><i />Live · updates every 15 seconds</span>
              : <span className={s.historyIndicator}>Saved daily record</span>}
          </div>}
        </header>

        {attendanceScope === 'team' ? (
          <TeamAttendanceTable date={teamDate} today={today} />
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
                leaveRange={leaveRange}
                onSelectLeaveRange={selectLeaveRangeDate}
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
        ? <AttendanceSide week={week} monthLabel={monthLabel(y, m)} monthDays={monthQuery?.data?.month.days ?? []} monthLoading={!!monthQuery?.isLoading} monthFailed={!!monthQuery?.isError} byDate={attendanceByDate} averageBreakMinutes={personalHighlights.data?.averageBreakMinutes ?? null} showAverageBreak={hasPersonalHighlights} selectedMetric={attendanceFilter} onSelectMetric={selectAttendanceKpi} onOpenLeaveAnalysis={() => setLeaveAnalysisOpen(true)} />
        : <ProductivitySide week={week} byDate={productivityByDate} loading={weekProductivity.isLoading} failed={weekProductivity.isError} month={{ start: monthStart, end: monthTo, label: monthLabel(y, m), days: monthProductivity.data, loading: monthProductivity.isLoading, failed: monthProductivity.isError, future: monthStart > today }} />)}

      {leaveAnalysisOpen && <PersonalLeaveUsageModal userId={userId} today={today} isIntern={isIntern} onClose={() => setLeaveAnalysisOpen(false)} />}

      {popup && (
        <DayPopup
          date={popup.date}
          anchor={popup.anchor}
          mode={mode}
          day={attendanceByDate.get(popup.date)}
          punch={punches.get(popup.date)}
          productivity={productivityByDate.get(popup.date)}
          highlight={highlight}
          correctionAllowed={popup.date < today || (popup.date === today && correctionAllowed)}
          leaveRange={leaveRange}
          availableCompOff={Array.isArray(compOffCredits.data) ? compOffCredits.data.length : 0}
          onCorrection={() => { setCorrectionDate(popup.date); setPopup(null); }}
          onApplyLeave={(type) => {
            const range = leaveRange && popup.date >= leaveRange.startDate && popup.date <= leaveRange.endDate
              ? leaveRange
              : { startDate: popup.date, endDate: popup.date };
            const params = new URLSearchParams({
              apply: 'true',
              startDate: range.startDate,
              endDate: range.endDate,
            });
            if (type) params.set('type', type);
            setPopup(null);
            router.push(`/leave?${params.toString()}`);
          }}
          onClose={() => setPopup(null)}
        />
      )}
      {correctionDate && (correctionDate < today || (correctionDate === today && correctionAllowed)) && <CorrectionDialog date={correctionDate} onClose={() => setCorrectionDate(null)} />}
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
  breakCount?: number;
  breakMinutes?: number;
  breakMinutesToday?: number;
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

function TeamAttendanceTable({ date, today }: { date: string; today: string }) {
  const isToday = date === today;
  const team = useQuery({
    queryKey: ['workday-team', 'home-attendance', date],
    queryFn: () => workdayApi.getTeam(date) as Promise<TeamMember[]>,
    refetchInterval: isToday ? pollWhileHealthy(15_000) : false,
    staleTime: isToday ? 10_000 : 5 * 60_000,
    retry: shouldRetryTransientQuery,
    retryDelay: transientQueryRetryDelay,
  });
  const members = team.data ?? [];

  if (team.isLoading) return <div className={s.teamState}>Loading team attendance for {isToday ? 'today' : date}…</div>;
  if (team.isError) return <div className={s.teamState}>Team attendance could not be loaded. Refresh to try again.</div>;
  if (!members.length) return <div className={s.teamState}>No active team members are assigned to you.</div>;

  return (
    <div className={s.teamTableWrap}>
      <div className={s.teamTableViewport}>
        <div className={s.teamTable} role="table" aria-label={`${isToday ? 'Today’s live' : date} team attendance`}>
          <div className={`${s.teamTableHeader} ${isToday ? s.teamTableLiveColumns : s.teamTablePastColumns}`} role="row">
            <span role="columnheader">Name</span><span role="columnheader">Punch in</span><span role="columnheader">Punch out</span><span role="columnheader">No. of breaks</span><span role="columnheader">Total break time</span>{isToday && <span role="columnheader">Current status</span>}<span role="columnheader">Leave balance</span>
          </div>
          {members.map((member) => {
            const status = liveStatus(member);
            const role = typeof member.role === 'string' ? member.role : member.role?.name;
            const photo = member.photoUrl || member.avatar;
            return (
              <div key={member.id} className={`${s.teamTableRow} ${isToday ? s.teamTableLiveColumns : s.teamTablePastColumns}`} role="row">
                <div className={s.teamPerson} role="cell">
                  <span className={s.teamAvatar}>{photo ? <img src={photo} alt="" /> : initials(member.name)}</span>
                  <span><strong>{member.name}</strong><small>{[role?.replace('_', ' '), member.department?.name].filter(Boolean).join(' · ')}</small></span>
                </div>
                <span className={s.teamTime} role="cell"><LogIn size={15} />{formatTime(member.startTime ?? null)}</span>
                <span className={s.teamTime} role="cell"><LogOut size={15} />{formatTime(member.endTime ?? member.todaySession?.logoutAt ?? null)}</span>
                <span className={s.teamBreakCount} role="cell">{member.breakCount ?? 0}</span>
                <span className={s.teamBreakTime} role="cell"><Timer size={15} />{hoursLabel(member.breakMinutes ?? member.breakMinutesToday ?? 0)}</span>
                {isToday && <span role="cell"><i className={s.teamStatus} data-tone={status.tone}>{status.label}</i></span>}
                <TeamLeaveBalanceCell memberId={member.id} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TeamLeaveBalanceCell({ memberId }: { memberId: string }) {
  const cellRef = useRef<HTMLSpanElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const element = cellRef.current;
    if (!element || shouldLoad) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setShouldLoad(true);
        observer.disconnect();
      }
    }, { rootMargin: '140px 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [shouldLoad]);

  const balance = useQuery({
    queryKey: ['leave-balance', memberId],
    queryFn: () => getUserLeaveBalance(memberId),
    enabled: shouldLoad,
    staleTime: 60_000,
    retry: shouldRetryTransientQuery,
    retryDelay: transientQueryRetryDelay,
  });

  return <span ref={cellRef} className={s.teamLeave} role="cell">
    {balance.data ? <><strong>{balance.data.balance}</strong><small> left · {balance.data.approved} used / {balance.data.allocation} allocated</small></>
      : balance.isError ? <small>Unavailable</small>
        : <small>{shouldLoad ? 'Loading…' : 'Scroll to load'}</small>}
  </span>;
}

function TeamDatePicker({ selected, today, onSelect, onClose }: { selected: string; today: string; onSelect: (date: string) => void; onClose: () => void }) {
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const [visibleMonth, setVisibleMonth] = useState(() => monthOf(selected));
  const [year, monthNumber] = visibleMonth.split('-').map(Number);
  const firstWeekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const currentMonth = monthOf(today);

  useEffect(() => {
    const closeOnKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    const closeOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener('keydown', closeOnKey);
    window.addEventListener('mousedown', closeOutside);
    return () => {
      window.removeEventListener('keydown', closeOnKey);
      window.removeEventListener('mousedown', closeOutside);
    };
  }, [onClose]);

  return (
    <div ref={pickerRef} className={s.teamDatePopover} role="dialog" aria-label="Choose team attendance date">
      <div className={s.teamDatePopoverHeader}>
        <button type="button" onClick={() => setVisibleMonth(shiftMonth(visibleMonth, -1))} aria-label="Previous month"><ChevronLeft size={15} /></button>
        <strong>{monthLabel(year, monthNumber)}</strong>
        <button type="button" onClick={() => setVisibleMonth(shiftMonth(visibleMonth, 1))} disabled={visibleMonth >= currentMonth} aria-label="Next month"><ChevronRight size={15} /></button>
      </div>
      <div className={s.teamDateWeekdays} aria-hidden="true">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className={s.teamDateDays}>
        {Array.from({ length: firstWeekday }, (_, index) => <span key={`blank-${index}`} />)}
        {Array.from({ length: lastDay }, (_, index) => {
          const day = index + 1;
          const date = `${visibleMonth}-${String(day).padStart(2, '0')}`;
          const disabled = date > today;
          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelect(date)}
              disabled={disabled}
              aria-label={`Show team attendance for ${date}`}
              aria-pressed={date === selected}
              data-today={date === today}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MonthPickerControl({ selected, today, maxMonth, onSelect }: { selected: string; today: string; maxMonth: string; onSelect: (month: string) => void }) {
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [visibleYear, setVisibleYear] = useState(() => Number(selected.slice(0, 4)));
  const currentMonth = monthOf(today);
  const maxYear = Number(maxMonth.slice(0, 4));
  const selectedNumber = Number(selected.slice(5, 7));
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  useEffect(() => {
    if (open) setVisibleYear(Number(selected.slice(0, 4)));
  }, [open, selected]);

  useEffect(() => {
    if (!open) return;
    const closeOnKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    const closeOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', closeOnKey);
    window.addEventListener('mousedown', closeOutside);
    return () => {
      window.removeEventListener('keydown', closeOnKey);
      window.removeEventListener('mousedown', closeOutside);
    };
  }, [open]);

  return (
    <div ref={pickerRef} className={s.monthPickerWrap}>
      <button
        type="button"
        className={s.monthPicker}
        onClick={() => setOpen((value) => !value)}
        aria-label="Choose attendance month"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <CalendarDays size={14} aria-hidden="true" />
        <span>{monthLabel(Number(selected.slice(0, 4)), selectedNumber)}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && <div className={s.monthPickerPopover} role="dialog" aria-label="Choose month">
        <div className={s.monthPickerPopoverHead}>
          <button type="button" onClick={() => setVisibleYear((year) => year - 1)} aria-label="Previous year"><ChevronLeft size={15} /></button>
          <strong>{visibleYear}</strong>
          <button type="button" onClick={() => setVisibleYear((year) => year + 1)} disabled={visibleYear >= maxYear} aria-label="Next year"><ChevronRight size={15} /></button>
        </div>
        <div className={s.monthPickerGrid}>
          {monthNames.map((name, index) => {
            const value = `${visibleYear}-${String(index + 1).padStart(2, '0')}`;
            return <button
              key={value}
              type="button"
              disabled={value > maxMonth}
              aria-pressed={value === selected}
              data-current={value === currentMonth}
              onClick={() => { onSelect(value); setOpen(false); }}
            >{name.slice(0, 3)}</button>;
          })}
        </div>
      </div>}
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
  leaveRange, onSelectLeaveRange,
}: {
  month: string;
  today: string;
  mode: Mode;
  attendanceFilter: AttendanceFilter | null;
  selected: string | null;
  attendanceByDate: Map<string, MyAttendanceDayV2>;
  punches: Map<string, { in: OwnPunchEvidence | null; out: OwnPunchEvidence | null }>;
  productivityByDate: Map<string, HomeProductivityDay>;
  highlight: ReturnType<typeof productiveDays>;
  onOpen: (date: string, el: HTMLElement) => void;
  leaveRange: { startDate: string; endDate: string } | null;
  onSelectLeaveRange: (date: string, el: HTMLElement) => void;
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
          if (!inMonth || (future && mode === 'productivity')) {
            return (
              <div key={date} className={`${s.day} ${s.muted} ${attendanceFilter ? s.dimmedDay : ''}`} aria-hidden={!inMonth}>
                <div className={s.dayTop}><span className={s.dayNumber}>{inMonth ? dayNum : ''}</span></div>
              </div>
            );
          }
          const inLeaveRange = !!leaveRange && date >= leaveRange.startDate && date <= leaveRange.endDate;
          const cls = [s.day, date === today ? s.today : '', selected === date ? s.selected : '', inLeaveRange ? s.leaveSelectedDay : ''];
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
          const displayOutcome = day?.outcome ?? (day?.calendar?.status !== 'WORKING' ? day?.calendar?.status ?? null : null);
          const status = day && displayOutcome ? presentDay({ ...day, outcome: displayOutcome }) : null;
          const matchesFilter = !!attendanceFilter && !!day && matchesHomeAttendanceFilter(day, attendanceFilter);
          if (attendanceFilter && !matchesFilter) cls.push(s.dimmedDay);
          if (matchesFilter) cls.push(s.highlightedDay);
          return (
            <button key={date} type="button" className={cls.join(' ')}
              data-status={status?.label}
              style={{
                '--day-tint': displayOutcome && status ? status.tint : undefined,
                '--day-status': displayOutcome && status ? status.color : undefined,
              } as CSSProperties}
              onClick={(e) => onOpen(date, e.currentTarget)}
              onContextMenu={future ? (event) => { event.preventDefault(); onSelectLeaveRange(date, event.currentTarget); } : undefined}
              aria-label={`${date}: ${status?.label ?? (future ? 'future working day, apply leave available' : 'no attendance result')}`}>
              <div className={s.dayTop}>
                <span className={s.dayNumber}>{dayNum}</span>
                {status && displayOutcome && <span className={s.statusDot} style={{ background: status.color }} title={day?.calendar?.holidayName ?? status.label} />}
              </div>
              {displayOutcome && ['WEEKLY_OFF', 'HOLIDAY'].includes(displayOutcome) && (
                <span className={s.plannedDayLabel}>{day?.calendar?.holidayName ?? status?.label}</span>
              )}
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

function matchesHomeAttendanceFilter(day: MyAttendanceDayV2, filter: AttendanceFilter): boolean {
  // Calendar policy exists before an attendance result does. Fixed weekly offs
  // and published holidays must therefore participate in the filter even on a
  // future date (where outcome correctly remains null).
  const effectiveOutcome = day.outcome ?? (day.calendar?.status !== 'WORKING' ? day.calendar?.status ?? null : null);
  const lateOrShort = day.modifiers.some((value) => ['LATE', 'LATE_EXEMPTED', 'INSUFFICIENT_PRESENCE', 'INSUFFICIENT_EFFECTIVE_WORK'].includes(value));
  if (filter === 'Total late marks') return day.modifiers.includes('LATE');
  if (filter === 'Total present days') return effectiveOutcome === 'PRESENT';
  if (filter === 'Less working hours') return day.modifiers.includes('INSUFFICIENT_EFFECTIVE_WORK')
    || (day.workedMinutes !== null && day.requiredMinutes !== null && day.workedMinutes < day.requiredMinutes);
  if (filter === 'Needs review') return day.evaluationState === 'NEEDS_REVIEW' || effectiveOutcome === 'UNRESOLVED';
  if (filter === 'Late / Short hours') return lateOrShort;
  if (filter === 'Regularized') return day.modifiers.includes('REGULARIZED');
  if (filter === 'Present') return effectiveOutcome === 'PRESENT' && !lateOrShort && !day.modifiers.includes('REGULARIZED');
  if (filter === 'Absent / leave') return ['ABSENT', 'LEAVE', 'LWP'].includes(effectiveOutcome ?? '');
  if (filter === 'Half day') return effectiveOutcome === 'HALF_DAY';
  if (filter === 'Holiday') return effectiveOutcome === 'HOLIDAY';
  if (filter === 'Weekly off') return effectiveOutcome === 'WEEKLY_OFF';
  return false;
}

type PersonalLeaveRecord = {
  id: string;
  type: string;
  startDate: string;
  endDate: string;
  status: string;
  isHalfDay?: boolean;
  duration?: number | null;
};

const LEAVE_TYPE_NAMES: Record<string, string> = {
  ...LEAVE_TYPE_LABEL,
  ANNUAL: 'Annual Leave',
  SICK: 'Sick Leave',
  COMP_OFF: 'Comp Off',
  UNPAID: 'Unpaid Leave',
  OTHER: 'Other Leave',
};

const LEAVE_TYPE_COLORS: Record<string, string> = {
  CASUAL: '#2563eb',
  EMERGENCY: '#f59e0b',
  ANNUAL: '#7c3aed',
  SICK: '#ec4899',
  COMP_OFF: '#0d9488',
  UNPAID: '#64748b',
  OTHER: '#4f46e5',
};

function leaveRecordDays(record: PersonalLeaveRecord): number {
  const duration = record.duration == null ? null : Number(record.duration);
  if (duration !== null && Number.isFinite(duration) && duration > 0) return duration;
  if (record.isHalfDay) return 0.5;
  const start = new Date(record.startDate).getTime();
  const end = new Date(record.endDate).getTime();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(1, Math.floor((end - start) / 86_400_000) + 1) : 0;
}

function leaveDateLabel(startDate: string, endDate: string): string {
  const format = (value: string) => new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const start = format(startDate);
  const end = format(endDate);
  return start === end ? start : `${start} – ${end}`;
}

function PersonalLeaveUsageModal({ userId, today, isIntern, onClose }: { userId: string; today: string; isIntern: boolean; onClose: () => void }) {
  const [expanded, setExpanded] = useState<'used' | 'pending' | null>(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);
  const balanceTypes: PersonalLeaveType[] = isIntern ? ['CASUAL'] : ['CASUAL', 'SICK'];
  const balances = useQueries({
    queries: balanceTypes.map((type) => ({
      queryKey: ['my-leave-balance', type],
      queryFn: () => getMyLeaveBalance(type),
      staleTime: 300_000,
      retry: shouldRetryTransientQuery,
      retryDelay: transientQueryRetryDelay,
    })),
  });
  const records = useQuery({
    queryKey: ['my-leave-records-summary', userId],
    queryFn: () => leaveApi.getAll({ userId, page: 1, limit: 200 }) as Promise<any>,
    enabled: !!userId,
    staleTime: 300_000,
    retry: shouldRetryTransientQuery,
    retryDelay: transientQueryRetryDelay,
  });

  const [todayYear, todayMonth] = today.split('-').map(Number);
  const leaveYearStart = todayMonth >= 4 ? todayYear : todayYear - 1;
  const periodStart = `${leaveYearStart}-04-01`;
  const periodEnd = `${leaveYearStart + 1}-03-31`;
  const allRecords = (Array.isArray(records.data) ? records.data : records.data?.items ?? []) as PersonalLeaveRecord[];
  const approvedRecords = allRecords
    .filter((record) => record.status === 'APPROVED' && record.startDate.slice(0, 10) <= periodEnd && record.endDate.slice(0, 10) >= periodStart)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  const pendingRecords = allRecords
    .filter((record) => record.status === 'PENDING' && record.startDate.slice(0, 10) <= periodEnd && record.endDate.slice(0, 10) >= periodStart)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  const validBalances = balances.map((query, index) => ({ type: balanceTypes[index], data: query.data })).filter((entry) => entry.data);
  const allocated = validBalances.reduce((sum, entry) => sum + (entry.data?.allocation ?? 0), 0);
  const used = validBalances.reduce((sum, entry) => sum + (entry.data?.approved ?? 0), 0);
  const remaining = validBalances.reduce((sum, entry) => sum + (entry.data?.balance ?? 0), 0);
  const pending = validBalances.reduce((sum, entry) => sum + (entry.data?.pending ?? 0), 0);
  const loading = records.isLoading || balances.some((query) => query.isLoading);
  const unavailable = records.isError || balances.some((query) => query.isError);

  if (typeof document === 'undefined') return null;
  const detailRecords = expanded === 'used' ? approvedRecords : pendingRecords;
  const detailTitle = expanded === 'used' ? 'Used leave dates' : 'Leaves awaiting approval';
  const emptyText = expanded === 'used'
    ? 'No approved leave dates are recorded for this leave year.'
    : 'No leave requests are currently awaiting approval.';

  return createPortal(
    <div className={s.leaveAnalysisModalBackdrop} onMouseDown={onClose}>
      <section className={s.leaveAnalysisModal} role="dialog" aria-modal="true" aria-labelledby="leave-analysis-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className={s.leaveAnalysisModalHeader}>
          <span className={s.leaveAnalysisIcon} aria-hidden="true"><CalendarDays size={22} /></span>
          <div><h2 id="leave-analysis-title">Leave Analysis</h2><p>Your allocation, usage, remaining balance and requests awaiting approval.</p></div>
          <span className={s.leavePeriod}>Leave year · Apr {leaveYearStart}–Mar {leaveYearStart + 1}</span>
          <button type="button" className={s.leaveAnalysisModalClose} onClick={onClose} aria-label="Close leave analysis"><X size={20} /></button>
        </header>
        {loading ? <div className={s.leaveAnalysisState}>Loading your leave analysis…</div>
          : unavailable ? <div className={s.leaveAnalysisState}>Your leave analysis could not be loaded. Refresh to try again.</div>
          : <>
            <div className={s.leaveAnalysisModalKpis}>
              <article><span>Allocated days</span><strong>{allocated}<small> days</small></strong><p>Total leave assigned for this leave year.</p></article>
              <button type="button" data-tone="used" aria-expanded={expanded === 'used'} aria-controls="leave-analysis-records" onClick={() => setExpanded((value) => value === 'used' ? null : 'used')}>
                <span>Used days</span><strong>{used}<small> days</small></strong><p>Approved leave already taken.</p><em>{expanded === 'used' ? 'Hide dates' : 'View dates'} <ChevronDown size={15} /></em>
              </button>
              <article data-tone="remaining"><span>Remaining days</span><strong>{remaining}<small> days</small></strong><p>Leave still available to use.</p></article>
              <button type="button" data-tone="pending" aria-expanded={expanded === 'pending'} aria-controls="leave-analysis-records" onClick={() => setExpanded((value) => value === 'pending' ? null : 'pending')}>
                <span>Pending approval</span><strong>{pending}<small> days</small></strong><p>Submitted leave not yet approved.</p><em>{expanded === 'pending' ? 'Hide requests' : 'View requests'} <ChevronDown size={15} /></em>
              </button>
            </div>
            {expanded && <div id="leave-analysis-records" className={s.leaveAnalysisRecords}>
              <div className={s.leaveAnalysisRecordsHead}><div><h3>{detailTitle}</h3><p>{expanded === 'used' ? 'Exact approved dates and leave types' : 'Dates and leave types waiting for a decision'}</p></div><span>{detailRecords.length} record{detailRecords.length === 1 ? '' : 's'}</span></div>
              <div className={s.usedLeaveList}>
                {detailRecords.length ? <ul>{detailRecords.map((record) => (
                  <li key={record.id}>
                    <i style={{ background: LEAVE_TYPE_COLORS[record.type] ?? '#4f46e5' }} />
                    <div><strong>{LEAVE_TYPE_NAMES[record.type] ?? record.type}</strong><span>{leaveDateLabel(record.startDate, record.endDate)}</span></div>
                    <b>{leaveRecordDays(record)}d</b>
                  </li>
                ))}</ul> : <div className={s.personalLeaveEmpty}>{emptyText}</div>}
              </div>
            </div>}
          </>}
      </section>
    </div>,
    document.body,
  );
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

function KpiScoreMetric({ label, value, icon, detail, full = false, onClick, selected = false }: {
  label: string;
  value: string;
  icon: React.ReactNode;
  detail?: string;
  full?: boolean;
  onClick?: () => void;
  selected?: boolean;
}) {
  const content = (
    <>
      <span className={s.kpiScoreMetricIcon} aria-hidden="true">{icon}</span>
      <div className={s.kpiScoreMetricCopy}>
        <span>{label}</span>
        <strong>{value}</strong>
        {detail && <small>{detail}</small>}
      </div>
    </>
  );
  const className = `${s.kpiScoreMetric} ${full ? s.kpiScoreMetricFull : ''} ${onClick ? s.kpiScoreMetricButton : ''}`;
  return onClick
    ? <button type="button" className={className} onClick={onClick} aria-pressed={selected} aria-label={`${label}: ${value}. Highlight contributing days`}>{content}</button>
    : <article className={className}>{content}</article>;
}

function AttendanceKpiScore({ current, averageBreakMinutes, showAverageBreak, monthLabel: selectedMonthLabel, monthDays, monthLoading, monthFailed, selectedMetric, onSelectMetric, onOpenLeaveAnalysis }: {
  current: ReturnType<typeof attendanceWeek>;
  averageBreakMinutes: number | null;
  showAverageBreak: boolean;
  monthLabel: string;
  monthDays: MyAttendanceDayV2[];
  monthLoading: boolean;
  monthFailed: boolean;
  selectedMetric: AttendanceFilter | null;
  onSelectMetric: (filter: AttendanceKpiFilter) => void;
  onOpenLeaveAnalysis: () => void;
}) {
  const completedDays = monthDays.filter((day) => !day.isFuture && !day.isInProgress);
  const presentDays = completedDays.filter((day) => day.outcome === 'PRESENT').length;
  const lateMarks = completedDays.filter((day) => day.modifiers.includes('LATE')).length;
  const shortDays = completedDays.filter((day) =>
    day.modifiers.includes('INSUFFICIENT_EFFECTIVE_WORK')
      || (day.workedMinutes !== null && day.requiredMinutes !== null && day.workedMinutes < day.requiredMinutes),
  ).length;
  const attendanceValue = (value: number) => monthLoading ? '—' : monthFailed ? 'Unavailable' : String(value);

  return (
    <section className={`${s.card} ${s.kpiScore}`} aria-label="The Trailer">
      <header className={s.kpiScoreHead}>
        <div><h2>The Trailer</h2></div>
        <span className={s.kpiIcon} aria-hidden="true"><Gauge size={16} /></span>
      </header>
      <div className={s.kpiScoreGrid}>
        <KpiScoreMetric label="Avg working hours" value={hoursLabel(current.avgWorkMinutes)} icon={<Timer size={15} />} detail="Daily average" />
        <KpiScoreMetric label="Avg punch in" value={clockLabel(current.avgPunchInMinutes)} icon={<LogIn size={15} />} detail="Working days" />
        <KpiScoreMetric label="Avg punch out" value={clockLabel(current.avgPunchOutMinutes)} icon={<LogOut size={15} />} detail="Completed days" />
        {showAverageBreak && <KpiScoreMetric label="Avg break time" value={hoursLabel(averageBreakMinutes)} icon={<Timer size={15} />} detail="Selected month · meetings excluded" />}
        <KpiScoreMetric label="Total late marks" value={attendanceValue(lateMarks)} icon={<LogIn size={15} />} detail={`${selectedMonthLabel} · Click to view days`} onClick={() => onSelectMetric('Total late marks')} selected={selectedMetric === 'Total late marks'} />
        <KpiScoreMetric label="Total present days" value={attendanceValue(presentDays)} icon={<CalendarCheck size={15} />} detail={`${selectedMonthLabel} · Click to view days`} onClick={() => onSelectMetric('Total present days')} selected={selectedMetric === 'Total present days'} />
        <KpiScoreMetric label="Less working hours" value={attendanceValue(shortDays)} icon={<Timer size={15} />} detail={`Below required hours · ${selectedMonthLabel}`} onClick={() => onSelectMetric('Less working hours')} selected={selectedMetric === 'Less working hours'} />
      </div>
      <button type="button" className={s.leaveAnalysisLaunch} onClick={onOpenLeaveAnalysis}>
        <span className={s.leaveAnalysisLaunchIcon}><CalendarDays size={19} aria-hidden="true" /></span>
        <span><strong>Leave Analysis</strong><small>Balance, used dates and pending approvals</small></span>
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </section>
  );
}

function AttendanceSide({ week, monthLabel: selectedMonthLabel, monthDays, monthLoading, monthFailed, byDate, averageBreakMinutes, showAverageBreak, selectedMetric, onSelectMetric, onOpenLeaveAnalysis }: {
  week: WeekWindow;
  monthLabel: string;
  monthDays: MyAttendanceDayV2[];
  monthLoading: boolean;
  monthFailed: boolean;
  byDate: Map<string, MyAttendanceDayV2>;
  averageBreakMinutes: number | null;
  showAverageBreak: boolean;
  selectedMetric: AttendanceFilter | null;
  onSelectMetric: (filter: AttendanceKpiFilter) => void;
  onOpenLeaveAnalysis: () => void;
}) {
  const current = attendanceWeek(week.start, week.end, byDate);

  return (
    <aside className={s.side} aria-label={`${weekName(week)} attendance`}>
      <AttendanceKpiScore
        current={current}
        averageBreakMinutes={averageBreakMinutes}
        showAverageBreak={showAverageBreak}
        monthLabel={selectedMonthLabel}
        monthDays={monthDays}
        monthLoading={monthLoading}
        monthFailed={monthFailed}
        selectedMetric={selectedMetric}
        onSelectMetric={onSelectMetric}
        onOpenLeaveAnalysis={onOpenLeaveAnalysis}
      />
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
  date, anchor, mode, day, punch, productivity, highlight, correctionAllowed, leaveRange,
  availableCompOff, onCorrection, onApplyLeave, onClose,
}: {
  date: string;
  anchor: HTMLElement;
  mode: Mode;
  day: MyAttendanceDayV2 | undefined;
  punch: { in: OwnPunchEvidence | null; out: OwnPunchEvidence | null } | undefined;
  productivity: HomeProductivityDay | undefined;
  highlight: ReturnType<typeof productiveDays>;
  correctionAllowed: boolean;
  leaveRange: { startDate: string; endDate: string } | null;
  availableCompOff: number;
  onCorrection: () => void;
  onApplyLeave: (type?: string) => void;
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
  const future = !!day?.isFuture || date > localToday();
  const plannedStatus = day?.calendar?.status;
  const plannedOff = plannedStatus === 'HOLIDAY' || plannedStatus === 'WEEKLY_OFF';
  const activeLeaveRange = leaveRange && date >= leaveRange.startDate && date <= leaveRange.endDate ? leaveRange : null;

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
          {future && <div className={s.futureDayNotice}>
            <strong>{plannedOff ? (day?.calendar?.holidayName ?? (plannedStatus === 'HOLIDAY' ? 'Company holiday' : 'Weekly off')) : 'No attendance yet'}</strong>
            <span>{plannedOff ? 'This date is not charged as leave.' : 'Future attendance stays blank until this day occurs.'}</span>
            {activeLeaveRange && <small>Selected range: {activeLeaveRange.startDate} to {activeLeaveRange.endDate}</small>}
          </div>}
          {!future && <div className={s.punchPair}>
            <div className={s.punchCard}>
              <TinyPunchPhoto large evidenceId={photoId(punch?.in)} label={`Punch in ${formatTime(day?.punchInAt ?? null)}`} />
              <div><span className={s.punchLabel}>Punch in</span><strong>{formatTime(day?.punchInAt ?? null)}</strong></div>
            </div>
            <div className={s.punchCard}>
              <TinyPunchPhoto large evidenceId={photoId(punch?.out)} label={`Punch out ${formatTime(day?.punchOutAt ?? null)}`} />
              <div><span className={s.punchLabel}>Punch out</span><strong>{day?.punchOutAt ? formatTime(day.punchOutAt) : day?.isInProgress ? 'Working' : '—'}</strong></div>
            </div>
          </div>}
          {!future && <div className={s.stats}>
            <div className={s.stat}><span>Working hours</span><strong>{hoursLabel(day?.presenceMinutes ?? day?.workedMinutes)}</strong></div>
            <div className={s.stat}><span>Break time</span><strong>{hoursLabel(day?.breakMinutes)}</strong></div>
          </div>}
          <div className={s.actions}>
            {!future && <Link href="/attendance" className={s.primaryAction}>Open full day <ArrowRight size={13} aria-hidden="true" /></Link>}
            {!future && correctionAllowed && (
              <button type="button" className={s.secondaryAction} onClick={onCorrection}><PencilLine size={13} aria-hidden="true" />Request correction</button>
            )}
            {future && !plannedOff && <button type="button" className={s.primaryAction} onClick={() => onApplyLeave()}>Apply leave</button>}
            {future && !plannedOff && availableCompOff > 0 && <button type="button" className={s.secondaryAction} onClick={() => onApplyLeave('COMP_OFF')}>Use comp-off ({availableCompOff})</button>}
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
