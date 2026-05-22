'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  dashboardApi, ticketsApi, projectsApi, notificationsApi, workdayApi,
} from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { useSocket } from '@/hooks/useSocket';
import { useIdleDetection } from '@/hooks/useIdleDetection';
import { WorkdayBar } from '@/components/workday/WorkdayBar';
import { IdleWarningToast } from '@/components/workday/IdleWarningToast';
import { IdlePopup } from '@/components/workday/IdlePopup';
import { SessionRecoveryModal } from '@/components/workday/SessionRecoveryModal';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  ClipboardList, CheckCircle2, CalendarDays, Users, FolderKanban,
  BarChart3, Building2, User, Plus, Info, CheckCircle,
  AlertTriangle, XCircle, Calendar, ChevronRight, Activity, X,
} from 'lucide-react';
import { getTicketVisibility, PRIORITY_DOT } from '@/lib/ticket-visibility';
import { TimingTicker } from '@/components/tickets/OverdueTicker';

// ─────────────────────────────────────────────────────────────────────────────
// Clock & date helpers
// ─────────────────────────────────────────────────────────────────────────────
function useLiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const greeting = (h: number) =>
  h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';

const fmtLongDate = (d: Date) =>
  d.toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

const fmtTime = (d: Date) =>
  d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Task bucket helpers
// ─────────────────────────────────────────────────────────────────────────────
const todayStart = () => new Date(new Date().setHours(0, 0, 0, 0));
const todayEnd   = () => new Date(new Date().setHours(23, 59, 59, 999));

type Bucket = 'today' | 'upcoming' | 'overdue';

function bucket(dueDate: string | null | undefined): Bucket | null {
  if (!dueDate) return null;
  const d = new Date(dueDate);
  if (d < todayStart()) return 'overdue';
  if (d <= todayEnd())   return 'today';
  return 'upcoming';
}

// ─────────────────────────────────────────────────────────────────────────────
// Mini components
// ─────────────────────────────────────────────────────────────────────────────
const PRIORITY_CLS: Record<string, string> = {
  URGENT: 'bg-red-100    text-red-700    dark:bg-red-900/30    dark:text-red-400',
  HIGH:   'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  MEDIUM: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  LOW:    'bg-green-100  text-green-700  dark:bg-green-900/30  dark:text-green-400',
};

function PriBadge({ p }: { p: string }) {
  return (
    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide flex-shrink-0', PRIORITY_CLS[p] ?? 'bg-slate-100 text-slate-600')}>
      {p}
    </span>
  );
}

const PROJECT_STATUS_CLS: Record<string, string> = {
  ACTIVE:    'bg-green-100  text-green-700  dark:bg-green-900/30  dark:text-green-400',
  ON_HOLD:   'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  COMPLETED: 'bg-blue-100   text-blue-700   dark:bg-blue-900/30   dark:text-blue-400',
  CANCELLED: 'bg-slate-100  text-slate-600  dark:bg-gray-700      dark:text-gray-400',
};

function NotifIcon({ type }: { type: string }) {
  if (type === 'SUCCESS') return <CheckCircle   size={15} className="text-green-500  flex-shrink-0 mt-0.5" />;
  if (type === 'WARNING') return <AlertTriangle size={15} className="text-orange-500 flex-shrink-0 mt-0.5" />;
  if (type === 'ERROR')   return <XCircle       size={15} className="text-red-500    flex-shrink-0 mt-0.5" />;
  return                         <Info          size={15} className="text-blue-500   flex-shrink-0 mt-0.5" />;
}

// Skeleton shimmer blocks
function CardSkeleton() {
  return (
    <div className="apex-card p-5 space-y-4">
      <div className="flex items-center gap-4">
        <Skeleton className="w-12 h-12 rounded-full flex-shrink-0" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-3.5 w-28" />
        </div>
      </div>
      <Skeleton className="h-3 w-24" />
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5">
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      <Skeleton className="h-5 w-14 rounded-full" />
      <Skeleton className="h-3.5 w-12" />
    </div>
  );
}

function PanelRowSkeleton() {
  return (
    <div className="px-5 py-4 space-y-2">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-4 w-14 rounded-full" />
      </div>
      <Skeleton className="h-1.5 w-full rounded-full" />
      <Skeleton className="h-3 w-24" />
    </div>
  );
}

