'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Building2, CalendarDays, CheckCircle2, Clock3, Coffee, Eye, FolderKanban, LogIn, LogOut, PlayCircle, Presentation, Ticket, UserRound, Users, X, Zap } from 'lucide-react';
import { dashboardApi } from '../api/dashboard-api';
import type { HomeExperience, TeamInsightPayload } from './home-types';
import { SectionFrame } from './home-ui';
import attendanceInsightsStyles from '@/components/attendance-v2/insights.module.css';

const EMPTY_DEPARTMENTS: HomeExperience['team']['departments'] = [];
type AnalysisMode = 'monthly' | 'daily';
type PersonalAttendanceFilter = 'PRESENT' | 'PRODUCTIVE' | 'OVERTIME' | 'LATE' | 'HALF_DAY' | 'LEAVE' | 'ABSENT';

function localDay() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function minutesLabel(value: number | null | undefined) {
  if (value == null) return '—';
  const rounded = Math.max(0, Math.round(value));
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  return hours ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
}

function clockLabel(value: number | null | undefined) {
  if (value == null) return '—';
  const minuteOfDay = ((Math.round(value) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function meetingCountLabel(value: number | null | undefined) {
  if (value == null) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function readablePeriod(mode: AnalysisMode, month: string, date: string) {
  const value = mode === 'daily' ? `${date}T00:00:00` : `${month}-01T00:00:00`;
  return new Date(value).toLocaleDateString('en-GB', mode === 'daily'
    ? { day: 'numeric', month: 'long', year: 'numeric' }
    : { month: 'long', year: 'numeric' });
}

function leaveDateRange(startDate: string, endDate: string) {
  const format = (value: string) => new Date(`${value}T00:00:00.000Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return startDate === endDate ? format(startDate) : `${format(startDate)} – ${format(endDate)}`;
}

function MetricTile({ icon: Icon, label, value, note, tone }: {
  icon: typeof Clock3;
  label: string;
  value: string;
  note?: string;
  tone: 'blue' | 'violet' | 'amber' | 'emerald';
}) {
  const styles = {
    blue: 'border-blue-200 bg-blue-50/70 text-blue-700 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-300',
    violet: 'border-violet-200 bg-violet-50/70 text-violet-700 dark:border-violet-800 dark:bg-violet-950/20 dark:text-violet-300',
    amber: 'border-amber-200 bg-amber-50/70 text-amber-700 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300',
    emerald: 'border-emerald-200 bg-emerald-50/70 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300',
  }[tone];
  return <article className={`rounded-xl border p-3 ${styles}`}>
    <div className="flex items-center justify-between gap-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.08em]">{label}</p>
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/80 shadow-sm dark:bg-slate-900/70"><Icon size={16} aria-hidden /></span>
    </div>
    <p className="mt-3 text-xl font-black tracking-tight text-slate-950 dark:text-white">{value}</p>
    {note && <p className="mt-1 text-[11px] leading-4 text-slate-600 dark:text-slate-300">{note}</p>}
  </article>;
}

function TicketKpi({ icon: Icon, label, value, tone }: { icon: typeof Ticket; label: string; value: number; tone: 'blue' | 'violet' | 'amber' | 'rose' | 'emerald' }) {
  const styles = {
    blue: 'border-blue-200 bg-blue-50/70 text-blue-700 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-300',
    violet: 'border-violet-200 bg-violet-50/70 text-violet-700 dark:border-violet-800 dark:bg-violet-950/20 dark:text-violet-300',
    amber: 'border-amber-200 bg-amber-50/70 text-amber-700 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300',
    rose: 'border-rose-200 bg-rose-50/70 text-rose-700 dark:border-rose-800 dark:bg-rose-950/20 dark:text-rose-300',
    emerald: 'border-emerald-200 bg-emerald-50/70 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300',
  }[tone];
  return <article className={`flex min-h-16 items-center justify-between gap-2 rounded-xl border px-3 py-2 ${styles}`}>
    <div><p className="text-[9px] font-bold uppercase tracking-[0.08em]">{label}</p><p className="mt-1 text-xl font-black leading-none text-slate-950 dark:text-white">{value}</p></div>
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/80 shadow-sm dark:bg-slate-900/70"><Icon size={14} aria-hidden /></span>
  </article>;
}

function PersonalAttendanceKpi({ label, value, note, tone, onClick }: { label: string; value: string | number; note?: string; tone: 'green' | 'violet' | 'amber' | 'rose' | 'blue'; onClick?: () => void }) {
  const styles = {
    green: 'border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300',
    violet: 'border-violet-200 bg-violet-50/80 text-violet-700 dark:border-violet-800 dark:bg-violet-950/20 dark:text-violet-300',
    amber: 'border-orange-200 bg-orange-50/80 text-orange-700 dark:border-orange-800 dark:bg-orange-950/20 dark:text-orange-300',
    rose: 'border-rose-200 bg-rose-50/80 text-rose-700 dark:border-rose-800 dark:bg-rose-950/20 dark:text-rose-300',
    blue: 'border-blue-200 bg-blue-50/80 text-blue-700 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-300',
  }[tone];
  const content = <>
    <p className="text-[10px] font-bold uppercase tracking-[0.08em]">{label}</p>
    <p className="mt-1.5 text-xl font-black text-slate-950 dark:text-white">{value}</p>
    {note && <p className="mt-0.5 text-[9px] leading-3 text-slate-500 dark:text-slate-400">{note}</p>}
  </>;
  return onClick
    ? <button type="button" onClick={onClick} className={`rounded-xl border px-3 py-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${styles}`}>{content}</button>
    : <article className={`rounded-xl border px-3 py-2.5 ${styles}`}>{content}</article>;
}

function AttendanceFilterKpi({ label, value, color, selected, onClick }: { label: string; value: number; color: string; selected: boolean; onClick: () => void }) {
  return <button
    type="button"
    aria-pressed={selected}
    onClick={onClick}
    className={`group flex min-w-[118px] flex-1 items-center gap-2 rounded-xl border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${selected ? 'border-blue-600 bg-blue-50 shadow-sm ring-2 ring-blue-100 dark:bg-blue-950/30 dark:ring-blue-900' : 'border-slate-200 bg-white hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-sm dark:border-slate-700 dark:bg-slate-900'}`}
  >
    <span className={`h-3.5 w-3.5 shrink-0 rounded-[4px] border border-black/5 ${color}`} aria-hidden />
    <span className="min-w-0">
      <span className="block truncate text-[9px] font-bold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">{label}</span>
      <span className="mt-0.5 block text-lg font-black leading-none text-slate-950 dark:text-white">{value}</span>
    </span>
  </button>;
}

const ATTENDANCE_DAY_COLOR: Record<string, string> = {
  PRESENT: '#18B86B',
  PRODUCTIVE: '#55CDE3',
  OVERTIME: '#6676D9',
  LATE: '#F2A05A',
  SHORT_HOURS: '#F2A05A',
  LATE_EXEMPTED: '#45BFAE',
  HALF_DAY: '#9B6DE3',
  LEAVE: '#EC7F95',
  LWP: '#EC5D78',
  ABSENT: '#EF6468',
  HOLIDAY: '#E7EDF6',
  WEEKLY_OFF: '#E7EDF6',
  NEEDS_REVIEW: '#E7EDF6',
  MISSING: '#E7EDF6',
  FUTURE: '#F4F7FB',
};

function attendanceDayLabel(status: string) {
  return ({
    PRESENT: 'Present', PRODUCTIVE: 'Productive day · ticket or validated meeting activity', OVERTIME: 'Overtime · more than 9 hours worked',
    LATE: 'Late', SHORT_HOURS: 'Short hours', LATE_EXEMPTED: 'Late exempted', HALF_DAY: 'Half day',
    LEAVE: 'Leave', LWP: 'Leave without pay', ABSENT: 'Absent', HOLIDAY: 'Holiday',
    WEEKLY_OFF: 'Weekly off', NEEDS_REVIEW: 'Needs review', MISSING: 'No verified record', FUTURE: 'Upcoming',
  } as Record<string, string>)[status] ?? status.replaceAll('_', ' ').toLowerCase();
}

function readablePersonStatus(status: string | null | undefined) {
  const normalized = String(status ?? 'OFFLINE').trim().toUpperCase();
  const label = normalized.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
  const tone = normalized === 'WORKING' || normalized === 'ACTIVE'
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300'
    : normalized === 'ON_BREAK'
      ? 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300'
      : normalized === 'IN_MEETING'
        ? 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/30 dark:text-violet-300'
        : 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300';
  return { label, tone };
}

function readableRole(role: string | null | undefined) {
  return String(role ?? '').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
}

export function TeamInsightsSection({ team }: { team: HomeExperience['team'] }) {
  const today = localDay();
  const [departmentId, setDepartmentId] = useState('all');
  const [personId, setPersonId] = useState('overall');
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('monthly');
  const [month, setMonth] = useState(today.slice(0, 7));
  const [date, setDate] = useState(today);
  const [showLeaveDetails, setShowLeaveDetails] = useState(false);
  const [attendanceFilter, setAttendanceFilter] = useState<PersonalAttendanceFilter | null>(null);
  const departments = team.departments ?? EMPTY_DEPARTMENTS;

  useEffect(() => {
    setDepartmentId((current) => current === 'all' || departments.some((department) => department.id === current) ? current : 'all');
  }, [departments]);

  const selectedDepartment = departments.find((department) => department.id === departmentId);
  const people = useMemo(() => (team.showDepartmentFilter
    ? departmentId === 'all' ? departments.flatMap((department) => department.people) : selectedDepartment?.people ?? []
    : departments.flatMap((department) => department.people))
      .filter((person, index, all) => all.findIndex((candidate) => candidate.id === person.id) === index),
  [departmentId, departments, selectedDepartment, team.showDepartmentFilter]);

  useEffect(() => {
    setPersonId((current) => current === 'overall' || people.some((person) => person.id === current) ? current : 'overall');
  }, [departmentId, people]);

  useEffect(() => {
    setAttendanceFilter(null);
  }, [personId, month]);

  useEffect(() => {
    if (!showLeaveDetails) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setShowLeaveDetails(false); };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [showLeaveDetails]);

  const insightQuery = useQuery({
    queryKey: ['home-team-insights', 'personal-attendance-calendar-v7', departmentId, personId, analysisMode, analysisMode === 'monthly' ? month : date],
    queryFn: () => dashboardApi.getTeamInsights({
      ...(departmentId !== 'all' ? { departmentId } : {}),
      personId,
      month: analysisMode === 'monthly' ? month : date.slice(0, 7),
      calculationVersion: 'personal-attendance-calendar-v7',
      ...(analysisMode === 'daily' ? { date } : {}),
    }) as Promise<TeamInsightPayload>,
    staleTime: 30_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  const insight = insightQuery.data;

  const overallLabel = team.hierarchyRole === 'TEAM_LEAD'
    ? 'Overall team'
    : team.hierarchyRole === 'MANAGER'
      ? departmentId === 'all' ? 'Overall assigned departments' : `Overall ${selectedDepartment?.name ?? 'department'}`
      : departmentId === 'all' ? 'Overall company' : `Overall ${selectedDepartment?.name ?? 'department'}`;

  const filters = <div className="flex max-w-full flex-wrap items-center justify-end gap-2 rounded-xl border border-[#004687]/20 bg-blue-50/70 p-1.5 dark:bg-blue-950/20">
    {team.showDepartmentFilter && <label className="relative flex min-w-[165px] flex-1 items-center sm:flex-none">
      <Building2 size={14} className="pointer-events-none absolute left-3 text-white/80" aria-hidden />
      <span className="sr-only">Department</span>
      <select value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setPersonId('overall'); }} className="h-9 w-full appearance-none rounded-lg border border-[#004687] bg-[#004687] pl-9 pr-8 text-xs font-bold text-white outline-none focus:ring-2 focus:ring-blue-300 [&>option]:bg-white [&>option]:text-slate-800">
        <option className="bg-white text-slate-800" value="all">{team.hierarchyRole === 'MANAGER' ? 'All assigned departments' : 'All departments'}</option>
        {departments.map((department) => <option className="bg-white text-slate-800" key={department.id} value={department.id}>{department.name}</option>)}
      </select>
    </label>}
    <label className="relative flex min-w-[170px] flex-1 items-center sm:flex-none">
      <UserRound size={14} className="pointer-events-none absolute left-3 text-white/80" aria-hidden />
      <span className="sr-only">Person</span>
      <select value={personId} onChange={(event) => { setPersonId(event.target.value); setShowLeaveDetails(false); }} className="h-9 w-full appearance-none rounded-lg border border-[#004687] bg-[#004687] pl-9 pr-8 text-xs font-bold text-white outline-none focus:ring-2 focus:ring-blue-300 [&>option]:bg-white [&>option]:text-slate-800">
        <option className="bg-white text-slate-800" value="overall">{overallLabel}</option>
        {people.map((person) => <option className="bg-white text-slate-800" key={person.id} value={person.id}>{person.name}</option>)}
      </select>
    </label>
    <div className="flex h-9 rounded-lg bg-[#004687] p-1" aria-label="Team insights period">
      {(['monthly', 'daily'] as const).map((mode) => <button key={mode} type="button" onClick={() => setAnalysisMode(mode)} aria-pressed={analysisMode === mode} className={`rounded-md px-3 text-xs font-bold capitalize transition ${analysisMode === mode ? 'bg-white text-[#004687] shadow-sm' : 'text-white/75 hover:text-white'}`}>{mode}</button>)}
    </div>
    <label className="relative flex min-w-[150px] flex-1 items-center sm:flex-none">
      <CalendarDays size={14} className="pointer-events-none absolute left-3 text-white/80" aria-hidden />
      <span className="sr-only">{analysisMode === 'monthly' ? 'Month' : 'Date'}</span>
      {analysisMode === 'monthly'
        ? <input type="month" value={month} max={today.slice(0, 7)} onChange={(event) => event.target.value && setMonth(event.target.value)} className="h-9 w-full rounded-lg border border-[#004687] bg-[#004687] pl-9 pr-2 text-xs font-bold text-white outline-none [color-scheme:dark] focus:ring-2 focus:ring-blue-300" />
        : <input type="date" value={date} max={today} onChange={(event) => event.target.value && setDate(event.target.value)} className="h-9 w-full rounded-lg border border-[#004687] bg-[#004687] pl-9 pr-2 text-xs font-bold text-white outline-none [color-scheme:dark] focus:ring-2 focus:ring-blue-300" />}
    </label>
  </div>;

  const useAverages = analysisMode === 'monthly' || insight?.target === 'OVERALL';
  const workday = insight?.workday;
  const metrics = workday ? (useAverages ? workday.averages : workday) : null;
  const isScheduledDay = (workday?.scheduledWorkingDays ?? 0) > 0;
  const meetingValue = analysisMode === 'monthly'
    ? `${meetingCountLabel(workday?.averages.meetingCount)} avg/day`
    : `${meetingCountLabel(insight?.target === 'OVERALL' ? workday?.averages.meetingCount : workday?.meetingCount)} meeting${(insight?.target === 'PERSON' && workday?.meetingCount === 1) ? '' : 's'}`;
  const attendanceDays = workday?.attendanceCalendar ?? [];
  const matchesAttendanceFilter = (status: string, filter: PersonalAttendanceFilter) => ({
    PRESENT: ['PRESENT', 'PRODUCTIVE', 'OVERTIME'],
    PRODUCTIVE: ['PRODUCTIVE'],
    OVERTIME: ['OVERTIME'],
    LATE: ['LATE', 'SHORT_HOURS', 'LATE_EXEMPTED'],
    HALF_DAY: ['HALF_DAY'],
    LEAVE: ['LEAVE', 'LWP'],
    ABSENT: ['ABSENT'],
  }[filter] as string[]).includes(status);
  const attendanceFilterKpis: Array<{ filter: PersonalAttendanceFilter; label: string; color: string; value: number }> = [
    { filter: 'PRESENT', label: 'Present', color: 'bg-emerald-400', value: workday?.presentDays ?? 0 },
    { filter: 'PRODUCTIVE', label: 'Productive', color: 'bg-cyan-300', value: attendanceDays.filter((day) => day.status === 'PRODUCTIVE').length },
    { filter: 'OVERTIME', label: 'Overtime', color: 'bg-indigo-400', value: attendanceDays.filter((day) => day.status === 'OVERTIME').length },
    { filter: 'LATE', label: 'Late / short', color: 'bg-orange-300', value: attendanceDays.filter((day) => matchesAttendanceFilter(day.status, 'LATE')).length },
    { filter: 'HALF_DAY', label: 'Half day', color: 'bg-violet-300', value: workday?.halfDays ?? 0 },
    { filter: 'LEAVE', label: 'Leave', color: 'bg-rose-300', value: workday?.leaveDays ?? 0 },
    { filter: 'ABSENT', label: 'Absent', color: 'bg-red-400', value: workday?.absentDays ?? 0 },
  ];
  const filteredAttendanceCount = attendanceFilter ? attendanceDays.filter((day) => matchesAttendanceFilter(day.status, attendanceFilter)).length : attendanceDays.length;
  const personalAttendanceKpis = insight?.target === 'PERSON' && workday ? <>
    <PersonalAttendanceKpi label="Present days" value={workday.presentDays} tone="green" />
    <PersonalAttendanceKpi label="Half days" value={workday.halfDays} tone="violet" />
    <PersonalAttendanceKpi label="Late marks" value={workday.lateDays} tone="amber" />
    <PersonalAttendanceKpi label="Allocated leaves" value={workday.leaveUsage?.allocatedDays ?? '—'} note={workday.leaveUsage ? `FY ${workday.leaveUsage.financialYear}` : 'Leave balance unavailable'} tone="blue" />
    <PersonalAttendanceKpi label="Leaves taken" value={workday.leaveUsage?.takenDays ?? '—'} note={workday.leaveUsage ? 'View records' : 'Records unavailable'} tone="rose" onClick={workday.leaveUsage ? () => setShowLeaveDetails(true) : undefined} />
    <PersonalAttendanceKpi label="Less working hours" value={workday.lessWorkingHoursDays} tone="blue" />
  </> : null;
  const identityStatus = readablePersonStatus(insight?.identity?.status);

  return <SectionFrame icon={Users} title="Team Insights" titleColor="#004687" aside={filters}>
    {insightQuery.isLoading && <div className="grid min-h-64 place-items-center rounded-2xl border border-slate-200 bg-white text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900">Loading verified workday records…</div>}
    {insightQuery.isError && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-300"><span>Workday analysis could not be loaded.</span><button type="button" onClick={() => insightQuery.refetch()} className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700">Try again</button></div>}
    {insight && workday && <div className="grid grid-cols-1 gap-5 xl:grid-cols-2" data-department-id={departmentId} data-person-id={personId}>
      <header className="order-0 flex flex-wrap items-center gap-3 px-1 xl:col-span-2">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-blue-500 to-indigo-700 font-bold text-white" style={insight.identity?.photoUrl ? { backgroundImage: `url(${insight.identity.photoUrl})`, backgroundPosition: 'center', backgroundSize: 'cover' } : undefined}>{insight.identity?.photoUrl ? '' : insight.identity?.initials ?? <Users size={21} />}</div>
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-base font-bold text-slate-900 dark:text-white">{insight.identity?.name ?? overallLabel}</h3>{insight.identity && <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${identityStatus.tone}`}><i className="h-1.5 w-1.5 rounded-full bg-current" />{identityStatus.label}</span>}</div><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{insight.identity ? [readableRole(insight.identity.role), insight.identity.department?.name].filter(Boolean).join(' · ') : `${insight.scope.people} people in the permitted hierarchy scope`}</p></div>
        </div>
      </header>

      <section className="order-1 px-1 xl:col-span-2" aria-label="Workday analysis">
        <div className="flex flex-wrap items-end justify-between gap-2"><h3 className="text-lg font-black text-slate-900 dark:text-white">Workday Analysis</h3>{!workday.calendarResolved ? <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Calendar policy needs review</span> : workday.unresolvedScheduleDays > 0 ? <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{workday.unresolvedScheduleDays} schedule day{workday.unresolvedScheduleDays === 1 ? '' : 's'} unresolved</span> : workday.coverageRate != null && workday.coverageRate < 100 ? <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{workday.coverageRate}% attendance verified</span> : !workday.daysWorked && isScheduledDay ? <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500 dark:bg-slate-800">No work session recorded</span> : null}</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <MetricTile icon={Clock3} label="Working hours" value={minutesLabel(metrics?.workingMinutes)} tone="blue" />
          <MetricTile icon={Zap} label="Productive hours" value={minutesLabel(metrics?.productiveMinutes)} tone="violet" />
          <MetricTile icon={Coffee} label="Break time" value={minutesLabel(metrics?.breakMinutes)} tone="amber" />
          <MetricTile icon={Presentation} label={analysisMode === 'monthly' ? 'Meetings / workday' : 'Meetings'} value={meetingValue} tone="emerald" />
          <MetricTile icon={LogIn} label={analysisMode === 'monthly' ? 'Average punch in' : 'Punch in'} value={clockLabel(workday?.punchInMinute)} tone="blue" />
          <MetricTile icon={LogOut} label={analysisMode === 'monthly' ? 'Average punch out' : 'Punch out'} value={clockLabel(workday?.punchOutMinute)} tone="amber" />
        </div>

      </section>

      <section className="order-3 px-1" aria-label="Ticket analysis">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h3 className="text-lg font-black text-slate-900 dark:text-white">Ticket Analysis</h3></div>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">{insight.target === 'PERSON' ? 'Individual' : 'Scope'} totals</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <TicketKpi icon={Ticket} label="Active" value={insight.tickets.active} tone="blue" />
          <TicketKpi icon={PlayCircle} label="In progress" value={insight.tickets.inProgress} tone="violet" />
          <TicketKpi icon={Eye} label="Under review" value={insight.tickets.underReview} tone="amber" />
          <TicketKpi icon={AlertTriangle} label="Overdue" value={insight.tickets.overdue} tone="rose" />
          <div className="col-span-2"><TicketKpi icon={CheckCircle2} label="Completed" value={insight.tickets.completed} tone="emerald" /></div>
        </div>
      </section>

      {!insight.scope.companyWide && <section className="order-3 px-1" aria-label="Project contributions">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h3 className="text-lg font-black text-slate-900 dark:text-white">Project Contributions</h3></div>
          <span className="rounded-full bg-violet-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-violet-700 dark:bg-violet-950/30 dark:text-violet-300">{insight.projects.length} active project{insight.projects.length === 1 ? '' : 's'}</span>
        </div>
        {insight.projects.length ? <div className="mt-3 space-y-2">
          {insight.projects.map((project) => <article key={project.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/40">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2.5"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-[#004687] shadow-sm dark:bg-slate-900 dark:text-blue-300"><FolderKanban size={17} aria-hidden /></span><div className="min-w-0"><p className="truncate text-sm font-black text-slate-900 dark:text-white">{project.name}</p><p className="mt-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">{project.code} · {project.status.replaceAll('_', ' ')}</p></div></div>
            </div>
            <div className="grid grid-cols-4 gap-3 text-center">
              {[['Assigned', project.assigned], ['Active', project.active], ['Completed', project.done], ['Overdue', project.overdue]].map(([label, value]) => <div key={label}><p className="text-sm font-black text-slate-950 dark:text-white">{value}</p><p className="mt-0.5 text-[8px] font-bold uppercase tracking-wide text-slate-500">{label}</p></div>)}
            </div>
            <div className="shrink-0 text-right"><p className="text-lg font-black text-[#004687] dark:text-blue-300">{project.contributionPercent == null ? '—' : `${project.contributionPercent}%`}</p><p className="text-[8px] font-bold uppercase tracking-wide text-slate-500">Contribution</p></div>
          </article>)}
        </div> : <div className="mt-3 flex min-h-24 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/30 dark:text-slate-400">No project-linked ticket activity was recorded for this selection.</div>}
      </section>}

      {insight.target === 'PERSON' && <section className="order-2 px-1 xl:col-span-2" aria-label="Individual attendance analysis">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-black text-slate-900 dark:text-white">Attendance</h3>
          {analysisMode === 'monthly' && <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">Individual monthly calendar</span>}
        </div>
        {analysisMode === 'monthly' ? <div className="mt-3 space-y-3">
          <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Attendance record filters">
            {attendanceFilterKpis.map((kpi) => <AttendanceFilterKpi
              key={kpi.filter}
              label={kpi.label}
              value={kpi.value}
              color={kpi.color}
              selected={attendanceFilter === kpi.filter}
              onClick={() => setAttendanceFilter((current) => current === kpi.filter ? null : kpi.filter)}
            />)}
            <article className="flex min-w-[118px] flex-1 items-center gap-2 rounded-xl border border-blue-200 bg-blue-50/70 px-3 py-2 dark:border-blue-800 dark:bg-blue-950/20">
              <span className="h-3.5 w-3.5 shrink-0 rounded-[4px] border border-blue-200 bg-blue-200 dark:border-blue-700 dark:bg-blue-700" aria-hidden />
              <span className="min-w-0"><span className="block truncate text-[9px] font-bold uppercase tracking-[0.08em] text-blue-700 dark:text-blue-300">Allocated leave</span><span className="mt-0.5 block text-lg font-black leading-none text-slate-950 dark:text-white">{workday.leaveUsage?.allocatedDays ?? '—'}</span></span>
            </article>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white px-5 dark:border-slate-700 dark:bg-slate-950/20">
            <div className={attendanceInsightsStyles.distribution}>
              <div>
                <h3>Attendance record</h3>
                <span>{attendanceFilter ? `${filteredAttendanceCount} matching day${filteredAttendanceCount === 1 ? '' : 's'}` : `${attendanceDays.filter((day) => day.date <= today).length} recorded days`} · open days stay provisional</span>
              </div>
              <div className={attendanceInsightsStyles.dayStrip} aria-label={`${readablePeriod('monthly', month, date)} attendance record`}>
                {attendanceDays.map((day) => {
                  const canSelect = day.date <= today;
                  const label = day.holidayName || attendanceDayLabel(day.status);
                  const matches = !attendanceFilter || matchesAttendanceFilter(day.status, attendanceFilter);
                  return <button
                    key={day.date}
                    type="button"
                    disabled={!canSelect}
                    onClick={() => { setDate(day.date); setAnalysisMode('daily'); }}
                    title={`${day.date} · ${label}`}
                    aria-label={`${day.date}, ${label}`}
                    style={{ '--day-color': ATTENDANCE_DAY_COLOR[day.status] ?? '#E7EDF6', opacity: matches ? 1 : 0.18 } as React.CSSProperties}
                  ><i /><span>{Number(day.date.slice(-2))}</span></button>;
                })}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-2">
                  {attendanceFilter && <button type="button" onClick={() => setAttendanceFilter(null)} className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold text-slate-600 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300">Clear filter</button>}
                  {workday.leaveUsage && <button type="button" onClick={() => setShowLeaveDetails(true)} className="rounded-full bg-rose-50 px-3 py-1 text-[10px] font-bold text-rose-700 transition hover:bg-rose-100 dark:bg-rose-950/30 dark:text-rose-300">View leave records</button>}
                </div>
              </div>
            </div>
          </div>
        </div> : <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">{personalAttendanceKpis}</div>}
      </section>}
    </div>}
    {showLeaveDetails && insight?.target === 'PERSON' && workday?.leaveUsage && <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowLeaveDetails(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="team-leave-details-title" className="w-full max-w-3xl overflow-hidden rounded-3xl border border-blue-200 bg-white shadow-2xl dark:border-blue-800 dark:bg-slate-900">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 dark:border-slate-700">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-blue-700 dark:text-blue-300">FY {workday.leaveUsage.financialYear}</p>
            <h3 id="team-leave-details-title" className="mt-1 text-xl font-black text-slate-950 dark:text-white">Leaves taken by {insight.identity?.name}</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{workday.leaveUsage.takenDays} approved day{workday.leaveUsage.takenDays === 1 ? '' : 's'} from {workday.leaveUsage.allocatedDays} allocated</p>
          </div>
          <button type="button" onClick={() => setShowLeaveDetails(false)} aria-label="Close leave details" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"><X size={18} aria-hidden /></button>
        </header>
        <div className="max-h-[65vh] overflow-y-auto p-6">
          {workday.leaveUsage.leaves.length ? <div className="space-y-3">
            {workday.leaveUsage.leaves.map((leave) => <article key={leave.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50/70 px-4 py-3 dark:border-rose-900 dark:bg-rose-950/20">
              <div>
                <p className="text-sm font-black text-slate-900 dark:text-white">{leave.type.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase())}</p>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{leaveDateRange(leave.startDate, leave.endDate)}</p>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-rose-700 shadow-sm dark:bg-slate-900 dark:text-rose-300">{leave.isHalfDay ? 'Half day' : 'Approved'}</span>
            </article>)}
          </div> : <div className="grid min-h-40 place-items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-center dark:border-slate-700 dark:bg-slate-800/40">
            <div><p className="font-bold text-slate-800 dark:text-slate-100">No approved leave records</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">There are no leaves taken in this financial year.</p></div>
          </div>}
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
          <span>{workday.leaveUsage.pendingDays} pending day{workday.leaveUsage.pendingDays === 1 ? '' : 's'} not included in leaves taken</span>
          <button type="button" onClick={() => setShowLeaveDetails(false)} className="rounded-xl bg-[#004687] px-5 py-2.5 font-bold text-white shadow-sm transition hover:bg-[#003765] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">Close</button>
        </footer>
      </section>
    </div>}
  </SectionFrame>;
}
