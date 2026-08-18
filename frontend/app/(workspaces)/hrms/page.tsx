'use client';

import Link from 'next/link';
import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@apex/core-identity';
import { changeRequestsApi } from '@/lib/api';
import { leaveApi } from '@apex/workforce-leave/api';
import { usersApi } from '@apex/core-users/api';

import { cn, formatRelativeTime } from '@apex/shared-utilities';
import { motion } from 'motion/react';
import {
  type LucideIcon,
  LayoutGrid, Users, Clock, CalendarOff, FileText, ClipboardCheck,
  UserPlus, UserMinus, Target, BarChart3, ShieldAlert, ArrowRight, ArrowLeft,
  Loader2, ExternalLink, Inbox,
} from 'lucide-react';

// Standalone HRMS workspace — deliberately NOT under (dashboard), so it does not
// inherit the Apex OS global Sidebar/TopBar. This page builds its own full-page
// shell (HRMS sidebar + header + content) and replicates the auth-redirect guard
// that (dashboard)/layout.tsx would otherwise have provided.
//
// Every HRMS sidebar item stays inside /hrms (internal ?section= navigation only).
// HR-management data is fetched directly from the same APIs the main Apex OS pages
// use — verified section by section (see notes below) — never by navigating the
// user out to /leave, /users, /analytics, /admin/activity, or /admin/approvals.
// Where a real Apex OS page is relevant, it is offered only as a clearly secondary
// "Open ..." link/button, never as the primary HRMS navigation.

type SectionKey =
  | 'overview' | 'employees' | 'leave-management' | 'attendance-management'
  | 'hr-approvals' | 'documents' | 'onboarding' | 'offboarding' | 'performance' | 'reports';

interface PanelItem {
  key: SectionKey;
  label: string;
  icon: LucideIcon;
}

const PANEL_ITEMS: PanelItem[] = [
  { key: 'overview',              label: 'HRMS Overview',        icon: LayoutGrid },
  { key: 'employees',             label: 'Employees',            icon: Users },
  { key: 'attendance-management', label: 'Attendance Management', icon: Clock },
  { key: 'leave-management',      label: 'Leave Management',      icon: CalendarOff },
  { key: 'documents',             label: 'Documents',            icon: FileText },
  { key: 'hr-approvals',          label: 'HR Approvals',         icon: ClipboardCheck },
  { key: 'onboarding',            label: 'Onboarding',           icon: UserPlus },
  { key: 'offboarding',           label: 'Offboarding',          icon: UserMinus },
  { key: 'performance',           label: 'Performance',          icon: Target },
  { key: 'reports',               label: 'HR Reports',           icon: BarChart3 },
];

interface OverviewCard {
  title: string;
  icon: LucideIcon;
  desc: string;
  note: string;
  badge: 'Live' | 'Planned';
  sectionKey: SectionKey;
}