function NotifRowSkeleton() {
  return (
    <div className="flex items-start gap-3 px-5 py-3.5">
      <Skeleton className="w-4 h-4 rounded-full mt-0.5 flex-shrink-0" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      <Skeleton className="h-3 w-12 flex-shrink-0" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stat card config factory
// ─────────────────────────────────────────────────────────────────────────────
interface CardCfg {
  icon: React.ReactNode;
  iconBg: string;
  value: number;
  label: string;
  sub: string;
  subColor: string;
  href?: string;
}

function buildStatCards(role: string, stats: any, myOpenCount: number, myDueToday: number): CardCfg[] {
  const s = stats ?? {};

  if (['ADMIN', 'SUPER_ADMIN'].includes(role)) {
    return [
      { icon: <ClipboardList size={20} className="text-blue-600" />,   iconBg: 'bg-blue-100   dark:bg-blue-900/30',   value: s.openTickets   ?? 0, label: 'Open Tickets',      sub: `${s.urgentTickets ?? 0} urgent`,          subColor: 'text-blue-600   dark:text-blue-400',   href: '/tickets?status=OPEN' },
      { icon: <CalendarDays  size={20} className="text-orange-600" />, iconBg: 'bg-orange-100 dark:bg-orange-900/30', value: s.pendingLeave  ?? 0, label: 'Pending Approvals', sub: 'Requires action',                         subColor: 'text-orange-600 dark:text-orange-400', href: '/leave' },
      { icon: <FolderKanban  size={20} className="text-green-600" />,  iconBg: 'bg-green-100  dark:bg-green-900/30',  value: s.activeProjects ?? 0, label: 'Active Projects',  sub: `of ${s.totalProjects ?? 0} total`,        subColor: 'text-green-600  dark:text-green-400',  href: '/projects' },
    ];
  }
  if (role === 'MANAGER') {
    return [
      { icon: <ClipboardList size={20} className="text-blue-600" />,   iconBg: 'bg-blue-100   dark:bg-blue-900/30',   value: s.openTickets    ?? 0, label: 'Dept Open Tickets', sub: `${s.inProgressTickets ?? 0} in progress`, subColor: 'text-blue-600   dark:text-blue-400',   href: '/tickets?status=OPEN' },
      { icon: <CalendarDays  size={20} className="text-orange-600" />, iconBg: 'bg-orange-100 dark:bg-orange-900/30', value: s.pendingLeave   ?? 0, label: 'Pending Approvals', sub: 'Requires action',                         subColor: 'text-orange-600 dark:text-orange-400', href: '/leave' },
      { icon: <Users         size={20} className="text-purple-600" />, iconBg: 'bg-purple-100 dark:bg-purple-900/30', value: s.teamMembers    ?? 0, label: 'Team Members',      sub: 'In your department(s)',                   subColor: 'text-purple-600 dark:text-purple-400', href: '/team' },
    ];
  }
  if (role === 'TEAM_LEAD') {
    return [
      { icon: <ClipboardList size={20} className="text-blue-600" />,   iconBg: 'bg-blue-100   dark:bg-blue-900/30',   value: myOpenCount,         label: 'My Open Tasks',     sub: `${myDueToday} due today`,                 subColor: 'text-blue-600   dark:text-blue-400',   href: '/tickets' },
      { icon: <Users         size={20} className="text-purple-600" />, iconBg: 'bg-purple-100 dark:bg-purple-900/30', value: s.openTickets   ?? 0, label: 'Team Tasks',        sub: `${s.inProgressTickets ?? 0} in progress`, subColor: 'text-purple-600 dark:text-purple-400', href: '/tickets?status=OPEN' },
      { icon: <CalendarDays  size={20} className="text-orange-600" />, iconBg: 'bg-orange-100 dark:bg-orange-900/30', value: s.pendingLeave  ?? 0, label: 'Pending Approvals', sub: 'Requires action',                         subColor: 'text-orange-600 dark:text-orange-400', href: '/leave' },
    ];
  }
  // EMPLOYEE / INTERN
  return [
    { icon: <ClipboardList size={20} className="text-blue-600" />,   iconBg: 'bg-blue-100   dark:bg-blue-900/30',   value: myOpenCount,        label: 'My Open Tasks',       sub: `${myDueToday} due today`,                subColor: 'text-blue-600   dark:text-blue-400',   href: '/tickets' },
    { icon: <CheckCircle2  size={20} className="text-green-600" />,  iconBg: 'bg-green-100  dark:bg-green-900/30',  value: s.doneTickets ?? 0, label: 'Completed this week', sub: 'This week',                              subColor: 'text-green-600  dark:text-green-400',  href: '/tickets?status=DONE' },
    { icon: <CalendarDays  size={20} className="text-orange-600" />, iconBg: 'bg-orange-100 dark:bg-orange-900/30', value: s.pendingLeave ?? 0, label: 'Leave balance',       sub: `${s.pendingLeave ?? 0} pending`,         subColor: 'text-orange-600 dark:text-orange-400', href: '/leave' },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick-link config
// ─────────────────────────────────────────────────────────────────────────────
const ALL_QUICK_LINKS = [
  {
    label: 'New Ticket', icon: <Plus size={17} />, textCls: 'text-blue-600 dark:text-blue-400',
    hoverCls: 'hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-200 dark:hover:border-blue-800',
    href: '/tickets/new', roles: ['EMPLOYEE', 'INTERN', 'TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  },
  {
    label: 'Apply Leave', icon: <CalendarDays size={17} />, textCls: 'text-orange-600 dark:text-orange-400',
    hoverCls: 'hover:bg-orange-50 dark:hover:bg-orange-900/20 hover:border-orange-200 dark:hover:border-orange-800',
    href: '/leave', roles: ['EMPLOYEE', 'INTERN', 'TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  },
  {
    label: 'My Profile', icon: <User size={17} />, textCls: 'text-purple-600 dark:text-purple-400',
    hoverCls: 'hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:border-purple-200 dark:hover:border-purple-800',
    href: '/settings', roles: ['EMPLOYEE', 'INTERN', 'TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  },
  {
    label: 'Team', icon: <Users size={17} />, textCls: 'text-teal-600 dark:text-teal-400',
    hoverCls: 'hover:bg-teal-50 dark:hover:bg-teal-900/20 hover:border-teal-200 dark:hover:border-teal-800',
    href: '/team', roles: ['EMPLOYEE', 'INTERN', 'TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  },
  {
    label: 'Analytics', icon: <BarChart3 size={17} />, textCls: 'text-indigo-600 dark:text-indigo-400',
    hoverCls: 'hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:border-indigo-200 dark:hover:border-indigo-800',
    href: '/analytics', roles: ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  },
  {
    label: 'Departments', icon: <Building2 size={17} />, textCls: 'text-green-600 dark:text-green-400',
    hoverCls: 'hover:bg-green-50 dark:hover:bg-green-900/20 hover:border-green-200 dark:hover:border-green-800',
    href: '/departments', roles: ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { user }  = useAuthStore();
  const qc        = useQueryClient();
  const router    = useRouter();
  const now       = useLiveClock();
  const [taskTab, setTaskTab] = useState<Bucket>('today');
  const [showActivity, setShowActivity] = useState(false);
  const [showIdleToast, setShowIdleToast] = useState(false);
  const [showIdlePopup, setShowIdlePopup] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [awayMinutes, setAwayMinutes] = useState(0);

  const roleName  = (user?.role as any)?.name ?? '';
  const firstName = (user?.name ?? 'there').split(' ')[0];
  const userId    = user?.id ?? '';

  const { data: todayWorkdayData, refetch: refetchWorkday } = useQuery({
    queryKey: ['workday-today'],
    queryFn: () => workdayApi.getToday() as Promise<any>,
    refetchInterval: 60000,
    enabled: !!userId,
  });

  const workStatus = (todayWorkdayData as any)?.session?.status ?? 'OFFLINE';

  // Idle detection
  useIdleDetection({
    isWorking: workStatus === 'WORKING',
    onWarning: () => setShowIdleToast(true),
    onIdle: async () => {
      try { await workdayApi.reportIdle(20); refetchWorkday(); } catch {}
    },
    onSuggest: () => setShowIdlePopup(true),
  });

  // Session recovery check
  useEffect(() => {
    if (!todayWorkdayData) return;
    const session = (todayWorkdayData as any)?.session;
    if (!session) return;
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    const wasWorking = session.startWorkAt && !session.logoutAt && session.status === 'WORKING';
    const lastSeen = session.updatedAt ? new Date(session.updatedAt) : null;
    const longAway = lastSeen && lastSeen < thirtyMinAgo;
    if (wasWorking && longAway) {
      const mins = Math.floor((Date.now() - lastSeen.getTime()) / 60000);
      setAwayMinutes(mins);
      setShowRecovery(true);
    }
  }, [todayWorkdayData]);

  // ── Invalidate on real-time events ───────────────────────────────────────
  useSocket({
    onTicketCreated:       () => {
      qc.invalidateQueries({ queryKey: ['dash-overview'] });
      qc.invalidateQueries({ queryKey: ['my-tasks', userId] });
    },
    onTicketStatusChanged: () => {
      qc.invalidateQueries({ queryKey: ['dash-overview'] });
      qc.invalidateQueries({ queryKey: ['my-tasks', userId] });
    },
  });

  // ── Data fetching ─────────────────────────────────────────────────────────
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['dash-overview'],
    queryFn:  () => dashboardApi.getOverview() as Promise<any>,
    refetchInterval: 60_000,
  });

  const { data: myTasksRaw, isLoading: tasksLoading } = useQuery({
    queryKey: ['my-tasks', userId],
    queryFn:  () => ticketsApi.getAll({ assignedToId: userId, limit: 50, page: 1 }) as Promise<any>,
    enabled:  !!userId,
  });

  const { data: projectsRaw, isLoading: projectsLoading } = useQuery({
    queryKey: ['dash-projects'],
    queryFn:  () => projectsApi.getAll({ limit: 5 }) as Promise<any>,
    staleTime: 60_000,
  });

  const { data: notifsRaw, isLoading: notifsLoading } = useQuery({
    queryKey: ['dash-notifs'],
    queryFn:  () => notificationsApi.getAll() as Promise<any>,
    refetchInterval: 30_000,
  });

  // ── Derived ───────────────────────────────────────────────────────────────
  const stats = (overview?.stats ?? {}) as Record<string, number>;

  const allMyTasks = useMemo<any[]>(() => {
    const raw = myTasksRaw?.tickets ?? (Array.isArray(myTasksRaw) ? myTasksRaw : []);
    return (raw as any[]).filter((t: any) => !['DONE', 'CLOSED'].includes(t.status));
  }, [myTasksRaw]);

  const todayTasks    = useMemo(() => allMyTasks.filter((t) => bucket(t.dueDate) === 'today'),    [allMyTasks]);
  const upcomingTasks = useMemo(() => allMyTasks.filter((t) => bucket(t.dueDate) === 'upcoming'), [allMyTasks]);
  const overdueTasks  = useMemo(
    () => allMyTasks
      .filter((t) => bucket(t.dueDate) === 'overdue' || t.isOverdue)
      .sort((a, b) => (b.overdueMinutes ?? 0) - (a.overdueMinutes ?? 0)),
    [allMyTasks],
  );

  const visibleTasks = taskTab === 'today' ? todayTasks : taskTab === 'upcoming' ? upcomingTasks : overdueTasks;

  const projects = useMemo<any[]>(() => {
    const raw = projectsRaw?.projects ?? projectsRaw?.data ?? (Array.isArray(projectsRaw) ? projectsRaw : []);
    return (raw as any[]).slice(0, 3);
  }, [projectsRaw]);

  const notifications = useMemo<any[]>(() => {
    const raw = Array.isArray(notifsRaw) ? notifsRaw : (notifsRaw?.notifications ?? []);
    return (raw as any[]).slice(0, 5);
  }, [notifsRaw]);

  const statCards = useMemo(
    () => buildStatCards(roleName, stats, allMyTasks.length, todayTasks.length),
    [roleName, stats, allMyTasks.length, todayTasks.length],
  );

  const quickLinks = useMemo(
    () => ALL_QUICK_LINKS.filter((l) => l.roles.includes(roleName)),
    [roleName],
  );

  // ─────────────────────────────────────────────────────────────────────────
  const card = 'bg-white dark:bg-gray-800 rounded-xl border border-slate-200 dark:border-gray-700 shadow-sm';

  return (
    <>
    <div className="max-w-7xl mx-auto space-y-7">

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* SECTION 1 — Greeting hero                                          */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
        <div>
          <h1 className="text-[28px] font-bold leading-tight text-slate-800 dark:text-white">
            {greeting(now.getHours())}, {firstName}! 👋
          </h1>
          <p className="text-sm text-slate-400 dark:text-gray-500 mt-1.5">
            Here&apos;s what&apos;s happening in TechnoEdge today.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => setShowActivity(true)}
            className="flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors"
          >
            <Activity size={15} className="text-indigo-500" />
            Recent Activity
          </button>
          <div className="text-right space-y-0.5">
            <p className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-gray-300 justify-end">
              <Calendar size={14} className="text-slate-400 dark:text-gray-500" />
              {fmtLongDate(now)}
            </p>
            <p className="text-sm text-slate-400 dark:text-gray-500">{fmtTime(now)}</p>
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* WORKDAY BAR                                                         */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <WorkdayBar />

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* SECTION 2 — 3 stat cards                                           */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {overviewLoading || tasksLoading
          ? Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)
          : statCards.map((cfg, i) => (
            cfg.href ? (
              <Link key={i} href={cfg.href} className={cn(card, 'p-5 block hover:shadow-md hover:border-blue-200 dark:hover:border-blue-700 transition-all cursor-pointer')}>
                <div className="flex items-center gap-4">
                  <div className={cn('w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0', cfg.iconBg)}>
                    {cfg.icon}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[32px] font-bold leading-none text-slate-800 dark:text-white">
                      {cfg.value}
                    </p>
                    <p className="text-sm text-slate-500 dark:text-gray-400 mt-1.5">{cfg.label}</p>
                  </div>
                </div>
                <p className={cn('text-xs font-semibold mt-3.5', cfg.subColor)}>{cfg.sub}</p>
              </Link>
            ) : (
              <div key={i} className={cn(card, 'p-5')}>
                <div className="flex items-center gap-4">
                  <div className={cn('w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0', cfg.iconBg)}>
                    {cfg.icon}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[32px] font-bold leading-none text-slate-800 dark:text-white">
                      {cfg.value}
                    </p>
                    <p className="text-sm text-slate-500 dark:text-gray-400 mt-1.5">{cfg.label}</p>
                  </div>
                </div>
                <p className={cn('text-xs font-semibold mt-3.5', cfg.subColor)}>{cfg.sub}</p>
              </div>
            )
          ))}
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* SECTION 3 — Two-column content                                     */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[55%_1fr] gap-5 items-start">

        {/* ── LEFT: My Tasks ────────────────────────────────────────────── */}
        <div className={cn(card, 'overflow-hidden')}>
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-gray-700">
            <h2 className="font-bold text-slate-800 dark:text-white">My Tasks</h2>
            <Link
              href="/tickets"
              className="flex items-center gap-0.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              View All <ChevronRight size={12} />
            </Link>
          </div>

          {/* Tab strip */}
          <div className="flex px-5 border-b border-slate-100 dark:border-gray-700 gap-1">
            {(
              [
                { key: 'today' as const,    label: 'Today',    count: todayTasks.length,    alert: false },
                { key: 'upcoming' as const, label: 'Upcoming', count: upcomingTasks.length, alert: false },
                { key: 'overdue' as const,  label: 'Overdue',  count: overdueTasks.length,  alert: overdueTasks.length > 0 },
              ]
            ).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setTaskTab(tab.key)}
                className={cn(
                  'flex items-center gap-1.5 text-sm font-medium py-3 px-1 mr-4 border-b-2 transition-colors',
                  taskTab === tab.key
                    ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200',
                )}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className={cn(
                    'text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none',
                    tab.alert
                      ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                      : 'bg-slate-100 text-slate-500 dark:bg-gray-700 dark:text-gray-400',
                  )}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Task rows */}
          <div className="divide-y divide-slate-50 dark:divide-gray-700/40 min-h-[220px]">
            {tasksLoading
              ? Array.from({ length: 4 }).map((_, i) => <RowSkeleton key={i} />)
              : visibleTasks.length === 0
                ? (
                  <div className="flex flex-col items-center justify-center py-14 text-slate-400 dark:text-gray-500">
                    <CheckCircle2 size={30} className="mb-2.5 text-green-400" />
                    <p className="text-sm font-medium">
                      {taskTab === 'overdue' ? 'No overdue tasks!' : "You're all caught up! 🎉"}
                    </p>
                  </div>
                )
                : visibleTasks.slice(0, 5).map((t: any) => {
                    const tVis = getTicketVisibility({ status: t.status, isOverdue: t.isOverdue, overdueSeverity: t.overdueSeverity });
                    return (
                      <Link
                        key={t.id}
                        href={`/tickets/${t.id}`}
                        className={cn('flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-gray-700/40 transition-all group', tVis.borderClass, tVis.bgClass)}
                      >
                        <span className={cn('w-2 h-2 rounded-full flex-shrink-0 inline-block', PRIORITY_DOT[t.priority] ?? 'bg-gray-400')} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 dark:text-gray-200 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                            {t.title.length > 45 ? t.title.slice(0, 45) + '…' : t.title}
                          </p>
                          <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5 truncate">
                            {t.project?.name ? `${t.project.name} · ` : ''}
                            {t.department?.name ?? '—'}
                          </p>
                          {taskTab === 'overdue' && (
                            <TimingTicker ticket={t} />
                          )}
                        </div>
                        <PriBadge p={t.priority} />
                        {t.dueDate && (
                          <span className="text-xs text-slate-400 dark:text-gray-500 flex-shrink-0 font-mono">
                            {new Date(t.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                          </span>
                        )}
                      </Link>
                    );
                  })
            }
          </div>

          {/* Footer link */}
          {!tasksLoading && visibleTasks.length > 0 && (
            <div className="px-5 py-3 border-t border-slate-50 dark:border-gray-700/40">
              <Link href="/tickets" className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                View all tasks →
              </Link>
            </div>
          )}
        </div>

        {/* ── RIGHT column ──────────────────────────────────────────────── */}
        <div className="flex flex-col gap-5">

          {/* My Projects */}
          <div className={cn(card, 'overflow-hidden')}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-gray-700">
              <h2 className="font-bold text-slate-800 dark:text-white">My Projects</h2>
              <Link
                href="/projects"
                className="flex items-center gap-0.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                View All <ChevronRight size={12} />
              </Link>
            </div>
            <div className="divide-y divide-slate-50 dark:divide-gray-700/40">
              {projectsLoading
                ? Array.from({ length: 3 }).map((_, i) => <PanelRowSkeleton key={i} />)
                : projects.length === 0
                  ? (
                    <p className="text-sm text-center text-slate-400 dark:text-gray-500 py-10">
                      No active projects assigned.
                    </p>
                  )
                  : projects.map((proj: any) => {
                    const total   = proj._count?.tickets ?? 0;
                    const pct     = 0; // per-project DONE count not available on list endpoint
                    const status  = (proj.status ?? 'ACTIVE') as string;
                    return (
                      <Link key={proj.id} href="/projects" className="block px-5 py-4 hover:bg-slate-50 dark:hover:bg-gray-700/40 transition-colors group">
                        <div className="flex items-start justify-between gap-2 mb-2.5">
                          <p className="text-sm font-semibold text-slate-800 dark:text-gray-200 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                            {proj.name}
                          </p>
                          <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0', PROJECT_STATUS_CLS[status] ?? PROJECT_STATUS_CLS.ACTIVE)}>
                            {status.replace('_', ' ')}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="flex-1 h-1.5 bg-slate-100 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full transition-all"
                              style={{ width: `${total > 0 ? pct : 0}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-400 dark:text-gray-500 flex-shrink-0 w-7 text-right">
                            {total > 0 ? `${pct}%` : '—'}
                          </span>
                        </div>
                        {proj.endDate && (
                          <p className="text-xs text-slate-400 dark:text-gray-500">
                            Due: {new Date(proj.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </p>
                        )}
                      </Link>
                    );
                  })
              }
            </div>
          </div>

          {/* Recent Notifications */}
          <div className={cn(card, 'overflow-hidden')}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-gray-700">
              <h2 className="font-bold text-slate-800 dark:text-white">Notifications</h2>
              <span className="text-xs text-slate-400 dark:text-gray-500">Recent</span>
            </div>
            <div className="divide-y divide-slate-50 dark:divide-gray-700/40">
              {notifsLoading
                ? Array.from({ length: 4 }).map((_, i) => <NotifRowSkeleton key={i} />)
                : notifications.length === 0
                  ? (
                    <p className="text-sm text-center text-slate-400 dark:text-gray-500 py-10">
                      No notifications yet.
                    </p>
                  )
                  : notifications.map((n: any) => (
                    <div
                      key={n.id}
                      className={cn(
                        'flex items-start gap-3 px-5 py-3.5',
                        !n.isRead && 'bg-blue-50/50 dark:bg-blue-900/5',
                      )}
                    >
                      <NotifIcon type={n.type} />
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          'text-sm truncate',
                          n.isRead
                            ? 'font-medium text-slate-700 dark:text-gray-300'
                            : 'font-semibold text-slate-900 dark:text-white',
                        )}>
                          {n.title}
                        </p>
                        <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5 truncate">
                          {n.message}
                        </p>
                      </div>
                      <span className="text-[10px] text-slate-400 dark:text-gray-500 flex-shrink-0 whitespace-nowrap">
                        {timeAgo(n.createdAt)}
                      </span>
                    </div>
                  ))
              }
            </div>
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* SECTION 4 — Quick links bar                                        */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className={cn(card, 'p-4')}>
        <div className="flex flex-wrap gap-2.5">
          {quickLinks.map((link) => (
            <button
              key={link.href}
              onClick={() => router.push(link.href)}
              className={cn(
                'flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl',
                'border border-slate-200 dark:border-gray-700 transition-all',
                link.textCls, link.hoverCls,
              )}
            >
              {link.icon}
              {link.label}
            </button>
          ))}
        </div>
      </div>

    </div>

    {/* ── Recent Activity slide-over ───────────────────────────────────── */}
    {showActivity && (
      <>
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/30 z-40 transition-opacity"
          onClick={() => setShowActivity(false)}
        />
        {/* Panel */}
        <div className="fixed top-0 right-0 h-full w-full max-w-sm bg-white dark:bg-gray-900 shadow-2xl z-50 flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <Activity size={16} className="text-indigo-500" />
              <h2 className="font-bold text-slate-800 dark:text-white">Recent Activity</h2>
            </div>
            <button
              onClick={() => setShowActivity(false)}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 text-slate-500 dark:text-gray-400 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-50 dark:divide-gray-800">
            {notifsLoading
              ? Array.from({ length: 6 }).map((_, i) => <NotifRowSkeleton key={i} />)
              : (() => {
                  const raw = Array.isArray(notifsRaw) ? notifsRaw : (notifsRaw?.notifications ?? []);
                  const all = (raw as any[]).slice(0, 20);
                  if (all.length === 0) {
                    return (
                      <div className="flex flex-col items-center justify-center h-full py-20 text-slate-400 dark:text-gray-500">
                        <Activity size={30} className="mb-3 text-slate-300 dark:text-gray-600" />
                        <p className="text-sm">No recent activity</p>
                      </div>
                    );
                  }
                  return all.map((n: any) => (
                    <div
                      key={n.id}
                      className={cn(
                        'flex items-start gap-3 px-5 py-4',
                        !n.isRead && 'bg-blue-50/50 dark:bg-blue-900/5',
                      )}
                    >
                      <NotifIcon type={n.type} />
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          'text-sm leading-snug',
                          n.isRead
                            ? 'font-medium text-slate-700 dark:text-gray-300'
                            : 'font-semibold text-slate-900 dark:text-white',
                        )}>
                          {n.title}
                        </p>
                        {n.message && (
                          <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5 leading-relaxed">
                            {n.message}
                          </p>
                        )}
                        <p className="text-[10px] text-slate-300 dark:text-gray-600 mt-1">
                          {timeAgo(n.createdAt)}
                        </p>
                      </div>
                    </div>
                  ));
                })()
            }
          </div>
          <div className="px-5 py-3 border-t border-slate-100 dark:border-gray-700">
            <button
              onClick={() => setShowActivity(false)}
              className="w-full text-xs text-center font-medium text-slate-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
            >
              Close panel
            </button>
          </div>
        </div>
      </>
    )}

    {showIdleToast && <IdleWarningToast onDismiss={() => setShowIdleToast(false)} />}
    {showIdlePopup && <IdlePopup onClose={() => setShowIdlePopup(false)} onRefetch={refetchWorkday} />}
    {showRecovery && <SessionRecoveryModal awayMinutes={awayMinutes} onClose={() => setShowRecovery(false)} onRefetch={refetchWorkday} />}
    </>
  );
}
