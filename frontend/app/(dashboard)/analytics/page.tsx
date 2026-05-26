'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi, ticketsApi } from '@/lib/api';
import { TicketTrendChart } from '@/components/dashboard/ticket-trend-chart';
import { CategoryChart } from '@/components/dashboard/category-chart';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, TrendingDown, Minus, Download } from 'lucide-react';

type Tab = 'overview' | 'detailed';
type Range = '7d' | '30d' | '90d';

const RANGE_DAYS: Record<Range, number> = { '7d': 7, '30d': 30, '90d': 90 };

function StatCard({ label, value, sub, trend }: { label: string; value: any; sub?: string; trend?: number }) {
  const Icon = trend === undefined ? Minus : trend > 0 ? TrendingUp : TrendingDown;
  const trendColor = trend === undefined ? 'var(--text-tertiary)' : trend > 0 ? 'var(--color-success)' : 'var(--color-danger)';
  return (
    <div className="apex-card p-5">
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>{label}</p>
        {trend !== undefined && (
          <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: trendColor }}>
            <Icon size={12} />{Math.abs(trend)}%
          </span>
        )}
      </div>
      <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>
      {sub && <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{sub}</p>}
    </div>
  );
}

const STATUS_BADGE: Record<string, string> = {
  OPEN: 'bg-yellow-100 text-yellow-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  REVIEW: 'bg-purple-100 text-purple-700',
  DONE: 'bg-green-100 text-green-700',
  CLOSED: 'bg-slate-100 text-slate-600',
};

function AgeBadge({ days }: { days: number }) {
  const cls = days <= 2 ? 'bg-green-100 text-green-700' : days <= 7 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{days}d</span>;
}

