'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import { WorkdayBar } from '@/components/workday/WorkdayBar';
import { HomeHeader } from '@/components/home/HomeHeader';
import { CriticalActionPanel } from '@/components/home/CriticalActionPanel';
import { QuickActionStrip } from '@/components/home/QuickActionStrip';
import { MetricCards } from '@/components/home/MetricCards';
import { UpcomingEvents } from '@/components/home/UpcomingEvents';
import { RecentActivityFeed } from '@/components/home/RecentActivityFeed';
import { HomeSkeleton } from '@/components/home/HomeSkeleton';

export default function HomePage() {
  const user = useAuthStore(s => s.user);
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

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', paddingBottom: 48 }}>
      <HomeHeader summary={summary} />
      <WorkdayBar />
      <div style={{ marginTop: 12 }}>
        <QuickActionStrip role={role} />
      </div>
      <div style={{ marginTop: 20 }}>
        <p style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-tertiary)', marginBottom: 8 }}>
          Needs attention
        </p>
        <CriticalActionPanel alerts={summary?.criticalAlerts ?? []} />
      </div>
      <div style={{ marginTop: 20 }}>
        <MetricCards metrics={summary?.metrics} role={role} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 20 }}>
        <div>
          <p style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-tertiary)', marginBottom: 8 }}>
            Upcoming
          </p>
          <UpcomingEvents events={summary?.upcomingEvents ?? []} />
        </div>
        <div>
          <p style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-tertiary)', marginBottom: 8 }}>
            Recent activity
          </p>
          <RecentActivityFeed />
        </div>
      </div>
    </div>
  );
}
