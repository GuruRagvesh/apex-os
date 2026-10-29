'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@apex/core-identity';
import { dashboardApi } from '@apex/intelligence-dashboard/api';
import { workdayApi } from '@/lib/api';
import { shouldRetryTransientQuery, transientQueryRetryDelay, pollWhileHealthy } from '@apex/shared-auth';
import {
  ArrowRight, CalendarCheck, CalendarDays, Check, ChevronDown,
  ChevronLeft, ChevronRight, Gauge, GitFork, LogIn, LogOut, PencilLine, Search, Timer, X,
} from 'lucide-react';
import { getMyAttendanceV2, type AttendanceModifier, type MyAttendanceDayV2 } from '../my-attendance-v2-api';
import { getMyPunchEvidence, type OwnPunchEvidence } from '../../attendance/punch-api';
import { getMyLeaveBalance, getUserLeaveBalance, LEAVE_TYPE_LABEL, type PersonalLeaveType } from '../../attendance/leave-balance-api';
import { compOffApi, leaveApi } from '@apex/workforce-leave/api';
import { monthLabel, presentDay, formatTime } from '../status-presentation';
import { CorrectionDialog } from '../CorrectionDialog';
import { TinyPunchPhoto } from './TinyPunchPhoto';
import {
  addDays, attendanceWeek, clockLabel, datesBetween, hoursLabel, monthOf,
  pickWeek, shiftMonth,
  type WeekWindow,
} from './home-week';
import s from './home-calendar.module.css';
import { ProductivityTimelinePanel } from './ProductivityTimelinePanel';

type AttendanceKpiFilter = 'Total late marks' | 'Total present days' | 'Less working hours';

const ATTENDANCE_LEGEND = [
  { label: 'Present', color: '#0D8A62' },
  { label: 'Late / Short hours', color: '#C45C0A' },
  { label: 'Absent / leave', color: '#D94B68' },
  { label: 'Half day', color: '#7C3AED' },
  { label: 'Regularized', color: '#218B52' },
  { label: 'Holiday', color: '#D9A514' },
  { label: 'Weekly off', color: '#2767B0' },
  { label: 'Needs review', color: '#6F7F94' },
] as const;
type AttendanceFilter = typeof ATTENDANCE_LEGEND[number]['label'] | AttendanceKpiFilter;

type PersonAttendanceDay = {
  date: string;
  status: string;
  outcome: string | null;
  modifiers: string[];
  isPresent: boolean;
  holidayName: string | null;
  isWorkingDay: boolean;
  punchInAt: string | null;
  punchOutAt: string | null;
  workingMinutes: number | null;
  productiveMinutes: number;
  meetingMinutes: number;
  meetingCount: number;
  breakCount: number;
  breakMinutes: number;
  lateMinutes: number;
  currentStatus: string | null;
  leaveType: string | null;
};

type PersonAttendanceInsight = {
  identity: { id: string; name: string; status: string } | null;
  workday: {
    attendanceCalendar: PersonAttendanceDay[];
    punchInMinute: number | null;
    punchOutMinute: number | null;
    averages: { workingMinutes: number | null; breakMinutes: number | null };
  };
};

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

function personDayToCalendarDay(day: PersonAttendanceDay): MyAttendanceDayV2 {
  const sourceOutcome = day.outcome ?? day.status;
  const outcome = day.status === 'NEEDS_REVIEW'
    ? 'UNRESOLVED'
    : ['LATE', 'LATE_EXEMPTED', 'SHORT_HOURS', 'PRODUCTIVE', 'OVERTIME'].includes(sourceOutcome)
      ? 'PRESENT'
      : ['PRESENT', 'HALF_DAY', 'ABSENT', 'LEAVE', 'LWP', 'HOLIDAY', 'WEEKLY_OFF', 'EXEMPT', 'IN_PROGRESS'].includes(sourceOutcome)
        ? sourceOutcome as MyAttendanceDayV2['outcome']
        : null;
  const modifiers: AttendanceModifier[] = [];
  for (const modifier of day.modifiers) {
    if (modifier === 'SHORT_HOURS') modifiers.push('INSUFFICIENT_EFFECTIVE_WORK');
    if ([
      'LATE', 'LATE_EXEMPTED', 'INSUFFICIENT_PRESENCE',
      'INSUFFICIENT_EFFECTIVE_WORK', 'BREAK_EXCEEDS_ALLOWANCE',
      'AUTO_CLOSED', 'REGULARIZED', 'WORKED_ON_HOLIDAY',
      'WORKED_ON_WEEKLY_OFF',
    ].includes(modifier)) modifiers.push(modifier as AttendanceModifier);
  }
  const isFuture = day.status === 'FUTURE' || day.date > localToday();
  const calendarStatus = day.status === 'HOLIDAY' ? 'HOLIDAY' : day.status === 'WEEKLY_OFF' ? 'WEEKLY_OFF' : 'WORKING';
  return {
    date: day.date,
    calendar: { isWorkingDay: day.isWorkingDay, status: calendarStatus, reason: day.status, holidayName: day.holidayName },
    outcome,
    modifiers,
    exceptions: [],
    evaluationState: day.status === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : outcome ? 'CALCULATED' : null,
    isApplicable: true,
    isToday: day.date === localToday(),
    isFuture,
    isInProgress: day.date === localToday() && !!day.punchInAt && !day.punchOutAt,
    presenceMinutes: day.workingMinutes,
    requiredMinutes: null,
    workedMinutes: day.workingMinutes,
    breakMinutes: day.breakMinutes,
    lateMinutes: day.lateMinutes,
    punchInAt: day.punchInAt,
    punchOutAt: day.punchOutAt,
    leaveDeducted: null,
    lwpDeducted: null,
    reason: null,
    explanation: null,
    sourceStatus: day.status,
    sourceFlags: day.modifiers,
    unmappedSourceFlags: [],
    unavailable: [],
    dataSource: 'APEX_OS',
    correctionAllowed: false,
  };
}

