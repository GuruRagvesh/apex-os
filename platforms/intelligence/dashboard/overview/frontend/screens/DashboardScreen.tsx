'use client';

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@apex/core-identity';
import { dashboardApi } from '../api';
import { WorkdayBar } from '@/components/workday/WorkdayBar';
import { HomeSkeleton } from '../components/HomeSkeleton';
import { HeroKpis } from '../components/HeroKpis';
import { WorkdayStatusBox } from '../components/WorkdayStatusBox';
import { motion } from 'motion/react';
import { AlertTriangle } from 'lucide-react';

type HeroDaypart = 'morning' | 'afternoon' | 'evening' | 'night';

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
/**
 * Home.
 *
 * The personal calendar panel is attendance-owned, so it is composed in by the
 * route (frontend/app) and passed in as `personalPanel` rather than imported
 * here: this component stays inside its declared boundaries.
 */
export default function HomePage({ personalPanel }: { personalPanel?: ReactNode } = {}) {
  const user = useAuthStore(s => s.user);
  const roleObj = user?.role as any;
  const role: string = roleObj?.name ?? (typeof roleObj === 'string' ? roleObj : '') ?? '';

  const [heroTimeOverride, setHeroTimeOverride]   = useState<HeroDaypart | null>(null);
  const heroRef = useRef<HTMLElement | null>(null);
  const isLeadOrAbove = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(role);

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

  const { data: summary, isLoading, isError: summaryError } = useQuery({
    queryKey: ['home-summary'],
    queryFn: async () => {
      return await dashboardApi.getHomeSummary();
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  if (isLoading) return <HomeSkeleton />;

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
  const alerts = (summary as any)?.criticalAlerts?.length ?? 0;

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

  return (
    <div className="apex-fade-in" style={{ maxWidth: '1280px', margin: '0 auto', paddingBottom: 48 }}>

      {/* ── HERO: greeting, workday status, Start Work and the four KPIs ── */}
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
        <div className="relative z-10 flex flex-col gap-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="apex-dashboard-hero-title">
                Good {timeOfDay}, {firstName}
              </h1>
              <p className="apex-dashboard-hero-copy text-sm mt-1.5">
                {roleGuidance}
              </p>
            </div>
            <WorkdayStatusBox />
          </div>

          <div className="apex-hero-workday">
            <WorkdayBar />
          </div>

          <HeroKpis isLead={isLeadOrAbove} userId={user?.id} role={role} />
        </div>
      </motion.section>

      {/* ── ERROR BANNER (shown when dashboard data fails to load) ── */}
      {summaryError && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm flex items-center gap-3"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--color-warning) 25%, transparent)' }}
        >
          <AlertTriangle size={15} style={{ color: 'var(--color-warning)', flexShrink: 0 }} />
          <span style={{ color: 'var(--color-warning)', fontWeight: 600 }}>Dashboard data could not be loaded.</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Refresh to retry.</span>
        </div>
      )}

      {/* ── MY CALENDAR: attendance / productivity ── */}
      {personalPanel && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.12 }}
        >
          {personalPanel}
        </motion.div>
      )}
    </div>
  );
}
