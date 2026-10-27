'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, FolderKanban, Gauge, Loader2, Medal, Trophy, X } from 'lucide-react';
import { dashboardApi } from '../api/dashboard-api';
import { ModalPortal } from '../components/ModalPortal';
import type { PersonalHighlightPayload } from './home-types';

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthName(month: string) {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const tones: Record<string, string> = {
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  blue: 'border-blue-200 bg-blue-50 text-blue-800',
  indigo: 'border-indigo-200 bg-indigo-50 text-indigo-800',
  violet: 'border-violet-200 bg-violet-50 text-violet-800',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  cyan: 'border-cyan-200 bg-cyan-50 text-cyan-800',
  rose: 'border-rose-200 bg-rose-50 text-rose-800',
};

function BadgeIcon({ kind }: { kind: string }) {
  return kind === 'LEADER' ? <Trophy size={18} /> : kind === 'PERSONAL_BEST' ? <Medal size={18} /> : <CalendarCheck size={18} />;
}

function Projects({ data, framed = true }: { data: PersonalHighlightPayload; framed?: boolean }) {
  const content = <>
    <header className="flex items-start justify-between gap-3"><div><h2 className="w-fit rounded-lg bg-[var(--accent-text)] px-3 py-2 text-base font-bold text-white shadow-sm">Your Project Contribution</h2><p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Only your real ticket activity during {monthName(data.period.month)}</p></div><Gauge size={17} className="text-[var(--accent)]" /></header>
    <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/60"><tr><th className="px-4 py-2.5">Project</th><th>Status</th><th>Assigned</th><th>Completed</th><th>Active</th><th>Overdue</th><th className="pr-4">Contribution</th></tr></thead><tbody>{data.projects.map((project) => <tr key={project.id} className="border-t border-slate-100 dark:border-slate-800"><td className="px-4 py-3"><p className="font-semibold text-slate-800 dark:text-slate-100">{project.name}</p><p className="text-[10px] text-slate-500">{project.code}</p></td><td><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{project.status}</span></td><td>{project.assigned}</td><td className="font-semibold text-emerald-600">{project.done}</td><td>{project.active}</td><td className={project.overdue ? 'font-semibold text-rose-600' : ''}>{project.overdue}</td><td className="pr-4"><div className="flex items-center gap-2"><div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400" style={{ width: `${project.contributionPercent ?? 0}%` }} /></div><strong className="w-10 text-right">{project.contributionPercent == null ? '—' : `${project.contributionPercent}%`}</strong></div></td></tr>)}</tbody></table></div>
  </>;
  return framed ? <article className="apex-section-border overflow-hidden rounded-2xl border bg-white p-4 dark:bg-slate-900">{content}</article> : <div>{content}</div>;
}

