'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import { WorkdayBar } from '@/components/workday/WorkdayBar';
import { CriticalActionPanel } from '@/components/home/CriticalActionPanel';
import { QuickActionStrip } from '@/components/home/QuickActionStrip';
import { UpcomingEvents } from '@/components/home/UpcomingEvents';
import { RecentActivityFeed } from '@/components/home/RecentActivityFeed';
import { HomeSkeleton } from '@/components/home/HomeSkeleton';
import { KpiCapsuleStrip } from '@/components/ui/KpiCapsuleStrip';
import { CommandCard } from '@/components/ui/CommandCard';
import { AnnouncementBroadcast } from '@/components/ui/AnnouncementBroadcast';
import {
  Ticket, AlertTriangle, Clock, CheckCircle, CalendarDays,
  FolderKanban, Zap, Activity, TrendingUp,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const user = useAuthStore(s => s.user);
  const router = useRouter();
  const roleObj = user?.role as any;
  const role: string = roleObj?.name ?? (typeof roleObj === 'string' ? roleObj : '') ?? '';

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

  // Build KPI capsules from real metrics data
  const kpiCapsules = (() => {
    if (role === 'EMPLOYEE' || role === 'INTERN') {
      return [
        { label: 'Open Tickets', value: metrics.open ?? 0, icon: <Ticket size={16} />, color: '#2563EB', onClick: () => router.push('/tickets?status=OPEN') },
        { label: 'In Progress', value: metrics.inProgress ?? 0, icon: <Clock size={16} />, color: '#F59E0B', onClick: () => router.push('/tickets?status=IN_PROGRESS') },
        { label: 'In Review', value: metrics.inReview ?? 0, icon: <AlertTriangle size={16} />, color: '#8B5CF6', onClick: () => router.push('/tickets?status=REVIEW') },
        { label: 'Done This Week', value: metrics.doneThisWeek ?? 0, icon: <CheckCircle size={16} />, color: '#10B981', onClick: () => router.push('/tickets?status=DONE') },
      ];
    }
    if (role === 'TEAM_LEAD') {
      return [
        { label: 'Team Tickets', value: metrics.total ?? 0, icon: <Ticket size={16} />, color: '#2563EB', onClick: () => router.push('/tickets') },
        { label: 'Overdue', value: metrics.overdue ?? 0, icon: <AlertTriangle size={16} />, color: '#EF4444', onClick: () => router.push('/tickets') },
        { label: 'Pending Reviews', value: metrics.inReview ?? 0, icon: <Clock size={16} />, color: '#8B5CF6', onClick: () => router.push('/tickets?status=REVIEW') },
        { label: 'Team Online', value: metrics.teamOnline ?? 0, icon: <TrendingUp size={16} />, color: '#10B981', onClick: () => router.push('/team') },
      ];
    }
    if (role === 'MANAGER') {
      return [
        { label: 'Dept Tickets', value: metrics.total ?? 0, icon: <Ticket size={16} />, color: '#2563EB', onClick: () => router.push('/tickets') },
        { label: 'Overdue', value: metrics.overdue ?? 0, icon: <AlertTriangle size={16} />, color: '#EF4444', onClick: () => router.push('/tickets') },
        { label: 'Pending Leave', value: metrics.pendingLeave ?? 0, icon: <CalendarDays size={16} />, color: '#F59E0B', onClick: () => router.push('/leave') },
        { label: 'Team Size', value: metrics.teamCount ?? 0, icon: <TrendingUp size={16} />, color: '#10B981', onClick: () => router.push('/team') },
      ];
    }
    // ADMIN / SUPER_ADMIN
    return [
      { label: 'Active Today', value: metrics.activeToday ?? 0, icon: <TrendingUp size={16} />, color: '#10B981', onClick: () => router.push('/team') },
      { label: 'Open Tickets', value: metrics.totalTickets ?? 0, icon: <Ticket size={16} />, color: '#2563EB', onClick: () => router.push('/tickets') },
      { label: 'Overdue', value: metrics.overdue ?? 0, icon: <AlertTriangle size={16} />, color: '#EF4444', onClick: () => router.push('/tickets') },
      { label: 'Pending Leave', value: metrics.pendingLeave ?? 0, icon: <CalendarDays size={16} />, color: '#F59E0B', onClick: () => router.push('/leave') },
    ];
  })();

  return (
    <div className="apex-fade-in" style={{ maxWidth: '1200px', margin: '0 auto', paddingBottom: 48 }}>

      {/* ── HERO COMMAND HEADER ── */}
      <section className="mb-6 pt-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1
              className="text-3xl font-extrabold leading-tight"
              style={{ color: 'var(--text-primary)', letterSpacing: '-0.5px' }}
            >
              Good {timeOfDay}, {firstName}
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              {roleGuidance}
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <span
              className="font-mono text-xs"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            </span>
            <p
              className="font-mono text-xs mt-0.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        </div>

        {/* WorkdayBar — preserved as-is */}
        <div className="mt-4">
          <WorkdayBar />
        </div>
      </section>

      {/* ── QUICK ACTIONS ── */}
      <div className="mb-5">
        <QuickActionStrip role={role} />
      </div>

      {/* ── KPI CAPSULE STRIP ── */}
      {kpiCapsules.length > 0 && (
        <section className="mb-6">
          <KpiCapsuleStrip capsules={kpiCapsules} />
        </section>
      )}

      {/* ── CRITICAL ALERTS ── */}
      <section className="mb-6">
        <p
          className="font-mono text-[10px] uppercase tracking-widest mb-2"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Needs Attention
        </p>
        <CriticalActionPanel alerts={summary?.criticalAlerts ?? []} />
      </section>

      {/* ── BROADCASTS ── */}
      <section className="mb-6">
        <p
          className="font-mono text-[10px] uppercase tracking-widest mb-2"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Broadcasts
        </p>
        <AnnouncementBroadcast />
      </section>

      {/* ── COMMAND DOCK GRID ── */}
      <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 24 }}>
        <CommandCard
          title="High Priority Tickets"
          subtitle="Tickets requiring immediate action"
          icon={<AlertTriangle size={16} />}
          accentColor="#EF4444"
          onClick={() => router.push('/tickets?priority=HIGH')}
          footer={
            <button
              onClick={() => router.push('/tickets?priority=HIGH')}
              className="text-xs font-semibold text-red-600 hover:underline"
            >
              View all high priority →
            </button>
          }
        >
          <div className="space-y-1">
            <p className="text-3xl font-bold font-mono" style={{ color: 'var(--text-primary)' }}>
              {metrics.overdue ?? '—'}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              overdue tickets in your queue
            </p>
          </div>
        </CommandCard>

        <CommandCard
          title="Active Projects"
          subtitle="Current project portfolio"
          icon={<FolderKanban size={16} />}
          accentColor="#8B5CF6"
          onClick={() => router.push('/projects')}
          footer={
            <button
              onClick={() => router.push('/projects')}
              className="text-xs font-semibold text-purple-600 hover:underline"
            >
              Open projects →
            </button>
          }
        >
          <div className="space-y-1">
            <p className="text-3xl font-bold font-mono" style={{ color: 'var(--text-primary)' }}>
              {metrics.activeProjects ?? '—'}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              projects currently active
            </p>
          </div>
        </CommandCard>
      </div>

      {/* ── BOTTOM SECTION: Events + Activity ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <CommandCard
          title="Upcoming Events"
          subtitle="Scheduled items"
          icon={<CalendarDays size={16} />}
          accentColor="#2563EB"
          onClick={() => router.push('/calendar')}
        >
          <UpcomingEvents events={summary?.upcomingEvents ?? []} />
        </CommandCard>

        <CommandCard
          title="Recent Activity"
          subtitle="Latest team actions"
          icon={<Activity size={16} />}
          accentColor="#10B981"
        >
          <RecentActivityFeed />
        </CommandCard>
      </div>
    </div>
  );
}
