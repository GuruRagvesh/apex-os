'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ticketsApi, dashboardApi } from '@/lib/api';
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

  const isLeadOrAbove = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(role);

  const { data: slaRisk } = useQuery({
    queryKey: ['sla-risk'],
    queryFn: () => ticketsApi.getSlaRisk() as Promise<any>,
    enabled: isLeadOrAbove,
    refetchInterval: 120000,
    staleTime: 60000,
  });

  const { data: overview } = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: () => dashboardApi.getOverview() as Promise<any>,
    staleTime: 30000,
  });

  const bottleneckTickets = overview?.bottleneckTickets ?? [];

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
          onClick: () => router.push('/tickets?overdue=true'),
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
          onClick: () => router.push('/tickets?overdue=true'),
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
        value: metrics.openTickets ?? metrics.open ?? 0,
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
        onClick: () => router.push('/tickets?overdue=true'),
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
  // Backend uses severity: 'red' | 'purple' | 'amber' — 'red' is the urgent/critical level
  const firstUrgentAlert = criticalAlerts.find((a: any) => a.severity === 'red' || a.severity === 'urgent' || a.type === 'urgent');
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
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl font-extrabold leading-tight" style={{ letterSpacing: '-0.5px', color: 'var(--text-primary)' }}>
                Good {timeOfDay}, {firstName}
              </h1>
              <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-800 text-slate-400 border border-slate-700 px-2 py-0.5 rounded-full mt-1.5">
                {role === 'SUPER_ADMIN' || role === 'ADMIN' ? 'Company Administrator Scope' :
                 role === 'MANAGER' ? 'Department Manager Scope' :
                 role === 'TEAM_LEAD' ? 'Team Lead Scope' :
                 'Personal Contributor Scope'}
              </span>
            </div>
            <p className="text-sm mt-1.5" style={{ color: 'var(--text-secondary)' }}>
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
            <span className="font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
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

      {/* ── SLA RISK BANNER (managers/leads only, shown when there are at-risk tickets) ── */}
      {isLeadOrAbove && slaRisk && (slaRisk.overdue > 0 || slaRisk.dueSoon > 0 || slaRisk.reviewAgeing > 0) && (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.14 }}
          className="mb-4"
        >
          <div
            className="flex items-center gap-4 px-4 py-3 rounded-xl text-sm flex-wrap"
            style={{ backgroundColor: 'color-mix(in srgb, var(--color-danger) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)' }}
          >
            <ShieldAlert size={16} style={{ color: 'var(--color-danger)', flexShrink: 0 }} />
            <span className="font-semibold" style={{ color: 'var(--color-danger)' }}>SLA Risk</span>
            {slaRisk.overdue > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: 'color-mix(in srgb, var(--color-danger) 15%, transparent)', color: 'var(--color-danger)' }}>
                {slaRisk.overdue} overdue
              </span>
            )}
            {slaRisk.dueSoon > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 15%, transparent)', color: 'var(--color-warning)' }}>
                {slaRisk.dueSoon} due soon
              </span>
            )}
            {slaRisk.reviewAgeing > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 15%, transparent)', color: 'var(--color-warning)' }}>
                {slaRisk.reviewAgeing} reviews ageing
              </span>
            )}
            <button
              onClick={() => router.push('/tickets')}
              className="ml-auto text-xs font-medium flex items-center gap-1"
              style={{ color: 'var(--color-danger)' }}
            >
              View tickets <ArrowRight size={12} />
            </button>
          </div>
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
          <p className="font-mono text-[10px] uppercase tracking-widest mb-2" style={{ color: 'var(--text-tertiary)' }}>
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
          title="Overdue Tickets"
          count={metrics.overdue ?? 0}
          summary={(metrics.overdue ?? 0) > 0 ? `${metrics.overdue} overdue ticket${metrics.overdue > 1 ? 's' : ''} need${metrics.overdue > 1 ? '' : 's'} attention` : 'No overdue tickets in your scope'}
          icon={ShieldAlert}
          severity={(metrics.overdue ?? 0) > 0 ? 'urgent' : 'success'}
          previewItems={summary?.previews?.overdueTickets ?? []}
          onClick={() => router.push('/tickets?overdue=true')}
        />

        <CommandCard
          id="active-projects"
          title="Active Projects"
          count={metrics.activeProjects ?? 0}
          summary={(metrics.activeProjects ?? 0) > 0 ? `${metrics.activeProjects} active project${metrics.activeProjects > 1 ? 's' : ''} in progress` : 'No active projects'}
          icon={FolderKanban}
          severity="blue"
          previewItems={summary?.previews?.activeProjects ?? []}
          onClick={() => router.push('/projects?status=ACTIVE')}
        />

        {(role === 'TEAM_LEAD' || role === 'MANAGER' || role === 'ADMIN' || role === 'SUPER_ADMIN') && (
          <CommandCard
            id="pending-leave"
            title="Leave Requests"
            count={metrics.pendingLeave ?? 0}
            summary={(metrics.pendingLeave ?? 0) > 0 ? `${metrics.pendingLeave} leave request${metrics.pendingLeave > 1 ? 's' : ''} pending approval` : 'No pending leave requests'}
            icon={CalendarDays}
            severity={(metrics.pendingLeave ?? 0) > 0 ? 'warning' : 'success'}
            previewItems={summary?.previews?.pendingLeave ?? []}
            onClick={() => router.push('/leave?tab=needs-action')}
          />
        )}

        {(role === 'EMPLOYEE' || role === 'INTERN') && (
          <CommandCard
            id="in-review"
            title="In Review"
            count={metrics.inReview ?? 0}
            summary={(metrics.inReview ?? 0) > 0 ? `${metrics.inReview} ticket${metrics.inReview > 1 ? 's' : ''} awaiting review` : 'No tickets awaiting review'}
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
        <div className="border overflow-hidden rounded-[22px] flex flex-col" style={{ backgroundColor: 'var(--surface-card)', borderColor: 'var(--border-primary)' }}>
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
              {bottleneckTickets.length > 0 ? (
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
        <div className="border overflow-hidden rounded-[22px]" style={{ backgroundColor: 'var(--surface-card)', borderColor: 'var(--border-primary)' }}>
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
        <div className="border overflow-hidden rounded-[22px]" style={{ backgroundColor: 'var(--surface-card)', borderColor: 'var(--border-primary)' }}>
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
              <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
                No critical alerts at this time.
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                All systems are operating normally.
              </p>
            </div>
          ) : (
            criticalAlerts.map((alert: any, i: number) => {
              const isUrgent = alert.type === 'urgent' || alert.severity === 'urgent';
              const isWarning = alert.type === 'warning';
              return (
                <div
                  key={alert.id ?? i}
                  className="p-4 rounded-xl border"
                  style={{
                    backgroundColor: isUrgent ? 'var(--color-danger-bg)' : isWarning ? 'var(--color-warning-bg)' : 'var(--color-info-bg)',
                    borderColor: isUrgent ? 'rgba(239,68,68,0.25)' : isWarning ? 'rgba(245,158,11,0.25)' : 'rgba(59,130,246,0.25)',
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <p
                        className="text-[10px] font-black font-mono uppercase tracking-widest mb-1"
                        style={{ color: isUrgent ? 'var(--color-danger)' : isWarning ? 'var(--color-warning)' : 'var(--color-info)' }}
                      >
                        {alert.type?.toUpperCase() ?? 'ALERT'}
                      </p>
                      <h4 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{alert.title ?? 'Alert'}</h4>
                      {alert.message && (
                        <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{alert.message}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
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
