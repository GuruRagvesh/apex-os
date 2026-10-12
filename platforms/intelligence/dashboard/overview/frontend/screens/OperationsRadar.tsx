'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, CalendarClock, ChevronRight, Radar } from 'lucide-react';
import { dashboardApi } from '../api';
import type { HomeActivity, HomeExperience } from './home-types';
import { EmptyState, SectionFrame, SmallLink, formatDate } from './home-ui';

function ageLabel(date: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

export function OperationsRadar({ experience, userId }: { experience: HomeExperience; userId: string }) {
  const canSeeCompany = experience.scope === 'Company';
  const canSeeTeam = experience.scope !== 'Personal';
  const [activityScope, setActivityScope] = useState<'my' | 'team' | 'company'>(canSeeCompany ? 'company' : canSeeTeam ? 'team' : 'my');
  const [actorId, setActorId] = useState('');
  const { data: activity = [], isPending, isError, refetch } = useQuery({
    queryKey: ['home-activity', userId, activityScope],
    queryFn: () => dashboardApi.getHomeActivity(activityScope) as Promise<HomeActivity[]>,
    staleTime: 60_000,
  });
  const visibleActivity = actorId ? activity.filter((item) => item.actorId === actorId) : activity;
  const actors = Array.from(new Map(activity.map((item) => [item.actorId, item.actor])).entries());
  const { radar } = experience;

  return (
    <SectionFrame icon={Radar} title="Operations radar">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,1fr)]">
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <div className="mb-4 flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100"><AlertTriangle size={16} className="text-rose-500" /> Attention & SLA</h3><span className="text-[11px] text-slate-500 dark:text-slate-400">{experience.scope} risks</span></div>
          <div className="grid grid-cols-3 gap-2">
            <RiskStat label="Overdue" count={radar.overdue} color="text-rose-600" />
            <RiskStat label="Due soon" count={radar.dueSoon} color="text-amber-600" />
            <RiskStat label="Ageing reviews" count={radar.ageingReviews} color="text-violet-600" />
          </div>
          <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-700">
            <div className="mb-2 flex justify-between"><h4 className="text-xs font-semibold text-slate-800 dark:text-slate-100">Needs my attention</h4><span className="text-[11px] text-amber-700 dark:text-amber-300">{radar.actions.length} priorities</span></div>
            {radar.actions.length ? <div>{radar.actions.map((action) => <Link key={`${action.type}-${action.id}`} href={action.url} className="flex items-start gap-3 border-t border-slate-100 py-3 text-xs hover:text-blue-600 dark:border-slate-800"><span className="rounded-lg bg-blue-50 p-1.5 text-blue-600 dark:bg-blue-950 dark:text-blue-300"><AlertTriangle size={14} /></span><span className="min-w-0 flex-1"><strong className="block text-slate-800 dark:text-slate-100">{action.title}</strong><span className="mt-0.5 block truncate text-[11px] text-slate-500 dark:text-slate-400">{action.detail}</span></span><ChevronRight size={14} className="mt-1 text-slate-400" /></Link>)}</div> : <EmptyState>No decisions or assigned overdue work need your attention.</EmptyState>}
          </div>
          <div className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"><strong>Operational bottlenecks</strong><p className="mt-1">{radar.blocked} blocked ticket{radar.blocked === 1 ? '' : 's'} and {radar.overdue} overdue ticket{radar.overdue === 1 ? '' : 's'} in your scope.</p></div>
          {radar.bottlenecks.length > 0 && <ul className="mt-2 space-y-1">{radar.bottlenecks.slice(0, 3).map((ticket) => <li key={ticket.id}><Link href={ticket.url} className="block truncate text-[11px] text-slate-600 hover:text-blue-600 dark:text-slate-300">{ticket.code} · {ticket.title}{ticket.blocked ? ' · Blocked' : ' · Overdue'}</Link></li>)}</ul>}
          <div className="mt-4 text-right"><SmallLink href="/tickets?overdue=true">View all issues</SmallLink></div>
        </div>
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100"><CalendarClock size={16} className="text-blue-600" /> Upcoming</h3>
            {radar.upcoming.length ? <ul>{radar.upcoming.slice(0, 3).map((item) => <li key={`${item.type}-${item.id}`} className="border-b border-slate-100 py-2 last:border-b-0 dark:border-slate-800"><Link href={item.url} className="flex gap-2 text-xs hover:text-blue-600"><span className="min-w-14 rounded bg-blue-50 px-1.5 py-1 text-center text-[10px] font-semibold text-blue-600 dark:bg-blue-950 dark:text-blue-300">{formatDate(item.date)}</span><span className="min-w-0"><strong className="block truncate text-slate-800 dark:text-slate-100">{item.title}</strong><span className="text-[11px] text-slate-500 dark:text-slate-400">{item.type}</span></span></Link></li>)}</ul> : <EmptyState>No deadlines or approved leave coming up.</EmptyState>}
            <div className="mt-3"><SmallLink href="/calendar">View upcoming</SmallLink></div>
          </div>
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100"><Activity size={16} className="text-blue-600" /> Recent activity</h3>
            <div className="mb-3 flex flex-wrap gap-1.5">{(['my', ...(canSeeTeam ? ['team'] : []), ...(canSeeCompany ? ['company'] : [])] as ('my' | 'team' | 'company')[]).map((scope) => <button key={scope} type="button" onClick={() => { setActivityScope(scope); setActorId(''); }} className={`rounded-full px-3 py-1 text-xs capitalize ${activityScope === scope ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{scope === 'team' && experience.scope === 'Department' ? 'Department' : scope}</button>)}</div>
            {activityScope !== 'my' && actors.length > 1 && <select aria-label="Filter recent activity by person" value={actorId} onChange={(event) => setActorId(event.target.value)} className="mb-2 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"><option value="">All people</option>{actors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>}
            {isPending ? <p className="text-xs text-slate-500">Loading activity…</p> : isError ? <p className="text-xs text-rose-600">Activity unavailable. <button onClick={() => refetch()} className="underline">Retry</button></p> : visibleActivity.length ? <ul>{visibleActivity.slice(0, 4).map((item) => <li key={item.id} className="border-b border-slate-100 py-2 last:border-b-0 dark:border-slate-800">{item.url ? <Link href={item.url} className="block text-xs hover:text-blue-600"><strong className="text-slate-800 dark:text-slate-100">{item.actor}</strong> {item.action}<span className="block text-[11px] text-slate-500 dark:text-slate-400">{ageLabel(item.date)}</span></Link> : <span className="block text-xs text-slate-600 dark:text-slate-300"><strong>{item.actor}</strong> {item.action}<span className="block text-[11px] text-slate-500 dark:text-slate-400">{ageLabel(item.date)}</span></span>}</li>)}</ul> : <EmptyState>No recent activity in this scope.</EmptyState>}
            {canSeeTeam && <div className="mt-3"><SmallLink href="/admin/activity">View complete activity log</SmallLink></div>}
          </div>
        </div>
      </div>
    </SectionFrame>
  );
}

function RiskStat({ label, count, color }: { label: string; count: number; color: string }) {
  return <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/70"><p className="min-h-8 text-[10px] text-slate-500 dark:text-slate-400">{label}</p><p className={`text-xl font-bold ${color}`}>{count.toLocaleString('en-IN')}</p></div>;
}
