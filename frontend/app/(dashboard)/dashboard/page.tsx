'use client';

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dashboardApi, ticketsApi, leaveApi, aiApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { useSocket } from '@/hooks/useSocket';
import { StatCard } from '@/components/dashboard/stat-card';
import { TicketRow } from '@/components/tickets/ticket-row';
import { ActivityItem } from '@/components/dashboard/activity-item';
import { TicketTrendChart } from '@/components/dashboard/ticket-trend-chart';
import { CategoryChart } from '@/components/dashboard/category-chart';
import { SkeletonStatCards, Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import {
  Ticket, AlertTriangle, CheckCircle, Clock, FolderKanban,
  Users, CalendarOff, Zap, Plus, ArrowRight, ListChecks,
  Sparkles, Loader2, X, Copy, Check, Kanban,
} from 'lucide-react';

// ─── Shared helpers ───────────────────────────────────────────────────────────
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

function WelcomeHeader({ name, sub }: { name: string; sub: string }) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-800">
        Good {greeting()}, {name?.split(' ')[0]} 👋
      </h2>
      <p className="text-slate-500 text-sm mt-1">{sub}</p>
    </div>
  );
}

// ─── Daily Summary Modal ──────────────────────────────────────────────────────
function DailySummaryModal({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['ai-summary'],
    queryFn: () => aiApi.summarizeTickets() as Promise<{ summary: string }>,
    staleTime: 5 * 60 * 1000, // cache 5 min so re-opening doesn't re-fetch
  });

  const handleCopy = () => {
    if (data?.summary) {
      navigator.clipboard.writeText(data.summary).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100"
          style={{ background: 'linear-gradient(135deg,#1e40af 0%,#4f46e5 100%)' }}>
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-indigo-200" />
            <h3 className="font-semibold text-white text-sm">AI Daily Summary</h3>
          </div>
          <button onClick={onClose} className="text-indigo-200 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 min-h-[200px]">
          {isLoading && (
            <div className="flex flex-col items-center justify-center h-40 gap-3">
              <Loader2 size={28} className="animate-spin text-indigo-400" />
              <p className="text-sm text-slate-500">Generating summary with AI…</p>
            </div>
          )}
          {error && (
            <p className="text-sm text-red-500 text-center py-8">Failed to generate summary. Check your OpenAI key.</p>
          )}
          {data?.summary && (
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{data.summary}</p>
          )}
        </div>

        {/* Footer */}
        {data?.summary && (
          <div className="px-6 pb-5 flex items-center justify-between">
            <p className="text-xs text-slate-400">Powered by GPT-4o mini</p>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors text-slate-600"
            >
              {copied ? <><Check size={12} className="text-green-600" /> Copied!</> : <><Copy size={12} /> Copy</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Workload table (Admin/Manager only) ─────────────────────────────────────
function WorkloadTable({ data }: { data: any[] }) {
  if (!Array.isArray(data) || data.length === 0) {
    return <p className="text-sm text-slate-400 text-center py-6">No workload data</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="text-left text-xs font-semibold text-slate-500 uppercase pb-2">Member</th>
            <th className="text-right text-xs font-semibold text-slate-500 uppercase pb-2">Open</th>
            <th className="text-right text-xs font-semibold text-slate-500 uppercase pb-2">In&nbsp;Progress</th>
            <th className="text-right text-xs font-semibold text-slate-500 uppercase pb-2">Done</th>
            <th className="text-right text-xs font-semibold text-slate-500 uppercase pb-2">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {data.map((row: any) => (
            <tr key={row.user?.id ?? row.id} className="hover:bg-slate-50 transition-colors">
              <td className="py-2.5 font-medium text-slate-700">{row.user?.name ?? row.name}</td>
              <td className="py-2.5 text-right text-yellow-600 font-medium">{row.open ?? 0}</td>
              <td className="py-2.5 text-right text-blue-600 font-medium">{row.inProgress ?? row.in_progress ?? 0}</td>
              <td className="py-2.5 text-right text-green-600 font-medium">{row.done ?? 0}</td>
              <td className="py-2.5 text-right text-slate-600 font-semibold">{row.total ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── ADMIN / MANAGER VIEW ────────────────────────────────────────────────────
function AdminDashboard({ user }: { user: any }) {
  const qc = useQueryClient();
  const [showSummary, setShowSummary] = useState(false);

  useSocket({
    onTicketCreated: () => {
      qc.invalidateQueries({ queryKey: ['dashboard-overview'] });
      qc.invalidateQueries({ queryKey: ['activity-feed'] });
    },
    onTicketStatusChanged: () => {
      qc.invalidateQueries({ queryKey: ['dashboard-overview'] });
    },
  });

  const { data: overview, isLoading } = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: () => dashboardApi.getOverview() as Promise<any>,
    refetchInterval: 60000,
  });

  const { data: trend } = useQuery({
    queryKey: ['ticket-trend'],
    queryFn: () => dashboardApi.getTicketTrend(14) as Promise<any[]>,
  });

  const { data: byCategory } = useQuery({
    queryKey: ['tickets-by-category'],
    queryFn: () => dashboardApi.getTicketsByCategory() as Promise<any[]>,
  });

  const { data: activity } = useQuery({
    queryKey: ['activity-feed'],
    queryFn: () => dashboardApi.getActivityFeed(10) as Promise<any[]>,
  });

  const { data: workload } = useQuery({
    queryKey: ['workload'],
    queryFn: () => dashboardApi.getWorkload() as Promise<any[]>,
  });

  const stats = overview?.stats ?? {};

  return (
    <>
    {showSummary && <DailySummaryModal onClose={() => setShowSummary(false)} />}
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between">
        <WelcomeHeader name={user?.name} sub="Here's what's happening across the company today" />
        <button
          onClick={() => setShowSummary(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 shadow-sm flex-shrink-0"
          style={{ background: 'linear-gradient(135deg,#1e40af 0%,#4f46e5 100%)' }}
        >
          <Sparkles size={15} />
          Daily Summary
        </button>
      </div>

      {/* 8 Stat Cards */}
      {isLoading ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4"><SkeletonStatCards count={4} /></div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4"><SkeletonStatCards count={4} /></div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Open Tickets" value={stats.openTickets ?? 0}
              icon={<Ticket size={20} className="text-yellow-600" />} bg="bg-yellow-50"
              change={stats.totalTickets ? `${Math.round((stats.openTickets / stats.totalTickets) * 100)}% of total` : ''} />
            <StatCard label="In Progress" value={stats.inProgressTickets ?? 0}
              icon={<Clock size={20} className="text-blue-600" />} bg="bg-blue-50" />
            <StatCard label="Urgent" value={stats.urgentTickets ?? 0}
              icon={<AlertTriangle size={20} className="text-red-600" />} bg="bg-red-50"
              alert={stats.urgentTickets > 0} />
            <StatCard label="Resolved Today" value={stats.doneTickets ?? 0}
              icon={<CheckCircle size={20} className="text-green-600" />} bg="bg-green-50" />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Active Projects" value={stats.activeProjects ?? 0}
              icon={<FolderKanban size={20} className="text-indigo-600" />} bg="bg-indigo-50"
              sub={`of ${stats.totalProjects ?? 0} total`} />
            <StatCard label="Team Members" value={stats.totalUsers ?? 0}
              icon={<Users size={20} className="text-purple-600" />} bg="bg-purple-50" />
            <StatCard label="Pending Leave" value={stats.pendingLeave ?? 0}
              icon={<CalendarOff size={20} className="text-pink-600" />} bg="bg-pink-50"
              alert={stats.pendingLeave > 3} />
            <StatCard label="Overdue" value={stats.overdueTickets ?? 0}
              icon={<Zap size={20} className="text-orange-600" />} bg="bg-orange-50"
              alert={stats.overdueTickets > 0} />
          </div>
        </>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-800 mb-4">Ticket Trend (14 days)</h3>
          {isLoading ? <Skeleton className="h-48 w-full rounded-lg" /> : <TicketTrendChart data={trend ?? []} />}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-800 mb-4">By Category</h3>
          {isLoading ? <Skeleton className="h-48 w-full rounded-lg" /> : <CategoryChart data={byCategory ?? []} />}
        </div>
      </div>

      {/* Workload + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">Team Workload</h3>
            <Link href="/users" className="text-xs text-indigo-600 hover:underline">View team</Link>
          </div>
          <div className="px-5 py-4">
            {isLoading
              ? <Skeleton className="h-32 w-full rounded-lg" />
              : <WorkloadTable data={workload ?? []} />}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">Recent Activity</h3>
            <span className="text-xs text-slate-400 bg-green-50 text-green-600 px-2 py-0.5 rounded-full font-medium">Live</span>
          </div>
          <div className="divide-y divide-slate-50 max-h-80 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-start gap-3">
                    <Skeleton className="h-7 w-7 rounded-full flex-shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-full" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </div>
                ))}
              </div>
            ) : Array.isArray(activity) && activity.length > 0 ? (
              activity.map((item: any) => <ActivityItem key={item.id} item={item} />)
            ) : (
              <div className="p-6 text-center text-slate-400 text-sm">No recent activity</div>
            )}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

// ─── TEAM LEAD VIEW ──────────────────────────────────────────────────────────
function TeamLeadDashboard({ user }: { user: any }) {
  const deptId = user?.department?.id;

  const { data: deptTickets, isLoading } = useQuery({
    queryKey: ['dept-tickets', deptId],
    queryFn: () => ticketsApi.getAll({ departmentId: deptId, limit: 100 }) as Promise<any>,
    enabled: !!deptId,
    refetchInterval: 60000,
  });

  const tickets: any[] = deptTickets?.tickets ?? [];
  const openCount = tickets.filter((t) => t.status === 'OPEN').length;
  const inProgressCount = tickets.filter((t) => t.status === 'IN_PROGRESS').length;
  const urgentCount = tickets.filter((t) => t.priority === 'URGENT' && !['DONE', 'CLOSED'].includes(t.status)).length;
  const overdueCount = tickets.filter((t) => t.isOverdue).length;
  const reviewTickets = tickets.filter((t) => t.status === 'REVIEW');

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <WelcomeHeader
        name={user?.name}
        sub={`${user?.department?.name ?? 'Your department'} · Team Lead view`}
      />

      {/* 4 dept-scoped stat cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4"><SkeletonStatCards count={4} /></div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Open" value={openCount}
            icon={<Ticket size={20} className="text-yellow-600" />} bg="bg-yellow-50" />
          <StatCard label="In Progress" value={inProgressCount}
            icon={<Clock size={20} className="text-blue-600" />} bg="bg-blue-50" />
          <StatCard label="Urgent" value={urgentCount}
            icon={<AlertTriangle size={20} className="text-red-600" />} bg="bg-red-50"
            alert={urgentCount > 0} />
          <StatCard label="Overdue" value={overdueCount}
            icon={<Zap size={20} className="text-orange-600" />} bg="bg-orange-50"
            alert={overdueCount > 0} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Pending Approvals */}
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-slate-800">Pending Approvals</h3>
              {reviewTickets.length > 0 && (
                <span className="text-xs bg-amber-100 text-amber-700 font-semibold px-2 py-0.5 rounded-full">
                  {reviewTickets.length}
                </span>
              )}
            </div>
            <Link href="/tickets?status=REVIEW" className="text-xs text-indigo-600 hover:underline flex items-center gap-1">
              View all <ArrowRight size={11} />
            </Link>
          </div>
          <div className="divide-y divide-slate-50">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {[1, 2].map((i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
              </div>
            ) : reviewTickets.length > 0 ? (
              reviewTickets.slice(0, 5).map((t) => <TicketRow key={t.id} ticket={t} compact />)
            ) : (
              <div className="p-6 text-center text-slate-400 text-sm">
                <ListChecks size={24} className="mx-auto mb-2 text-slate-300" />
                No tickets awaiting review
              </div>
            )}
          </div>
        </div>

        {/* Team's Tickets */}
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">
              {user?.department?.name ?? 'Department'} Tickets
            </h3>
            <Link
              href={`/tickets${deptId ? `?departmentId=${deptId}` : ''}`}
              className="text-xs text-indigo-600 hover:underline flex items-center gap-1"
            >
              View all <ArrowRight size={11} />
            </Link>
          </div>
          <div className="divide-y divide-slate-50">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
              </div>
            ) : tickets.length > 0 ? (
              tickets
                .filter((t) => !['DONE', 'CLOSED'].includes(t.status))
                .slice(0, 6)
                .map((t) => <TicketRow key={t.id} ticket={t} compact />)
            ) : (
              <div className="p-6 text-center text-slate-400 text-sm">No active tickets</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── EMPLOYEE VIEW ───────────────────────────────────────────────────────────
function EmployeeDashboard({ user }: { user: any }) {
  const { data: overview, isLoading } = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: () => dashboardApi.getOverview() as Promise<any>,
    refetchInterval: 60000,
  });

  const { data: leaveStats } = useQuery({
    queryKey: ['leave-stats'],
    queryFn: () => leaveApi.getStats() as Promise<any>,
  });

  const myTickets: any[] = overview?.myTickets ?? [];
  const openMine = myTickets.filter((t) => t.status === 'OPEN').length;
  const inProgressMine = myTickets.filter((t) => t.status === 'IN_PROGRESS').length;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <WelcomeHeader name={user?.name} sub="Here's your personal workspace" />

      {/* Quick action cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* New Ticket shortcut */}
        <Link
          href="/tickets/new"
          className="group bg-gradient-to-br from-indigo-600 to-blue-700 rounded-xl p-5 flex flex-col gap-3 hover:shadow-lg transition-all"
        >
          <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center">
            <Plus size={20} className="text-white" />
          </div>
          <div>
            <p className="font-semibold text-white">New Ticket</p>
            <p className="text-xs text-indigo-200 mt-0.5">Report an issue or request</p>
          </div>
        </Link>

        {/* My open */}
        <div className={cn('bg-white rounded-xl border p-5', openMine > 0 ? 'border-yellow-200' : 'border-slate-200')}>
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 rounded-lg bg-yellow-50">
              <Ticket size={20} className="text-yellow-600" />
            </div>
            {openMine > 0 && <span className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />}
          </div>
          <p className="text-2xl font-bold text-slate-800">{openMine}</p>
          <p className="text-xs font-medium text-slate-500 mt-0.5">My Open Tickets</p>
        </div>

        {/* My in-progress */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 rounded-lg bg-blue-50">
              <Clock size={20} className="text-blue-600" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-800">{inProgressMine}</p>
          <p className="text-xs font-medium text-slate-500 mt-0.5">In Progress</p>
        </div>
      </div>

      {/* My Tickets list */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">My Tickets</h3>
          <Link href="/tickets" className="text-xs text-indigo-600 hover:underline flex items-center gap-1">
            View all <ArrowRight size={11} />
          </Link>
        </div>
        <div className="divide-y divide-slate-50">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 py-2">
                  <Skeleton className="h-3.5 w-12" />
                  <Skeleton className="h-3.5 flex-1" />
                  <Skeleton className="h-4 w-14 rounded-full" />
                </div>
              ))}
            </div>
          ) : myTickets.length > 0 ? (
            myTickets.map((t: any) => <TicketRow key={t.id} ticket={t} compact />)
          ) : (
            <div className="p-8 text-center">
              <CheckCircle size={28} className="mx-auto text-green-400 mb-2" />
              <p className="text-slate-500 text-sm font-medium">All clear! No tickets assigned to you.</p>
              <Link href="/tickets/new" className="text-xs text-indigo-600 hover:underline mt-1 inline-block">
                Create a new ticket
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Leave summary */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">Leave</h3>
          <Link href="/leave" className="text-xs text-indigo-600 hover:underline flex items-center gap-1">
            Manage <ArrowRight size={11} />
          </Link>
        </div>
        <div className="grid grid-cols-3 divide-x divide-slate-100 text-center">
          {[
            { label: 'Pending', value: leaveStats?.pending ?? 0, color: 'text-amber-600' },
            { label: 'Approved', value: leaveStats?.approved ?? 0, color: 'text-green-600' },
            { label: 'Rejected', value: leaveStats?.rejected ?? 0, color: 'text-red-500' },
          ].map((s) => (
            <div key={s.label} className="px-4 py-5">
              <p className={cn('text-2xl font-bold', s.color)}>{s.value}</p>
              <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── SUPER ADMIN → TEAM LEAD VIEW (AI & R&D scoped) ─────────────────────────
const GURU_TEAM = ['Sonali', 'Snehal', 'Pratik', 'Shama'];

function GurTeamLeadDashboard({ user }: { user: any }) {
  const deptId = user?.department?.id;

  const { data: deptTickets, isLoading } = useQuery({
    queryKey: ['dept-tickets-guru', deptId],
    queryFn: () => ticketsApi.getAll({ departmentId: deptId, limit: 200 }) as Promise<any>,
    enabled: !!deptId,
    refetchInterval: 60000,
  });

  const tickets: any[] = deptTickets?.tickets ?? [];
  const openCount      = tickets.filter((t) => t.status === 'OPEN').length;
  const inProgressCount= tickets.filter((t) => t.status === 'IN_PROGRESS').length;
  const overdueCount   = tickets.filter((t) => t.isOverdue).length;

  // Build per-member stats from assigned tickets
  const memberStats: Record<string, { open: number; inProgress: number; done: number }> = {};
  tickets.forEach((t) => {
    const firstName = t.assignedTo?.name?.split(' ')[0] ?? '';
    if (!GURU_TEAM.includes(firstName)) return;
    if (!memberStats[firstName]) memberStats[firstName] = { open: 0, inProgress: 0, done: 0 };
    if (t.status === 'OPEN') memberStats[firstName].open++;
    else if (t.status === 'IN_PROGRESS') memberStats[firstName].inProgress++;
    else if (['DONE', 'CLOSED'].includes(t.status)) memberStats[firstName].done++;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">
            Good {greeting()}, Guru — AI & R&D Lead 👋
          </h2>
          <p className="text-slate-500 text-sm mt-1">Your team's activity and tasks</p>
        </div>
        <Link
          href="/kanban"
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 shadow-sm flex-shrink-0"
          style={{ background: 'linear-gradient(135deg,#1e40af 0%,#4f46e5 100%)' }}
        >
          <Kanban size={15} />
          Team Kanban
        </Link>
      </div>

      {/* 4 Stat Cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4"><SkeletonStatCards count={4} /></div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Team's Open" value={openCount}
            icon={<Ticket size={20} className="text-yellow-600" />} bg="bg-yellow-50" />
          <StatCard label="In Progress" value={inProgressCount}
            icon={<Clock size={20} className="text-blue-600" />} bg="bg-blue-50" />
          <StatCard label="Overdue" value={overdueCount}
            icon={<AlertTriangle size={20} className="text-red-600" />} bg="bg-red-50"
            alert={overdueCount > 0} />
          <StatCard label="Team Size" value={4}
            icon={<Users size={20} className="text-purple-600" />} bg="bg-purple-50" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* My Team */}
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">My Team</h3>
            <span className="text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full">AI & R&D Interns</span>
          </div>
          <div className="px-5 py-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase pb-2">Member</th>
                  <th className="text-right text-xs font-semibold text-slate-500 uppercase pb-2">Open</th>
                  <th className="text-right text-xs font-semibold text-slate-500 uppercase pb-2">In&nbsp;Prog</th>
                  <th className="text-right text-xs font-semibold text-slate-500 uppercase pb-2">Done</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {GURU_TEAM.map((name) => {
                  const s = memberStats[name] ?? { open: 0, inProgress: 0, done: 0 };
                  return (
                    <tr key={name} className="hover:bg-slate-50 transition-colors">
                      <td className="py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                            <span className="text-xs font-semibold text-indigo-600">{name[0]}</span>
                          </div>
                          <span className="font-medium text-slate-700">{name}</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-right text-yellow-600 font-medium">{s.open}</td>
                      <td className="py-2.5 text-right text-blue-600 font-medium">{s.inProgress}</td>
                      <td className="py-2.5 text-right text-green-600 font-medium">{s.done}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* AI & R&D Active Tickets */}
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">AI & R&D Tickets</h3>
            <Link
              href={`/tickets${deptId ? `?departmentId=${deptId}` : ''}`}
              className="text-xs text-indigo-600 hover:underline flex items-center gap-1"
            >
              View all <ArrowRight size={11} />
            </Link>
          </div>
          <div className="divide-y divide-slate-50">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
              </div>
            ) : tickets.filter((t) => !['DONE', 'CLOSED'].includes(t.status)).length > 0 ? (
              tickets
                .filter((t) => !['DONE', 'CLOSED'].includes(t.status))
                .slice(0, 6)
                .map((t) => <TicketRow key={t.id} ticket={t} compact />)
            ) : (
              <div className="p-6 text-center text-slate-400 text-sm">No active tickets</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { user } = useAuthStore();
  const role = user?.role?.name;
  const [apexMode, setApexMode] = useState<string | null>(null);

  useEffect(() => {
    setApexMode(localStorage.getItem('apexMode') ?? 'super_admin');
  }, []);

  // SUPER_ADMIN: wait for localStorage to hydrate, then branch on mode
  if (role === 'SUPER_ADMIN') {
    if (apexMode === null) return null; // brief flash prevention
    if (apexMode === 'team_lead') return <GurTeamLeadDashboard user={user} />;
    return <AdminDashboard user={user} />;
  }

  // Legacy role names (old seed) + new role names (new seed)
  if (['Admin', 'ADMIN', 'Manager', 'MANAGER'].includes(role ?? '')) return <AdminDashboard user={user} />;
  if (['Team Lead', 'TEAM_LEAD'].includes(role ?? '')) return <TeamLeadDashboard user={user} />;
  return <EmployeeDashboard user={user} />;
}
