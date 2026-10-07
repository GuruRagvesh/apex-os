'use client';

// Productivity over a date range (TKT-1027 / TKT-1036): productive ticket time
// per employee, daily or monthly, with a project filter and workday time beside
// it. Every figure comes from GET /analytics/productivity, which applies the
// caller's scope; this panel only chooses dates and formats the answer.

import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { analyticsApi } from '../api';
import { projectsApi } from '@apex/operations-projects/api';
import { Skeleton } from '@apex/shared-ui/components/skeleton';
import {
  companyToday, presetRange, fmtHm, groupByMonth, productiveShare, type RangePreset, type DailyRow,
} from '../lib/analytics-range';

const PRESETS: Array<{ key: Exclude<RangePreset, 'custom'>; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'month', label: 'This month' },
];

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="apex-card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>{label}</p>
      <p className="text-xl font-bold mt-1" style={{ color: 'var(--text-primary)' }}>{value}</p>
      {sub && <p className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>{sub}</p>}
    </div>
  );
}

const qcText = (q: any) =>
  q && q.ratedReviews > 0 ? `${q.taskEfficiency.toFixed(1)} · ${q.performance.toFixed(1)} · ${q.attitude.toFixed(1)}` : '—';

const shareText = (p: number, w: number) => {
  const s = productiveShare(p, w);
  return s === null ? '—' : `${s}%`;
};

