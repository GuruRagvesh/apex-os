'use client';

import { useQuery } from '@tanstack/react-query';
import { Award, CalendarCheck, Gauge, Medal, Sparkles, Trophy } from 'lucide-react';
import { dashboardApi } from '../api/dashboard-api';
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

export function PersonalHighlightsSection() {
  const month = currentMonth();
  const query = useQuery({
    queryKey: ['home-personal-highlights', month],
    queryFn: () => dashboardApi.getPersonalHighlights(month) as Promise<PersonalHighlightPayload>,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  if (query.isLoading) return <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Calculating your monthly achievements…</div>;
  if (query.isError || !query.data) return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">Personal achievements could not be calculated from the current records.</div>;
  const data = query.data;

  return <section className="space-y-4" aria-label="Personal monthly achievements and project contribution">
    <article className="apex-section-border overflow-hidden rounded-2xl border bg-white p-4 dark:bg-slate-900">
      <header className="flex items-start justify-between gap-3">
        <div><h2 className="flex w-fit items-center gap-2 rounded-lg bg-[var(--accent-text)] px-3 py-2 text-base font-bold text-white shadow-sm"><Award size={17} />Your Achievements</h2><p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Earned from verified {monthName(data.period.month)} records</p></div>
        <span className="rounded-full border border-[var(--accent-border)] bg-[var(--accent-subtle)] px-2.5 py-1 text-[10px] font-semibold text-[var(--accent-text)]">Monthly</span>
      </header>
      {data.achievements.length ? <div className="flex gap-3 overflow-x-auto p-4">
        {data.achievements.map((badge) => <div key={badge.id} className={`flex min-w-[230px] items-center gap-3 rounded-2xl border p-3.5 shadow-sm ${tones[badge.tone] ?? tones.blue}`}>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/80 shadow-sm"><BadgeIcon kind={badge.kind} /></span>
          <div className="min-w-0"><h3 className="text-xs font-bold">{badge.title}</h3><p className="mt-1 text-[10px] leading-4 opacity-80">{badge.detail}</p></div>
        </div>)}
      </div> : <div className="flex items-center gap-3 p-5 text-sm text-slate-500"><Sparkles size={18} className="text-slate-400" /><span>No badge has been earned from this month’s recorded data yet.</span></div>}
    </article>

    <article className="apex-section-border overflow-hidden rounded-2xl border bg-white p-4 dark:bg-slate-900">
      <header className="flex items-start justify-between gap-3"><div><h2 className="w-fit rounded-lg bg-[var(--accent-text)] px-3 py-2 text-base font-bold text-white shadow-sm">Your Project Contribution</h2><p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Only your real ticket activity during {monthName(data.period.month)}</p></div><Gauge size={17} className="text-[var(--accent)]" /></header>
      {data.projects.length ? <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/60"><tr><th className="px-4 py-2.5">Project</th><th>Status</th><th>Assigned</th><th>Completed</th><th>Active</th><th>Overdue</th><th className="pr-4">Contribution</th></tr></thead><tbody>{data.projects.map((project) => <tr key={project.id} className="border-t border-slate-100 dark:border-slate-800"><td className="px-4 py-3"><p className="font-semibold text-slate-800 dark:text-slate-100">{project.name}</p><p className="text-[10px] text-slate-500">{project.code}</p></td><td><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{project.status}</span></td><td>{project.assigned}</td><td className="font-semibold text-emerald-600">{project.done}</td><td>{project.active}</td><td className={project.overdue ? 'font-semibold text-rose-600' : ''}>{project.overdue}</td><td className="pr-4"><div className="flex items-center gap-2"><div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400" style={{ width: `${project.contributionPercent ?? 0}%` }} /></div><strong className="w-10 text-right">{project.contributionPercent == null ? '—' : `${project.contributionPercent}%`}</strong></div></td></tr>)}</tbody></table></div> : <div className="mt-3 p-6 text-center text-sm text-slate-500">No project contribution is recorded for you this month.</div>}
    </article>
  </section>;
}