export function HomeCalendarPanel() {
  const today = localToday();
  const userId = useAuthStore((state) => state.user?.id ?? '');
  const userName = useAuthStore((state) => state.user?.name ?? 'My attendance');
  const role = useAuthStore((state) => (state.user?.role as any)?.name ?? state.user?.role ?? '');
  const normalizedRole = String(role).toUpperCase();
  const isIntern = normalizedRole === 'INTERN';
  const canViewTeamAttendance = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(normalizedRole);
  const [selectedPersonId, setSelectedPersonId] = useState(userId);
  const [attendanceFilter, setAttendanceFilter] = useState<AttendanceFilter | null>(null);
  const [month, setMonth] = useState(() => monthOf(today));
  const [popup, setPopup] = useState<{ date: string; anchor: HTMLElement } | null>(null);
  const [correctionDate, setCorrectionDate] = useState<string | null>(null);
  const [leaveAnalysisOpen, setLeaveAnalysisOpen] = useState(false);
  const [leaveRange, setLeaveRange] = useState<{ startDate: string; endDate: string } | null>(null);
  const calendarCardRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (userId) setSelectedPersonId((current) => current || userId);
  }, [userId]);

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

  const selectedPersonQuery = useQuery({
    queryKey: ['home-team-insights', 'attendance-person-calendar-v10', selectedPersonId, month],
    queryFn: () => dashboardApi.getTeamInsights({
      personId: selectedPersonId,
      month,
      calculationVersion: 'attendance-person-calendar-v10',
    }) as Promise<PersonAttendanceInsight>,
    enabled: canViewTeamAttendance && !!selectedPersonId && selectedPersonId !== userId,
    staleTime: 30_000,
    refetchInterval: month === monthOf(today) ? pollWhileHealthy(15_000) : false,
    retry: shouldRetryTransientQuery,
    retryDelay: transientQueryRetryDelay,
  });

  const selectedPersonDays = useMemo(() => (selectedPersonQuery.data?.workday.attendanceCalendar ?? []).map(personDayToCalendarDay), [selectedPersonQuery.data]);
  const selectedPersonByDate = useMemo(() => new Map(selectedPersonDays.map((day) => [day.date, day])), [selectedPersonDays]);
  const selectedPersonMetricsByDate = useMemo(() => new Map((selectedPersonQuery.data?.workday.attendanceCalendar ?? []).map((day) => [day.date, day])), [selectedPersonQuery.data]);
  const viewingAnotherPerson = !!selectedPersonId && selectedPersonId !== userId;
  const activeAttendanceByDate = viewingAnotherPerson ? selectedPersonByDate : attendanceByDate;
  const activeMonthDays = viewingAnotherPerson ? selectedPersonDays : monthQuery?.data?.month.days ?? [];
  const activeMonthLoading = viewingAnotherPerson ? selectedPersonQuery.isLoading : !!monthQuery?.isLoading;
  const activeMonthError = viewingAnotherPerson ? selectedPersonQuery.isError : !!monthQuery?.isError;
  const selectedWorkedDays = selectedPersonDays.filter((day) => day.punchInAt && day.workedMinutes != null);
  const selectedAverageWorkingMinutes = selectedWorkedDays.length
    ? selectedWorkedDays.reduce((sum, day) => sum + (day.workedMinutes ?? 0), 0) / selectedWorkedDays.length
    : null;
  const selectedAverageBreakMinutes = selectedWorkedDays.length
    ? selectedWorkedDays.reduce((sum, day) => sum + (day.breakMinutes ?? 0), 0) / selectedWorkedDays.length
    : null;
  const ownWorkedDaysForBreak = (monthQuery?.data?.month.days ?? []).filter((day) => !!day.punchInAt && !day.isFuture);
  const ownAverageBreakMinutes = ownWorkedDaysForBreak.length
    ? ownWorkedDaysForBreak.reduce((sum, day) => sum + (day.breakMinutes ?? 0), 0) / ownWorkedDaysForBreak.length
    : null;

  const evidence = useQuery({
    queryKey: ['my-punch-evidence-v2'],
    queryFn: () => getMyPunchEvidence(90),
    staleTime: 60_000,
    retry: shouldRetryTransientQuery,
    retryDelay: transientQueryRetryDelay,
  });
  const punches = useMemo(() => evidenceByDate(evidence.data), [evidence.data]);

  const week: WeekWindow = useMemo(() => pickWeek(today, attendanceByDate), [today, attendanceByDate]);

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
  const selectAttendanceKpi = (filter: AttendanceKpiFilter) => {
    const selecting = attendanceFilter !== filter;
    setAttendanceFilter(selecting ? filter : null);
    setPopup(null);
    if (selecting) requestAnimationFrame(() => calendarCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <section className={s.panel} aria-label="Attendance">
      <div ref={calendarCardRef} className={`${s.card} ${s.calendar}`}>
        <header className={s.header}>
          <h2 className={s.title}>Attendance</h2>
          <button
            type="button"
            className={s.leaveAnalysisHeaderButton}
            onClick={() => setLeaveAnalysisOpen(true)}
            aria-label={`Open leave analysis for ${viewingAnotherPerson ? selectedPersonQuery.data?.identity?.name ?? 'selected employee' : userName}`}
          >
            <CalendarDays size={15} aria-hidden="true" />
            <span>Leave Analysis</span>
          </button>
          {canViewTeamAttendance && <AttendancePersonFilter
            currentUser={{ id: userId, name: userName, role: normalizedRole.replaceAll('_', ' ') }}
            selectedId={selectedPersonId || userId}
            today={today}
            onSelect={(id) => { setSelectedPersonId(id); setPopup(null); }}
          />}
          <div className={s.monthControls}>
            <button type="button" onClick={() => { setMonth(shiftMonth(month, -1)); setPopup(null); }} aria-label="Previous month"><ChevronLeft size={16} /></button>
            <MonthPickerControl selected={month} today={today} maxMonth={latestCalendarMonth} onSelect={(value) => { setMonth(value); setPopup(null); }} />
            <button type="button" onClick={() => { setMonth(shiftMonth(month, 1)); setPopup(null); }} disabled={!canGoNext} aria-label="Next month"><ChevronRight size={16} /></button>
          </div>
        </header>

        <div className={s.attendanceCalendarLayout}>
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

          <div className={s.calendarMain}>
            {activeMonthLoading ? (
              <div className={s.skeleton}>Loading your calendar…</div>
            ) : activeMonthError ? (
              <div className={s.skeleton}>Attendance could not be loaded. Refresh to try again.</div>
            ) : (
              <CalendarGrid
                month={month}
                today={today}
                attendanceFilter={attendanceFilter}
                selected={popup?.date ?? null}
                attendanceByDate={activeAttendanceByDate}
                punches={viewingAnotherPerson ? new Map() : punches}
                showPunchPhotos={!viewingAnotherPerson}
                emphasizeNeedsReview={!viewingAnotherPerson}
                onOpen={openDay}
                leaveRange={leaveRange}
                onSelectLeaveRange={selectLeaveRangeDate}
              />
            )}
          </div>
        </div>

      </div>

      <AttendanceSide
        week={week}
        monthLabel={monthLabel(y, m)}
        monthDays={activeMonthDays}
        monthLoading={activeMonthLoading}
        monthFailed={activeMonthError}
        byDate={activeAttendanceByDate}
        metricsOverride={viewingAnotherPerson && selectedPersonQuery.data ? {
          daysWorked: selectedPersonDays.filter((day) => !!day.punchInAt).length,
          avgWorkMinutes: selectedAverageWorkingMinutes,
          totalWorkMinutes: selectedPersonDays.reduce((sum, day) => sum + (day.workedMinutes ?? 0), 0),
          avgPunchInMinutes: selectedPersonQuery.data.workday.punchInMinute,
          avgPunchOutMinutes: selectedPersonQuery.data.workday.punchOutMinute,
          totalBreakMinutes: selectedPersonDays.reduce((sum, day) => sum + (day.breakMinutes ?? 0), 0),
          onTimeFullDays: 0,
        } : undefined}
        averageBreakMinutes={viewingAnotherPerson ? selectedAverageBreakMinutes : ownAverageBreakMinutes}
        selectedMetric={attendanceFilter}
        onSelectMetric={selectAttendanceKpi}
      />

      <ProductivityTimelinePanel />

      {leaveAnalysisOpen && <PersonalLeaveUsageModal
        userId={viewingAnotherPerson ? selectedPersonId : userId}
        personName={viewingAnotherPerson ? selectedPersonQuery.data?.identity?.name ?? 'Selected employee' : userName}
        today={today}
        isIntern={viewingAnotherPerson ? false : isIntern}
        isOwn={!viewingAnotherPerson}
        onClose={() => setLeaveAnalysisOpen(false)}
      />}

      {popup && (
        <DayPopup
          date={popup.date}
          anchor={popup.anchor}
          day={activeAttendanceByDate.get(popup.date)}
          punch={viewingAnotherPerson ? undefined : punches.get(popup.date)}
          personMetrics={viewingAnotherPerson ? selectedPersonMetricsByDate.get(popup.date) : undefined}
          personName={viewingAnotherPerson ? selectedPersonQuery.data?.identity?.name ?? 'Selected employee' : userName}
          showPunchPhotos={!viewingAnotherPerson}
          canUsePersonalActions={!viewingAnotherPerson}
          correctionAllowed={popup.date < today || (popup.date === today && correctionAllowed)}
          leaveRange={leaveRange}
          availableCompOff={Array.isArray(compOffCredits.data)
            ? compOffCredits.data.reduce((sum: number, credit: any) => sum + Number(credit.remainingMinutes ?? credit.creditMinutes ?? 540), 0) / 540
            : 0}
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

function AttendancePersonFilter({ currentUser, selectedId, today, onSelect }: {
  currentUser: { id: string; name: string; role: string };
  selectedId: string;
  today: string;
  onSelect: (id: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const peopleQuery = useQuery({
    queryKey: ['workday-team', 'attendance-name-filter', today],
    queryFn: () => workdayApi.getTeam(today) as Promise<TeamMember[]>,
    enabled: open,
    staleTime: 60_000,
    retry: shouldRetryTransientQuery,
    retryDelay: transientQueryRetryDelay,
  });

  useEffect(() => {
    if (!open) return;
    const closeOnKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    const closeOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', closeOnKey);
    window.addEventListener('mousedown', closeOutside);
    return () => {
      window.removeEventListener('keydown', closeOnKey);
      window.removeEventListener('mousedown', closeOutside);
    };
  }, [open]);

  const people = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; role?: string; department?: string; photo?: string | null }>();
    if (currentUser.id) byId.set(currentUser.id, currentUser);
    for (const member of peopleQuery.data ?? []) {
      if (member.id === currentUser.id) continue;
      const role = typeof member.role === 'string' ? member.role : member.role?.name;
      byId.set(member.id, {
        id: member.id,
        name: member.name,
        role: role?.replaceAll('_', ' '),
        department: member.department?.name,
        photo: member.photoUrl || member.avatar,
      });
    }
    const term = search.trim().toLowerCase();
    return Array.from(byId.values())
      .filter((person) => !term || [person.name, person.role, person.department].some((value) => value?.toLowerCase().includes(term)))
      .sort((a, b) => a.id === currentUser.id ? -1 : b.id === currentUser.id ? 1 : a.name.localeCompare(b.name));
  }, [currentUser, peopleQuery.data, search]);
  const selected = people.find((person) => person.id === selectedId)
    ?? (selectedId === currentUser.id ? currentUser : null);

  return (
    <div ref={rootRef} className={s.personFilter}>
      <button
        type="button"
        className={s.personFilterButton}
        onClick={() => { setOpen((value) => !value); setSearch(''); }}
        aria-label="Filter attendance calendar by employee name"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={s.personFilterAvatar}>{initials(selected?.name ?? currentUser.name)}</span>
        <span><small>{selected?.role ?? 'Employee'}</small><strong>{selected?.name ?? currentUser.name}</strong></span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && <div className={s.personFilterPopover}>
        <label className={s.personFilterSearch}>
          <Search size={14} aria-hidden="true" />
          <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or department" />
        </label>
        <div className={s.personFilterList} role="listbox" aria-label="Employees available in your hierarchy">
          {peopleQuery.isLoading && <div className={s.personFilterState}>Loading people…</div>}
          {peopleQuery.isError && <div className={s.personFilterState}>Names could not be loaded.</div>}
          {!peopleQuery.isLoading && !peopleQuery.isError && people.map((person) => (
            <button
              key={person.id}
              type="button"
              role="option"
              aria-selected={person.id === selectedId}
              onClick={() => { onSelect(person.id); setOpen(false); }}
            >
              <span className={s.personFilterAvatar}>{person.photo ? <img src={person.photo} alt="" /> : initials(person.name)}</span>
              <span><strong>{person.name}</strong><small>{[person.role, person.department].filter(Boolean).join(' · ')}</small></span>
              {person.id === selectedId && <Check size={15} aria-hidden="true" />}
            </button>
          ))}
          {!peopleQuery.isLoading && !peopleQuery.isError && !people.length && <div className={s.personFilterState}>No matching people.</div>}
        </div>
      </div>}
    </div>
  );
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '—';
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

// ── Calendar grid ────────────────────────────────────────────────────────────

function CalendarGrid({
  month, today, attendanceFilter, selected, attendanceByDate, punches, showPunchPhotos, emphasizeNeedsReview, onOpen,
  leaveRange, onSelectLeaveRange,
}: {
  month: string;
  today: string;
  attendanceFilter: AttendanceFilter | null;
  selected: string | null;
  attendanceByDate: Map<string, MyAttendanceDayV2>;
  punches: Map<string, { in: OwnPunchEvidence | null; out: OwnPunchEvidence | null }>;
  showPunchPhotos: boolean;
  emphasizeNeedsReview: boolean;
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
          if (!inMonth) {
            return (
              <div key={date} className={`${s.day} ${s.muted} ${attendanceFilter ? s.dimmedDay : ''}`} aria-hidden={!inMonth}>
                <div className={s.dayTop}><span className={s.dayNumber}>{inMonth ? dayNum : ''}</span></div>
              </div>
            );
          }
          const inLeaveRange = !!leaveRange && date >= leaveRange.startDate && date <= leaveRange.endDate;
          const cls = [s.day, date === today ? s.today : '', selected === date ? s.selected : '', inLeaveRange ? s.leaveSelectedDay : ''];
          const day = attendanceByDate.get(date);
          const punch = punches.get(date);
          const hasLateOrShortType = !!day?.modifiers.some((value) =>
            ['LATE', 'LATE_EXEMPTED', 'INSUFFICIENT_PRESENCE', 'INSUFFICIENT_EFFECTIVE_WORK'].includes(value),
          );
          // Review state and day type are separate facts. A late/short-hours
          // day awaiting review stays orange; grey is reserved for days whose
          // underlying type is genuinely still unknown.
          const displayOutcome = day?.outcome === 'UNRESOLVED' && hasLateOrShortType
            ? 'PRESENT'
            : day?.outcome ?? (day?.calendar?.status !== 'WORKING' ? day?.calendar?.status ?? null : null);
          const status = day && displayOutcome ? presentDay({ ...day, outcome: displayOutcome }) : null;
          const needsReview = day?.evaluationState === 'NEEDS_REVIEW' || day?.outcome === 'UNRESOLVED';
          if (needsReview && emphasizeNeedsReview) cls.push(s.needsReviewPulse);
          const matchesFilter = !!attendanceFilter && !!day && matchesHomeAttendanceFilter(day, attendanceFilter);
          if (attendanceFilter && !matchesFilter) cls.push(s.dimmedDay);
          if (matchesFilter) cls.push(s.highlightedDay);
          return (
            <button key={date} type="button" className={cls.join(' ')}
              data-status={status?.label}
              data-review={needsReview || undefined}
              style={{
                '--day-tint': displayOutcome && status ? status.tint : undefined,
                '--day-status': displayOutcome && status ? status.color : undefined,
              } as CSSProperties}
              onClick={(e) => onOpen(date, e.currentTarget)}
              onContextMenu={future ? (event) => { event.preventDefault(); onSelectLeaveRange(date, event.currentTarget); } : undefined}
              aria-label={`${date}: ${status?.label ?? (future ? 'future working day, apply leave available' : 'no attendance result')}${needsReview && status?.label !== 'Needs review' ? ' · needs review' : ''}`}>
              <div className={s.dayTop}>
                <span className={s.dayNumber}>{dayNum}</span>
                {status && displayOutcome && <span className={s.statusDot} style={{ background: status.color }} title={day?.calendar?.holidayName ?? `${status.label}${needsReview && status.label !== 'Needs review' ? ' · needs review' : ''}`} />}
              </div>
              {displayOutcome && ['WEEKLY_OFF', 'HOLIDAY'].includes(displayOutcome) && (
                <span className={s.plannedDayLabel}>{day?.calendar?.holidayName ?? status?.label}</span>
              )}
              {day?.punchInAt ? (
                <>
                  <span className={s.punchRow}>
                    {showPunchPhotos ? <TinyPunchPhoto evidenceId={photoId(punch?.in)} label={`Punch in ${formatTime(day.punchInAt)}`} /> : <LogIn size={13} aria-hidden="true" />}
                    <span className={s.punchTime}>{formatTime(day.punchInAt)}</span>
                  </span>
                  <span className={s.punchRow}>
                    {showPunchPhotos ? <TinyPunchPhoto evidenceId={photoId(punch?.out)} label={day.punchOutAt ? `Punch out ${formatTime(day.punchOutAt)}` : 'Not punched out'} /> : <LogOut size={13} aria-hidden="true" />}
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
    || (day.presenceMinutes !== null && day.requiredMinutes !== null && day.presenceMinutes < day.requiredMinutes);
  if (filter === 'Needs review') return day.evaluationState === 'NEEDS_REVIEW' || effectiveOutcome === 'UNRESOLVED';
  if (filter === 'Late / Short hours') return lateOrShort;
  if (filter === 'Regularized') return day.modifiers.includes('REGULARIZED');
  // Present means the person attended. Late, short-hours and half-day remain
  // present facts, but retain their own orange/purple cell colours when this
  // filter highlights them.
  if (filter === 'Present') return !['ABSENT', 'LEAVE', 'LWP'].includes(effectiveOutcome ?? '')
    && (['PRESENT', 'HALF_DAY'].includes(effectiveOutcome ?? '') || lateOrShort);
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

function PersonalLeaveUsageModal({ userId, personName, today, isIntern, isOwn, onClose }: {
  userId: string;
  personName: string;
  today: string;
  isIntern: boolean;
  isOwn: boolean;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<'taken' | 'pending' | null>(null);
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
  const balanceTypes: PersonalLeaveType[] = ['ANNUAL'];
  const balances = useQueries({
    queries: balanceTypes.map((type) => ({
      queryKey: ['my-leave-balance', userId, type],
      queryFn: () => getMyLeaveBalance(type),
      enabled: isOwn,
      staleTime: 300_000,
      retry: shouldRetryTransientQuery,
      retryDelay: transientQueryRetryDelay,
    })),
  });
  const teamBalance = useQuery({
    queryKey: ['leave-balance', 'analysis', userId],
    queryFn: () => getUserLeaveBalance(userId),
    enabled: !isOwn && !!userId,
    staleTime: 60_000,
    retry: shouldRetryTransientQuery,
    retryDelay: transientQueryRetryDelay,
  });
  const records = useQuery({
    queryKey: ['leave-records-summary', userId],
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
  const ownAllocated = validBalances.reduce((sum, entry) => sum + (entry.data?.allocation ?? 0), 0);
  const ownUsed = validBalances.reduce((sum, entry) => sum + (entry.data?.approved ?? 0), 0);
  const ownPending = validBalances.reduce((sum, entry) => sum + (entry.data?.pending ?? 0), 0);
  const allocated = isOwn ? ownAllocated : teamBalance.data?.allocation ?? 0;
  const used = isOwn ? ownUsed : teamBalance.data?.approved ?? 0;
  const pending = isOwn ? ownPending : teamBalance.data?.pending ?? 0;
  const loading = records.isLoading || (isOwn ? balances.some((query) => query.isLoading) : teamBalance.isLoading);
  const unavailable = records.isError || (isOwn ? balances.some((query) => query.isError) : teamBalance.isError);

  if (typeof document === 'undefined') return null;
  const detailRecords = expanded === 'taken' ? approvedRecords : pendingRecords;
  const detailTitle = expanded === 'taken' ? 'Leaves taken' : 'Leave requests awaiting approval';
  const emptyText = expanded === 'taken'
    ? 'No approved leave dates are recorded for this leave year.'
    : 'No leave requests are currently awaiting approval.';

  return createPortal(
    <div className={s.leaveAnalysisModalBackdrop} onMouseDown={onClose}>
      <section className={s.leaveAnalysisModal} role="dialog" aria-modal="true" aria-labelledby="leave-analysis-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className={s.leaveAnalysisModalHeader}>
          <span className={s.leaveAnalysisIcon} aria-hidden="true"><CalendarDays size={22} /></span>
          <div><h2 id="leave-analysis-title">Leave Analysis</h2><p>{isOwn ? 'Your' : `${personName}’s`} allocation, approved usage and submitted requests.</p></div>
          <span className={s.leavePeriod}>Leave year · Apr {leaveYearStart}–Mar {leaveYearStart + 1}</span>
          <button type="button" className={s.leaveAnalysisModalClose} onClick={onClose} aria-label="Close leave analysis"><X size={20} /></button>
        </header>
        {loading ? <div className={s.leaveAnalysisState}>Loading leave analysis…</div>
          : unavailable ? <div className={s.leaveAnalysisState}>Leave analysis could not be loaded. Refresh to try again.</div>
          : <>
            <div className={s.leaveAnalysisModalKpis}>
              <article><span>Allocated days</span><strong>{allocated}<small> days</small></strong><p>Total leave assigned for this leave year.</p></article>
              <article data-tone="remaining"><span>Used days</span><strong>{used}<small> days</small></strong><p>Approved leave charged against allocation.</p></article>
              <button type="button" data-tone="used" aria-expanded={expanded === 'taken'} aria-controls="leave-analysis-records" onClick={() => setExpanded((value) => value === 'taken' ? null : 'taken')}>
                <span>Leaves taken</span><strong>{approvedRecords.length}<small> request{approvedRecords.length === 1 ? '' : 's'}</small></strong><p>Approved leave types and exact dates.</p><em>{expanded === 'taken' ? 'Hide details' : 'View details'} <ChevronDown size={15} /></em>
              </button>
            </div>
            <div className={s.leaveAnalysisRequestSummary}>
              <button type="button" data-tone="pending" aria-expanded={expanded === 'pending'} aria-controls="leave-analysis-records" onClick={() => setExpanded((value) => value === 'pending' ? null : 'pending')}>
                <span><strong>Leave requests</strong><small>{pendingRecords.length} awaiting approval · {pending} pending day{pending === 1 ? '' : 's'}</small></span>
                <em>{expanded === 'pending' ? 'Hide requests' : 'View requests'} <ChevronDown size={15} /></em>
              </button>
            </div>
            {expanded && <div id="leave-analysis-records" className={s.leaveAnalysisRecords}>
              <div className={s.leaveAnalysisRecordsHead}><div><h3>{detailTitle}</h3><p>{expanded === 'taken' ? 'Exact approved dates and leave types' : 'Dates and leave types waiting for a decision'}</p></div><span>{detailRecords.length} record{detailRecords.length === 1 ? '' : 's'}</span></div>
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

function AttendanceKpiScore({ current, averageBreakMinutes, monthLabel: selectedMonthLabel, monthDays, monthLoading, monthFailed, selectedMetric, onSelectMetric }: {
  current: ReturnType<typeof attendanceWeek>;
  averageBreakMinutes: number | null;
  monthLabel: string;
  monthDays: MyAttendanceDayV2[];
  monthLoading: boolean;
  monthFailed: boolean;
  selectedMetric: AttendanceFilter | null;
  onSelectMetric: (filter: AttendanceKpiFilter) => void;
}) {
  const completedDays = monthDays.filter((day) => !day.isFuture && !day.isInProgress);
  const presentDays = completedDays.filter((day) => {
    const lateOrShort = day.modifiers.some((value) =>
      ['LATE', 'LATE_EXEMPTED', 'INSUFFICIENT_PRESENCE', 'INSUFFICIENT_EFFECTIVE_WORK'].includes(value),
    );
    return !['ABSENT', 'LEAVE', 'LWP'].includes(day.outcome ?? '')
      && (['PRESENT', 'HALF_DAY'].includes(day.outcome ?? '') || lateOrShort);
  }).length;
  const lateMarks = completedDays.filter((day) => day.modifiers.includes('LATE')).length;
  const shortDays = completedDays.filter((day) =>
    day.modifiers.includes('INSUFFICIENT_EFFECTIVE_WORK')
      || (day.presenceMinutes !== null && day.requiredMinutes !== null && day.presenceMinutes < day.requiredMinutes),
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
        <KpiScoreMetric label="Avg break time" value={hoursLabel(averageBreakMinutes)} icon={<Timer size={15} />} detail="Average daily break duration" />
        <KpiScoreMetric label="Total late marks" value={attendanceValue(lateMarks)} icon={<LogIn size={15} />} detail={`${selectedMonthLabel} · Click to view days`} onClick={() => onSelectMetric('Total late marks')} selected={selectedMetric === 'Total late marks'} />
        <KpiScoreMetric label="Total present days" value={attendanceValue(presentDays)} icon={<CalendarCheck size={15} />} detail={`${selectedMonthLabel} · Click to view days`} onClick={() => onSelectMetric('Total present days')} selected={selectedMetric === 'Total present days'} />
        <KpiScoreMetric label="Less working hours" value={attendanceValue(shortDays)} icon={<Timer size={15} />} detail={`Below required hours · ${selectedMonthLabel}`} onClick={() => onSelectMetric('Less working hours')} selected={selectedMetric === 'Less working hours'} />
      </div>
    </section>
  );
}

function AttendanceSide({ week, monthLabel: selectedMonthLabel, monthDays, monthLoading, monthFailed, byDate, metricsOverride, averageBreakMinutes, selectedMetric, onSelectMetric }: {
  week: WeekWindow;
  monthLabel: string;
  monthDays: MyAttendanceDayV2[];
  monthLoading: boolean;
  monthFailed: boolean;
  byDate: Map<string, MyAttendanceDayV2>;
  metricsOverride?: ReturnType<typeof attendanceWeek>;
  averageBreakMinutes: number | null;
  selectedMetric: AttendanceFilter | null;
  onSelectMetric: (filter: AttendanceKpiFilter) => void;
}) {
  const current = metricsOverride ?? attendanceWeek(week.start, week.end, byDate);

  return (
    <aside className={s.side} aria-label={`${weekName(week)} attendance`}>
      <AttendanceKpiScore
        current={current}
        averageBreakMinutes={averageBreakMinutes}
        monthLabel={selectedMonthLabel}
        monthDays={monthDays}
        monthLoading={monthLoading}
        monthFailed={monthFailed}
        selectedMetric={selectedMetric}
        onSelectMetric={onSelectMetric}
      />
    </aside>
  );
}

// ── Day popup ────────────────────────────────────────────────────────────────

function DayPopup({
  date, anchor, day, punch, personMetrics, personName, showPunchPhotos, canUsePersonalActions, correctionAllowed, leaveRange,
  availableCompOff, onCorrection, onApplyLeave, onClose,
}: {
  date: string;
  anchor: HTMLElement;
  day: MyAttendanceDayV2 | undefined;
  punch: { in: OwnPunchEvidence | null; out: OwnPunchEvidence | null } | undefined;
  personMetrics: PersonAttendanceDay | undefined;
  personName: string;
  showPunchPhotos: boolean;
  canUsePersonalActions: boolean;
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
  }, [anchor, date]);

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
          <div className={s.popupEyebrow}>Attendance details</div>
          <div className={s.popupTitle}>{title}</div>
          <div className={s.popupPerson}>{personName}</div>
          {status && <div className={s.popupStatus} style={{ color: status.color, background: `color-mix(in srgb, ${status.color} 10%, #FFFFFF)` }}><i style={{ background: status.color }} />{status.label}</div>}
          {date === localToday() && personMetrics?.currentStatus && <div className={s.liveDayStatus}><i />{personMetrics.currentStatus.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase())}</div>}
        </div>
        <button type="button" className={s.popupClose} onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>

      <>
          {future && <div className={s.futureDayNotice}>
            <strong>{plannedOff ? (day?.calendar?.holidayName ?? (plannedStatus === 'HOLIDAY' ? 'Company holiday' : 'Weekly off')) : 'No attendance yet'}</strong>
            <span>{plannedOff ? 'This date is not charged as leave.' : 'Future attendance stays blank until this day occurs.'}</span>
            {activeLeaveRange && <small>Selected range: {activeLeaveRange.startDate} to {activeLeaveRange.endDate}</small>}
          </div>}
          {!future && <div className={s.punchPair}>
            <div className={s.punchCard}>
              {showPunchPhotos ? <TinyPunchPhoto large evidenceId={photoId(punch?.in)} label={`Punch in ${formatTime(day?.punchInAt ?? null)}`} /> : <span className={s.popupMetricIcon}><LogIn size={17} /></span>}
              <div><span className={s.punchLabel}>Punch in</span><strong>{formatTime(day?.punchInAt ?? null)}</strong></div>
            </div>
            <div className={s.punchCard}>
              {showPunchPhotos ? <TinyPunchPhoto large evidenceId={photoId(punch?.out)} label={`Punch out ${formatTime(day?.punchOutAt ?? null)}`} /> : <span className={s.popupMetricIcon}><LogOut size={17} /></span>}
              <div><span className={s.punchLabel}>Punch out</span><strong>{day?.punchOutAt ? formatTime(day.punchOutAt) : day?.isInProgress ? 'Working' : '—'}</strong></div>
            </div>
          </div>}
          {!future && <div className={s.stats}>
            <div className={s.stat}><span>Working hours</span><strong>{hoursLabel(personMetrics?.workingMinutes ?? day?.workedMinutes ?? day?.presenceMinutes)}</strong></div>
            <div className={s.stat}><span>Productive hours</span><strong>{personMetrics ? hoursLabel(personMetrics.productiveMinutes) : '—'}</strong></div>
            <div className={s.stat}><span>Breaks taken</span><strong>{personMetrics?.breakCount ?? '—'}</strong></div>
            <div className={s.stat}><span>Total break time</span><strong>{hoursLabel(personMetrics?.breakMinutes ?? day?.breakMinutes)}</strong></div>
            <div className={s.stat}><span>Meetings</span><strong>{personMetrics ? personMetrics.meetingCount : '—'}</strong></div>
            <div className={s.stat}><span>Meeting time</span><strong>{personMetrics ? hoursLabel(personMetrics.meetingMinutes) : '—'}</strong></div>
          </div>}
          <div className={s.actions}>
            {!future && canUsePersonalActions && <Link href="/attendance" className={s.primaryAction}>Open full day <ArrowRight size={13} aria-hidden="true" /></Link>}
            {!future && canUsePersonalActions && correctionAllowed && (
              <button type="button" className={s.secondaryAction} onClick={onCorrection}><PencilLine size={13} aria-hidden="true" />Request correction</button>
            )}
            {future && canUsePersonalActions && !plannedOff && <button type="button" className={s.primaryAction} onClick={() => onApplyLeave()}>Apply leave</button>}
            {future && canUsePersonalActions && !plannedOff && availableCompOff > 0 && <button type="button" className={s.secondaryAction} onClick={() => onApplyLeave('COMP_OFF')}>Use comp-off ({availableCompOff})</button>}
          </div>
      </>
    </div>,
    document.body,
  );
}
