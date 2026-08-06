'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  analyticsApi, dashboardApi, ticketsApi,
} from '@/lib/api';
import { TicketTrendChart } from '@/components/dashboard/ticket-trend-chart';
import { CategoryChart } from '@/components/dashboard/category-chart';
import { Skeleton } from '@apex/shared-ui/components/skeleton';
import {
  TrendingUp, TrendingDown, Minus, Download, ShieldAlert,
  Activity, Users, CheckCircle, AlertTriangle, Clock, RotateCcw,
  BarChart2, Zap, Eye, Ban,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import Link from 'next/link';

// ── Types ──────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'command-center' | 'employee' | 'reviewer' | 'manager' | 'sla' | 'rework';
type Period = 'today' | 'week' | 'month';
type Range = '7d' | '30d' | '90d';

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmtSeconds(s: number): string {
  if (!s || s <= 0) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return '< 1m';
}

function fmtPct(n: number): string {
  if (n === undefined || n === null) return '—';
  return `${Math.round(n)}%`;
}

// ── Shared UI primitives ───────────────────────────────────────────────────────

function MetricCard({
  label, value, sub, icon, loading, color = 'blue',
}: {
  label: string; value: React.ReactNode; sub?: string;
  icon?: React.ReactNode; loading?: boolean; color?: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'slate';
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600', green: 'bg-green-50 text-green-600',
    amber: 'bg-amber-50 text-amber-600', red: 'bg-red-50 text-red-600',
    purple: 'bg-purple-50 text-purple-600', slate: 'bg-slate-100 text-slate-500',
  };
  return (
    <div className="apex-card p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </p>
        {icon && (
          <span className={`p-1.5 rounded-lg ${colorMap[color]}`}>{icon}</span>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-7 w-24 rounded" />
      ) : (
        <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{value ?? '—'}</p>
      )}
      {sub && !loading && (
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{sub}</p>
      )}
    </div>
  );
}

function SectionError({ message }: { message?: string }) {
  return (
    <div className="apex-card p-6 flex items-center gap-3 border-l-4 border-red-400">
      <AlertTriangle size={18} className="text-red-500 flex-shrink-0" />
      <div>
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Failed to load</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          {message ?? 'An error occurred while fetching this section.'}
        </p>
      </div>
    </div>
  );
}

function SectionRestricted({ message }: { message?: string }) {
  return (
    <div className="apex-card p-8 text-center space-y-3">
      <ShieldAlert size={32} className="mx-auto" style={{ color: 'var(--accent)' }} />
      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
        {message ?? 'You do not have permission to view this section.'}
      </p>
    </div>
  );
}

function SectionEmpty({ message }: { message?: string }) {
  return (
    <div className="apex-card p-8 text-center">
      <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>{message ?? 'No data yet.'}</p>
    </div>
  );
}

function SkeletonGrid({ cols = 4, count = 4 }: { cols?: number; count?: number }) {
  return (
    <div className={`grid grid-cols-2 lg:grid-cols-${cols} gap-4`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="apex-card p-5 space-y-3">
          <Skeleton className="h-3 w-20 rounded" />
          <Skeleton className="h-7 w-16 rounded" />
          <Skeleton className="h-3 w-28 rounded" />
        </div>
      ))}
    </div>
  );
}

// ── Old analytics helpers (preserved for Overview/Detailed tabs) ───────────────

const RANGE_DAYS: Record<Range, number> = { '7d': 7, '30d': 30, '90d': 90 };

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