// Live/Planned classification — verified by reading each backend endpoint directly:
//   • GET /users        (usersService.findAll)   — isHrOrAdmin() bypass: HR sees the
//     full company directory, not just their own department. Genuinely Live for HR.
//   • GET /leave + /leave/stats (leaveAccessService.buildLeaveWhereForUser) — same
//     isHrOrAdmin() bypass: HR sees every employee's leave, not just their own. Live.
//   • GET /users/change-requests/pending — scoped to `currentApproverId === you` (plus
//     admin-stage items for Admin/SuperAdmin), no isHR bypass. Still real, safe, and
//     honestly framed as "your queue", not "every HR approval" — kept Live.
//   • GET /events (activity/workday) — role-name only, NO isHR bypass. An HR-flagged
//     Employee/Intern would only see their own personal activity here, which would
//     misrepresent "Attendance Management" as company-wide when it isn't. Planned.
//   • Documents/Onboarding/Offboarding/Performance/HR Reports — no backend exists. Planned.
const OVERVIEW_CARDS: OverviewCard[] = [
  {
    title: 'Employees', icon: Users, badge: 'Live', sectionKey: 'employees',
    desc: 'Company-wide employee directory for HR review.',
    note: 'Live — sourced from the same Apex OS user records as Admin User Management.',
  },
  {
    title: 'Attendance Management', icon: Clock, badge: 'Planned', sectionKey: 'attendance-management',
    desc: 'HR review of employee attendance, workday status, and corrections.',
    note: 'Company-wide attendance oversight is planned.',
  },
  {
    title: 'Leave Management', icon: CalendarOff, badge: 'Live', sectionKey: 'leave-management',
    desc: 'Manage employee leave requests, balances, and HR review.',
    note: 'Live — company-wide leave data. Employees apply from Apex OS Leave.',
  },
  {
    title: 'Documents', icon: FileText, badge: 'Planned', sectionKey: 'documents',
    desc: 'Employee documents, ID proofs, and HR paperwork storage.',
    note: 'Will connect to employee profiles once built.',
  },
  {
    title: 'HR Approvals', icon: ClipboardCheck, badge: 'Live', sectionKey: 'hr-approvals',
    desc: 'Employee-change approvals — designation, department, team lead, role.',
    note: 'Live — shows requests currently awaiting your approval.',
  },
  {
    title: 'Onboarding', icon: UserPlus, badge: 'Planned', sectionKey: 'onboarding',
    desc: 'Structured checklist for bringing a new employee up to speed.',
    note: 'Will auto-generate Apex OS tickets for each step.',
  },
  {
    title: 'Offboarding', icon: UserMinus, badge: 'Planned', sectionKey: 'offboarding',
    desc: 'Structured checklist for a clean employee exit.',
    note: 'Will auto-generate Apex OS tickets for each step.',
  },
  {
    title: 'Performance', icon: Target, badge: 'Planned', sectionKey: 'performance',
    desc: 'KRA/KPI tracking and periodic performance review cycles.',
    note: 'Not built yet — ticket-level review ratings already exist in Apex OS. Payroll and KRA/KPI are not built.',
  },
  {
    title: 'HR Reports', icon: BarChart3, badge: 'Planned', sectionKey: 'reports',
    desc: 'Leave trends, attendance trends, employee workload, workday compliance, approval aging.',
    note: 'HR-specific reporting is planned. Apex OS Analytics exists separately.',
  },
];

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

  const currentLabel = PANEL_ITEMS.find((p) => p.key === section)?.label ?? 'HRMS Overview';
  const roleBadge = ROLE_BADGE_COLOR[role] ?? { bg: 'rgba(100,116,139,0.15)', text: '#94a3b8' };

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: '#050505' }}>
      {/* HRMS workspace sidebar — standalone, no Apex OS global sidebar present.
          Every item below stays inside /hrms — none navigate to a main Apex OS route. */}
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
          {PANEL_ITEMS.map((item) => {
            const active = section === item.key;
            return (
              <button
                key={item.key}
                onClick={() => router.push(item.key === 'overview' ? '/hrms' : `/hrms?section=${item.key}`)}
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
            {section === 'overview' && <OverviewSection onOpen={(key) => router.push(`/hrms?section=${key}`)} />}
            {section === 'employees' && <EmployeesPanel isAdmin={isAdmin} onBack={() => router.push('/hrms')} />}
            {section === 'leave-management' && <LeaveManagementPanel onBack={() => router.push('/hrms')} />}
            {section === 'hr-approvals' && <HRApprovalsPanel onBack={() => router.push('/hrms')} />}
            {section === 'attendance-management' && (
              <PlannedPanel
                title="Attendance Management" icon={Clock}
                desc="This section is for HR review of employee attendance, workday status, missing checkout, breaks, and corrections."
                note="Personal workday actions remain in the main Apex OS workspace. Company-wide attendance oversight inside HRMS is planned."
                secondaryLink={{ href: '/admin/activity', label: 'Open Apex OS Activity Log' }}
                onBack={() => router.push('/hrms')}
              />
            )}
            {section === 'documents' && (
              <PlannedPanel
                title="Documents" icon={FileText}
                desc="A central vault for employee documents, ID proofs, and HR paperwork."
                note="Will connect to employee profiles once built. No document storage exists yet."
                onBack={() => router.push('/hrms')}
              />
            )}
            {section === 'onboarding' && (
              <PlannedPanel
                title="Onboarding" icon={UserPlus}
                desc="A structured checklist for bringing a new employee up to speed."
                note="Will auto-generate Apex OS tickets for each onboarding step. Not built yet."
                onBack={() => router.push('/hrms')}
              />
            )}
            {section === 'offboarding' && (
              <PlannedPanel
                title="Offboarding" icon={UserMinus}
                desc="A structured checklist for a clean employee exit."
                note="Will auto-generate Apex OS tickets for each offboarding step. Not built yet."
                onBack={() => router.push('/hrms')}
              />
            )}
            {section === 'performance' && (
              <PlannedPanel
                title="Performance" icon={Target}
                desc="KRA/KPI tracking and periodic performance review cycles."
                note="The performance engine is not built yet — ticket-level review ratings already exist in Apex OS. Payroll and KRA/KPI are not built."
                onBack={() => router.push('/hrms')}
              />
            )}
            {section === 'reports' && (
              <PlannedPanel
                title="HR Reports" icon={BarChart3}
                desc="Leave trends, attendance trends, employee workload, workday compliance, and HR approval aging."
                note="No HR-specific report exists yet. Apex OS Analytics exists separately as its own live page — this is not a live HR reports module."
                secondaryLink={{ href: '/analytics', label: 'Open Apex OS Analytics' }}
                onBack={() => router.push('/hrms')}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────

function OverviewSection({ onOpen }: { onOpen: (key: SectionKey) => void }) {
  return (
    <>
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
        <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, maxWidth: 660 }}>
          HRMS is for HR department management work — employee records, leave management, attendance review, and
          HR approvals. Apex OS Home stays the place for everyday personal work like applying leave, tickets, and
          daily tasks. HRMS does not replace the main Apex OS workspace; it separates HR management work from
          everyday employee work.
        </p>
      </motion.section>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {OVERVIEW_CARDS.map((card, i) => (
          <OverviewCardTile key={card.title} card={card} index={i} onOpen={() => onOpen(card.sectionKey)} />
        ))}
      </div>
    </>
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

// ── Shared section chrome ──────────────────────────────────────────────────────

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      onClick={onBack}
      className="flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors"
      style={{ color: '#64748b' }}
    >
      <ArrowLeft size={12} />
      Back to HRMS Overview
    </button>
  );
}

function SecondaryLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
      style={{ color: '#94a3b8', border: '1px solid #1E293B', backgroundColor: 'rgba(148,163,184,0.06)' }}
    >
      {label}
      <ExternalLink size={11} />
    </Link>
  );
}

function SectionBadge({ badge }: { badge: 'Live' | 'Planned' }) {
  return (
    <span
      className="text-[9px] font-mono uppercase tracking-widest px-2 py-1 rounded-full"
      style={{
        background: badge === 'Live' ? 'rgba(16,185,129,0.12)' : 'rgba(148,163,184,0.12)',
        color: badge === 'Live' ? '#34d399' : '#94a3b8',
      }}
    >
      {badge}
    </span>
  );
}

function PanelShell({
  title, icon: Icon, badge, desc, onBack, secondaryLink, children,
}: {
  title: string; icon: LucideIcon; badge: 'Live' | 'Planned'; desc: string;
  onBack: () => void; secondaryLink?: { href: string; label: string }; children?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="rounded-2xl overflow-hidden border p-6"
      style={{ backgroundColor: '#0F172A', borderColor: '#1E293B' }}
    >
      <BackButton onBack={onBack} />

      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl flex-shrink-0" style={{ background: badge === 'Live' ? 'rgba(16,185,129,0.1)' : 'rgba(148,163,184,0.12)' }}>
            <Icon size={22} style={{ color: badge === 'Live' ? '#34d399' : '#94a3b8' }} />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <h2 className="text-lg font-bold" style={{ color: '#e2e8f0' }}>{title}</h2>
              <SectionBadge badge={badge} />
            </div>
            <p className="text-sm max-w-xl" style={{ color: '#8892a4' }}>{desc}</p>
          </div>
        </div>
        {secondaryLink && <SecondaryLink href={secondaryLink.href} label={secondaryLink.label} />}
      </div>

      {children}
    </motion.div>
  );
}

function PlannedPanel({
  title, icon, desc, note, secondaryLink, onBack,
}: {
  title: string; icon: LucideIcon; desc: string; note: string;
  secondaryLink?: { href: string; label: string }; onBack: () => void;
}) {
  return (
    <PanelShell title={title} icon={icon} badge="Planned" desc={desc} onBack={onBack} secondaryLink={secondaryLink}>
      <div className="pt-4" style={{ borderTop: '1px solid #1E293B' }}>
        <p className="text-xs font-mono" style={{ color: '#475569' }}>{note}</p>
      </div>
    </PanelShell>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10" style={{ color: '#475569' }}>
      <Inbox size={22} />
      <p className="text-xs">{label}</p>
    </div>
  );
}

function LoadingRow() {
  return (
    <div className="flex items-center justify-center py-10">
      <Loader2 size={18} className="animate-spin" style={{ color: '#475569' }} />
    </div>
  );
}

// ── Employees (Live) ───────────────────────────────────────────────────────────

function EmployeesPanel({ isAdmin, onBack }: { isAdmin: boolean; onBack: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['hrms-employees'],
    queryFn: () => usersApi.getAll({ limit: 50 }) as Promise<any>,
  });
  const employees: any[] = (data as any)?.users ?? [];
  const total = (data as any)?.total ?? employees.length;

  return (
    <PanelShell
      title="Employees" icon={Users} badge="Live"
      desc="Company-wide employee directory for HR review, sourced from live Apex OS user records."
      onBack={onBack}
      secondaryLink={isAdmin ? { href: '/users', label: 'Open Admin User Management' } : undefined}
    >
      <div className="rounded-xl overflow-hidden border" style={{ borderColor: '#1E293B' }}>
        {isLoading ? (
          <LoadingRow />
        ) : employees.length === 0 ? (
          <EmptyRow label="No employees found." />
        ) : (
          <div className="divide-y" style={{ borderColor: '#1E293B' }}>
            {employees.map((u: any) => (
              <div key={u.id} className="flex items-center justify-between gap-3 px-4 py-2.5" style={{ borderColor: '#1E293B' }}>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: '#e2e8f0' }}>{u.name}</p>
                  <p className="text-xs truncate" style={{ color: '#64748b' }}>{u.email}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[10px] px-2 py-0.5 rounded font-mono uppercase" style={{ backgroundColor: 'rgba(100,116,139,0.15)', color: '#94a3b8' }}>
                    {u.department?.name ?? '—'}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded font-mono uppercase" style={{ backgroundColor: 'rgba(37,99,235,0.12)', color: '#60a5fa' }}>
                    {u.role?.name ?? '—'}
                  </span>
                  {!u.isActive && (
                    <span className="text-[10px] px-2 py-0.5 rounded font-mono uppercase" style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: '#f87171' }}>
                      Inactive
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="text-[10px] font-mono mt-3" style={{ color: '#475569' }}>
        Showing {employees.length} of {total} employees. Editing, deactivation, and account creation remain in Admin User Management.
      </p>
    </PanelShell>
  );
}

// ── Leave Management (Live) ─────────────────────────────────────────────────────

function LeaveManagementPanel({ onBack }: { onBack: () => void }) {
  const { data: stats } = useQuery({
    queryKey: ['hrms-leave-stats'],
    queryFn: () => leaveApi.getStats() as Promise<any>,
  });
  const { data: listData, isLoading } = useQuery({
    queryKey: ['hrms-leave-list'],
    queryFn: () => leaveApi.getAll({ limit: 20 }) as Promise<any>,
  });
  const items: any[] = (listData as any)?.items ?? [];
  const s = (stats as any) ?? {};

  return (
    <PanelShell
      title="Leave Management" icon={CalendarOff} badge="Live"
      desc="This section is for managing employee leave requests, balances, approvals, and HR review."
      onBack={onBack}
      secondaryLink={{ href: '/leave', label: 'Open Apex OS Leave' }}
    >
      <p className="text-xs mb-4" style={{ color: '#64748b' }}>
        Employees apply for their own leave from Apex OS Leave. Employee leave application remains in Apex OS —
        HR leave management lives here.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total', value: s.total },
          { label: 'Pending', value: s.pending },
          { label: 'Approved', value: s.approved },
          { label: 'Rejected', value: s.rejected },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl p-3 text-center" style={{ backgroundColor: 'rgba(148,163,184,0.06)', border: '1px solid #1E293B' }}>
            <p className="text-lg font-bold font-mono" style={{ color: '#e2e8f0' }}>{stat.value ?? '—'}</p>
            <p className="text-[10px] uppercase tracking-wide" style={{ color: '#64748b' }}>{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl overflow-hidden border" style={{ borderColor: '#1E293B' }}>
        {isLoading ? (
          <LoadingRow />
        ) : items.length === 0 ? (
          <EmptyRow label="No leave requests found." />
        ) : (
          <div className="divide-y" style={{ borderColor: '#1E293B' }}>
            {items.map((it: any) => (
              <div key={it.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: '#e2e8f0' }}>{it.user?.name ?? 'Unknown'}</p>
                  <p className="text-xs truncate" style={{ color: '#64748b' }}>
                    {it.type} · {new Date(it.startDate).toLocaleDateString()} – {new Date(it.endDate).toLocaleDateString()}
                  </p>
                </div>
                <span
                  className="text-[10px] px-2 py-0.5 rounded font-mono uppercase flex-shrink-0"
                  style={{
                    backgroundColor: it.status === 'PENDING' ? 'rgba(245,158,11,0.12)' : it.status === 'APPROVED' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                    color: it.status === 'PENDING' ? '#fbbf24' : it.status === 'APPROVED' ? '#34d399' : '#f87171',
                  }}
                >
                  {it.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="text-[10px] font-mono mt-3" style={{ color: '#475569' }}>
        To approve or reject a request, use the existing action in Apex OS Leave.
      </p>
    </PanelShell>
  );
}

// ── HR Approvals (Live) ─────────────────────────────────────────────────────────

function HRApprovalsPanel({ onBack }: { onBack: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['hrms-approvals'],
    queryFn: () => changeRequestsApi.listPendingApprovals() as Promise<any[]>,
  });
  const items: any[] = Array.isArray(data) ? data : [];

  return (
    <PanelShell
      title="HR Approvals" icon={ClipboardCheck} badge="Live"
      desc="Employee-change approvals — designation, department, team lead, and role changes currently awaiting your approval."
      onBack={onBack}
      secondaryLink={{ href: '/admin/approvals', label: 'Open Legacy Admin Approvals' }}
    >
      <div className="rounded-xl overflow-hidden border" style={{ borderColor: '#1E293B' }}>
        {isLoading ? (
          <LoadingRow />
        ) : items.length === 0 ? (
          <EmptyRow label="No employee-change approvals are currently waiting on you." />
        ) : (
          <div className="divide-y" style={{ borderColor: '#1E293B' }}>
            {items.map((it: any) => (
              <div key={it.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: '#e2e8f0' }}>
                    {it.targetUser?.name ?? 'Unknown employee'}
                  </p>
                  <p className="text-xs truncate" style={{ color: '#64748b' }}>
                    {String(it.requestType ?? '').replace(/_/g, ' ')} · requested by {it.requestedBy?.name ?? 'Unknown'}
                  </p>
                </div>
                <span className="text-[10px] font-mono flex-shrink-0" style={{ color: '#475569' }}>
                  {it.createdAt ? formatRelativeTime(it.createdAt) : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </PanelShell>
  );
}
