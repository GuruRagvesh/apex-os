'use client';

import Link from 'next/link';
import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { cn } from '@/lib/utils';
import { motion } from 'motion/react';
import {
  type LucideIcon,
  LayoutGrid, Users, Clock, CalendarOff, FileText, ClipboardCheck,
  UserPlus, UserMinus, Target, BarChart3, ShieldAlert, ArrowRight, ArrowLeft,
} from 'lucide-react';

// Standalone HRMS workspace — deliberately NOT under (dashboard), so it does not
// inherit the Apex OS global Sidebar/TopBar. This page builds its own full-page
// shell (HRMS sidebar + header + content) and replicates the auth-redirect guard
// that (dashboard)/layout.tsx would otherwise have provided.

type SectionKey =
  | 'overview' | 'employees' | 'attendance' | 'leave' | 'documents'
  | 'approvals' | 'onboarding' | 'offboarding' | 'performance' | 'reports';

interface PanelItem {
  key: SectionKey;
  label: string;
  icon: LucideIcon;
  /** Present only when a real Apex OS route exists AND the current viewer can open it. */
  href?: string;
}

// /users and /analytics are Admin/SuperAdmin-only in their own page guards
// (verified by reading each page directly — neither checks the isHR flag), so
// Employees and Reports can only link out for isAdmin viewers. For HR-only
// viewers they fall back to an in-room Planned pane instead — HRMS must never
// advertise a Live route that the viewer will actually be blocked from opening.
// /leave, /admin/activity, and /admin/approvals have no such block and are
// safe to link for everyone with HRMS access.
function buildPanelItems(isAdmin: boolean): PanelItem[] {
  return [
    { key: 'overview',    label: 'HRMS Overview',        icon: LayoutGrid },
    { key: 'employees',   label: 'Employees',            icon: Users,          href: isAdmin ? '/users' : undefined },
    { key: 'attendance',  label: 'Attendance / Workday',  icon: Clock,          href: '/admin/activity' },
    { key: 'leave',       label: 'Leave',                 icon: CalendarOff,    href: '/leave' },
    { key: 'documents',   label: 'Documents',             icon: FileText },
    { key: 'approvals',   label: 'HR Approvals',          icon: ClipboardCheck, href: '/admin/approvals' },
    { key: 'onboarding',  label: 'Onboarding',            icon: UserPlus },
    { key: 'offboarding', label: 'Offboarding',           icon: UserMinus },
    { key: 'performance', label: 'Performance',           icon: Target },
    { key: 'reports',     label: 'Reports',               icon: BarChart3,      href: isAdmin ? '/analytics' : undefined },
  ];
}

interface OverviewCard {
  title: string;
  icon: LucideIcon;
  desc: string;
  note: string;
  href?: string;
  badge: 'Live' | 'Planned';
  sectionKey: SectionKey;
}

// Employees and Reports badges/hrefs depend on viewer — see buildPanelItems() note.
function buildOverviewCards(isAdmin: boolean): OverviewCard[] {
  return [
    {
      title: 'Employees', icon: Users, sectionKey: 'employees',
      href: isAdmin ? '/users' : undefined,
      badge: isAdmin ? 'Live' : 'Planned',
      desc: 'Company-wide employee directory, roles, and department assignment.',
      note: isAdmin ? 'Synced with Apex OS Users & Roles.' : 'Full employee directory is currently Admin-only. HR employee directory will be connected here.',
    },
    {
      title: 'Attendance / Workday', icon: Clock, href: '/admin/activity', badge: 'Live', sectionKey: 'attendance',
      desc: 'Live work sessions, breaks, and daily attendance tracking.',
      note: 'Powered by the live Apex OS Activity Log.',
    },
    {
      title: 'Leave', icon: CalendarOff, href: '/leave', badge: 'Live', sectionKey: 'leave',
      desc: 'Apply, approve, and track leave requests across the company.',
      note: 'Same leave engine used across Apex OS.',
    },
    {
      title: 'Documents', icon: FileText, badge: 'Planned', sectionKey: 'documents',
      desc: 'Employee documents, ID proofs, and HR paperwork storage.',
      note: 'Will connect to employee profiles once built.',
    },
    {
      title: 'HR Approvals', icon: ClipboardCheck, href: '/admin/approvals', badge: 'Live', sectionKey: 'approvals',
      desc: 'Designation, department, team lead, and role change approvals.',
      note: 'Live Apex OS approval chain — will also surface Leave approvals here.',
    },
    {
      title: 'Onboarding / Offboarding', icon: UserPlus, badge: 'Planned', sectionKey: 'onboarding',
      desc: 'Structured checklists for new and exiting employees.',
      note: 'Will auto-generate Apex OS tickets for each step.',
    },
    {
      title: 'Performance Preview', icon: Target, badge: 'Planned', sectionKey: 'performance',
      desc: 'KRA/KPI tracking and periodic performance review cycles.',
      note: 'Not built yet — ticket-level review ratings already exist in Apex OS.',
    },
    {
      title: 'Reports Preview', icon: BarChart3, sectionKey: 'reports',
      href: isAdmin ? '/analytics' : undefined,
      badge: isAdmin ? 'Live' : 'Planned',
      desc: 'Headcount, attrition, leave trends, and attendance summaries.',
      note: isAdmin ? 'HR-specific views are planned — currently powered by Apex OS Analytics.' : 'HR-specific reports are planned. Current analytics access is restricted.',
    },
  ];
}

