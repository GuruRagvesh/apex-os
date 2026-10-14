'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Building2, FolderKanban, UserRound, Users } from 'lucide-react';
import type { HomeExperience } from './home-types';
import { EmptyState, SectionFrame, SmallLink, formatDate } from './home-ui';

const EMPTY_DEPARTMENTS: HomeExperience['team']['departments'] = [];

export function TeamInsightsSection({ team }: { team: HomeExperience['team'] }) {
  const [departmentId, setDepartmentId] = useState('');
  const [personId, setPersonId] = useState('');
  const departments = team.departments ?? EMPTY_DEPARTMENTS;

  useEffect(() => {
    setDepartmentId((current) => departments.some((department) => department.id === current)
      ? current
      : departments[0]?.id ?? '');
  }, [departments]);

  const selectedDepartment = departments.find((department) => department.id === departmentId)
    ?? departments[0];
  const people = useMemo(() => team.showDepartmentFilter
    ? selectedDepartment?.people ?? []
    : departments.flatMap((department) => department.people)
      .filter((person, index, all) => all.findIndex((candidate) => candidate.id === person.id) === index),
  [departments, selectedDepartment, team.showDepartmentFilter]);

  useEffect(() => {
    setPersonId((current) => people.some((person) => person.id === current)
      ? current
      : people[0]?.id ?? '');
  }, [departmentId, people]);

  const filters = <div className="flex flex-wrap items-center justify-end gap-2">
    {team.showDepartmentFilter && <label className="relative flex min-w-[190px] items-center">
      <Building2 size={14} className="pointer-events-none absolute left-3 text-slate-500" aria-hidden />
      <span className="sr-only">Department</span>
      <select
        value={selectedDepartment?.id ?? ''}
        onChange={(event) => setDepartmentId(event.target.value)}
        className="h-9 w-full appearance-none rounded-lg border border-slate-200 bg-white pl-9 pr-8 text-xs font-medium text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        aria-label="Filter team insights by department"
      >
        {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
      </select>
    </label>}
    <label className="relative flex min-w-[210px] items-center">
      <UserRound size={14} className="pointer-events-none absolute left-3 text-slate-500" aria-hidden />
      <span className="sr-only">Person</span>
      <select
        value={personId}
        onChange={(event) => setPersonId(event.target.value)}
        disabled={!people.length}
        className="h-9 w-full appearance-none rounded-lg border border-slate-200 bg-white pl-9 pr-8 text-xs font-medium text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        aria-label="Filter team insights by person"
      >
        {!people.length && <option value="">No people available</option>}
        {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select>
    </label>
  </div>;

  return (
    <SectionFrame icon={Users} title="Team insights" aside={filters}>
      <div
        className="min-h-[190px] rounded-xl border border-dashed border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/30"
        aria-label="Selected person insight canvas"
        data-department-id={selectedDepartment?.id ?? ''}
        data-person-id={personId}
      />
    </SectionFrame>
  );
}

export function ProjectInsightsSection({ projects }: { projects: HomeExperience['projects'] }) {
  const [mode, setMode] = useState<'focus' | 'compare'>('compare');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  useEffect(() => {
    setSelectedIds((current) => {
      const available = current.filter((id) => projects.some((project) => project.id === id));
      return available.length ? available : projects.slice(0, 2).map((project) => project.id);
    });
  }, [projects]);
  const select = (id: string) => {
    if (mode === 'focus') { setSelectedIds([id]); return; }
    setSelectedIds((current) => current.includes(id)
      ? current.length > 1 ? current.filter((item) => item !== id) : current
      : [...current.slice(-1), id]);
  };
  const visible = projects.filter((project) => selectedIds.includes(project.id)).slice(0, mode === 'focus' ? 1 : 2);

  return (
    <SectionFrame icon={FolderKanban} title="Project insights" aside={<SmallLink href="/projects">All projects</SmallLink>}>
      {projects.length ? <>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <button type="button" onClick={() => { setMode('focus'); setSelectedIds((current) => current.slice(0, 1)); }} className={`rounded-full px-3 py-1.5 ${mode === 'focus' ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>Focus on one</button>
          <button type="button" onClick={() => { setMode('compare'); setSelectedIds((current) => current.length === 1 && projects.length > 1 ? [current[0], projects.find((project) => project.id !== current[0])!.id] : current); }} className={`rounded-full px-3 py-1.5 ${mode === 'compare' ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>Compare projects</button>
          <span className="ml-auto text-slate-500 dark:text-slate-400">{selectedIds.length} selected</span>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">{projects.map((project) => <button type="button" key={project.id} onClick={() => select(project.id)} aria-pressed={selectedIds.includes(project.id)} className={`rounded-full border px-3 py-1.5 text-xs ${selectedIds.includes(project.id) ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}>{selectedIds.includes(project.id) ? '✓ ' : '+ '}{project.name}</button>)}</div>
        <div className={`grid gap-3 ${visible.length > 1 ? 'lg:grid-cols-2' : ''}`}>{visible.map((project) => {
          const expanded = expandedIds.includes(project.id);
          const people = expanded ? project.people : project.people.slice(0, 3);
          return <article key={project.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><Link href={`/projects/${project.id}`} className="text-sm font-semibold text-slate-900 hover:text-blue-600 dark:text-slate-100">{project.name}</Link><p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{project.lead ? `${project.lead} · ` : ''}Due {formatDate(project.endDate)}</p></div><span className={`text-[11px] font-medium ${project.overdue || project.blocked ? 'text-amber-700 dark:text-amber-300' : 'text-green-700 dark:text-green-300'}`}>● {project.overdue || project.blocked ? 'At risk' : 'On track'}</span></div>
            <div className="mt-4 flex items-baseline justify-between"><span className="text-xs text-slate-600 dark:text-slate-300">Ticket completion</span><strong className="text-lg text-slate-900 dark:text-slate-100">{project.progress}%</strong></div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div className="h-full bg-green-500" style={{ width: `${project.progress}%` }} /></div>
            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">{project.done} of {project.total} tickets completed · In progress {project.inProgress} · Review {project.review} · To do {project.todo}</p>
            <div className="mt-4 grid grid-cols-4 gap-1.5">{([['Active', project.active], ['Done', project.done], ['Overdue', project.overdue], ['Blocked', project.blocked]] as const).map(([label, count]) => <div key={label} className="rounded-lg bg-slate-50 px-2 py-2 dark:bg-slate-800"><p className="text-[10px] text-slate-500 dark:text-slate-400">{label}</p><p className={`mt-1 text-lg font-semibold ${label === 'Overdue' && count ? 'text-rose-600' : label === 'Done' ? 'text-green-600' : 'text-slate-800 dark:text-slate-100'}`}>{count}</p></div>)}</div>
            <p className={`mt-3 rounded-lg px-3 py-2 text-xs ${project.overdue || project.blocked ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200' : 'bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-200'}`}>{project.overdue || project.blocked ? `${project.overdue} overdue ticket${project.overdue === 1 ? '' : 's'} and ${project.blocked} blocked ticket${project.blocked === 1 ? '' : 's'} need attention.` : 'No overdue or blocked tickets currently.'}</p>
            <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700"><div className="mb-2 flex justify-between"><h4 className="text-xs font-semibold text-slate-800 dark:text-slate-100">People insights</h4><span className="text-[11px] text-slate-500 dark:text-slate-400">{project.peopleCount} people</span></div>
              {project.people.length ? <><table className="w-full text-left text-[11px]"><thead className="text-slate-500 dark:text-slate-400"><tr><th className="py-1 font-medium">Member</th><th className="text-right font-medium">Active</th><th className="text-right font-medium">Done</th><th className="text-right font-medium">Overdue</th><th className="text-right font-medium">Hours</th></tr></thead><tbody>{people.map((person) => <tr key={person.id} className="border-t border-slate-100 dark:border-slate-800"><td className="py-2 text-slate-700 dark:text-slate-200">{person.name}</td><td className="text-right">{person.active}</td><td className="text-right">{person.done}</td><td className={`text-right ${person.overdue ? 'text-rose-600' : ''}`}>{person.overdue}</td><td className="text-right">{person.hours}h</td></tr>)}</tbody></table>{project.people.length > 3 && <button type="button" onClick={() => setExpandedIds((current) => expanded ? current.filter((id) => id !== project.id) : [...current, project.id])} className="mt-2 w-full text-xs text-blue-600 hover:underline dark:text-blue-400">{expanded ? 'Show fewer members' : 'View all members'}</button>}</> : <p className="text-xs text-slate-500 dark:text-slate-400">Member workload details are available to authorized leaders.</p>}
            </div>
          </article>;
        })}</div>
      </> : <EmptyState>No active projects are available in your scope.</EmptyState>}
    </SectionFrame>
  );
}