function LegacyStatCard({ label, value, sub, trend }: { label: string; value: any; sub?: string; trend?: number }) {
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

// ── Tab definitions ────────────────────────────────────────────────────────────

const ALL_TABS: { key: Tab; label: string; icon: React.ReactNode; minRole?: string[] }[] = [
  { key: 'overview',       label: 'Overview',        icon: <BarChart2 size={14} /> },
  { key: 'command-center', label: 'Command Center',  icon: <Zap size={14} /> },
  { key: 'employee',       label: 'Productivity',    icon: <Activity size={14} /> },
  { key: 'reviewer',       label: 'Review',          icon: <Eye size={14} /> },
  { key: 'manager',        label: 'Team',            icon: <Users size={14} /> },
  { key: 'sla',            label: 'SLA',             icon: <Clock size={14} /> },
  { key: 'rework',         label: 'Rework',          icon: <RotateCcw size={14} /> },
];

// ── Main page ──────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const { user, hasHydrated } = useAuthStore();
  const roleName: string = (user?.role as any)?.name ?? user?.role ?? '';
  const isManagerPlus = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleName);
  const isAdminPlus   = ['ADMIN', 'SUPER_ADMIN'].includes(roleName);
  const canAccess     = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleName);

  const [tab, setTab]       = useState<Tab>('overview');
  const [period, setPeriod] = useState<Period>('today');
  const [range, setRange]   = useState<Range>('30d');
  const days = RANGE_DAYS[range];

  // ── Legacy overview queries (tab = overview | detailed) ──────────────────────
  const { data: trend, isLoading: trendLoading } = useQuery({
    queryKey: ['ticket-trend', days],
    queryFn: () => dashboardApi.getTicketTrend(days) as Promise<any[]>,
    enabled: canAccess && tab === 'overview',
  });
  const { data: byCategory } = useQuery({
    queryKey: ['tickets-by-category'],
    queryFn: () => dashboardApi.getTicketsByCategory() as Promise<any[]>,
    enabled: canAccess && tab === 'overview',
  });
  const { data: overview } = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: () => dashboardApi.getOverview() as Promise<any>,
    refetchInterval: 60000,
    enabled: canAccess && tab === 'overview',
  });
  const { data: workload } = useQuery({
    queryKey: ['workload'],
    queryFn: () => dashboardApi.getWorkload() as Promise<any[]>,
    enabled: canAccess && tab === 'overview',
  });
  const { data: allTickets } = useQuery({
    queryKey: ['all-tickets-analytics'],
    queryFn: () => ticketsApi.getAll({ limit: 200, page: 1 }) as Promise<any>,
    enabled: canAccess && tab === 'overview',
  });

  // ── New analytics queries (lazy per tab) ─────────────────────────────────────
  const { data: commandCenter, isLoading: ccLoading, error: ccError } = useQuery({
    queryKey: ['analytics-command-center', period],
    queryFn: () => analyticsApi.getCommandCenter(period),
    enabled: tab === 'command-center',
    retry: 1,
  });

  const { data: employeeMetrics, isLoading: empLoading, error: empError } = useQuery({
    queryKey: ['analytics-employee', user?.id],
    queryFn: () => analyticsApi.getEmployeeMetrics(),
    enabled: tab === 'employee',
    retry: 1,
  });

  const { data: reviewerMetrics, isLoading: revLoading, error: revError } = useQuery({
    queryKey: ['analytics-reviewer', user?.id],
    queryFn: () => analyticsApi.getReviewerMetrics(),
    enabled: tab === 'reviewer',
    retry: 1,
  });

  const { data: managerMetrics, isLoading: mgrLoading, error: mgrError } = useQuery({
    queryKey: ['analytics-manager'],
    queryFn: () => analyticsApi.getManagerMetrics(),
    enabled: tab === 'manager' && isManagerPlus,
    retry: 1,
  });

  const { data: slaAnalytics, isLoading: slaLoading, error: slaError } = useQuery({
    queryKey: ['analytics-sla'],
    queryFn: () => analyticsApi.getSlaAnalytics(),
    enabled: tab === 'sla',
    retry: 1,
  });

  const { data: reworkAnalytics, isLoading: reworkLoading, error: reworkError } = useQuery({
    queryKey: ['analytics-rework'],
    queryFn: () => analyticsApi.getReworkAnalytics(),
    enabled: tab === 'rework',
    retry: 1,
  });

  // ── Legacy stats ──────────────────────────────────────────────────────────────
  const stats  = (overview as any)?.stats ?? {};
  const total  = (stats.openTickets ?? 0) + (stats.inProgressTickets ?? 0) + (stats.doneTickets ?? 0);
  const resRate = total > 0 ? Math.round(((stats.doneTickets ?? 0) / total) * 100) : 0;
  const tickets: any[] = (allTickets as any)?.tickets ?? [];

  function computePeriodTrend(data: any[] | undefined, field: 'created' | 'resolved'): number | undefined {
    if (!data || data.length < 2) return undefined;
    const half = Math.floor(data.length / 2);
    const prev = data.slice(0, half).reduce((s, d) => s + (d[field] ?? 0), 0);
    const curr = data.slice(half).reduce((s, d) => s + (d[field] ?? 0), 0);
    if (prev === 0) return curr > 0 ? 100 : undefined;
    return Math.round(((curr - prev) / prev) * 100);
  }
  const createdTrend  = computePeriodTrend(trend as any, 'created');
  const resolvedTrend = computePeriodTrend(trend as any, 'resolved');

  const handleExport = () => {
    const dateTo = new Date();
    const dateFrom = new Date(dateTo);
    dateFrom.setDate(dateFrom.getDate() - days);
    ticketsApi.exportCsv({
      dateFrom: dateFrom.toISOString().split('T')[0],
      dateTo: dateTo.toISOString().split('T')[0],
    });
  };

  // ── Guards ────────────────────────────────────────────────────────────────────
  if (!hasHydrated) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--accent)' }} />
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="max-w-xl mx-auto apex-card p-8 text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full flex items-center justify-center"
          style={{ backgroundColor: 'var(--accent-subtle)' }}>
          <ShieldAlert size={24} style={{ color: 'var(--accent)' }} />
        </div>
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Analytics is not available for your role
          </h1>
          <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
            Your dashboard, tickets, kanban board, projects, leave, and calendar already show your personal operational scope.
          </p>
        </div>
        <Link href="/dashboard" className="apex-btn apex-btn-primary inline-flex justify-center">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Analytics</h1>
        {isAdminPlus && (
          <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-purple-100 text-purple-700">
            Global view — {roleName.replace('_', ' ')}
          </span>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto pb-1 rounded-xl p-1" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
        {ALL_TABS.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap flex-shrink-0"
            style={tab === key
              ? { backgroundColor: 'var(--surface-card)', boxShadow: 'var(--shadow-sm)', color: 'var(--accent)' }
              : { color: 'var(--text-secondary)' }
            }
          >
            {icon}{label}
          </button>
        ))}
      </div>

      {/* ── TAB: OVERVIEW ──────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="space-y-6">
          {/* Range selector */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex gap-2">
              {(['7d', '30d', '90d'] as Range[]).map((r) => (
                <button key={r} onClick={() => setRange(r)}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium border transition-all"
                  style={range === r
                    ? { borderColor: 'var(--accent)', backgroundColor: 'var(--accent-subtle)', color: 'var(--accent)' }
                    : { borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }
                  }>
                  {r}
                </button>
              ))}
            </div>
            <button onClick={handleExport} className="apex-btn apex-btn-secondary flex items-center gap-1.5">
              <Download size={14} /> Export CSV
            </button>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <LegacyStatCard label="Total Tickets" value={total} trend={createdTrend} />
            <LegacyStatCard label="Resolved" value={stats.doneTickets ?? 0} trend={resolvedTrend} />
            <LegacyStatCard label="Resolution Rate" value={`${resRate}%`} />
            <LegacyStatCard label="Overdue" value={stats.overdueTickets ?? 0} />
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
            {trendLoading ? <Skeleton className="h-48 w-full rounded-lg" /> : <TicketTrendChart data={(trend as any) ?? []} />}
          </div>

          {/* Category + Workload */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="apex-card p-5">
              <h3 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>By Category</h3>
              <CategoryChart data={(byCategory as any) ?? []} />
            </div>
            <div className="apex-card p-5">
              <h3 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Team Workload</h3>
              {Array.isArray(workload) && workload.length > 0 ? (
                <div className="space-y-2">
                  {(() => {
                    const maxAssigned = Math.max(...(workload as any[]).map((r: any) => r.totalAssigned ?? 0), 1);
                    return (workload as any[]).slice(0, 10).map((row: any) => {
                      const name = row.name ?? row.user?.name ?? '—';
                      const tot  = row.totalAssigned ?? 0;
                      const urgent = row.urgent ?? 0;
                      return (
                        <div key={row.id ?? row.user?.id} className="flex items-center gap-3">
                          <span className="text-sm w-28 truncate flex-shrink-0" style={{ color: 'var(--text-primary)' }}>{name}</span>
                          <div className="apex-progress-track flex-1">
                            <div className="apex-progress-fill" style={{ width: `${Math.round((tot / maxAssigned) * 100)}%` }} />
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {urgent > 0 && <span className="text-[10px] font-bold px-1 rounded bg-red-100 text-red-600">{urgent}U</span>}
                            <span className="text-xs w-6 text-right font-semibold"
                              style={{ color: tot > 5 ? 'var(--color-danger)' : 'var(--text-secondary)' }}>{tot}</span>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              ) : (
                <div className="apex-empty" style={{ padding: '2rem' }}>
                  <p className="apex-empty-desc">No workload data</p>
                </div>
              )}
            </div>
          </div>

          {/* Ticket ageing table */}
          <div className="apex-card overflow-hidden">
            <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Open Tickets — Age</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="apex-table">
                <thead>
                  <tr><th>Ticket</th><th>Title</th><th>Status</th><th>Priority</th><th>Assignee</th><th className="text-right">Age</th></tr>
                </thead>
                <tbody>
                  {tickets.filter((t) => !['DONE', 'CLOSED'].includes(t.status)).slice(0, 20).map((t) => {
                    const ageDays = Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 86400000);
                    return (
                      <tr key={t.id}>
                        <td className="font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>{t.ticketId}</td>
                        <td className="max-w-xs truncate">{t.title}</td>
                        <td><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[t.status] ?? ''}`}>{t.status.replace('_', ' ')}</span></td>
                        <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t.priority}</td>
                        <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t.assignedTo?.name ?? '—'}</td>
                        <td className="text-right"><AgeBadge days={ageDays} /></td>
                      </tr>
                    );
                  })}
                  {tickets.filter((t) => !['DONE', 'CLOSED'].includes(t.status)).length === 0 && (
                    <tr><td colSpan={6} className="text-center py-8" style={{ color: 'var(--text-tertiary)' }}>No open tickets</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: COMMAND CENTER ─────────────────────────────────────────────────── */}
      {tab === 'command-center' && (
        <div className="space-y-5">
          {/* Period selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Period:</span>
            {(['today', 'week', 'month'] as Period[]).map((p) => (
              <button key={p} onClick={() => setPeriod(p)}
                className="px-3 py-1.5 rounded-lg text-sm font-medium border transition-all capitalize"
                style={period === p
                  ? { borderColor: 'var(--accent)', backgroundColor: 'var(--accent-subtle)', color: 'var(--accent)' }
                  : { borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }
                }>
                {p === 'today' ? 'Today' : p === 'week' ? 'Last 7 days' : 'Last 30 days'}
              </button>
            ))}
          </div>

          {ccError ? (
            <SectionError message={(ccError as any)?.message} />
          ) : ccLoading ? (
            <SkeletonGrid cols={4} count={4} />
          ) : !commandCenter ? (
            <SectionEmpty message="No command center data." />
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard
                label="Active Work"
                value={(commandCenter as any).activeWork ?? 0}
                sub="Tickets in progress during this period"
                icon={<Activity size={16} />}
                color="blue"
              />
              <MetricCard
                label="Active Reviews"
                value={(commandCenter as any).activeReviews ?? 0}
                sub="Tickets currently under review"
                icon={<Eye size={16} />}
                color="purple"
              />
              <MetricCard
                label="Blocked Tickets"
                value={(commandCenter as any).blockedTickets ?? 0}
                sub="Blocked and awaiting resolution"
                icon={<Ban size={16} />}
                color={(commandCenter as any).blockedTickets > 0 ? 'red' : 'slate'}
              />
              <MetricCard
                label="Pending Approvals"
                value={(commandCenter as any).pendingApprovals ?? 0}
                sub="Leave requests pending manager action"
                icon={<CheckCircle size={16} />}
                color={(commandCenter as any).pendingApprovals > 0 ? 'amber' : 'slate'}
              />
            </div>
          )}

          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Command Center reflects tickets within your access scope for the selected period.
          </p>
        </div>
      )}

      {/* ── TAB: EMPLOYEE PRODUCTIVITY ─────────────────────────────────────────── */}
      {tab === 'employee' && (
        <div className="space-y-5">
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              Your Productivity Metrics
            </h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              Based on logged work time — pauses, breaks, and logged-out periods are excluded from productive hours.
            </p>
          </div>

          {empError ? (
            <SectionError message={(empError as any)?.message} />
          ) : empLoading ? (
            <SkeletonGrid cols={4} count={7} />
          ) : !employeeMetrics ? (
            <SectionEmpty message="No productivity data yet." />
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                  label="Completed"
                  value={(employeeMetrics as any).ticketsCompleted ?? 0}
                  sub="Tickets moved to DONE or CLOSED"
                  icon={<CheckCircle size={16} />}
                  color="green"
                />
                <MetricCard
                  label="Under Review"
                  value={(employeeMetrics as any).ticketsUnderReview ?? 0}
                  sub="Tickets currently in REVIEW"
                  icon={<Eye size={16} />}
                  color="purple"
                />
                <MetricCard
                  label="Reworked"
                  value={(employeeMetrics as any).ticketsReworked ?? 0}
                  sub="Tickets that required at least one rework"
                  icon={<RotateCcw size={16} />}
                  color={(employeeMetrics as any).ticketsReworked > 0 ? 'amber' : 'slate'}
                />
                <MetricCard
                  label="Productive Hours"
                  value={`${(employeeMetrics as any).productiveHours?.toFixed(1) ?? '0'}h`}
                  sub="Total logged work time (excl. breaks)"
                  icon={<Clock size={16} />}
                  color="blue"
                />
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                <MetricCard
                  label="Avg. Completion Time"
                  value={fmtSeconds((employeeMetrics as any).averageCompletionTimeSeconds)}
                  sub="Average active work time per completed ticket"
                  icon={<Clock size={16} />}
                  color="blue"
                />
                <MetricCard
                  label="Review Acceptance"
                  value={fmtPct((employeeMetrics as any).reviewAcceptancePercent)}
                  sub="% of review cycles approved first time"
                  icon={<CheckCircle size={16} />}
                  color={(employeeMetrics as any).reviewAcceptancePercent >= 70 ? 'green' : 'amber'}
                />
                <MetricCard
                  label="Rework Rate"
                  value={fmtPct((employeeMetrics as any).reworkPercent)}
                  sub="% of review cycles that required rework"
                  icon={<RotateCcw size={16} />}
                  color={(employeeMetrics as any).reworkPercent > 30 ? 'red' : 'slate'}
                />
              </div>

              {(employeeMetrics as any).ticketsCompleted === 0 &&
               (employeeMetrics as any).ticketsUnderReview === 0 && (
                <p className="text-xs text-center" style={{ color: 'var(--text-tertiary)' }}>
                  No ticket activity recorded yet. Metrics will populate once work begins.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* ── TAB: REVIEWER METRICS ──────────────────────────────────────────────── */}
      {tab === 'reviewer' && (
        <div className="space-y-5">
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              Your Review Metrics
            </h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              Review time is counted from when a ticket enters REVIEW until a decision is made.
            </p>
          </div>

          {revError ? (
            <SectionError message={(revError as any)?.message} />
          ) : revLoading ? (
            <SkeletonGrid cols={3} count={6} />
          ) : !reviewerMetrics ? (
            <SectionEmpty message="No review data yet." />
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                  label="Reviews Completed"
                  value={(reviewerMetrics as any).completedApprovalsCount ?? 0}
                  sub="Total review decisions made"
                  icon={<CheckCircle size={16} />}
                  color="green"
                />
                <MetricCard
                  label="Avg. Reviewer Time"
                  value={fmtSeconds((reviewerMetrics as any).averageApprovalSeconds)}
                  sub="Average active time per review cycle"
                  icon={<Clock size={16} />}
                  color="blue"
                />
                <MetricCard
                  label="Review Backlog"
                  value={(reviewerMetrics as any).pendingApprovalsCount ?? 0}
                  sub="Tickets currently waiting in REVIEW"
                  icon={<Eye size={16} />}
                  color={(reviewerMetrics as any).pendingApprovalsCount > 5 ? 'amber' : 'slate'}
                />
                <MetricCard
                  label="Approvals Today"
                  value={(reviewerMetrics as any).approvalsToday ?? 0}
                  sub="Reviews completed today"
                  icon={<CheckCircle size={16} />}
                  color="green"
                />
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                  label="Approvals This Week"
                  value={(reviewerMetrics as any).approvalsThisWeek ?? 0}
                  sub="Reviews completed this week"
                  icon={<CheckCircle size={16} />}
                  color="green"
                />
                <MetricCard
                  label="Approval Rate"
                  value={fmtPct((reviewerMetrics as any).approvalPercent)}
                  sub="% of reviews that were approved"
                  icon={<CheckCircle size={16} />}
                  color={(reviewerMetrics as any).approvalPercent >= 60 ? 'green' : 'amber'}
                />
                <MetricCard
                  label="Rework Requested"
                  value={fmtPct((reviewerMetrics as any).rejectionPercent)}
                  sub="% of reviews that required rework"
                  icon={<RotateCcw size={16} />}
                  color={(reviewerMetrics as any).rejectionPercent > 40 ? 'amber' : 'slate'}
                />
                <MetricCard
                  label="SLA Breaches"
                  value={(reviewerMetrics as any).approvalSlaBreaches ?? 0}
                  sub="Reviews that exceeded the review SLA limit"
                  icon={<AlertTriangle size={16} />}
                  color={(reviewerMetrics as any).approvalSlaBreaches > 0 ? 'red' : 'green'}
                />
                <MetricCard
                  label="SLA Breach Rate"
                  value={fmtPct((reviewerMetrics as any).approvalSlaBreachRate)}
                  sub="% of reviews missing SLA"
                  icon={<AlertTriangle size={16} />}
                  color={(reviewerMetrics as any).approvalSlaBreachRate > 0 ? 'red' : 'green'}
                />
              </div>

              {(reviewerMetrics as any).completedApprovalsCount === 0 && (
                <p className="text-xs text-center" style={{ color: 'var(--text-tertiary)' }}>
                  No reviews completed yet. Metrics will populate once review decisions are recorded.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* ── TAB: MANAGER / TEAM METRICS ────────────────────────────────────────── */}
      {tab === 'manager' && (
        <div className="space-y-5">
          {!isManagerPlus ? (
            <SectionRestricted message="Team metrics are available to Managers and above." />
          ) : (
            <>
              <div>
                <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Department / Team Metrics
                </h2>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                  {isAdminPlus ? 'Showing company-wide metrics.' : 'Showing metrics for your managed departments.'}
                </p>
              </div>

              {mgrError ? (
                <SectionError message={(mgrError as any)?.message} />
              ) : mgrLoading ? (
                <SkeletonGrid cols={4} count={4} />
              ) : !managerMetrics ? (
                <SectionEmpty message="No team metrics available." />
              ) : (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <MetricCard
                      label="Dept. Throughput"
                      value={(managerMetrics as any).departmentThroughput ?? 0}
                      sub="Total tickets completed"
                      icon={<Activity size={16} />}
                      color="green"
                    />
                    <MetricCard
                      label="Completed Tickets"
                      value={(managerMetrics as any).ticketsCompleted ?? 0}
                      sub="DONE + CLOSED tickets"
                      icon={<CheckCircle size={16} />}
                      color="green"
                    />
                    <MetricCard
                      label="Overdue Tickets"
                      value={(managerMetrics as any).overdueTickets ?? 0}
                      sub="Past execution due date, not yet done"
                      icon={<AlertTriangle size={16} />}
                      color={(managerMetrics as any).overdueTickets > 0 ? 'red' : 'slate'}
                    />
                    <MetricCard
                      label="Blocked Tickets"
                      value={(managerMetrics as any).blockedTickets ?? 0}
                      sub="Blocked and awaiting action"
                      icon={<Ban size={16} />}
                      color={(managerMetrics as any).blockedTickets > 0 ? 'amber' : 'slate'}
                    />
                  </div>

                  {/* Rankings */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="apex-card p-5 space-y-3">
                      <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                        Employee Rankings
                      </h3>
                      {Array.isArray((managerMetrics as any).employeeRankings) &&
                       (managerMetrics as any).employeeRankings.length > 0 ? (
                        <div className="space-y-2">
                          {(managerMetrics as any).employeeRankings.map((r: any, i: number) => (
                            <div key={r.userId ?? i} className="flex items-center justify-between">
                              <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                                {i + 1}. {r.name ?? r.userId}
                              </span>
                              <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                {r.score ?? '—'}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                          No ranking data yet — scoring algorithm pending.
                        </p>
                      )}
                    </div>

                    <div className="apex-card p-5 space-y-3">
                      <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                        Reviewer Rankings
                      </h3>
                      {Array.isArray((managerMetrics as any).reviewerRankings) &&
                       (managerMetrics as any).reviewerRankings.length > 0 ? (
                        <div className="space-y-2">
                          {(managerMetrics as any).reviewerRankings.map((r: any, i: number) => (
                            <div key={r.userId ?? i} className="flex items-center justify-between">
                              <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                                {i + 1}. {r.name ?? r.userId}
                              </span>
                              <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                {r.score ?? '—'}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                          No ranking data yet — scoring algorithm pending.
                        </p>
                      )}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ── TAB: SLA ANALYTICS ─────────────────────────────────────────────────── */}
      {tab === 'sla' && (
        <div className="space-y-5">
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              SLA Analytics
            </h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              Calculated from logged work duration, not raw wall-clock time — breaks and logged-out periods are excluded.
            </p>
          </div>

          {slaError ? (
            <SectionError message={(slaError as any)?.message} />
          ) : slaLoading ? (
            <SkeletonGrid cols={4} count={4} />
          ) : !slaAnalytics ? (
            <SectionEmpty message="No SLA data available." />
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                  label="On Time"
                  value={fmtPct((slaAnalytics as any).onTimePercent)}
                  sub="Tickets completed within SLA limit"
                  icon={<CheckCircle size={16} />}
                  color={(slaAnalytics as any).onTimePercent >= 80 ? 'green' : 'amber'}
                />
                <MetricCard
                  label="Overdue"
                  value={fmtPct((slaAnalytics as any).overduePercent)}
                  sub="Tickets that exceeded SLA limit"
                  icon={<AlertTriangle size={16} />}
                  color={(slaAnalytics as any).overduePercent > 20 ? 'red' : 'slate'}
                />
                <MetricCard
                  label="SLA Breaches"
                  value={(slaAnalytics as any).slaBreaches ?? 0}
                  sub="Total tickets that exceeded SLA"
                  icon={<AlertTriangle size={16} />}
                  color={(slaAnalytics as any).slaBreaches > 0 ? 'red' : 'green'}
                />
                <MetricCard
                  label="Avg. Delay"
                  value={fmtSeconds((slaAnalytics as any).averageDelaySeconds)}
                  sub="Average excess work time for overdue tickets"
                  icon={<Clock size={16} />}
                  color="amber"
                />
              </div>

              {/* SLA explanation */}
              <div className="apex-card p-4 border-l-4 border-blue-400">
                <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                  How SLA is measured in Apex OS
                </p>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  SLA is calculated using the ledger-based timer system. Only active work time
                  (while the user is WORKING) is counted. Time spent on breaks, idle, or logged out
                  does not contribute to SLA usage — giving a fairer picture of team performance.
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── TAB: REWORK ANALYTICS ──────────────────────────────────────────────── */}
      {tab === 'rework' && (
        <div className="space-y-5">
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              Rework Analytics
            </h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              Tracks how often tickets are sent back for rework during the review stage.
            </p>
          </div>

          {reworkError ? (
            <SectionError message={(reworkError as any)?.message} />
          ) : reworkLoading ? (
            <SkeletonGrid cols={3} count={3} />
          ) : !reworkAnalytics ? (
            <SectionEmpty message="No rework data yet." />
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                <MetricCard
                  label="Total Reworks"
                  value={(reworkAnalytics as any).reworkCount ?? 0}
                  sub="Total rework cycles across all tickets"
                  icon={<RotateCcw size={16} />}
                  color={(reworkAnalytics as any).reworkCount > 0 ? 'amber' : 'slate'}
                />
                <MetricCard
                  label="Rework Rate"
                  value={fmtPct((reworkAnalytics as any).reworkRate)}
                  sub="% of tickets that required at least one rework"
                  icon={<RotateCcw size={16} />}
                  color={(reworkAnalytics as any).reworkRate > 25 ? 'red' : (reworkAnalytics as any).reworkRate > 10 ? 'amber' : 'green'}
                />
                <div className="apex-card p-5">
                  <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-secondary)' }}>
                    Rework Health
                  </p>
                  {(reworkAnalytics as any).reworkCount === 0 ? (
                    <p className="text-sm font-medium text-green-600">No reworks recorded</p>
                  ) : (reworkAnalytics as any).reworkRate <= 10 ? (
                    <p className="text-sm font-medium text-green-600">Healthy — below 10%</p>
                  ) : (reworkAnalytics as any).reworkRate <= 25 ? (
                    <p className="text-sm font-medium text-amber-600">Moderate — review quality may need attention</p>
                  ) : (
                    <p className="text-sm font-medium text-red-600">High — frequent rework detected</p>
                  )}
                </div>
              </div>

              {/* Most reworked areas */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="apex-card p-5 space-y-3">
                  <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                    Most Reworked Employees
                  </h3>
                  {Array.isArray((reworkAnalytics as any).mostReworkedEmployees) &&
                   (reworkAnalytics as any).mostReworkedEmployees.length > 0 ? (
                    <div className="space-y-1.5">
                      {(reworkAnalytics as any).mostReworkedEmployees.map((e: any, i: number) => (
                        <div key={e.userId ?? i} className="flex justify-between text-sm">
                          <span style={{ color: 'var(--text-primary)' }}>{e.name ?? e.userId}</span>
                          <span className="font-semibold text-amber-600">{e.count} reworks</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No rework data yet.</p>
                  )}
                </div>

                <div className="apex-card p-5 space-y-3">
                  <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                    Most Reworked Task Types
                  </h3>
                  {Array.isArray((reworkAnalytics as any).mostReworkedTicketTypes) &&
                   (reworkAnalytics as any).mostReworkedTicketTypes.length > 0 ? (
                    <div className="space-y-1.5">
                      {(reworkAnalytics as any).mostReworkedTicketTypes.map((t: any, i: number) => (
                        <div key={t.typeId ?? i} className="flex justify-between text-sm">
                          <span style={{ color: 'var(--text-primary)' }}>{t.name ?? t.typeId}</span>
                          <span className="font-semibold text-amber-600">{t.count} reworks</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No rework data yet.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

    </div>
  );
}
