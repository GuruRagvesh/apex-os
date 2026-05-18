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
  const color = trend === undefined ? 'text-slate-400' : trend > 0 ? 'text-green-600' : 'text-red-500';
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-slate-200 dark:border-gray-700 p-5">
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>
        {trend !== undefined && <span className={`flex items-center gap-1 text-xs font-semibold ${color}`}><Icon size={12} />{Math.abs(trend)}%</span>}
      </div>
      <p className="text-2xl font-bold text-slate-800 dark:text-white">{value}</p>
      {sub && <p className="text-xs text-slate-400 dark:text-gray-500 mt-1">{sub}</p>}
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

  const handleExport = () => {
    ticketsApi.exportCsv();
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Analytics</h1>
        {/* Tab switcher */}
        <div className="flex gap-1 bg-slate-100 dark:bg-gray-800 rounded-xl p-1">
          {(['overview', 'detailed'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all capitalize ${tab === t ? 'bg-white dark:bg-gray-700 shadow text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200'}`}
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
            <StatCard label="Total Tickets" value={total} trend={12} />
            <StatCard label="Resolved" value={stats.doneTickets ?? 0} trend={8} />
            <StatCard label="Resolution Rate" value={`${resRate}%`} trend={resRate > 60 ? 3 : -5} />
            <StatCard label="Overdue" value={stats.overdueTickets ?? 0} trend={-(stats.overdueTickets ?? 0)} />
          </div>

          {/* Trend chart */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-slate-200 dark:border-gray-700 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-800 dark:text-white">Ticket Trend ({days} days)</h3>
              <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-gray-400">
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 inline-block" /> Created</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-green-500 inline-block" /> Resolved</span>
              </div>
            </div>
            {trendLoading ? <Skeleton className="h-48 w-full rounded-lg" /> : <TicketTrendChart data={trend ?? []} />}
          </div>

          {/* Category + Workload */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-slate-200 dark:border-gray-700 p-5">
              <h3 className="font-semibold text-slate-800 dark:text-white mb-4">By Category</h3>
              <CategoryChart data={byCategory ?? []} />
            </div>

            <div className="bg-white dark:bg-gray-900 rounded-xl border border-slate-200 dark:border-gray-700 p-5">
              <h3 className="font-semibold text-slate-800 dark:text-white mb-4">Team Workload</h3>
              {Array.isArray(workload) && workload.length > 0 ? (
                <div className="space-y-2">
                  {workload.slice(0, 8).map((row: any) => (
                    <div key={row.user?.id} className="flex items-center gap-3">
                      <span className="text-sm text-slate-700 dark:text-gray-300 w-32 truncate">{row.user?.name ?? row.name}</span>
                      <div className="flex-1 h-2 bg-slate-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 rounded-full"
                          style={{ width: `${Math.min(((row.open ?? 0) + (row.inProgress ?? 0)) * 10, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-500 dark:text-gray-400 w-8 text-right">{(row.open ?? 0) + (row.inProgress ?? 0)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400 dark:text-gray-500 text-center py-8">No workload data</p>
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
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${range === r ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400' : 'border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-800'}`}
                >
                  {r}
                </button>
              ))}
            </div>
            <button
              onClick={handleExport}
              className="flex items-center gap-2 text-sm px-4 py-2 border border-slate-200 dark:border-gray-700 rounded-lg hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors text-slate-600 dark:text-gray-400"
            >
              <Download size={14} />
              Export CSV
            </button>
          </div>

          {/* Ticket ageing table */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-slate-200 dark:border-gray-700">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-gray-800">
              <h3 className="font-semibold text-slate-800 dark:text-white">Open Tickets — Age</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-gray-800">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase">Ticket</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase">Title</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase">Status</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase">Priority</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase">Assignee</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase">Age</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-gray-800">
                  {tickets.filter((t) => !['DONE', 'CLOSED'].includes(t.status)).slice(0, 20).map((t) => {
                    const ageMs = Date.now() - new Date(t.createdAt).getTime();
                    const ageDays = Math.floor(ageMs / 86400000);
                    return (
                      <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors">
                        <td className="px-5 py-3 font-mono text-xs text-slate-500 dark:text-gray-400">{t.ticketId}</td>
                        <td className="px-5 py-3 text-slate-800 dark:text-gray-200 max-w-xs truncate">{t.title}</td>
                        <td className="px-5 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[t.status] ?? ''}`}>
                            {t.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-600 dark:text-gray-400">{t.priority}</td>
                        <td className="px-5 py-3 text-xs text-slate-600 dark:text-gray-400">{t.assignedTo?.name ?? '—'}</td>
                        <td className="px-5 py-3 text-right"><AgeBadge days={ageDays} /></td>
                      </tr>
                    );
                  })}
                  {tickets.filter((t) => !['DONE', 'CLOSED'].includes(t.status)).length === 0 && (
                    <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-400 dark:text-gray-500">No open tickets</td></tr>
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
