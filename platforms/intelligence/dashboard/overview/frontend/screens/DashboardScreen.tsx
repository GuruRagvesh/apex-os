'use client';

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@apex/core-identity';
import Link from 'next/link';
import { useTicketCreationGate } from '@apex/operations-tickets-lifecycle/components/ticket-creation-gate';
import { cn } from '@apex/shared-utilities';
import { dashboardApi } from '../api';
import { WorkdayBar } from '@/components/workday/WorkdayBar';
import { UpcomingEvents } from '../components/UpcomingEvents';
import { RecentActivityFeed } from '../components/RecentActivityFeed';
import { HomeSkeleton } from '../components/HomeSkeleton';
import { KpiCapsuleStrip } from '@apex/shared-ui/components/KpiCapsuleStrip';
import { QuickActionPalette } from '@apex/shared-ui/components/QuickActionPalette';
import CommandCard from '@apex/shared-ui/components/CommandCard';
import { motion } from 'motion/react';
import {
  Ticket, AlertTriangle, Clock, CheckCircle, CalendarDays,
  FolderKanban, TrendingUp, Users, Zap, Activity,
  ArrowRight, ListTodo,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

type HeroDaypart = 'morning' | 'afternoon' | 'evening' | 'night';

type TodayTask = {
  id: string;
  title: string;
  detail?: string;
  completed?: boolean;
};

// Temporary preview data. Once punch-in supports a task payload, the dashboard
// summary's todayTasks collection takes over without changing this card.
const SAMPLE_TODAY_TASKS: TodayTask[] = [
  {
    id: 'sample-priority-review',
    title: 'Review today\'s priority tickets',
    detail: 'Morning focus',
  },
  {
    id: 'sample-progress-update',
    title: 'Update project progress notes',
    detail: 'Before end of day',
  },
];

const HERO_MESH_PATH = [
  ...Array.from({ length: 31 }, (_, index) => `M ${index * 40} 0 V 320`),
  ...Array.from({ length: 9 }, (_, index) => `M 0 ${index * 40} H 1200`),
].join(' ');

function HeroGridMesh() {
  const renderMesh = (layer: 'base' | 'lit') => {
    const filterId = `apex-hero-mesh-${layer}`;
    return (
      <svg
        className={`apex-hero-mesh-layer apex-hero-mesh-${layer}`}
        viewBox="0 0 1200 320"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <filter id={filterId} x="-8%" y="-20%" width="116%" height="140%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.007 0.018"
              numOctaves="1"
              seed="12"
              result="meshNoise"
            >
              <animate
                attributeName="baseFrequency"
                dur={layer === 'base' ? '16s' : '13s'}
                values="0.007 0.018;0.011 0.026;0.006 0.021;0.007 0.018"
                repeatCount="indefinite"
              />
            </feTurbulence>
            <feDisplacementMap
              in="SourceGraphic"
              in2="meshNoise"
              scale={layer === 'base' ? 24 : 29}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
        <path d={HERO_MESH_PATH} filter={`url(#${filterId})`} />
      </svg>
    );
  };

  return (
    <div className="apex-hero-mesh" aria-hidden="true">
      {renderMesh('base')}
      {renderMesh('lit')}
    </div>
  );
}

function TodayTasksCard({ tasks }: { tasks: TodayTask[] }) {
  const visibleTasks = tasks.slice(0, 5);

  return (
    <div
      className="apex-section-border overflow-hidden rounded-[22px] border"
      style={{ backgroundColor: 'var(--surface-card)' }}
    >
      <div className="flex items-center justify-between gap-4 bg-[#0B1220] px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="rounded-lg bg-blue-900/40 p-2 text-blue-400">
            <ListTodo className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-white">My Tasks Today</h2>
            <p className="mt-0.5 text-[10px] font-medium text-slate-400">
              Your punch-in plan for the day
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-blue-400/25 bg-blue-500/10 px-2.5 py-1 text-[10px] font-bold text-blue-300">
          {visibleTasks.length}/5
        </span>
      </div>

      <div
        className="relative min-h-[215px] px-5 py-3"
        style={{
          backgroundColor: 'var(--surface-card)',
          backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0, transparent 42px, color-mix(in srgb, var(--border-subtle) 72%, transparent) 43px)',
        }}
      >
        {visibleTasks.length > 0 ? (
          <ol className="divide-y divide-transparent">
            {visibleTasks.map((task, index) => (
              <li key={task.id} className="flex min-h-[43px] items-center gap-3">
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[9px] font-bold',
                    task.completed
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : 'border-blue-300 bg-white text-blue-600 dark:border-blue-700 dark:bg-slate-950 dark:text-blue-300',
                  )}
                  aria-hidden="true"
                >
                  {task.completed ? '✓' : index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn(
                    'truncate text-xs font-bold text-slate-800 dark:text-slate-100',
                    task.completed && 'text-slate-400 line-through dark:text-slate-500',
                  )}>
                    {task.title}
                  </p>
                  {task.detail && (
                    <p className="mt-0.5 truncate text-[10px] font-medium text-slate-400 dark:text-slate-500">
                      {task.detail}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="flex min-h-[120px] items-center justify-center text-center">
            <div>
              <p className="text-xs font-bold text-slate-600 dark:text-slate-300">No tasks planned yet</p>
              <p className="mt-1 text-[10px] text-slate-400">Add up to five tasks when you punch in.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function HomePage() {
  const user = useAuthStore(s => s.user);
  const router = useRouter();
  const roleObj = user?.role as any;
  const role: string = roleObj?.name ?? (typeof roleObj === 'string' ? roleObj : '') ?? '';

  const [paletteOpen, setPaletteOpen]             = useState(false);
  const [heroTimeOverride, setHeroTimeOverride]   = useState<HeroDaypart | null>(null);
  const heroRef = useRef<HTMLElement | null>(null);
  const isLeadOrAbove = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(role);
  const isManagerOrAbove = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(role);

  // Local preview helper: ?heroTime=morning|afternoon|evening|night (ignored in production).
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const value = new URLSearchParams(window.location.search).get('heroTime');
    if (value === 'morning' || value === 'afternoon' || value === 'evening' || value === 'night') {
      setHeroTimeOverride(value);
    }
  }, []);

  const handleHeroPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const hero = heroRef.current;
    if (!hero) return;

    const bounds = hero.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    hero.style.setProperty('--hero-pointer-x', `${pointerX}px`);
    hero.style.setProperty('--hero-pointer-y', `${pointerY}px`);
    hero.dataset.pointerActive = 'true';
  };

  const handleHeroPointerLeave = () => {
    const hero = heroRef.current;
    if (!hero) return;
    hero.dataset.pointerActive = 'false';
  };

  const ticketGate = useTicketCreationGate();
  const dashboardPaletteActions = [
    ...(!ticketGate.allowed ? [] : [{
      id: 'new-ticket',
      label: 'Create New Ticket',
      description: 'Open a new ticket in your scope',
      icon: <Ticket size={15} />,
      onClick: () => router.push('/tickets/new'),
    }]),
    {
      id: 'due-today',
      label: 'View Due Today',
      description: 'Tickets due today in your scope',
      icon: <CalendarDays size={15} />,
      onClick: () => router.push('/tickets?filter=due-today'),
    },
    {
      id: 'high-priority',
      label: isLeadOrAbove ? 'High Priority Tickets' : 'My High Priority Tickets',
      description: isLeadOrAbove ? 'View high priority items in your scope' : 'View your high priority work',
      icon: <AlertTriangle size={15} />,
      onClick: () => router.push('/tickets?priority=HIGH'),
    },
    isLeadOrAbove
      ? {
        id: 'leave-review',
        label: 'Review Leave Requests',
        description: 'Leave requests and approvals in your scope',
        icon: <CalendarDays size={15} />,
        onClick: () => router.push('/leave'),
      }
      : {
        id: 'leave-self',
        label: 'Apply or View Leave',
        description: 'Open your own leave requests',
        icon: <CalendarDays size={15} />,
        onClick: () => router.push('/leave'),
      },
    {
      id: 'projects',
      label: 'Open Projects',
      description: 'View projects available to your role',
      icon: <FolderKanban size={15} />,
      onClick: () => router.push('/projects'),
    },
    ...(isLeadOrAbove ? [{
      id: 'team',
      label: 'Check Team Availability',
      description: 'Open roster and live team status',
      icon: <Users size={15} />,
      onClick: () => router.push('/team'),
    }] : []),
    ...(isLeadOrAbove ? [{
      id: 'activity',
      label: isManagerOrAbove ? 'Activity Log' : 'Team Activity Log',
      description: 'View scoped operational activity',
      icon: <Activity size={15} />,
      onClick: () => router.push('/admin/activity'),
    }] : []),
    {
      id: 'workday',
      label: 'Start Workday',
      description: 'Open your workday panel',
      icon: <Zap size={15} />,
      onClick: () => router.push('/dashboard'),
    },
  ];

  const { data: summary, isLoading, isError: summaryError } = useQuery({
    queryKey: ['home-summary'],
    queryFn: async () => {
      return await dashboardApi.getHomeSummary();
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const { data: overview, isLoading: overviewLoading, isError: overviewError, refetch: refetchOverview } = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: () => dashboardApi.getOverview() as Promise<any>,
    staleTime: 30000,
  });

  const bottleneckTickets = overview?.bottleneckTickets ?? [];

  if (isLoading) return <HomeSkeleton />;

  const metrics = summary?.metrics ?? {};
  const dataAvailable = !summaryError && !!summary;
  const firstName = user?.name?.split(' ')[0] ?? 'there';
  const hour = new Date().getHours();
  const actualDaypart: HeroDaypart =
    hour >= 8 && hour < 12
      ? 'morning'
      : hour >= 12 && hour < 16
        ? 'afternoon'
        : hour >= 16 && hour < 18
          ? 'evening'
          : 'night';
  const heroDaypart = heroTimeOverride ?? actualDaypart;
  const timeOfDay = heroDaypart;
  const alerts = summary?.criticalAlerts?.length ?? 0;

  const roleGuidance =
    role === 'EMPLOYEE' || role === 'INTERN'
      ? "Here's your workday snapshot. Stay focused."
      : role === 'TEAM_LEAD'
      ? "Your team is counting on you. Here's the overview."
      : role === 'MANAGER'
      ? "Operations at a glance. Approve, delegate, decide."
      : alerts > 0
      ? `${alerts} item${alerts > 1 ? 's' : ''} need${alerts > 1 ? '' : 's'} your attention today.`
      : "All systems nominal. Here's your command center.";

  // ── KPI Capsules (intern-style with statusType + LucideIcon) ──────────────
  const kpiCapsules = (() => {
    if (role === 'EMPLOYEE' || role === 'INTERN') {
      return [
        {
          label: 'In Progress',
          value: summaryError ? '–' : (metrics.inProgress ?? 0),
          icon: Clock,
          subtext: 'currently working',
          statusType: 'orange' as const,
          previewItems: [],
          onClick: () => router.push('/tickets?status=IN_PROGRESS'),
        },
        {
          label: 'In Review',
          value: summaryError ? '–' : (metrics.inReview ?? 0),
          icon: AlertTriangle,
          subtext: 'awaiting approval',
          statusType: 'orange' as const,
          previewItems: [],
          onClick: () => router.push('/tickets?status=REVIEW'),
        },
        {
          label: 'Done This Week',
          value: summaryError ? '–' : (metrics.doneThisWeek ?? 0),
          icon: CheckCircle,
          subtext: 'completed',
          statusType: 'green' as const,
          previewItems: [],
          onClick: () => router.push('/tickets?status=DONE'),
        },
      ];
    }
    if (role === 'TEAM_LEAD') {
      return [
        {
          label: 'Team Tickets',
          value: summaryError ? '–' : (metrics.total ?? 0),
          icon: Ticket,
          subtext: 'total in team',
          statusType: 'blue' as const,
          previewItems: [],
          onClick: () => router.push('/tickets'),
        },
        {
          label: 'Overdue',
          value: summaryError ? '–' : (metrics.overdue ?? 0),
          icon: AlertTriangle,
          subtext: 'need attention',
          statusType: (metrics.overdue ?? 0) > 0 ? 'red' as const : 'green' as const,
          previewItems: [],
          onClick: () => router.push('/tickets?overdue=true'),
        },
        {
          label: 'Pending Reviews',
          value: summaryError ? '–' : (metrics.inReview ?? 0),
          icon: Clock,
          subtext: 'awaiting review',
          statusType: (metrics.inReview ?? 0) > 0 ? 'orange' as const : 'green' as const,
          previewItems: [],
          onClick: () => router.push('/tickets?status=REVIEW'),
        },
        {
          label: 'Team Online',
          value: summaryError ? '–' : (metrics.teamOnline ?? 0),
          icon: TrendingUp,
          subtext: 'currently active',
          statusType: 'green' as const,
          previewItems: [],
          onClick: () => router.push('/team?tab=live-status'),
        },
      ];
    }
    if (role === 'MANAGER') {
      return [
        {
          label: 'Dept Tickets',
          value: summaryError ? '–' : (metrics.total ?? 0),
          icon: Ticket,
          subtext: 'department total',
          statusType: 'blue' as const,
          previewItems: [],
          onClick: () => router.push('/tickets'),
        },
        {
          label: 'Overdue',
          value: summaryError ? '–' : (metrics.overdue ?? 0),
          icon: AlertTriangle,
          subtext: 'SLA breaches',
          statusType: (metrics.overdue ?? 0) > 0 ? 'red' as const : 'green' as const,
          previewItems: [],
          onClick: () => router.push('/tickets?overdue=true'),
        },
        {
          label: 'Pending Leave',
          value: summaryError ? '–' : (metrics.pendingLeave ?? 0),
          icon: CalendarDays,
          subtext: 'awaiting approval',
          statusType: (metrics.pendingLeave ?? 0) > 0 ? 'orange' as const : 'green' as const,
          previewItems: [],
          onClick: () => router.push('/leave?tab=needs-action'),
        },
        {
          label: 'Team Size',
          value: summaryError ? '–' : (metrics.teamCount ?? 0),
          icon: Users,
          subtext: 'total members',
          statusType: 'green' as const,
          previewItems: [],
          onClick: () => router.push('/team?tab=live-status'),
        },
      ];
    }
    // ADMIN / SUPER_ADMIN
    return [
      {
        label: 'Overdue',
        value: summaryError ? '–' : (metrics.overdue ?? 0),
        icon: AlertTriangle,
        subtext: 'SLA exceeded',
        statusType: (metrics.overdue ?? 0) > 0 ? 'red' as const : 'green' as const,
        previewItems: [],
        onClick: () => router.push('/tickets?overdue=true'),
      },
      {
        label: 'Pending Leave',
        value: summaryError ? '–' : (metrics.pendingLeave ?? 0),
        icon: CalendarDays,
        subtext: 'awaiting approval',
        statusType: (metrics.pendingLeave ?? 0) > 0 ? 'orange' as const : 'green' as const,
        previewItems: [],
        onClick: () => router.push('/leave?tab=needs-action'),
      },
    ];
  })();

  const todayTasks: TodayTask[] = Array.isArray((summary as any)?.todayTasks)
    ? (summary as any).todayTasks.slice(0, 5)
    : SAMPLE_TODAY_TASKS;

  return (
    <div className="apex-fade-in" style={{ maxWidth: '1200px', margin: '0 auto', paddingBottom: 48 }}>

      {/* ── HERO COMMAND HEADER ── */}
      <motion.section
        ref={heroRef}
        initial={{ opacity: 0, y: -15, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.28, ease: 'easeOut' }}
        className="apex-dashboard-hero mb-6"
        data-hero-daypart={heroDaypart}
        data-pointer-active="false"
        onPointerMove={handleHeroPointerMove}
        onPointerLeave={handleHeroPointerLeave}
      >
        <HeroGridMesh />
        <div className="relative z-10">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="apex-dashboard-hero-title">
                  Good {timeOfDay}, {firstName}
                </h1>
              </div>
              <p className="apex-dashboard-hero-copy text-sm mt-1.5">
                {roleGuidance}
              </p>
            </div>

            {/* button06 CTA hero button */}
            <div className="flex-shrink-0 flex flex-col items-end gap-2">
              <button
                className="button06"
                onClick={() => setPaletteOpen(true)}
              >
                <span className="button06_bg" />
                <span className="button06_inner" data-text="Open Operations Directory">
                  <span className="button06_text">Open Operations Directory</span>
                </span>
                <span className="button06_icon">
                  <span className="button06_icon-start">
                    <svg className="button06_icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="button06_icon-mid" />
                  <span className="button06_icon-end">
                    <svg className="button06_icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </span>
              </button>
            </div>
          </div>

          {/* WorkdayBar — workday state, timer, break management */}
          <WorkdayBar />
        </div>
      </motion.section>

      {/* ── ERROR BANNER (shown when dashboard data fails to load) ── */}
      {summaryError && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm flex items-center gap-3"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--color-warning) 25%, transparent)' }}
        >
          <AlertTriangle size={15} style={{ color: 'var(--color-warning)', flexShrink: 0 }} />
          <span style={{ color: 'var(--color-warning)', fontWeight: 600 }}>Dashboard data could not be loaded.</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Metrics show — until data is available. Refresh to retry.</span>
        </div>
      )}

      {/* ── TODAY'S TASKS + KPI CAPSULES ── */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.12 }}
        className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,1fr)]"
      >
        <TodayTasksCard tasks={todayTasks} />
        {kpiCapsules.length > 0 && (
          <KpiCapsuleStrip
            capsules={kpiCapsules}
            className={cn(
              'h-full auto-rows-fr grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-1',
              kpiCapsules.length > 2 && 'lg:grid-cols-2',
            )}
          />
        )}
      </motion.section>

      {/* ── COMMAND DOCK GRID ── */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, delay: 0.2 }}
        className={cn(
          'grid grid-cols-1 gap-4 mb-6',
          (role === 'EMPLOYEE' || role === 'INTERN') && 'md:grid-cols-2',
        )}
      >
        <CommandCard
          id="active-projects"
          title="Active Projects"
          count={summaryError ? '–' : (metrics.activeProjects ?? 0)}
          summary={
            summaryError ? 'Dashboard data unavailable — refresh to retry' :
            (metrics.activeProjects ?? 0) > 0
              ? `${metrics.activeProjects} active project${metrics.activeProjects > 1 ? 's' : ''} currently in progress`
              : 'No active projects in your scope'
          }
          icon={FolderKanban}
          severity={(metrics.activeProjects ?? 0) > 0 ? 'blue' : 'success'}
          previewItems={summary?.previews?.activeProjects ?? []}
          onClick={() => router.push('/projects?status=ACTIVE')}
        />

        {(role === 'EMPLOYEE' || role === 'INTERN') && (
          <CommandCard
            id="in-review"
            title="In Review"
            count={summaryError ? '–' : (metrics.inReview ?? 0)}
            summary={
              summaryError ? 'Dashboard data unavailable — refresh to retry' :
              (metrics.inReview ?? 0) > 0
                ? `${metrics.inReview} ticket${metrics.inReview > 1 ? 's' : ''} submitted and waiting for review`
                : 'No tickets in review — submit completed work to move forward'
            }
            icon={AlertTriangle}
            severity={(metrics.inReview ?? 0) > 0 ? 'warning' : 'success'}
            previewItems={summary?.previews?.inReviewTickets ?? []}
            onClick={() => router.push('/tickets?status=REVIEW')}
          />
        )}
      </motion.div>

      {/* ── BOTTOM SECTION: Bottlenecks + Events + Activity ── */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, delay: 0.24 }}
        className="grid grid-cols-1 lg:grid-cols-3 gap-4"
      >
        {/* Bottlenecks & SLA Risk */}
        <div className="apex-section-border border overflow-hidden rounded-[22px] flex flex-col" style={{ backgroundColor: 'var(--surface-card)' }}>
          <div className="bg-[#0B1220] px-5 py-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-900/40 text-red-400">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Bottlenecks & SLA Risk</h3>
              <p className="text-[10px] text-slate-400 font-mono mt-0.5 font-bold">Urgent action required</p>
            </div>
          </div>
          <div className="p-5 flex-1 flex flex-col justify-between" style={{ backgroundColor: 'var(--surface-card)' }}>
            <div className="space-y-2.5">
              {overviewError ? (
                <div className="text-center py-8 text-xs">
                  <p className="font-semibold text-slate-500 dark:text-slate-400">Bottlenecks could not be loaded.</p>
                  <button onClick={() => refetchOverview()} className="mt-2 text-blue-600 dark:text-blue-400 hover:underline font-semibold">Retry</button>
                </div>
              ) : overviewLoading ? (
                <div className="text-center py-8 text-slate-400 text-xs">Checking active tickets…</div>
              ) : bottleneckTickets.length > 0 ? (
                bottleneckTickets.slice(0, 4).map((t: any) => (
                  <Link
                    key={t.id}
                    href={`/tickets/${t.id}`}
                    className="block p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/80 hover:border-red-500 hover:bg-slate-50/50 dark:hover:bg-slate-900/30 transition-all"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-mono font-bold text-slate-400">{t.ticketId}</span>
                      <span className={cn(
                        'text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider',
                        t.status === 'REVIEW' ? 'bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400' : 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400'
                      )}>
                        {t.status === 'REVIEW' ? 'In Review' : 'Overdue'}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-slate-750 dark:text-gray-250 truncate">{t.title}</p>
                  </Link>
                ))
              ) : (
                <div className="text-center py-8 text-slate-400 text-xs">
                  <p className="font-semibold text-slate-500 dark:text-slate-400">No critical bottlenecks!</p>
                  <p className="text-[10px] text-slate-450 dark:text-slate-500 mt-1">All active tickets are within SLA.</p>
                </div>
              )}
            </div>
            <Link
              href="/tickets"
              className="mt-4 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 justify-end"
            >
              Go to Tickets <ArrowRight size={11} />
            </Link>
          </div>
        </div>

        {/* Upcoming Events */}
        <div className="apex-section-border border overflow-hidden rounded-[22px]" style={{ backgroundColor: 'var(--surface-card)' }}>
          <div className="bg-[#0B1220] px-5 py-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-900/40 text-blue-400">
              <CalendarDays className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Upcoming Events</h3>
              <p className="text-[10px] text-slate-400 font-mono mt-0.5">Scheduled items</p>
            </div>
          </div>
          <div className="p-5" style={{ backgroundColor: 'var(--surface-card)' }}>
            <UpcomingEvents events={summary?.upcomingEvents ?? []} />
          </div>
        </div>

        {/* Recent Activity */}
        <div className="apex-section-border border overflow-hidden rounded-[22px]" style={{ backgroundColor: 'var(--surface-card)' }}>
          <div className="bg-[#0B1220] px-5 py-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-900/40 text-emerald-400">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Recent Activity</h3>
              <p className="text-[10px] text-slate-400 font-mono mt-0.5">Latest team actions</p>
            </div>
          </div>
          <div className="p-5" style={{ backgroundColor: 'var(--surface-card)' }}>
            <RecentActivityFeed />
          </div>
        </div>
      </motion.div>

      {/* ── MODALS ── */}

      {/* Quick Action Palette */}
      <QuickActionPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={dashboardPaletteActions}
        onSelectAction={(actionId) => {
          // Actions already navigate via href in the palette
          console.log('Action selected:', actionId);
        }}
      />
    </div>
  );
}
