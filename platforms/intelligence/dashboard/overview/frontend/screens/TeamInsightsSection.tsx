'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Building2, CalendarDays, CheckCircle2, Eye, FolderKanban, PlayCircle, Ticket, UserRound, Users } from 'lucide-react';
import { dashboardApi } from '../api/dashboard-api';
import type { HomeExperience, TeamInsightPayload, TeamInsightProject } from './home-types';
import { SectionFrame } from './home-ui';

const EMPTY_DEPARTMENTS: HomeExperience['team']['departments'] = [];
type AnalysisMode = 'monthly' | 'daily';

function localDay() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function personInitials(name: string | null | undefined) {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return `${words[0][0]}${words.length > 1 ? words[words.length - 1][0] : ''}`.toUpperCase();
}

function projectDepartmentLabel(project: TeamInsightProject) {
  const departments = project.departments?.length
    ? project.departments
    : project.department ? [project.department] : [];
  if (!departments.length) return 'No department assigned';
  if (departments.length === 1) return departments[0].name;
  return `Cross-department · ${departments.map((department) => department.name).join(', ')}`;
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
      <select value={personId} onChange={(event) => setPersonId(event.target.value)} className="h-9 w-full appearance-none rounded-lg border border-[#004687] bg-[#004687] pl-9 pr-8 text-xs font-bold text-white outline-none focus:ring-2 focus:ring-blue-300 [&>option]:bg-white [&>option]:text-slate-800">
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

  const identityStatus = readablePersonStatus(insight?.identity?.status);

  return <SectionFrame icon={Users} title="Team Insights" titleColor="#004687" aside={filters}>
    {insightQuery.isLoading && <div className="grid min-h-64 place-items-center rounded-2xl border border-slate-200 bg-white text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900">Loading team insights…</div>}
    {insightQuery.isError && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-300"><span>Team insights could not be loaded.</span><button type="button" onClick={() => insightQuery.refetch()} className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700">Try again</button></div>}
    {insight && <div className="grid grid-cols-1 gap-5" data-department-id={departmentId} data-person-id={personId}>
      <header className="order-0 flex flex-wrap items-center gap-3 px-1">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-blue-500 to-indigo-700 font-bold text-white">
            <span aria-hidden>{personInitials(insight.identity?.name ?? overallLabel)}</span>
            {insight.identity?.photoUrl && <img src={insight.identity.photoUrl} alt="" className="absolute inset-0 h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
          </div>
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-base font-bold text-slate-900 dark:text-white">{insight.identity?.name ?? overallLabel}</h3>{insight.identity && <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${identityStatus.tone}`}><i className="h-1.5 w-1.5 rounded-full bg-current" />{identityStatus.label}</span>}</div><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{insight.identity ? [readableRole(insight.identity.role), insight.identity.department?.name].filter(Boolean).join(' · ') : `${insight.scope.people} people in the permitted hierarchy scope`}</p></div>
        </div>
      </header>

      <section className="order-1 px-1" aria-label="Ticket analysis">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h3 className="inline-flex rounded-lg bg-slate-600 px-3 py-1.5 text-sm font-black text-white ring-1 ring-inset ring-slate-700 dark:bg-slate-600 dark:text-white dark:ring-slate-500">Ticket Analysis</h3></div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
          <TicketKpi icon={Ticket} label="Active" value={insight.tickets.active} tone="blue" />
          <TicketKpi icon={PlayCircle} label="In progress" value={insight.tickets.inProgress} tone="violet" />
          <TicketKpi icon={Eye} label="Under review" value={insight.tickets.underReview} tone="amber" />
          <TicketKpi icon={AlertTriangle} label="Overdue" value={insight.tickets.overdue} tone="rose" />
          <TicketKpi icon={CheckCircle2} label="Completed" value={insight.tickets.completed} tone="emerald" />
        </div>
      </section>

      <section className="order-2 px-1" aria-label={insight.scope.companyWide ? 'Active projects' : 'Project contributions'}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h3 className="inline-flex rounded-lg bg-slate-600 px-3 py-1.5 text-sm font-black text-white ring-1 ring-inset ring-slate-700 dark:bg-slate-600 dark:text-white dark:ring-slate-500">{insight.scope.companyWide ? 'Active Projects' : 'Project Contributions'}</h3></div>
          {insight.scope.companyWide && <span className="rounded-full bg-blue-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-blue-700 ring-1 ring-inset ring-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:ring-blue-800">{insight.projects.length} ongoing project{insight.projects.length === 1 ? '' : 's'}</span>}
        </div>
        {insight.projects.length ? <div className={`mt-3 space-y-2 ${insight.scope.companyWide ? 'max-h-[360px] overflow-y-auto pr-1' : ''}`}>
          {insight.projects.map((project) => <article key={project.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/40">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2.5"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-[#004687] shadow-sm dark:bg-slate-900 dark:text-blue-300"><FolderKanban size={17} aria-hidden /></span><div className="min-w-0"><p className="truncate text-sm font-black text-slate-900 dark:text-white">{project.name}</p><p className="mt-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">{project.code} · {projectDepartmentLabel(project)}{insight.scope.companyWide ? '' : ` · ${project.status.replaceAll('_', ' ')}`}</p></div></div>
            </div>
            <div className={`grid gap-3 text-center ${insight.scope.companyWide ? 'grid-cols-3' : 'grid-cols-4'}`}>
              {(insight.scope.companyWide
                ? [['Active', project.active], ['In progress', project.inProgress ?? 0], ['Completed', project.done]]
                : [['Assigned', project.assigned], ['Active', project.active], ['Completed', project.done], ['Overdue', project.overdue]]
              ).map(([label, value]) => <div key={label}><p className="text-sm font-black text-slate-950 dark:text-white">{value}</p><p className="mt-0.5 text-[8px] font-bold uppercase tracking-wide text-slate-500">{label}</p></div>)}
            </div>
            {!insight.scope.companyWide && <div className="shrink-0 text-right"><p className="text-lg font-black text-[#004687] dark:text-blue-300">{project.contributionPercent == null ? '—' : `${project.contributionPercent}%`}</p><p className="text-[8px] font-bold uppercase tracking-wide text-slate-500">Contribution</p></div>}
          </article>)}
        </div> : <div className="mt-3 flex min-h-24 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/30 dark:text-slate-400">{insight.scope.companyWide ? 'No active projects are currently recorded.' : 'No project-linked ticket activity was recorded for this selection.'}</div>}
      </section>

    </div>}
  </SectionFrame>;
}