export function ProductivityPanel() {
  const today = useMemo(() => companyToday(), []);
  const [preset, setPreset] = useState<RangePreset>('30d');
  const [custom, setCustom] = useState(() => presetRange('30d', today));
  const [projectId, setProjectId] = useState('');
  const [userId, setUserId] = useState('');
  const [view, setView] = useState<'daily' | 'monthly'>('daily');

  const range = preset === 'custom' ? custom : presetRange(preset, today);
  const customInvalid = preset === 'custom' && (!custom.from || !custom.to || custom.from > custom.to);

  const { data: projectsData } = useQuery({
    queryKey: ['projects', { analyticsFilter: true }],
    queryFn: () => projectsApi.getAll({ limit: 200 }) as Promise<any>,
    staleTime: 60000,
  });
  const projects: any[] = Array.isArray(projectsData) ? projectsData : (projectsData?.projects ?? []);

  // Team rows always come from the unfiltered-by-person query; the daily
  // series follows the selected person when there is one.
  const base = { from: range.from, to: range.to, projectId: projectId || undefined };
  const teamQuery = useQuery({
    queryKey: ['analytics-productivity', base],
    queryFn: () => analyticsApi.getProductivity(base) as Promise<any>,
    enabled: !customInvalid,
    placeholderData: keepPreviousData,
    retry: 1,
  });
  const personQuery = useQuery({
    queryKey: ['analytics-productivity', { ...base, userId }],
    queryFn: () => analyticsApi.getProductivity({ ...base, userId }) as Promise<any>,
    enabled: !customInvalid && Boolean(userId),
    placeholderData: keepPreviousData,
    retry: 1,
  });

  const team = teamQuery.data;
  const focus = userId ? personQuery.data : team;
  const daily: DailyRow[] = focus?.daily ?? [];
  const rows = view === 'daily' ? daily.map((d) => ({ key: d.date, label: d.date, ...d })) : groupByMonth(daily).map((m) => ({ key: m.month, label: m.month, ...m }));
  const employees: any[] = team?.employees ?? [];
  const showTeam = team && team.scope !== 'self';
  const selectedName = employees.find((e) => e.userId === userId)?.name;
  const error = teamQuery.error ?? personQuery.error;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Productivity</h2>
        <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
          Productive time is ticket work time from the timer (breaks, pauses and logged-out time excluded). Workday time
          is time between Start Work and End Day, minus breaks. Reviewer time is shown separately. Dates are company dates (IST).
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Date range">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              aria-pressed={preset === p.key}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border"
              style={preset === p.key
                ? { borderColor: 'var(--accent)', backgroundColor: 'var(--accent-subtle)', color: 'var(--accent)' }
                : { borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => { setCustom(range); setPreset('custom'); }}
            aria-pressed={preset === 'custom'}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border"
            style={preset === 'custom'
              ? { borderColor: 'var(--accent)', backgroundColor: 'var(--accent-subtle)', color: 'var(--accent)' }
              : { borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
          >
            Custom
          </button>
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-1.5">
            <input type="date" className="apex-input text-xs py-1" value={custom.from} max={today}
              aria-label="From date" onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>to</span>
            <input type="date" className="apex-input text-xs py-1" value={custom.to} max={today}
              aria-label="To date" onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </div>
        )}
        <select className="apex-select text-xs" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.projectId} · {p.name}</option>)}
        </select>
        <div className="flex gap-1" role="group" aria-label="Breakdown">
          {(['daily', 'monthly'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium border capitalize"
              style={view === v
                ? { borderColor: 'var(--accent)', color: 'var(--accent)' }
                : { borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {customInvalid ? (
        <p className="text-xs text-red-500">Choose a start date on or before the end date.</p>
      ) : error ? (
        <div className="apex-card p-5 flex items-center gap-3 border-l-4 border-red-400">
          <AlertTriangle size={18} className="text-red-500 flex-shrink-0" />
          <p className="text-sm flex-1" style={{ color: 'var(--text-primary)' }}>
            {(error as any)?.message || 'Productivity figures could not be loaded.'}
          </p>
          <button className="apex-btn apex-btn-secondary text-xs" onClick={() => { teamQuery.refetch(); if (userId) personQuery.refetch(); }}>
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      ) : teamQuery.isLoading || !focus ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : (
        <>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {focus.range.from === focus.range.to ? focus.range.from : `${focus.range.from} to ${focus.range.to}`}
            {focus.project ? ` · ${focus.project.name}` : ''}
            {userId && selectedName ? ` · ${selectedName}` : showTeam ? ` · ${employees.length} people` : ''}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Productive time" value={fmtHm(focus.totals.productiveSeconds)} sub="Ticket work time" />
            <Stat label="Workday time" value={fmtHm(focus.totals.workdaySeconds)}
              sub={focus.workdayTimeIsPerPerson ? 'Whole workday, not split by project' : 'Start Work to End Day, minus breaks'} />
            <Stat label="Productive share" value={shareText(focus.totals.productiveSeconds, focus.totals.workdaySeconds)} sub="Productive ÷ workday time" />
            <Stat label="Tickets completed" value={String(focus.totals.ticketsCompleted)} sub="Done or closed in range" />
            <Stat label="Review outcomes" value={`${focus.totals.approvals} / ${focus.totals.reworks}`} sub="Approved / sent to rework" />
            <Stat label="Reviewer time" value={fmtHm(focus.totals.reviewerSeconds)} sub="Reviewing others' work" />
            <Stat label="QC rating" value={qcText(focus.totals.quality)}
              sub={focus.totals.quality?.ratedReviews ? `Efficiency · performance · attitude, avg of ${focus.totals.quality.ratedReviews} rated review${focus.totals.quality.ratedReviews === 1 ? '' : 's'}` : 'No rated reviews in this range'} />
          </div>

          {showTeam && (
            <div className="apex-card overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Per employee</h3>
                {userId && <button className="text-xs underline" style={{ color: 'var(--accent)' }} onClick={() => setUserId('')}>Show everyone</button>}
              </div>
              <div className="overflow-x-auto">
                <table className="apex-table text-xs">
                  <thead>
                    <tr>
                      <th>Employee</th><th>Department</th><th className="text-right">Productive</th><th className="text-right">Workday</th>
                      <th className="text-right">Share</th><th className="text-right">Completed</th><th className="text-right">Approved</th>
                      <th className="text-right">Rework</th><th className="text-right">QC (eff · perf · att)</th><th className="text-right">Reviewer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((e) => (
                      <tr key={e.userId} className="cursor-pointer" aria-selected={e.userId === userId}
                        style={e.userId === userId ? { backgroundColor: 'var(--accent-subtle)' } : undefined}
                        onClick={() => setUserId(e.userId === userId ? '' : e.userId)}>
                        <td>
                          <button className="text-left font-medium" style={{ color: 'var(--text-primary)' }}
                            onClick={(ev) => { ev.stopPropagation(); setUserId(e.userId === userId ? '' : e.userId); }}>
                            {e.name}
                          </button>
                        </td>
                        <td>{e.department ?? '—'}</td>
                        <td className="text-right">{fmtHm(e.productiveSeconds)}</td>
                        <td className="text-right">{fmtHm(e.workdaySeconds)}</td>
                        <td className="text-right">{shareText(e.productiveSeconds, e.workdaySeconds)}</td>
                        <td className="text-right">{e.ticketsCompleted}</td>
                        <td className="text-right">{e.approvals}</td>
                        <td className="text-right">{e.reworks}</td>
                        <td className="text-right whitespace-nowrap">{qcText(e.quality)}</td>
                        <td className="text-right">{fmtHm(e.reviewerSeconds)}</td>
                      </tr>
                    ))}
                    {employees.length === 0 && (
                      <tr><td colSpan={10} className="text-center py-6" style={{ color: 'var(--text-tertiary)' }}>No people in your scope.</td></tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="font-semibold">
                      <td>Total</td><td />
                      <td className="text-right">{fmtHm(team.totals.productiveSeconds)}</td>
                      <td className="text-right">{fmtHm(team.totals.workdaySeconds)}</td>
                      <td className="text-right">{shareText(team.totals.productiveSeconds, team.totals.workdaySeconds)}</td>
                      <td className="text-right">{team.totals.ticketsCompleted}</td>
                      <td className="text-right">{team.totals.approvals}</td>
                      <td className="text-right">{team.totals.reworks}</td>
                      <td className="text-right whitespace-nowrap">{qcText(team.totals.quality)}</td>
                      <td className="text-right">{fmtHm(team.totals.reviewerSeconds)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          <div className="apex-card overflow-hidden">
            <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {view === 'daily' ? 'By day' : 'By month'}{userId && selectedName ? ` · ${selectedName}` : ''}
              </h3>
            </div>
            <div className="overflow-x-auto max-h-[420px]">
              <table className="apex-table text-xs">
                <thead>
                  <tr><th>{view === 'daily' ? 'Date' : 'Month'}</th><th className="text-right">Productive</th><th className="text-right">Workday</th><th className="text-right">Share</th><th className="text-right">Completed</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td>{r.label}</td>
                      <td className="text-right">{fmtHm(r.productiveSeconds)}</td>
                      <td className="text-right">{fmtHm(r.workdaySeconds)}</td>
                      <td className="text-right">{shareText(r.productiveSeconds, r.workdaySeconds)}</td>
                      <td className="text-right">{r.ticketsCompleted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