export default function AnalyticsPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [range, setRange] = useState<Range>('30d');
  const days = RANGE_DAYS[range];

  const { data: trend, isLoading: trendLoading } = useQuery({
    queryKey: ['ticket-trend', days],
    queryFn: () => dashboardApi.getTicketTrend(days) as Promise<any[]>,
  });

  const { data: byCategory } = useQuery({
    queryKey: ['tickets-by-category'],
    queryFn: () => dashboardApi.getTicketsByCategory() as Promise<any[]>,
  });

  const { data: overview } = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: () => dashboardApi.getOverview() as Promise<any>,
    refetchInterval: 60000,
  });

  const { data: workload } = useQuery({
    queryKey: ['workload'],
    queryFn: () => dashboardApi.getWorkload() as Promise<any[]>,
  });

  const { data: allTickets } = useQuery({
    queryKey: ['all-tickets-analytics'],
    queryFn: () => ticketsApi.getAll({ limit: 200, page: 1 }) as Promise<any>,
    enabled: tab === 'detailed',
  });

  const stats = overview?.stats ?? {};
  const total = (stats.openTickets ?? 0) + (stats.inProgressTickets ?? 0) + (stats.doneTickets ?? 0);
  const resRate = total > 0 ? Math.round(((stats.doneTickets ?? 0) / total) * 100) : 0;

  const tickets: any[] = allTickets?.tickets ?? [];

  // Compute real period-over-period trends from the fetched trend chart data.
  // Splits the window in half (first half = previous period, second half = current period)
  // and calculates % change. Returns undefined when data is insufficient to avoid showing
  // a fake indicator.
  function computePeriodTrend(data: any[] | undefined, field: 'created' | 'resolved'): number | undefined {
    if (!data || data.length < 2) return undefined;
    const half = Math.floor(data.length / 2);
    const prev = data.slice(0, half).reduce((s, d) => s + (d[field] ?? 0), 0);
    const curr = data.slice(half).reduce((s, d) => s + (d[field] ?? 0), 0);
    if (prev === 0) return curr > 0 ? 100 : undefined;
    return Math.round(((curr - prev) / prev) * 100);
  }

  const createdTrend  = computePeriodTrend(trend, 'created');
  const resolvedTrend = computePeriodTrend(trend, 'resolved');

  const handleExport = () => {
    ticketsApi.exportCsv();
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Analytics</h1>
        {/* Tab switcher */}
        <div className="flex gap-1 rounded-xl p-1" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
          {(['overview', 'detailed'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all capitalize"
              style={tab === t
                ? { backgroundColor: 'var(--surface-card)', boxShadow: 'var(--shadow-sm)', color: 'var(--accent)' }
                : { color: 'var(--text-secondary)' }
              }
            >
              {t === 'overview' ? '📊 Overview' : '📋 Detailed'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && (
        <div className="space-y-6">
          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total Tickets" value={total} trend={createdTrend} />
            <StatCard label="Resolved" value={stats.doneTickets ?? 0} trend={resolvedTrend} />
            <StatCard label="Resolution Rate" value={`${resRate}%`} />
            <StatCard label="Overdue" value={stats.overdueTickets ?? 0} />
          </div>

          {/* Trend chart */}
          <div className="apex-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Ticket Trend ({days} days)</h3>
              <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 inline-block" /> Created</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-green-500 inline-block" /> Resolved</span>
              </div>
            </div>
            {trendLoading ? <Skeleton className="h-48 w-full rounded-lg" /> : <TicketTrendChart data={trend ?? []} />}
          </div>

          {/* Category + Workload */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="apex-card p-5">
              <h3 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>By Category</h3>
              <CategoryChart data={byCategory ?? []} />
            </div>

            <div className="apex-card p-5">
              <h3 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Team Workload</h3>
              {Array.isArray(workload) && workload.length > 0 ? (
                <div className="space-y-2">
                  {workload.slice(0, 8).map((row: any) => (
                    <div key={row.user?.id} className="flex items-center gap-3">
                      <span className="text-sm w-32 truncate" style={{ color: 'var(--text-primary)' }}>{row.user?.name ?? row.name}</span>
                      <div className="apex-progress-track flex-1">
                        <div
                          className="apex-progress-fill"
                          style={{ width: `${Math.min(((row.open ?? 0) + (row.inProgress ?? 0)) * 10, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs w-8 text-right" style={{ color: 'var(--text-secondary)' }}>{(row.open ?? 0) + (row.inProgress ?? 0)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="apex-empty" style={{ padding: '2rem' }}>
                  <p className="apex-empty-desc">No workload data</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'detailed' && (
        <div className="space-y-6">
          {/* Range selector + export */}
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {(['7d', '30d', '90d'] as Range[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium border transition-all"
                  style={range === r
                    ? { borderColor: 'var(--accent)', backgroundColor: 'var(--accent-subtle)', color: 'var(--accent)' }
                    : { borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }
                  }
                >
                  {r}
                </button>
              ))}
            </div>
            <button onClick={handleExport} className="apex-btn apex-btn-secondary">
              <Download size={14} /> Export CSV
            </button>
          </div>

          {/* Ticket ageing table */}
          <div className="apex-card overflow-hidden">
            <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Open Tickets — Age</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="apex-table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Title</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Assignee</th>
                    <th className="text-right">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.filter((t) => !['DONE', 'CLOSED'].includes(t.status)).slice(0, 20).map((t) => {
                    const ageMs = Date.now() - new Date(t.createdAt).getTime();
                    const ageDays = Math.floor(ageMs / 86400000);
                    return (
                      <tr key={t.id}>
                        <td className="font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>{t.ticketId}</td>
                        <td className="max-w-xs truncate">{t.title}</td>
                        <td>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[t.status] ?? ''}`}>
                            {t.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t.priority}</td>
                        <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t.assignedTo?.name ?? '—'}</td>
                        <td className="text-right"><AgeBadge days={ageDays} /></td>
                      </tr>
                    );
                  })}
                  {tickets.filter((t) => !['DONE', 'CLOSED'].includes(t.status)).length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-8" style={{ color: 'var(--text-tertiary)' }}>No open tickets</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
