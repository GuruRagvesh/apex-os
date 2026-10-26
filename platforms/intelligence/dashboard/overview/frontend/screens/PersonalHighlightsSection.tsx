'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Award, CalendarCheck, Gauge, Medal, Trophy, X } from 'lucide-react';
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

function Achievements({ data, framed = true }: { data: PersonalHighlightPayload; framed?: boolean }) {
  const content = <>
    <header className="flex items-start justify-between gap-3">
      <div><h2 className="flex w-fit items-center gap-2 rounded-lg bg-[var(--accent-text)] px-3 py-2 text-base font-bold text-white shadow-sm"><Award size={17} />Your Achievements</h2><p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Earned from verified {monthName(data.period.month)} records</p></div>
      <span className="rounded-full border border-[var(--accent-border)] bg-[var(--accent-subtle)] px-2.5 py-1 text-[10px] font-semibold text-[var(--accent-text)]">Monthly</span>
    </header>
    <div className="flex gap-3 overflow-x-auto p-4">
      {data.achievements.map((badge) => <div key={badge.id} className={`flex min-w-[230px] items-center gap-3 rounded-2xl border p-3.5 shadow-sm ${tones[badge.tone] ?? tones.blue}`}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/80 shadow-sm"><BadgeIcon kind={badge.kind} /></span>
        <div className="min-w-0"><h3 className="text-xs font-bold">{badge.title}</h3><p className="mt-1 text-[10px] leading-4 opacity-80">{badge.detail}</p></div>
      </div>)}
    </div>
  </>;
  return framed ? <article className="apex-section-border overflow-hidden rounded-2xl border bg-white p-4 dark:bg-slate-900">{content}</article> : <div>{content}</div>;
}

function Projects({ data, framed = true }: { data: PersonalHighlightPayload; framed?: boolean }) {
  const content = <>
    <header className="flex items-start justify-between gap-3"><div><h2 className="w-fit rounded-lg bg-[var(--accent-text)] px-3 py-2 text-base font-bold text-white shadow-sm">Your Project Contribution</h2><p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Only your real ticket activity during {monthName(data.period.month)}</p></div><Gauge size={17} className="text-[var(--accent)]" /></header>
    <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/60"><tr><th className="px-4 py-2.5">Project</th><th>Status</th><th>Assigned</th><th>Completed</th><th>Active</th><th>Overdue</th><th className="pr-4">Contribution</th></tr></thead><tbody>{data.projects.map((project) => <tr key={project.id} className="border-t border-slate-100 dark:border-slate-800"><td className="px-4 py-3"><p className="font-semibold text-slate-800 dark:text-slate-100">{project.name}</p><p className="text-[10px] text-slate-500">{project.code}</p></td><td><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{project.status}</span></td><td>{project.assigned}</td><td className="font-semibold text-emerald-600">{project.done}</td><td>{project.active}</td><td className={project.overdue ? 'font-semibold text-rose-600' : ''}>{project.overdue}</td><td className="pr-4"><div className="flex items-center gap-2"><div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400" style={{ width: `${project.contributionPercent ?? 0}%` }} /></div><strong className="w-10 text-right">{project.contributionPercent == null ? '—' : `${project.contributionPercent}%`}</strong></div></td></tr>)}</tbody></table></div>
  </>;
  return framed ? <article className="apex-section-border overflow-hidden rounded-2xl border bg-white p-4 dark:bg-slate-900">{content}</article> : <div>{content}</div>;
}

export function PersonalHighlightsSection({ presentation = 'inline' }: { presentation?: 'inline' | 'launcher' } = {}) {
  const month = currentMonth();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'achievements' | 'projects'>('achievements');
  const query = useQuery({
    queryKey: ['home-personal-highlights', month],
    queryFn: () => dashboardApi.getPersonalHighlights(month) as Promise<PersonalHighlightPayload>,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  if (query.isLoading || query.isError || !query.data) return null;
  const data = query.data;
  const hasAchievements = data.achievements.length > 0;
  const hasProjects = data.projects.length > 0;
  if (!hasAchievements && !hasProjects) return null;

  if (presentation === 'inline') {
    return <section className="space-y-4" aria-label="Personal monthly achievements and project contribution">
      {hasAchievements && <Achievements data={data} />}
      {hasProjects && <Projects data={data} />}
    </section>;
  }

  const activeTab = tab === 'achievements' && !hasAchievements ? 'projects' : tab === 'projects' && !hasProjects ? 'achievements' : tab;
  return <>
    <div className="mb-3 flex justify-end">
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-haspopup="dialog">
        <Trophy size={16} aria-hidden /> Achievements &amp; contributions
      </button>
    </div>
    {open && <ModalPortal>
      <div className="fixed inset-0 z-[160] grid place-items-center bg-slate-950/60 p-4 backdrop-blur-md" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="personal-highlights-title" className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-slate-300 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
            <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-blue-700 dark:text-blue-300">Personal performance</p><h2 id="personal-highlights-title" className="mt-1 text-xl font-black text-slate-950 dark:text-white">My highlights</h2></div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close highlights" className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"><X size={18} /></button>
          </header>
          <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-700">
            <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800" role="tablist" aria-label="Personal highlights">
              {hasAchievements && <button type="button" role="tab" aria-selected={activeTab === 'achievements'} onClick={() => setTab('achievements')} className={`rounded-lg px-4 py-2 text-xs font-bold transition ${activeTab === 'achievements' ? 'bg-slate-800 text-white shadow-sm dark:bg-slate-600' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'}`}>Achievements</button>}
              {hasProjects && <button type="button" role="tab" aria-selected={activeTab === 'projects'} onClick={() => setTab('projects')} className={`rounded-lg px-4 py-2 text-xs font-bold transition ${activeTab === 'projects' ? 'bg-slate-800 text-white shadow-sm dark:bg-slate-600' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'}`}>Project contributions</button>}
            </div>
          </div>
          <div className="overflow-y-auto p-5">{activeTab === 'achievements' ? <Achievements data={data} framed={false} /> : <Projects data={data} framed={false} />}</div>
        </section>
      </div>
    </ModalPortal>}
  </>;
}