// Planned (no-route-for-this-viewer) detail panes, keyed by section — shown
// when a panel item with no href for the current viewer is opened directly.
// Onboarding/Offboarding share one overview card above but get their own
// focused pane here since the panel lists them as two distinct rows.
// Employees/Reports entries only render for HR-only (non-Admin) viewers —
// see buildPanelItems() for why those two are conditional.
const PLANNED_DETAIL: Partial<Record<SectionKey, { title: string; icon: LucideIcon; desc: string; note: string }>> = {
  employees: {
    title: 'Employees', icon: Users,
    desc: 'Company-wide employee directory, roles, and department assignment.',
    note: 'Full employee directory is currently Admin-only. HR employee directory will be connected here.',
  },
  documents: {
    title: 'Documents', icon: FileText,
    desc: 'A central vault for employee documents, ID proofs, and HR paperwork.',
    note: 'Will connect to employee profiles once built. No document storage exists yet.',
  },
  onboarding: {
    title: 'Onboarding', icon: UserPlus,
    desc: 'A structured checklist for bringing a new employee up to speed.',
    note: 'Will auto-generate Apex OS tickets for each onboarding step. Not built yet.',
  },
  offboarding: {
    title: 'Offboarding', icon: UserMinus,
    desc: 'A structured checklist for a clean employee exit.',
    note: 'Will auto-generate Apex OS tickets for each offboarding step. Not built yet.',
  },
  performance: {
    title: 'Performance', icon: Target,
    desc: 'KRA/KPI tracking and periodic performance review cycles.',
    note: 'The performance engine is not built yet — ticket-level review ratings already exist in Apex OS. Payroll and KRA/KPI are not built.',
  },
  reports: {
    title: 'Reports', icon: BarChart3,
    desc: 'Headcount, attrition, leave trends, and attendance summaries.',
    note: 'HR-specific reports are planned. Current analytics access is restricted.',
  },
};

const ROLE_BADGE_COLOR: Record<string, { bg: string; text: string }> = {
  SUPER_ADMIN: { bg: 'rgba(139,92,246,0.15)', text: '#a78bfa' },
  ADMIN:       { bg: 'rgba(239,68,68,0.15)',  text: '#f87171' },
  MANAGER:     { bg: 'rgba(245,158,11,0.15)', text: '#fbbf24' },
  TEAM_LEAD:   { bg: 'rgba(37,99,235,0.15)',  text: '#60a5fa' },
  EMPLOYEE:    { bg: 'rgba(16,185,129,0.15)', text: '#34d399' },
  INTERN:      { bg: 'rgba(20,184,166,0.15)', text: '#2dd4bf' },
};

export default function HRMSPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#050505' }}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#2563eb' }} />
      </div>
    }>
      <HRMSPageInner />
    </Suspense>
  );
}

