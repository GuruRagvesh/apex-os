'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import { WorkdayBar } from '@/components/workday/WorkdayBar';
import { CriticalActionPanel } from '@/components/home/CriticalActionPanel';
import { UpcomingEvents } from '@/components/home/UpcomingEvents';
import { RecentActivityFeed } from '@/components/home/RecentActivityFeed';
import { HomeSkeleton } from '@/components/home/HomeSkeleton';
import { KpiCapsuleStrip } from '@/components/ui/KpiCapsuleStrip';
import { AnnouncementBroadcast } from '@/components/ui/AnnouncementBroadcast';
import { CommandModal } from '@/components/ui/CommandModal';
import { QuickActionPalette } from '@/components/ui/QuickActionPalette';
import CommandCard from '@/components/ui/CommandCard';
import { motion } from 'motion/react';
import {
  Ticket, AlertTriangle, Clock, CheckCircle, CalendarDays,
  FolderKanban, TrendingUp, Users, Zap, Activity,
  ShieldAlert, ArrowRight,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const user = useAuthStore(s => s.user);
  const router = useRouter();
  const roleObj = user?.role as any;
  const role: string = roleObj?.name ?? (typeof roleObj === 'string' ? roleObj : '') ?? '';

  const [paletteOpen, setPaletteOpen]             = useState(false);
  const [alertsModalOpen, setAlertsModalOpen]     = useState(false);

  const { data: summary, isLoading } = useQuery({
    queryKey: ['home-summary'],
    queryFn: async () => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('apex_token') : null;
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/home/summary`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  if (isLoading) return <HomeSkeleton />;

  const metrics = summary?.metrics ?? {};
  const firstName = user?.name?.split(' ')[0] ?? 'there';
  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
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
          label: 'Open Tickets',
          value: metrics.open ?? 0,
          icon: Ticket,
          subtext: 'awaiting action',
          statusType: 'blue' as const,
          previewItems: [],
          onClick: () => router.push('/tickets?status=OPEN'),
        },
        {
          label: 'In Progress',
          value: metrics.inProgress ?? 0,
          icon: Clock,
          subtext: 'being worked on',
          statusType: 'orange' as const,
          previewItems: [],
          onClick: () => router.push('/tickets?status=IN_PROGRESS'),
        },
        {
          label: 'In Review',
          value: metrics.inReview ?? 0,
          icon: AlertTriangle,
          subtext: 'pending review',
          statusType: 'orange' as const,
          previewItems: [],
          onClick: () => router.push('/tickets?status=REVIEW'),
        },
        {
          label: 'Done This Week',
          value: metrics.doneThisWeek ?? 0,
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
          value: metrics.total ?? 0,
          icon: Ticket,
          subtext: 'total active',
          statusType: 'blue' as const,
          previewItems: [],
          onClick: () => router.push('/tickets'),
        },
        {
          label: 'Overdue',
          value: metrics.overdue ?? 0,
          icon: AlertTriangle,
          subtext: 'need attention',
          statusType: 'red' as const,
          previewItems: [],
          onClick: () => router.push('/tickets'),
        },
        {
          label: 'Pending Reviews',
          value: metrics.inReview ?? 0,
          icon: Clock,
          subtext: 'awaiting review',
          statusType: 'orange' as const,
          previewItems: [],
          onClick: () => router.push('/tickets?status=REVIEW'),
        },
        {
          label: 'Team Online',
          value: metrics.teamOnline ?? 0,
          icon: TrendingUp,
          subtext: 'currently active',
          statusType: 'green' as const,
          previewItems: [],
          onClick: () => router.push('/team'),
        },
      ];
    }
    if (role === 'MANAGER') {
      return [
        {
          label: 'Dept Tickets',
          value: metrics.total ?? 0,
          icon: Ticket,
          subtext: 'department total',
          statusType: 'blue' as const,
          previewItems: [],
          onClick: () => router.push('/tickets'),
        },
        {
          label: 'Overdue',
          value: metrics.overdue ?? 0,
          icon: AlertTriangle,
          subtext: 'SLA breaches',
          statusType: 'red' as const,
          previewItems: [],
          onClick: () => router.push('/tickets'),
        },
        {
          label: 'Pending Leave',
          value: metrics.pendingLeave ?? 0,
          icon: CalendarDays,
          subtext: 'awaiting approval',
          statusType: 'orange' as const,
          previewItems: [],
          onClick: () => router.push('/leave'),
        },
        {
          label: 'Team Size',
          value: metrics.teamCount ?? 0,
          icon: Users,
          subtext: 'total members',
          statusType: 'green' as const,
          previewItems: [],
          onClick: () => router.push('/team'),
        },
      ];
    }
    // ADMIN / SUPER_ADMIN
    return [
      {
        label: 'Active Today',
        value: metrics.activeToday ?? 0,
        icon: TrendingUp,
        subtext: 'staff online',
        statusType: 'green' as const,
        previewItems: [],
        onClick: () => router.push('/team'),
      },
      {
        label: 'Open Tickets',
        value: metrics.totalTickets ?? metrics.open ?? 0,
        icon: Ticket,
        subtext: 'needs attention',
        statusType: 'blue' as const,
        previewItems: [],
        onClick: () => router.push('/tickets'),
      },
      {
        label: 'Overdue',
        value: metrics.overdue ?? 0,
        icon: AlertTriangle,
        subtext: 'SLA exceeded',
        statusType: 'red' as const,
        previewItems: [],
        onClick: () => router.push('/tickets'),
      },
      {
        label: 'Pending Leave',
        value: metrics.pendingLeave ?? 0,
        icon: CalendarDays,
        subtext: 'awaiting approval',
        statusType: 'orange' as const,
        previewItems: [],
        onClick: () => router.push('/leave'),
      },
    ];
  })();

  // ── Announcement broadcast data ───────────────────────────────────────────
  const criticalAlerts: any[] = summary?.criticalAlerts ?? [];
  const firstUrgentAlert = criticalAlerts.find((a: any) => a.type === 'urgent' || a.severity === 'urgent');
  const broadcastTitle = firstUrgentAlert
    ? (firstUrgentAlert.title ?? firstUrgentAlert.message ?? 'Urgent alert requires your attention')
    : 'No active broadcasts today';

  return (
    <div className="apex-fade-in" style={{ maxWidth: '1200px', margin: '0 auto', paddingBottom: 48 }}>

      {/* ── HERO COMMAND HEADER ── */}
      <motion.section
        initial={{ opacity: 0, y: -15, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.28, ease: 'easeOut' }}
        className="mb-6 pt-2"
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-3xl font-extrabold leading-tight text-slate-900 dark:text-white" style={{ letterSpacing: '-0.5px' }}>
              Good {timeOfDay}, {firstName}
            </h1>
            <p className="text-sm mt-1 text-slate-500 dark:text-slate-400">
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
            <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500">
              {new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
            </span>
          </div>
        </div>

        {/* WorkdayBar — preserved as-is */}
        <WorkdayBar />
      </motion.section>

      {/* ── ANNOUNCEMENT BROADCAST ── */}
      <motion.div
        initial={{ opacity: 0, scale: 0.99 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.25, delay: 0.08 }}
      >
        <AnnouncementBroadcast
          eventTitle={broadcastTitle}
          onAddCalendar={() => {}}
          onOpenAnnouncement={() => setAlertsModalOpen(true)}
        />
      </motion.div>

      {/* ── KPI CAPSULE STRIP ── */}
      {kpiCapsules.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.12 }}
          className="mb-6"
        >
          <KpiCapsuleStrip capsules={kpiCapsules} />
        </motion.section>
      )}

      {/* ── CRITICAL ALERTS ── */}
      {criticalAlerts.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.16 }}
          className="mb-6"
        >
          <p className="font-mono text-[10px] uppercase tracking-widest mb-2 text-slate-400 dark:text-slate-500">
            Needs Attention
          </p>
          <CriticalActionPanel alerts={criticalAlerts} />
        </motion.section>
      )}

      {/* ── COMMAND DOCK GRID ── */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, delay: 0.2 }}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6"
      >
        <CommandCard
          id="high-priority"
          title="High Priority Tickets"
          count={metrics.overdue ?? 0}
          summary="Tickets requiring immediate SLA attention"
          icon={ShieldAlert}
          severity="urgent"
          previewItems={[]}
          onClick={() => router.push('/tickets?priority=HIGH')}
        />

        <CommandCard
          id="active-projects"
          title="Active Projects"
          count={metrics.activeProjects ?? 0}
          summary="Current project portfolio in progress"
          icon={FolderKanban}
          severity="blue"
          previewItems={[]}
          onClick={() => router.push('/projects')}
        />

        {(role === 'TEAM_LEAD' || role === 'MANAGER' || role === 'ADMIN' || role === 'SUPER_ADMIN') && (
          <CommandCard
            id="pending-leave"
            title="Leave Requests"
            count={metrics.pendingLeave ?? 0}
            summary="Pending leave approvals for your team"
            icon={CalendarDays}
            severity={metrics.pendingLeave > 0 ? 'warning' : 'success'}
            previewItems={[]}
            onClick={() => router.push('/leave')}
          />
        )}

        {(role === 'EMPLOYEE' || role === 'INTERN') && (
          <CommandCard
            id="in-review"
            title="In Review"
            count={metrics.inReview ?? 0}
            summary="Tickets currently under code review"
            icon={AlertTriangle}
            severity="warning"
            previewItems={[]}
            onClick={() => router.push('/tickets?status=REVIEW')}
          />
        )}
      </motion.div>

      {/* ── BOTTOM SECTION: Events + Activity ── */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, delay: 0.24 }}
        className="grid grid-cols-1 md:grid-cols-2 gap-4"
      >
        {/* Upcoming Events */}
        <div className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-[22px] overflow-hidden">
          <div className="bg-[#0B1220] px-5 py-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-900/40 text-blue-400">
              <CalendarDays className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Upcoming Events</h3>
              <p className="text-[10px] text-slate-400 font-mono mt-0.5">Scheduled items</p>
            </div>
          </div>
          <div className="p-5 bg-white dark:bg-[#0F172A]">
            <UpcomingEvents events={summary?.upcomingEvents ?? []} />
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-[22px] overflow-hidden">
          <div className="bg-[#0B1220] px-5 py-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-900/40 text-emerald-400">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Recent Activity</h3>
              <p className="text-[10px] text-slate-400 font-mono mt-0.5">Latest team actions</p>
            </div>
          </div>
          <div className="p-5 bg-white dark:bg-[#0F172A]">
            <RecentActivityFeed />
          </div>
        </div>
      </motion.div>

      {/* ── MODALS ── */}

      {/* Alerts modal — opened by AnnouncementBroadcast click */}
      <CommandModal
        open={alertsModalOpen}
        title="Active Broadcasts & Alerts"
        onClose={() => setAlertsModalOpen(false)}
        viewFullPageAction={{
          label: 'View All Tickets',
          onClick: () => { setAlertsModalOpen(false); router.push('/tickets'); },
          icon: ArrowRight,
        }}
      >
        <div className="space-y-4">
          {criticalAlerts.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                No critical alerts at this time.
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                All systems are operating normally.
              </p>
            </div>
          ) : (
            criticalAlerts.map((alert: any, i: number) => (
              <div
                key={alert.id ?? i}
                className={`p-4 rounded-xl border ${
                  alert.type === 'urgent' || alert.severity === 'urgent'
                    ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/40'
                    : alert.type === 'warning'
                    ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/40'
                    : 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/40'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <p className={`text-[10px] font-black font-mono uppercase tracking-widest mb-1 ${
                      alert.type === 'urgent' || alert.severity === 'urgent'
                        ? 'text-red-600 dark:text-red-400'
                        : alert.type === 'warning'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-blue-600 dark:text-blue-400'
                    }`}>
                      {alert.type?.toUpperCase() ?? 'ALERT'}
                    </p>
                    <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">{alert.title ?? 'Alert'}</h4>
                    {alert.message && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{alert.message}</p>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </CommandModal>

      {/* Quick Action Palette */}
      <QuickActionPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onSelectAction={(actionId) => {
          // Actions already navigate via href in the palette
          console.log('Action selected:', actionId);
        }}
      />
    </div>
  );
}
