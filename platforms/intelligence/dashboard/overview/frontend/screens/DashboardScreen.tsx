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
import { motion } from 'motion/react';
import { AlertTriangle } from 'lucide-react';
import type { HomeTeamScope } from './home-types';
import { SmartAnnouncementsCarousel, type HomeCarouselData } from '../components/SmartAnnouncementsCarousel';
import { HeroQuickActions } from './HeroQuickActions';
import { TeamInsightsSection } from './TeamInsightsSection';
import { PersonalHighlightsSection } from './PersonalHighlightsSection';

type HeroScene = 'morning' | 'late-morning' | 'afternoon' | 'evening' | 'sunset' | 'night';

const HERO_SCENES: readonly HeroScene[] = ['morning', 'late-morning', 'afternoon', 'evening', 'sunset', 'night'];

const HERO_MESH_PATH = [
  ...Array.from({ length: 31 }, (_, index) => `M ${index * 40} 0 V 320`),
  ...Array.from({ length: 9 }, (_, index) => `M 0 ${index * 40} H 1200`),
].join(' ');

function HeroGridMesh() {
  const renderMesh = (layer: 'base' | 'lit') => {
    const filterId = `apex-hero-mesh-${layer}`;
    return <svg className={`apex-hero-mesh-layer apex-hero-mesh-${layer}`} viewBox="0 0 1200 320" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <filter id={filterId} x="-8%" y="-20%" width="116%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.007 0.018" numOctaves="1" seed="12" result="meshNoise">
            <animate attributeName="baseFrequency" dur={layer === 'base' ? '16s' : '13s'} values="0.007 0.018;0.011 0.026;0.006 0.021;0.007 0.018" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="meshNoise" scale={layer === 'base' ? 24 : 29} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
      <path d={HERO_MESH_PATH} filter={`url(#${filterId})`} />
    </svg>;
  };

  return <div className="apex-hero-mesh" aria-hidden="true">{renderMesh('base')}{renderMesh('lit')}</div>;
}

function sceneForHour(hour: number): HeroScene {
  if (hour >= 7 && hour < 10) return 'morning';
  if (hour >= 10 && hour < 12) return 'late-morning';
  if (hour >= 12 && hour < 16) return 'afternoon';
  if (hour >= 16 && hour < 18) return 'evening';
  if (hour >= 18 && hour < 19) return 'sunset';
  return 'night';
}

function greetingForScene(scene: HeroScene) {
  if (scene === 'morning' || scene === 'late-morning') return 'morning';
  if (scene === 'afternoon') return 'afternoon';
  if (scene === 'evening' || scene === 'sunset') return 'evening';
  return 'night';
}
/**
 * Home.
 *
 * The personal calendar panel is attendance-owned, so it is composed in by the
 * route (frontend/app) and passed in as `personalPanel` rather than imported
 * here: this component stays inside its declared boundaries.
 */