function HRMSPageInner() {
  const { user, isAuthenticated, hasHydrated } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const section = (searchParams.get('section') as SectionKey) || 'overview';

  // This page is a standalone workspace (not under (dashboard)), so it must
  // replicate the auth-redirect guard (dashboard)/layout.tsx normally provides.
  useEffect(() => {
    if (hasHydrated && !isAuthenticated) router.replace('/login');
  }, [hasHydrated, isAuthenticated, router]);

  const roleObj = user?.role as any;
  const role: string = roleObj?.name ?? (typeof roleObj === 'string' ? roleObj : '') ?? '';
  const isSuperAdmin = role === 'SUPER_ADMIN';
  const isAdmin = role === 'ADMIN' || isSuperAdmin;
  // isHR is a separate boolean flag on the user, not a role — same pattern used
  // in sidebar.tsx and the team/leave/users pages.
  const isHR = Boolean((user as any)?.isHR);

  // No MANAGER preview tier — MANAGER has no existing explicit product permission
  // for HRMS data, so it is not granted here.
  const hasAccess = isHR || isAdmin;

  // A manually-typed ?section= for a Live (real-route) item bounces to that real
  // page instead of rendering an empty in-room pane for it. Recomputed inline from
  // primitives (not a memoized array) so the effect only depends on isAdmin/section.
  useEffect(() => {
    const item = buildPanelItems(isAdmin).find((p) => p.key === section);
    if (item?.href) router.replace(item.href);
  }, [section, isAdmin, router]);

  if (!hasHydrated || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#050505' }}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#2563eb' }} />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: '#050505' }}>
        <div className="max-w-xl w-full rounded-2xl p-8 text-center space-y-4" style={{ backgroundColor: '#0F172A', border: '1px solid #1E293B' }}>
          <div className="mx-auto w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(37,99,235,0.12)' }}>
            <ShieldAlert size={24} style={{ color: '#60a5fa' }} />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">HRMS is restricted</h1>
            <p className="text-sm mt-2" style={{ color: '#94a3b8' }}>
              HRMS is available to HR and Admin roles. Use Team, Leave, or Profile for your own HR-related actions.
            </p>
          </div>
          <Link href="/dashboard" className="inline-flex justify-center px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors" style={{ backgroundColor: '#2563eb' }}>
            Back to Apex OS Home
          </Link>
        </div>
      </div>
    );
  }

  const panelItems = buildPanelItems(isAdmin);
  const overviewCards = buildOverviewCards(isAdmin);
  const activeItem = panelItems.find((p) => p.key === section);
  // Only render an in-room Planned pane when the current viewer genuinely has
  // no real route for this section — Live items always navigate away instead.
  const plannedDetail = section !== 'overview' && !activeItem?.href ? PLANNED_DETAIL[section] : undefined;
  const currentLabel = activeItem?.label ?? 'HRMS Overview';
  const roleBadge = ROLE_BADGE_COLOR[role] ?? { bg: 'rgba(100,116,139,0.15)', text: '#94a3b8' };

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: '#050505' }}>
      {/* HRMS workspace sidebar — standalone, no Apex OS global sidebar present */}
      <aside className="w-64 flex-shrink-0 flex flex-col" style={{ backgroundColor: '#0F172A', borderRight: '1px solid #1E293B' }}>
        <div className="p-5" style={{ borderBottom: '1px solid #1E293B' }}>
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 text-xs font-medium mb-4 transition-colors hover:text-slate-300"
            style={{ color: '#64748b' }}
          >
            <ArrowLeft size={12} />
            Apex OS Home
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, #0f766e 0%, #2563eb 100%)' }}>
              <Users size={16} style={{ color: '#fff' }} />
            </div>
            <div>
              <p className="font-bold text-white text-base leading-none">HRMS</p>
              <p className="text-[10px] text-slate-500 mt-0.5 font-mono uppercase tracking-widest">Human Resources</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {panelItems.map((item) => {
            const active = section === item.key;
            return (
              <button
                key={item.key}
                onClick={() => router.push(item.href ?? `/hrms?section=${item.key}`)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-sm font-medium transition-colors',
                  active ? 'bg-blue-600/15 text-blue-400' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200',
                )}
              >
                <item.icon size={16} className="flex-shrink-0" style={{ color: active ? '#60a5fa' : '#64748b' }} />
                <span className="flex-1 truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* HRMS content column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* HRMS header/top area */}
        <header
          className="h-14 px-6 flex items-center justify-between flex-shrink-0"
          style={{ borderBottom: '1px solid #1E293B', backgroundColor: '#0B1220' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-white truncate">{currentLabel}</span>
            <span
              className="text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full flex-shrink-0"
              style={{ background: 'rgba(37,99,235,0.12)', color: '#60a5fa' }}
            >
              HRMS Workspace
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span
              className="text-[10px] px-2 py-1 rounded font-mono uppercase tracking-wide"
              style={{ backgroundColor: roleBadge.bg, color: roleBadge.text }}
            >
              {isHR ? 'HR' : role}
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 24 }}>
            {!plannedDetail ? (
              <>
                {/* Room hero */}
                <motion.section
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className="mb-6 rounded-3xl overflow-hidden relative"
                  style={{ background: 'linear-gradient(135deg, #0f766e 0%, #0891b2 55%, #2563eb 100%)', padding: '36px 40px' }}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <Users size={13} style={{ color: 'rgba(255,255,255,0.65)' }} />
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                      Apex OS · Workspace
                    </span>
                  </div>
                  <h1 style={{ fontSize: 30, fontWeight: 900, color: '#fff', letterSpacing: '-0.4px', marginBottom: 8 }}>HRMS</h1>
                  <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, maxWidth: 640 }}>
                    The HR room inside Apex OS. Attendance, leave, and HR approvals already run on live Apex OS data —
                    onboarding, offboarding, and performance workflows will connect through the same tickets, approvals,
                    notifications, and analytics as the rest of Apex OS.
                  </p>
                </motion.section>

                {/* Overview grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {overviewCards.map((card, i) => (
                    <OverviewCardTile
                      key={card.title}
                      card={card}
                      index={i}
                      onOpen={() => router.push(card.href ?? `/hrms?section=${card.sectionKey}`)}
                    />
                  ))}
                </div>
              </>
            ) : (
              <PlannedPane detail={plannedDetail} onBack={() => router.push('/hrms')} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function OverviewCardTile({ card, index, onOpen }: { card: OverviewCard; index: number; onOpen: () => void }) {
  const Icon = card.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.03 }}
      onClick={onOpen}
      className="rounded-2xl overflow-hidden border p-5 flex flex-col cursor-pointer"
      style={{ backgroundColor: '#0F172A', borderColor: '#1E293B' }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="p-2.5 rounded-xl" style={{ background: 'rgba(59,130,246,0.12)' }}>
          <Icon size={16} style={{ color: '#60a5fa' }} />
        </div>
        <span
          className="text-[9px] font-mono uppercase tracking-widest px-2 py-1 rounded-full"
          style={{
            background: card.badge === 'Live' ? 'rgba(16,185,129,0.12)' : 'rgba(148,163,184,0.12)',
            color: card.badge === 'Live' ? '#34d399' : '#94a3b8',
          }}
        >
          {card.badge}
        </span>
      </div>
      <h3 className="text-sm font-bold mb-1.5" style={{ color: '#e2e8f0' }}>{card.title}</h3>
      <p className="text-xs mb-3 flex-1" style={{ color: '#8892a4' }}>{card.desc}</p>
      <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid #1E293B' }}>
        <p className="text-[10px] font-mono" style={{ color: '#475569' }}>{card.note}</p>
        <ArrowRight size={12} style={{ color: '#475569', flexShrink: 0, marginLeft: 8 }} />
      </div>
    </motion.div>
  );
}

function PlannedPane({ detail, onBack }: { detail: { title: string; icon: LucideIcon; desc: string; note: string }; onBack: () => void }) {
  const Icon = detail.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="rounded-2xl overflow-hidden border p-8"
      style={{ backgroundColor: '#0F172A', borderColor: '#1E293B' }}
    >
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors"
        style={{ color: '#64748b' }}
      >
        <ArrowLeft size={12} />
        Back to HRMS Overview
      </button>

      <div className="flex items-start gap-4 mb-5">
        <div className="p-3 rounded-xl flex-shrink-0" style={{ background: 'rgba(148,163,184,0.12)' }}>
          <Icon size={22} style={{ color: '#94a3b8' }} />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <h2 className="text-lg font-bold" style={{ color: '#e2e8f0' }}>{detail.title}</h2>
            <span
              className="text-[9px] font-mono uppercase tracking-widest px-2 py-1 rounded-full"
              style={{ background: 'rgba(148,163,184,0.12)', color: '#94a3b8' }}
            >
              Planned
            </span>
          </div>
          <p className="text-sm" style={{ color: '#8892a4' }}>{detail.desc}</p>
        </div>
      </div>

      <div className="pt-4" style={{ borderTop: '1px solid #1E293B' }}>
        <p className="text-xs font-mono" style={{ color: '#475569' }}>{detail.note}</p>
      </div>
    </motion.div>
  );
}
