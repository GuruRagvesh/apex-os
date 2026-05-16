'use client';

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { dashboardApi, ticketsApi, leaveApi, usersApi, aiApi } from '@/lib/api';
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
import toast from 'react-hot-toast';
import {
  Ticket, AlertTriangle, CheckCircle, Clock, FolderKanban,
  Users, CalendarOff, Zap, Plus, ArrowRight, ListChecks,
  Sparkles, Loader2, X, Copy, Check, Kanban,
} from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────
function useLiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const h = now.getHours();
  const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const timeStr = now.toLocaleString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: true, timeZone: 'Asia/Kolkata',
  });
  return { greeting, timeStr };
}

function WelcomeHeader({ name, sub }: { name: string; sub: string }) {
  const { greeting, timeStr } = useLiveClock();
  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-800">
        {greeting}, {name?.split(' ')[0]} 👋
      </h2>
      <p className="text-slate-500 text-sm mt-0.5 font-mono">{timeStr}</p>
      <p className="text-slate-400 text-xs mt-0.5">{sub}</p>
    </div>
  );
}

function getInitials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

// ── Daily Summary Modal ───────────────────────────────────────────────────────
function DailySummaryModal({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['ai-summary'],
    queryFn:  () => aiApi.summarizeTickets() as Promise<{ summary: string; disabled?: boolean }>,
    staleTime: 5 * 60 * 1000,
  });
  const aiDisabled = (data as any)?.disabled === true;

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
        <div
          className="flex items-center justify-between px-6 py-4 border-b border-slate-100"
          style={{ background: 'linear-gradient(135deg,#1e40af 0%,#4f46e5 100%)' }}
        >
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-indigo-200" />
            <h3 className="font-semibold text-white text-sm">AI Daily Summary</h3>
          </div>
          <button onClick={onClose} className="text-indigo-200 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5 min-h-[200px]">
          {isLoading && (
            <div className="flex flex-col items-center justify-center h-40 gap-3">
              <Loader2 size={28} className="animate-spin text-indigo-400" />
              <p className="text-sm text-slate-500">Generating summary with AI…</p>
            </div>
          )}
          {error && !aiDisabled && (
            <p className="text-sm text-red-500 text-center py-8">
              Failed to generate summary. Please try again later.
            </p>
          )}
          {aiDisabled && (
            <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
              <Sparkles size={28} className="text-slate-300" />
              <p className="text-sm text-slate-600 font-medium">AI Daily Summary is coming soon</p>
              <p className="text-xs text-slate-400 max-w-xs">
                It will generate an intelligent summary of your team&apos;s activity once AI is configured.
              </p>
            </div>
          )}
          {data?.summary && !aiDisabled && (
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{data.summary}</p>
          )}
        </div>
        {data?.summary && !aiDisabled && (
          <div className="px-6 pb-5 flex items-center justify-between">
            <p className="text-xs text-slate-400">Powered by GPT-4o mini</p>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors text-slate-600"
            >
              {copied
                ? <><Check size={12} className="text-green-600" /> Copied!</>
                : <><Copy size={12} /> Copy</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Workload table ────────────────────────────────────────────────────────────
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
              <td className="py-2.5 text-right text-blue-600 font-medium">
                {row.inProgress ?? row.in_progress ?? 0}
              </td>
              <td className="py-2.5 text-right text-green-600 font-medium">{row.done ?? 0}</td>
              <td className="py-2.5 text-right text-slate-600 font-semibold">{row.total ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── SUPER ADMIN / ADMIN VIEW ──────────────────────────────────────────────────
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
    queryFn:  () => dashboardApi.getOverview() as Promise<any>,
    refetchInterval: 60000,
  });

  const { data: trend }      = useQuery({ queryKey: ['ticket-trend'],       queryFn: () => dashboardApi.getTicketTrend(14) as Promise<any[]> });
  const { data: byCategory } = useQuery({ queryKey: ['tickets-by-category'], queryFn: () => dashboardApi.getTicketsByCategory() as Promise<any[]> });
  const { data: activity }   = useQuery({ queryKey: ['activity-feed'],       queryFn: () => dashboardApi.getActivityFeed(10) as Promise<any[]> });
  const { data: workload }   = useQuery({ queryKey: ['workload'],             queryFn: () => dashboardApi.getWorkload() as Promise<any[]> });

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

        {/* 8 stat cards */}
        {isLoading ? (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4"><SkeletonStatCards count={4} /></div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4"><SkeletonStatCards count={4} /></div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Open Tickets"   value={stats.openTickets ?? 0}    icon={<Ticket       size={20} className="text-yellow-600" />} bg="bg-yellow-50" />
              <StatCard label="In Progress"    value={stats.inProgressTickets ?? 0} icon={<Clock     size={20} className="text-blue-600"   />} bg="bg-blue-50"   />
              <StatCard label="Urgent"         value={stats.urgentTickets ?? 0}   icon={<AlertTriangle size={20} className="text-red-600"  />} bg="bg-red-50" alert={stats.urgentTickets > 0} />
              <StatCard label="Resolved Today" value={stats.doneTickets ?? 0}     icon={<CheckCircle  size={20} className="text-green-600" />} bg="bg-green-50"  />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Active Projects" value={stats.activeProjects ?? 0}  icon={<FolderKanban size={20} className="text-indigo-600" />} bg="bg-indigo-50" sub={`of ${stats.totalProjects ?? 0} total`} />
              <StatCard label="Team Members"    value={stats.totalUsers ?? 0}      icon={<Users        size={20} className="text-purple-600" />} bg="bg-purple-50" />
              <StatCard label="Pending Leave"   value={stats.pendingLeave ?? 0}    icon={<CalendarOff  size={20} className="text-pink-600"   />} bg="bg-pink-50" alert={stats.pendingLeave > 3} />
              <StatCard label="Overdue"         value={stats.overdueTickets ?? 0}  icon={<Zap          size={20} className="text-orange-600" />} bg="bg-orange-50" alert={stats.overdueTickets > 0} />
            </div>
          </>
        )}

        {/* Quick actions */}
        <div className="flex flex-wrap gap-3">
          <Link href="/tickets/new"  className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"><Plus size={15} /> New Ticket</Link>
          <Link href="/users"        className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg transition-colors"><Users size={15} /> Users</Link>
          <Link href="/analytics"    className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg transition-colors"><FolderKanban size={15} /> Analytics</Link>
          <button onClick={() => setShowSummary(true)} className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 border border-indigo-200 hover:bg-indigo-50 text-indigo-700 rounded-lg transition-colors"><Sparkles size={15} /> AI Summary</button>
        </div>

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
              <span className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full font-medium">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                Live
              </span>
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

// ── MANAGER VIEW ──────────────────────────────────────────────────────────────
function ManagerDashboard({ user }: { user: any }) {
  const deptId = user?.department?.id;
  const qc = useQueryClient();

  const { data: deptTickets, isLoading: ticketsLoading } = useQuery({
    queryKey: ['dept-tickets', deptId],
    queryFn:  () => ticketsApi.getAll({ departmentId: deptId, limit: 100 }) as Promise<any>,
    enabled:  !!deptId,
    refetchInterval: 60000,
  });

  const { data: leaveRequests, isLoading: leaveLoading } = useQuery({
    queryKey: ['leave-pending'],
    queryFn:  () => leaveApi.getAll({ status: 'PENDING' }) as Promise<any>,
  });

  const { data: workload } = useQuery({
    queryKey: ['workload'],
    queryFn:  () => dashboardApi.getWorkload() as Promise<any[]>,
  });

  const { data: activity } = useQuery({
    queryKey: ['activity-feed'],
    queryFn:  () => dashboardApi.getActivityFeed(10) as Promise<any[]>,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => leaveApi.approve(id),
    onSuccess: () => {
      toast.success('Leave approved');
      qc.invalidateQueries({ queryKey: ['leave-pending'] });
    },
    onError: () => toast.error('Failed to approve leave'),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => leaveApi.reject(id),
    onSuccess: () => {
      toast.success('Leave rejected');
      qc.invalidateQueries({ queryKey: ['leave-pending'] });
    },
    onError: () => toast.error('Failed to reject leave'),
  });

  const tickets: any[] = deptTickets?.tickets ?? [];
  const openCount      = tickets.filter((t) => t.status === 'OPEN').length;
  const inProgressCount= tickets.filter((t) => t.status === 'IN_PROGRESS').length;
  const overdueCount   = tickets.filter((t) => t.isOverdue).length;
  const pendingLeave   = Array.isArray(leaveRequests)
    ? leaveRequests
    : (leaveRequests as any)?.requests ?? [];
  const reviewCount    = tickets.filter((t) => t.status === 'REVIEW').length;

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <WelcomeHeader
        name={user?.name}
        sub={`${user?.department?.name ?? 'Your department'} — Manager`}
      />

      {/* 4 stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {ticketsLoading ? <SkeletonStatCards count={4} /> : (
          <>
            <StatCard label="Team Open"        value={openCount}       icon={<Ticket        size={20} className="text-yellow-600" />} bg="bg-yellow-50" />
            <StatCard label="In Progress"      value={inProgressCount} icon={<Clock         size={20} className="text-blue-600"   />} bg="bg-blue-50"   />
            <StatCard label="Overdue"          value={overdueCount}    icon={<Zap           size={20} className="text-orange-600" />} bg="bg-orange-50" alert={overdueCount > 0} />
            <StatCard label="Pending Approvals" value={reviewCount}    icon={<ListChecks    size={20} className="text-purple-600" />} bg="bg-purple-50" alert={reviewCount > 0} />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Pending Leave */}
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-slate-800">Pending Leave Requests</h3>
              {pendingLeave.length > 0 && (
                <span className="text-xs bg-amber-100 text-amber-700 font-semibold px-2 py-0.5 rounded-full">
                  {pendingLeave.length}
                </span>
              )}
            </div>
            <Link href="/leave" className="text-xs text-indigo-600 hover:underline">View all</Link>
          </div>
          <div className="divide-y divide-slate-100">
            {leaveLoading ? (
              <div className="p-4 space-y-2">
                {[1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
              </div>
            ) : pendingLeave.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-sm">
                <CalendarOff size={24} className="mx-auto mb-2 text-slate-300" />
                No pending leave requests
              </div>
            ) : (
              pendingLeave.slice(0, 5).map((req: any) => (
                <div key={req.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-semibold text-indigo-600">
                        {getInitials(req.user?.name ?? req.employee?.name ?? 'U')}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {req.user?.name ?? req.employee?.name}
                      </p>
                      <p className="text-xs text-slate-400">
                        {req.type} · {formatDate(req.startDate)} → {formatDate(req.endDate)}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => approveMutation.mutate(req.id)}
                      disabled={approveMutation.isPending}
                      className="text-xs font-semibold px-2.5 py-1 bg-green-100 hover:bg-green-200 text-green-700 rounded-lg transition-colors disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => rejectMutation.mutate(req.id)}
                      disabled={rejectMutation.isPending}
                      className="text-xs font-semibold px-2.5 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg transition-colors disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Team workload */}
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">Team Workload</h3>
            <Link href="/users" className="text-xs text-indigo-600 hover:underline">View team</Link>
          </div>
          <div className="px-5 py-4">
            <WorkloadTable data={workload ?? []} />
          </div>
        </div>
      </div>

      {/* Recent activity */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">Recent Activity</h3>
          <span className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full font-medium">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            Live
          </span>
        </div>
        <div className="divide-y divide-slate-50 max-h-64 overflow-y-auto">
          {Array.isArray(activity) && activity.length > 0
            ? activity.map((item: any) => <ActivityItem key={item.id} item={item} />)
            : <div className="p-6 text-center text-slate-400 text-sm">No recent activity</div>}
        </div>
      </div>
    </div>
  );
}

// ── TEAM LEAD VIEW ────────────────────────────────────────────────────────────
const ROLE_BADGE: Record<string, string> = {
  TEAM_LEAD: 'bg-indigo-100 text-indigo-700',
  EMPLOYEE:  'bg-green-100 text-green-700',
  INTERN:    'bg-teal-100 text-teal-700',
};

function TeamLeadDashboard({ user }: { user: any }) {
  const deptId = user?.department?.id;

  const { data: deptTickets, isLoading } = useQuery({
    queryKey: ['dept-tickets', deptId],
    queryFn:  () => ticketsApi.getAll({ departmentId: deptId, limit: 100 }) as Promise<any>,
    enabled:  !!deptId,
    refetchInterval: 60000,
  });

  const { data: deptUsers } = useQuery({
    queryKey: ['dept-users', deptId],
    queryFn:  () => usersApi.getAll({ departmentId: deptId, limit: 50 }) as Promise<any>,
    enabled:  !!deptId,
  });

  const tickets: any[]   = deptTickets?.tickets ?? [];
  const members: any[]   = deptUsers?.users ?? deptUsers ?? [];
  const openCount        = tickets.filter((t) => t.status === 'OPEN').length;
  const inProgressCount  = tickets.filter((t) => t.status === 'IN_PROGRESS').length;

  // Per-member ticket stats
  const memberStats: Record<string, { open: number; inProgress: number }> = {};
  tickets.forEach((t) => {
    const uid = t.assignedTo?.id;
    if (!uid) return;
    if (!memberStats[uid]) memberStats[uid] = { open: 0, inProgress: 0 };
    if (t.status === 'OPEN')        memberStats[uid].open++;
    else if (t.status === 'IN_PROGRESS') memberStats[uid].inProgress++;
  });

  const recentTickets = tickets
    .filter((t) => !['DONE', 'CLOSED'].includes(t.status))
    .slice(0, 10);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <WelcomeHeader
        name={user?.name}
        sub={`${user?.department?.name ?? 'Your department'} — Team Lead 👋`}
      />

      {/* 3 stat cards */}
      {isLoading ? (
        <div className="grid grid-cols-3 gap-4"><SkeletonStatCards count={3} /></div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Team Open"   value={openCount}       icon={<Ticket size={20} className="text-yellow-600" />} bg="bg-yellow-50" />
          <StatCard label="In Progress" value={inProgressCount} icon={<Clock  size={20} className="text-blue-600"   />} bg="bg-blue-50"   />
          <StatCard label="Team Size"   value={members.length || tickets.reduce((acc, t) => {
            if (t.assignedTo?.id && !acc.ids.has(t.assignedTo.id)) { acc.ids.add(t.assignedTo.id); acc.count++; }
            return acc;
          }, { ids: new Set<string>(), count: 0 }).count}
            icon={<Users size={20} className="text-purple-600" />} bg="bg-purple-50" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* My Team */}
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">My Team</h3>
            <span className="text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full">
              {user?.department?.name ?? ''}
            </span>
          </div>
          <div className="divide-y divide-slate-50">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
              </div>
            ) : members.length > 0 ? (
              members
                .filter((m) => m.id !== user?.id)
                .map((m: any) => {
                  const roleName = m.role?.name ?? m.role ?? 'EMPLOYEE';
                  const stats    = memberStats[m.id] ?? { open: 0, inProgress: 0 };
                  return (
                    <div key={m.id} className="px-5 py-3 flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ background: 'linear-gradient(135deg,#1e40af,#4f46e5)' }}
                      >
                        <span className="text-white text-xs font-semibold">{getInitials(m.name)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{m.name}</p>
                        <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded', ROLE_BADGE[roleName] ?? 'bg-slate-100 text-slate-600')}>
                          {roleName}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs flex-shrink-0">
                        <span className="text-yellow-600 font-medium" title="Open">
                          {stats.open} open
                        </span>
                        <span className="text-blue-600 font-medium" title="In Progress">
                          {stats.inProgress} active
                        </span>
                      </div>
                    </div>
                  );
                })
            ) : (
              <div className="p-6 text-center text-slate-400 text-sm">
                <Users size={24} className="mx-auto mb-2 text-slate-300" />
                No team members found
              </div>
            )}
          </div>
        </div>

        {/* Recent team tickets */}
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
            ) : recentTickets.length > 0 ? (
              recentTickets.map((t) => <TicketRow key={t.id} ticket={t} compact />)
            ) : (
              <div className="p-6 text-center text-slate-400 text-sm">No active tickets</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SUPER ADMIN → TEAM LEAD VIEW (AI & R&D scoped) ───────────────────────────
const GURU_TEAM = ['Sonali', 'Snehal', 'Pratik', 'Shama'];

function GurTeamLeadDashboard({ user }: { user: any }) {
  const deptId = user?.department?.id;

  const { data: deptTickets, isLoading } = useQuery({
    queryKey: ['dept-tickets-guru', deptId],
    queryFn:  () => ticketsApi.getAll({ departmentId: deptId, limit: 200 }) as Promise<any>,
    enabled:  !!deptId,
    refetchInterval: 60000,
  });

  const tickets: any[]  = deptTickets?.tickets ?? [];
  const openCount       = tickets.filter((t) => t.status === 'OPEN').length;
  const inProgressCount = tickets.filter((t) => t.status === 'IN_PROGRESS').length;
  const overdueCount    = tickets.filter((t) => t.isOverdue).length;

  const memberStats: Record<string, { open: number; inProgress: number; done: number }> = {};
  tickets.forEach((t) => {
    const firstName = t.assignedTo?.name?.split(' ')[0] ?? '';
    if (!GURU_TEAM.includes(firstName)) return;
    if (!memberStats[firstName]) memberStats[firstName] = { open: 0, inProgress: 0, done: 0 };
    if (t.status === 'OPEN')                            memberStats[firstName].open++;
    else if (t.status === 'IN_PROGRESS')                memberStats[firstName].inProgress++;
    else if (['DONE', 'CLOSED'].includes(t.status))     memberStats[firstName].done++;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between">
        <div>
          <WelcomeHeader name={user?.name} sub="AI & R&D Lead — Your team's activity and tasks" />
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

      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4"><SkeletonStatCards count={4} /></div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Team's Open"  value={openCount}       icon={<Ticket        size={20} className="text-yellow-600" />} bg="bg-yellow-50" />
          <StatCard label="In Progress"  value={inProgressCount} icon={<Clock         size={20} className="text-blue-600"   />} bg="bg-blue-50"   />
          <StatCard label="Overdue"      value={overdueCount}    icon={<AlertTriangle  size={20} className="text-red-600"    />} bg="bg-red-50" alert={overdueCount > 0} />
          <StatCard label="Team Size"    value={4}               icon={<Users          size={20} className="text-purple-600" />} bg="bg-purple-50" />
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

// ── EMPLOYEE / INTERN VIEW ────────────────────────────────────────────────────
function EmployeeDashboard({ user }: { user: any }) {
  const { data: overview, isLoading } = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn:  () => dashboardApi.getOverview() as Promise<any>,
    refetchInterval: 60000,
  });

  const { data: leaveStats } = useQuery({
    queryKey: ['leave-stats'],
    queryFn:  () => leaveApi.getStats() as Promise<any>,
  });

  const myTickets: any[]  = overview?.myTickets ?? [];
  const openMine         = myTickets.filter((t) => t.status === 'OPEN').length;
  const inProgressMine   = myTickets.filter((t) => t.status === 'IN_PROGRESS').length;
  const doneWeek         = myTickets.filter((t) => {
    if (!['DONE', 'CLOSED'].includes(t.status)) return false;
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    return new Date(t.updatedAt).getTime() > weekAgo;
  }).length;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <WelcomeHeader name={user?.name} sub="Here's your work today" />

      {/* 3 stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={cn('bg-white rounded-xl border p-5', openMine > 0 ? 'border-yellow-200' : 'border-slate-200')}>
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 rounded-lg bg-yellow-50"><Ticket size={20} className="text-yellow-600" /></div>
            {openMine > 0 && <span className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />}
          </div>
          <p className="text-2xl font-bold text-slate-800">{openMine}</p>
          <p className="text-xs font-medium text-slate-500 mt-0.5">My Open Tickets</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="p-2 rounded-lg bg-blue-50 w-fit mb-3"><Clock size={20} className="text-blue-600" /></div>
          <p className="text-2xl font-bold text-slate-800">{inProgressMine}</p>
          <p className="text-xs font-medium text-slate-500 mt-0.5">In Progress</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="p-2 rounded-lg bg-green-50 w-fit mb-3"><CheckCircle size={20} className="text-green-600" /></div>
          <p className="text-2xl font-bold text-slate-800">{doneWeek}</p>
          <p className="text-xs font-medium text-slate-500 mt-0.5">Done This Week</p>
        </div>
      </div>

      {/* New Ticket CTA */}
      <Link
        href="/tickets/new"
        className="group block bg-gradient-to-br from-indigo-600 to-blue-700 rounded-xl p-6 hover:shadow-lg transition-all"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 bg-white/20 rounded-xl flex items-center justify-center">
              <Plus size={22} className="text-white" />
            </div>
            <div>
              <p className="font-bold text-white text-base">Create a New Ticket</p>
              <p className="text-xs text-indigo-200 mt-0.5">Report an issue, request a resource, or ask for help</p>
            </div>
          </div>
          <ArrowRight size={20} className="text-white/60 group-hover:text-white group-hover:translate-x-1 transition-all" />
        </div>
      </Link>

      {/* My Tickets */}
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
            myTickets.slice(0, 10).map((t: any) => <TicketRow key={t.id} ticket={t} compact />)
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
            Apply Leave <ArrowRight size={11} />
          </Link>
        </div>
        <div className="grid grid-cols-3 divide-x divide-slate-100 text-center">
          {[
            { label: 'Pending',  value: leaveStats?.pending  ?? 0, color: 'text-amber-600' },
            { label: 'Approved', value: leaveStats?.approved ?? 0, color: 'text-green-600' },
            { label: 'Rejected', value: leaveStats?.rejected ?? 0, color: 'text-red-500'   },
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

// ── LOADING SKELETON ──────────────────────────────────────────────────────────
function DashboardSkeleton() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-9 w-36 rounded-xl" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SkeletonStatCards count={4} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SkeletonStatCards count={4} />
      </div>
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { user, hasHydrated } = useAuthStore();

  // Wait for Zustand to finish rehydrating from localStorage
  if (!hasHydrated) return <DashboardSkeleton />;

  // Rehydrated but no user — will be caught by the layout auth guard
  if (!user) return null;

  const role = (user.role as any)?.name ?? (typeof user.role === 'string' ? user.role : '');

  if (role === 'SUPER_ADMIN') {
    const mode = typeof window !== 'undefined' ? localStorage.getItem('apexMode') : null;
    return mode === 'team_lead'
      ? <GurTeamLeadDashboard user={user} />
      : <AdminDashboard       user={user} />;
  }

  if (role === 'ADMIN')     return <AdminDashboard   user={user} />;
  if (role === 'MANAGER')   return <ManagerDashboard user={user} />;
  if (role === 'TEAM_LEAD') return <TeamLeadDashboard user={user} />;
  return <EmployeeDashboard user={user} />;
}