function usePersonalHighlights() {
  const month = currentMonth();
  return useQuery({
    queryKey: ['home-personal-highlights', month],
    queryFn: () => dashboardApi.getPersonalHighlights(month) as Promise<PersonalHighlightPayload>,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
}

export function PersonalHighlightsSection() {
  const query = usePersonalHighlights();

  if (query.isLoading || query.isError || !query.data?.projects.length) return null;
  return <section className="space-y-4" aria-label="My project contributions">
    <Projects data={query.data} />
  </section>;
}

export function PersonalHighlightsTopbar({ role }: { role: string }) {
  const query = usePersonalHighlights();
  const achievementsRef = useRef<HTMLDivElement | null>(null);
  const [achievementsOpen, setAchievementsOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const isLeadership = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(role);
  const data = query.data;
  const achievements = data?.achievements ?? [];
  const projects = data?.projects ?? [];

  useEffect(() => {
    if (!achievementsOpen && !projectsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setAchievementsOpen(false);
      setProjectsOpen(false);
    };
    const closeAchievementsOutside = (event: MouseEvent) => {
      if (achievementsOpen && achievementsRef.current && !achievementsRef.current.contains(event.target as Node)) setAchievementsOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('mousedown', closeAchievementsOutside);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('mousedown', closeAchievementsOutside);
    };
  }, [achievementsOpen, projectsOpen]);

  return <div className="flex items-center gap-1 sm:gap-2" aria-label="Personal achievements and contributions">
    <div ref={achievementsRef} className="relative">
      <button
        type="button"
        onClick={() => { setAchievementsOpen((value) => !value); setProjectsOpen(false); }}
        className="relative grid h-9 w-9 place-items-center rounded-xl text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-300 dark:hover:bg-slate-800"
        aria-label="My achievements"
        aria-haspopup="dialog"
        aria-expanded={achievementsOpen}
        title="My achievements"
      >
        <Trophy size={18} aria-hidden />
        {achievements.length > 0 && <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-white dark:ring-slate-900" aria-hidden />}
      </button>
      {achievementsOpen && <section role="dialog" aria-label="My achievements" className="absolute right-0 top-11 z-50 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div><p className="text-sm font-black text-slate-900 dark:text-white">My Achievements</p><p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">{data ? monthName(data.period.month) : 'This month'}</p></div>
          <button type="button" onClick={() => setAchievementsOpen(false)} aria-label="Close achievements" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={15} /></button>
        </header>
        <div className="max-h-80 overflow-y-auto p-3">
          {query.isLoading ? <div className="grid min-h-28 place-items-center"><Loader2 size={20} className="animate-spin text-slate-400" /></div>
            : query.isError ? <div className="rounded-xl bg-rose-50 px-4 py-5 text-center text-xs text-rose-700 dark:bg-rose-950/20 dark:text-rose-300">Achievements could not be loaded.</div>
              : achievements.length ? <div className="space-y-2">{achievements.map((badge) => <article key={badge.id} className={`flex items-center gap-3 rounded-xl border p-3 ${tones[badge.tone] ?? tones.blue}`}><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/80 shadow-sm"><BadgeIcon kind={badge.kind} /></span><div><p className="text-xs font-bold">{badge.title}</p><p className="mt-0.5 text-[10px] leading-4 opacity-80">{badge.detail}</p></div></article>)}</div>
                : <div className="grid min-h-28 place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 text-center dark:border-slate-700 dark:bg-slate-800/40"><div><Trophy size={24} className="mx-auto text-slate-300 dark:text-slate-600" /><p className="mt-2 text-xs font-bold text-slate-700 dark:text-slate-200">No achievements yet</p><p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">New verified achievements will appear here.</p></div></div>}
        </div>
      </section>}
    </div>
    {isLeadership && <button
      type="button"
      onClick={() => { setProjectsOpen(true); setAchievementsOpen(false); }}
      className="relative grid h-9 w-9 place-items-center rounded-xl text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-300 dark:hover:bg-slate-800"
      aria-label="My project contributions"
      aria-haspopup="dialog"
      title="My project contributions"
    >
      <FolderKanban size={18} aria-hidden />
      {projects.length > 0 && <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-blue-500 ring-2 ring-white dark:ring-slate-900" aria-hidden />}
    </button>}
    {isLeadership && projectsOpen && <ModalPortal>
      <div className="fixed inset-0 z-[160] grid place-items-center bg-slate-950/30 p-4 backdrop-blur-[3px]" onMouseDown={(event) => { if (event.target === event.currentTarget) setProjectsOpen(false); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="personal-projects-title" className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-slate-300 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
            <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-blue-700 dark:text-blue-300">Personal performance</p><h2 id="personal-projects-title" className="mt-1 text-xl font-black text-slate-950 dark:text-white">My Project Contributions</h2></div>
            <button type="button" onClick={() => setProjectsOpen(false)} aria-label="Close project contributions" className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"><X size={18} /></button>
          </header>
          <div className="overflow-y-auto p-5">{query.isLoading ? <div className="grid min-h-56 place-items-center"><Loader2 size={24} className="animate-spin text-slate-400" /></div>
            : query.isError ? <div className="grid min-h-56 place-items-center rounded-2xl bg-rose-50 text-sm text-rose-700 dark:bg-rose-950/20 dark:text-rose-300">Project contributions could not be loaded.</div>
              : data && projects.length ? <Projects data={data} framed={false} />
                : <div className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-center dark:border-slate-700 dark:bg-slate-800/40"><div><FolderKanban size={30} className="mx-auto text-slate-300 dark:text-slate-600" /><p className="mt-3 text-sm font-bold text-slate-700 dark:text-slate-200">No project contributions yet</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Projects with verified ticket activity will appear here.</p></div></div>}</div>
        </section>
      </div>
    </ModalPortal>}
  </div>;
}