export default function HomePage({ personalPanel, showTeamInsights = false }: { personalPanel?: ReactNode; showTeamInsights?: boolean } = {}) {
  const user = useAuthStore(s => s.user);
  const roleObj = user?.role as any;
  const role: string = roleObj?.name ?? (typeof roleObj === 'string' ? roleObj : '') ?? '';
  const isContributor = role === 'EMPLOYEE' || role === 'INTERN';
  const canViewPersonalHighlights = ['INTERN', 'EMPLOYEE', 'TEAM_LEAD', 'MANAGER'].includes(role);
  const canManageAnnouncements = Boolean((user as any)?.isHR) || ['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(role);

  const [heroTimeOverride, setHeroTimeOverride] = useState<HeroScene | null>(null);
  const [heroNow, setHeroNow] = useState(() => new Date());
  const heroRef = useRef<HTMLElement | null>(null);
  const isLeadOrAbove = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(role);

  // Keep the scene current while the page remains open; crossing a time boundary
  // does not require a refresh. Thirty-second ticks also avoid visible clock drift.
  useEffect(() => {
    const interval = window.setInterval(() => setHeroNow(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  // Local preview helper: ?heroTime=morning|late-morning|afternoon|evening|sunset|night.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const value = new URLSearchParams(window.location.search).get('heroTime');
    if (HERO_SCENES.some((scene) => scene === value)) {
      setHeroTimeOverride(value as HeroScene);
    }
  }, []);

  const handleHeroPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const hero = heroRef.current;
    if (!hero) return;
    const bounds = hero.getBoundingClientRect();
    hero.style.setProperty('--hero-pointer-x', `${event.clientX - bounds.left}px`);
    hero.style.setProperty('--hero-pointer-y', `${event.clientY - bounds.top}px`);
    hero.dataset.pointerActive = 'true';
  };

  const handleHeroPointerLeave = () => {
    if (heroRef.current) heroRef.current.dataset.pointerActive = 'false';
  };

  const { data: summary, isLoading, isError: summaryError } = useQuery({
    queryKey: ['home-summary'],
    queryFn: async () => {
      return await dashboardApi.getHomeSummary();
    },
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });

  const { data: teamScope, isPending: teamScopeLoading, isError: teamScopeError, refetch: retryTeamScope } = useQuery({
    queryKey: ['home-team-scope', user?.id],
    queryFn: () => dashboardApi.getHomeTeamScope() as Promise<HomeTeamScope>,
    enabled: !!user?.id && isLeadOrAbove && showTeamInsights,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });

  const { data: carousel, isPending: carouselLoading, isError: carouselError, refetch: retryCarousel } = useQuery({
    queryKey: ['home-carousel', user?.id],
    queryFn: () => dashboardApi.getHomeCarousel() as Promise<HomeCarouselData>,
    enabled: !!user?.id,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });

  if (isLoading) return <HomeSkeleton />;

  const firstName = user?.name?.split(' ')[0] ?? 'there';
  const heroScene = heroTimeOverride ?? sceneForHour(heroNow.getHours());
  const timeOfDay = greetingForScene(heroScene);

  return (
    <div className="apex-fade-in" style={{ maxWidth: '1280px', margin: '0 auto', paddingBottom: 48 }}>

      {/* ── HERO: greeting, integrated workday controls and the KPI row ── */}
      <motion.section
        ref={heroRef}
        initial={{ opacity: 0, y: -15, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.28, ease: 'easeOut' }}
        className="apex-dashboard-hero mb-6"
        data-hero-daypart={heroScene}
        data-pointer-active="false"
        onPointerMove={handleHeroPointerMove}
        onPointerLeave={handleHeroPointerLeave}
      >
        <div className="apex-hero-sky" aria-hidden="true">
          {HERO_SCENES.map((scene) => (
            <span
              key={scene}
              className={`apex-hero-sky-layer apex-hero-sky-${scene}${scene === heroScene ? ' is-active' : ''}`}
            />
          ))}
        </div>
        <HeroGridMesh />
        <div className="relative z-10 flex flex-col gap-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="apex-dashboard-hero-title">
                Good {timeOfDay}, {firstName}
              </h1>
            </div>
            {user?.id && <HeroQuickActions userId={user.id} />}
          </div>

          <div className="apex-hero-workday">
            <WorkdayBar hero />
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

      {/* Shared Home sections use the same role-scoped read model for all roles. */}
      {(!isContributor || Boolean(carousel?.announcement) || Boolean(carousel?.criticalAnnouncements.length)) && <div className="mb-3">
        <SmartAnnouncementsCarousel data={carousel} recognition={isContributor ? [] : carousel?.recognition}
          announcementsOnly={isContributor} loading={carouselLoading && !!user} error={carouselError} onRetry={() => retryCarousel()}
          canManageAnnouncements={canManageAnnouncements} />
      </div>}
      {showTeamInsights && teamScopeLoading && isLeadOrAbove && <div className="mb-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-800">Loading team filters…</div>}
      {showTeamInsights && teamScopeError && <div className="mb-6 rounded-xl border border-rose-200 p-4 text-sm text-rose-700 dark:border-rose-900 dark:text-rose-300">Team filters could not be loaded. <button type="button" onClick={() => retryTeamScope()} className="underline">Retry</button></div>}

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

      {user?.id && canViewPersonalHighlights && isContributor && <div className="mt-6"><PersonalHighlightsSection /></div>}

      {user?.id && isLeadOrAbove && showTeamInsights && <div className="mt-6 space-y-5">
        {showTeamInsights && teamScope && <TeamInsightsSection team={teamScope} />}
      </div>}
    </div>
  );
}
