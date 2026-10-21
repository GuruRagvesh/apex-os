'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Building2, CalendarDays, Gauge, TicketCheck, UserRound, Users } from 'lucide-react';
import { dashboardApi } from '../api/dashboard-api';
import type { HomeExperience, TeamInsightPayload } from './home-types';
import { SectionFrame } from './home-ui';

const EMPTY_DEPARTMENTS: HomeExperience['team']['departments'] = [];

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function minutesLabel(value: number | null | undefined) {
  if (value == null) return '—';
  const hours = Math.floor(value / 60);
  const minutes = Math.round(value % 60);
  return hours ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
}

function weekDateRange(from: string, to: string) {
  const format = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${format(from)}–${format(to)}`;
}

function statusLabel(status?: string) {
  return ({ WORKING: 'Working now', ON_BREAK: 'On break', IN_MEETING: 'In a meeting', ON_LEAVE: 'On leave', IDLE: 'Paused', LOGGED_OUT: 'Day ended', OFFLINE: 'Not started' } as Record<string, string>)[status ?? ''] ?? 'Not started';
}

function MetricTile({ label, value, note, danger = false, strongBorder = false }: { label: string; value: string | number; note?: string; danger?: boolean; strongBorder?: boolean }) {
  const surface = danger ? 'bg-rose-50/70 dark:bg-rose-950/20' : 'bg-white dark:bg-slate-900';
  const border = strongBorder ? 'border-black dark:border-slate-300' : danger ? 'border-rose-300 dark:border-rose-700' : 'apex-section-border-subtle';
  return <div className={`rounded-xl border px-3 py-3 ${surface} ${border}`}>
    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">{label}</p>
    <p className={`mt-1 text-xl font-bold ${danger ? 'text-rose-600 dark:text-rose-300' : 'text-slate-900 dark:text-white'}`}>{value}</p>
    {note && <p className="mt-0.5 text-[10px] leading-4 text-slate-500 dark:text-slate-400">{note}</p>}
  </div>;
}

export function TeamInsightsSection({ team, highlightSla = true, compact = false }: { team: HomeExperience['team']; highlightSla?: boolean; compact?: boolean }) {
  const [departmentId, setDepartmentId] = useState('all');
  const [personId, setPersonId] = useState('overall');
  const [month, setMonth] = useState(currentMonth);
  const [week, setWeek] = useState('all');
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

  const insightQuery = useQuery({
    queryKey: ['home-team-insights', departmentId, personId, month, week],
    queryFn: () => dashboardApi.getTeamInsights({
      ...(departmentId !== 'all' ? { departmentId } : {}),
      personId,
      month,
      week,
    }) as Promise<TeamInsightPayload>,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
  const insight = insightQuery.data;
  useEffect(() => {
    if (week !== 'all' && insight && !insight.period.weeks.some((item) => String(item.value) === week)) setWeek('all');
  }, [insight, week]);

  const overallLabel = team.hierarchyRole === 'TEAM_LEAD'
    ? 'Overall team'
    : team.hierarchyRole === 'MANAGER'
      ? departmentId === 'all' ? 'Overall assigned departments' : `Overall ${selectedDepartment?.name ?? 'department'}`
      : departmentId === 'all' ? 'Overall company' : `Overall ${selectedDepartment?.name ?? 'department'}`;

  const filters = <div className="flex max-w-full flex-nowrap items-center justify-end gap-2 overflow-x-auto pb-0.5">
    {team.showDepartmentFilter && <label className="relative flex min-w-[170px] flex-none items-center">
      <Building2 size={14} className="pointer-events-none absolute left-3 text-slate-500" aria-hidden />
      <span className="sr-only">Department</span>
      <select
        value={departmentId}
        onChange={(event) => { setDepartmentId(event.target.value); setPersonId('overall'); }}
        className="h-9 w-full appearance-none rounded-lg border border-blue-900 bg-white pl-9 pr-8 text-xs font-medium text-slate-700 outline-none transition focus:border-blue-700 focus:ring-2 focus:ring-blue-100 dark:border-blue-400 dark:bg-slate-900 dark:text-slate-200"
        aria-label="Filter team insights by department"
      >
        <option value="all">{team.hierarchyRole === 'MANAGER' ? 'All assigned departments' : 'All departments'}</option>
        {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
      </select>
    </label>}
    <label className="relative flex min-w-[180px] flex-none items-center">
      <UserRound size={14} className="pointer-events-none absolute left-3 text-slate-500" aria-hidden />
      <span className="sr-only">Person</span>
      <select
        value={personId}
        onChange={(event) => setPersonId(event.target.value)}
        className="h-9 w-full appearance-none rounded-lg border border-blue-900 bg-white pl-9 pr-8 text-xs font-medium text-slate-700 outline-none transition focus:border-blue-700 focus:ring-2 focus:ring-blue-100 dark:border-blue-400 dark:bg-slate-900 dark:text-slate-200"
        aria-label="Filter team insights by person"
      >
        <option value="overall">{overallLabel}</option>
        {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select>
    </label>
    <label className="relative flex min-w-[145px] flex-none items-center">
      <CalendarDays size={14} className="pointer-events-none absolute left-3 text-slate-500" aria-hidden />
      <span className="sr-only">Month</span>
      <input type="month" value={month} onChange={(event) => { setMonth(event.target.value); setWeek('all'); }} className="h-9 w-full rounded-lg border border-blue-900 bg-white pl-9 pr-2 text-xs font-medium text-slate-700 outline-none transition focus:border-blue-700 focus:ring-2 focus:ring-blue-100 dark:border-blue-400 dark:bg-slate-900 dark:text-slate-200" />
    </label>
    <label className="relative flex min-w-[175px] flex-none items-center">
      <span className="sr-only">Week</span>
      <select value={week} onChange={(event) => setWeek(event.target.value)} className="h-9 w-full rounded-lg border border-blue-900 bg-white px-3 text-xs font-medium text-slate-700 outline-none transition focus:border-blue-700 focus:ring-2 focus:ring-blue-100 dark:border-blue-400 dark:bg-slate-900 dark:text-slate-200">
        <option value="all">Whole month</option>
        {(insight?.period.weeks ?? []).map((item) => <option key={item.value} value={item.value}>{item.label} · {weekDateRange(item.from, item.to)}</option>)}
      </select>
    </label>
  </div>;

  const focus = insight?.focus.ratio;
  const focusColor = focus == null ? '#cbd5e1' : focus >= 65 ? '#16a34a' : focus >= 45 ? '#d97706' : '#dc2626';
  const trendMax = Math.max(1, ...(insight?.productivity.buckets.filter((bucket) => !bucket.isFuture).map((bucket) => bucket.averageMinutes) ?? [1]));
  const actualWorkingMinutes = insight?.workday.workingMinutes ?? 0;
  const workdayTotal = Math.max(1, actualWorkingMinutes);
  const productiveShareMinutes = Math.min(insight?.workday.productiveMinutes ?? 0, actualWorkingMinutes);
  const otherMinutes = Math.max(0, actualWorkingMinutes - productiveShareMinutes);

  return <SectionFrame icon={Users} title="Team Insights" aside={filters}>
    {insightQuery.isLoading && <div className="grid min-h-[280px] place-items-center rounded-xl border border-slate-200 text-sm text-slate-500 dark:border-slate-700">Calculating live insights…</div>}
    {insightQuery.isError && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-300"><span>These insights could not be calculated from the current database.</span><button type="button" onClick={() => insightQuery.refetch()} className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700">Try again</button></div>}
    {insight && <div className={compact ? 'space-y-2' : 'space-y-3'} aria-label="Selected person insight canvas" data-department-id={departmentId} data-person-id={personId}>
      <div className="grid gap-3 lg:grid-cols-[1fr_210px]">
        <article className="apex-section-border flex min-h-[132px] flex-wrap items-center gap-4 rounded-2xl border bg-white p-4 dark:bg-slate-900">
          <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-blue-500 to-indigo-700 text-lg font-bold text-white shadow-sm" style={insight.identity?.photoUrl ? { backgroundImage: `url(${insight.identity.photoUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>{insight.identity?.photoUrl ? '' : insight.identity?.initials ?? <Users size={24} />}</div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-bold text-slate-900 dark:text-white">{insight.identity?.name ?? overallLabel}</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {insight.identity ? <><span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 dark:bg-blue-950/50 dark:text-blue-200">{insight.identity.role.replace(/_/g, ' ')}</span>{insight.identity.department && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{insight.identity.department.name}</span>}</> : <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{insight.scope.people} active people</span>}
            </div>
            {insight.identity && <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200"><span className={`h-2.5 w-2.5 rounded-full ${insight.identity.status === 'WORKING' ? 'bg-emerald-500' : insight.identity.status === 'IN_MEETING' ? 'bg-violet-500' : insight.identity.status === 'ON_BREAK' ? 'bg-amber-500' : 'bg-slate-400'}`} />{statusLabel(insight.identity.status)} · {minutesLabel(insight.identity.workingMinutes)}{insight.identity.status === 'ON_BREAK' && insight.identity.activeBreakMinutes ? ` · break ${minutesLabel(insight.identity.activeBreakMinutes)}` : ''}</div>}
          </div>
        </article>
        <article className="apex-section-border flex items-center justify-center gap-4 rounded-2xl border bg-white p-4 dark:bg-slate-900">
          <div className="grid h-24 w-24 place-items-center rounded-full" style={{ background: `conic-gradient(${focusColor} ${(focus ?? 0) * 3.6}deg, #e2e8f0 0)` }}><div className="grid h-[74px] w-[74px] place-items-center rounded-full bg-white text-center dark:bg-slate-900"><div><strong className="text-xl text-slate-900 dark:text-white">{focus == null ? '—' : `${focus}%`}</strong><p className="text-[9px] font-semibold uppercase text-slate-500">Focus</p></div></div></div>
          <div><p className="text-xs font-semibold text-slate-800 dark:text-slate-100">Focus ratio</p><p className="mt-1 text-[10px] text-slate-500">Tickets + meetings<br />÷ working time</p>{insight.focus.changePoints != null && <p className={`mt-2 text-xs font-semibold ${insight.focus.changePoints >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{insight.focus.changePoints >= 0 ? '▲' : '▼'} {Math.abs(insight.focus.changePoints)} pts</p>}</div>
        </article>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.2fr_.8fr]">
        <article className="apex-section-border rounded-2xl border bg-white p-3 dark:bg-slate-900">
          <div className="mb-3 flex items-start justify-between gap-3"><div><h3 className="w-fit rounded-lg bg-slate-700 px-3 py-2 text-sm font-bold text-white shadow-sm">Workday</h3><p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Averages across {insight.workday.daysWorked} worked person-day{insight.workday.daysWorked === 1 ? '' : 's'}</p></div><Activity size={17} className="mt-2 text-slate-600" /></div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <MetricTile label="Working hours" value={minutesLabel(insight.workday.averages.workingMinutes)} note="Punch in to punch out − breaks" strongBorder />
            <MetricTile label="Productive hours" value={minutesLabel(insight.workday.averages.productiveMinutes)} note="Tickets + meetings" strongBorder />
            <MetricTile label="Break time" value={minutesLabel(insight.workday.averages.breakMinutes)} note="Non-meeting breaks" strongBorder />
            <MetricTile label="Meetings" value={insight.workday.averages.meetingCount == null ? '—' : `${insight.workday.averages.meetingCount} / day`} note={`${minutesLabel(insight.workday.averages.meetingMinutes)} per day`} strongBorder />
          </div>
          <div className="mt-3 flex h-7 overflow-hidden rounded-full bg-slate-100 text-[9px] font-semibold dark:bg-slate-800" aria-label="Working-time composition">
            <div className="grid min-w-fit place-items-center bg-gradient-to-r from-blue-600 to-violet-500 px-2 text-white" style={{ width: `${productiveShareMinutes / workdayTotal * 100}%` }} title={`Productive time ${minutesLabel(insight.workday.productiveMinutes)}`}>Productive {minutesLabel(insight.workday.productiveMinutes)}</div>
            <div className="grid min-w-fit place-items-center px-2 text-slate-600 dark:text-slate-300" style={{ width: `${otherMinutes / workdayTotal * 100}%` }} title={`Other working time ${minutesLabel(otherMinutes)}`}>Other {minutesLabel(otherMinutes)}</div>
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-[10px] font-semibold text-slate-500"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-blue-500" />Tickets {minutesLabel(insight.workday.ticketMinutes)}</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-violet-500" />Meetings {minutesLabel(insight.workday.meetingMinutes)}</span><span className="font-normal">Overlapping ticket and meeting time is counted once.</span></div>
        </article>
        <article className="apex-section-border rounded-2xl border bg-white p-3 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-3"><div><h3 className="w-fit rounded-lg bg-slate-700 px-3 py-2 text-sm font-bold text-white shadow-sm">Productivity Direction</h3><p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Productive time only: tickets + meetings</p></div><span className={`mt-1 rounded-full px-2.5 py-1 text-[10px] font-bold ${insight.productivity.direction === 'RISING' ? 'bg-emerald-100 text-emerald-700' : insight.productivity.direction === 'FALLING' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-700'}`}>{insight.productivity.direction.replace('_', ' ')}</span></div>
          <div className="mt-4 flex h-28 items-end gap-2">{insight.productivity.buckets.map((bucket) => <div key={bucket.label} className={`flex min-w-0 flex-1 flex-col items-center gap-1 ${bucket.isFuture ? 'opacity-55' : ''}`} title={bucket.isFuture ? `${bucket.label} has not started` : `${minutesLabel(bucket.minutes)} total across ${bucket.daysWorked} worked person-day${bucket.daysWorked === 1 ? '' : 's'}${bucket.isPartial ? ' (to date)' : ''}`}><span className="text-[9px] font-semibold text-slate-500">{bucket.isFuture ? 'Upcoming' : minutesLabel(bucket.averageMinutes)}</span><div className={`w-full rounded-t-md ${bucket.isFuture ? 'border border-dashed border-slate-300 bg-slate-100 dark:border-slate-600 dark:bg-slate-800' : 'bg-gradient-to-t from-blue-600 to-cyan-400'}`} style={{ height: bucket.isFuture ? '18px' : `${Math.max(4, bucket.averageMinutes / trendMax * 78)}px` }} /><span className="text-[9px] text-slate-500">{bucket.label}{bucket.isPartial ? ' · to date' : ''}</span></div>)}</div>
          <p className="mt-3 text-xs font-semibold text-slate-700 dark:text-slate-200">{insight.productivity.changePercent == null ? 'No complete comparison period yet' : `${insight.productivity.changePercent >= 0 ? '+' : ''}${insight.productivity.changePercent}% vs the preceding equivalent period`}</p>
        </article>
      </div>

      <div className={`grid gap-3 ${insight.attendance ? 'xl:grid-cols-[1.65fr_.85fr]' : ''}`}>
        <article className="apex-section-border rounded-2xl border bg-white p-3 dark:bg-slate-900">
          <div className="mb-3 flex items-start justify-between gap-3"><h3 className="w-fit rounded-lg bg-slate-700 px-3 py-2 text-sm font-bold text-white shadow-sm">Tickets</h3><TicketCheck size={17} className="mt-2 text-slate-600" /></div>
          <div className={`grid grid-cols-2 gap-2 sm:grid-cols-4 ${insight.attendance ? 'xl:grid-cols-4' : 'xl:grid-cols-7'}`}>
            <MetricTile label="Active" value={insight.tickets.active} strongBorder />
            <MetricTile label="In progress" value={insight.tickets.inProgress} strongBorder />
            <MetricTile label="Under review" value={insight.tickets.underReview} note="During this period" strongBorder />
            <MetricTile label="Sent for review" value={insight.tickets.sentForReview} note="Distinct tickets" strongBorder />
            <MetricTile label="Execution overdue" value={insight.tickets.executionOverdue} note="Not submitted on time" danger={highlightSla && insight.tickets.executionOverdue > 0} strongBorder />
            <MetricTile label="Review overdue" value={insight.tickets.reviewOverdue} note="Reviewer SLA elapsed" danger={highlightSla && insight.tickets.reviewOverdue > 0} strongBorder />
            <div title={`${insight.tickets.reworkAttempts} total rework attempt${insight.tickets.reworkAttempts === 1 ? '' : 's'}`}><MetricTile label="Reworked" value={insight.tickets.reworkTickets} note={`${insight.tickets.reworkAttempts} attempt${insight.tickets.reworkAttempts === 1 ? '' : 's'}`} danger={insight.tickets.reworkTickets > 0} strongBorder /></div>
          </div>
        </article>

        {insight.attendance && <article className="apex-section-border rounded-2xl border bg-white p-3 dark:bg-slate-900">
          <div><h3 className="w-fit rounded-lg bg-slate-700 px-3 py-2 text-sm font-bold text-white shadow-sm">Attendance Pattern</h3><p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">One square for each recorded day</p></div>
          <div className="mt-3 grid grid-cols-7 gap-1.5">{insight.attendance.days.map((day) => <span key={day.date} title={`${day.date} · ${day.status.replace(/_/g, ' ')}`} className={`grid aspect-square min-h-7 place-items-center rounded-md border text-[9px] font-bold text-slate-800 ${day.status === 'PRESENT' ? 'border-emerald-500 bg-emerald-300' : day.status.startsWith('LATE') ? 'border-orange-500 bg-orange-300' : day.status === 'HALF_DAY' ? 'border-violet-500 bg-violet-300' : ['LEAVE', 'LWP', 'ABSENT'].includes(day.status) ? 'border-rose-500 bg-rose-300' : day.status === 'WEEKLY_OFF' ? 'border-blue-500 bg-blue-200' : day.status === 'HOLIDAY' ? 'border-amber-500 bg-amber-200' : 'border-slate-400 bg-slate-200'}`}>{Number(day.date.slice(-2))}</span>)}</div>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[9px] font-semibold text-slate-500">{Object.entries(insight.attendance.counts).filter(([, value]) => value > 0).map(([key, value]) => <span key={key}>{key.replace(/([A-Z])/g, ' $1')}: {value}</span>)}</div>
        </article>}
      </div>

      <article className="apex-section-border overflow-hidden rounded-2xl border bg-white p-3 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3"><div><h3 className="w-fit rounded-lg bg-slate-700 px-3 py-2 text-sm font-bold text-white shadow-sm">Projects Contributed To</h3><p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">{insight.scope.companyWide ? 'Company totals; contribution percentage is not applicable at this scope' : 'Distinct tickets; co-assignment never duplicates a ticket'}</p></div><Gauge size={17} className="mt-2 text-slate-600" /></div>
        {insight.projects.length ? <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/60"><tr><th className="px-4 py-2.5">Project</th><th>Status</th><th>Assigned</th><th>Done</th><th>Active</th><th>Overdue</th><th className="pr-4">Contribution</th></tr></thead><tbody>{insight.projects.map((project) => <tr key={project.id} className={`border-t dark:border-slate-800 ${project.hasStatusConflict ? 'border-amber-200 bg-amber-50/70 dark:bg-amber-950/10' : 'border-slate-100'}`}><td className="px-4 py-3"><p className="font-semibold text-slate-800 dark:text-slate-100">{project.name}</p><p className="text-[10px] text-slate-500">{project.code}</p>{project.hasStatusConflict && <p className="mt-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300">Data check: completed project still has active tickets</p>}</td><td><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{project.status}</span></td><td>{project.assigned}</td><td className="font-semibold text-emerald-600">{project.done}</td><td>{project.active}</td><td className={project.overdue ? 'font-semibold text-rose-600' : ''}>{project.overdue}</td><td className="pr-4">{insight.scope.companyWide ? <span className="text-[10px] font-semibold text-slate-500">Not applicable</span> : <div className="flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${project.contributionPercent ?? 0}%` }} /></div><span className="w-9 text-right font-semibold">{project.contributionPercent == null ? '—' : `${project.contributionPercent}%`}</span></div>}</td></tr>)}</tbody></table></div> : <div className="p-6 text-center text-sm text-slate-500">No project contribution is recorded for this scope.</div>}
      </article>
    </div>}
  </SectionFrame>;
}
