'use client';

import Link from 'next/link';
import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { cn } from '@/lib/utils';
import { motion } from 'motion/react';
import {
  type LucideIcon,
  LayoutGrid, Handshake, UserPlus, Building2, Contact, Phone, FileSignature,
  Workflow, ArrowRightLeft, BarChart3, ShieldAlert, ArrowLeft,
} from 'lucide-react';

// Standalone Sales CRM workspace — deliberately NOT under (dashboard), so it
// does not inherit the Apex OS global Sidebar/TopBar. This page builds its own
// full-page shell (CRM sidebar + header + content) and replicates the
// auth-redirect guard that (dashboard)/layout.tsx would otherwise have provided.
//
// No CRM backend exists anywhere in the app (confirmed by search) — every
// section here is Planned. None link out, to avoid ever mislabeling a real
// Apex OS page (Projects, Analytics) as a live CRM-specific module; where a
// real Apex OS page is relevant, its name is mentioned in the note text only.

type SectionKey =
  | 'overview' | 'leads' | 'clients' | 'contacts' | 'deals' | 'followups'
  | 'proposals' | 'pipeline' | 'wonDeal' | 'reports';

interface PanelItem {
  key: SectionKey;
  label: string;
  icon: LucideIcon;
}

const PANEL_ITEMS: PanelItem[] = [
  { key: 'overview',   label: 'CRM Overview',        icon: LayoutGrid },
  { key: 'leads',      label: 'Leads',               icon: UserPlus },
  { key: 'clients',    label: 'Clients',             icon: Building2 },
  { key: 'contacts',   label: 'Contacts',            icon: Contact },
  { key: 'deals',      label: 'Deals',                icon: Handshake },
  { key: 'followups',  label: 'Follow-ups',          icon: Phone },
  { key: 'proposals',  label: 'Proposals',           icon: FileSignature },
  { key: 'pipeline',   label: 'Pipeline',             icon: Workflow },
  { key: 'wonDeal',    label: 'Won Deal → Project',  icon: ArrowRightLeft },
  { key: 'reports',    label: 'Reports',              icon: BarChart3 },
];

interface OverviewCard {
  title: string;
  icon: LucideIcon;
  desc: string;
  note: string;
  sectionKey: SectionKey;
}

const OVERVIEW_CARDS: OverviewCard[] = [
  {
    title: 'Leads', icon: UserPlus, sectionKey: 'leads',
    desc: 'Capture and qualify new sales leads before they become clients.',
    note: 'Will generate Apex OS follow-up tickets automatically.',
  },
  {
    title: 'Clients', icon: Building2, sectionKey: 'clients',
    desc: 'Company and client records tied to deals and delivery work.',
    note: 'Client requirements will become Apex OS project tickets.',
  },
  {
    title: 'Contacts', icon: Contact, sectionKey: 'contacts',
    desc: 'Individual contact people at each client or prospect.',
    note: 'Will connect to Apex OS notifications for follow-ups.',
  },
  {
    title: 'Deals', icon: Handshake, sectionKey: 'deals',
    desc: 'Sales opportunities moving through your pipeline.',
    note: 'Deal stages will reuse the Apex OS Project Stages pattern.',
  },
  {
    title: 'Follow-ups', icon: Phone, sectionKey: 'followups',
    desc: 'Scheduled calls, emails, and check-ins with prospects.',
    note: 'Sales follow-ups will become real Apex OS work items.',
  },
  {
    title: 'Proposals', icon: FileSignature, sectionKey: 'proposals',
    desc: 'Quotes and proposals sent to prospects and clients.',
    note: 'Will attach to the Deal record once built.',
  },
  {
    title: 'Pipeline', icon: Workflow, sectionKey: 'pipeline',
    desc: 'Visual stage-by-stage view of every open deal.',
    note: 'Reuses the ordered, delete-protected pattern from Apex OS Project Stages.',
  },
  {
    title: 'Won Deal → Project', icon: ArrowRightLeft, sectionKey: 'wonDeal',
    desc: 'Convert a won deal directly into a real Apex OS project.',
    note: 'Project handoff will connect here. Apex OS Projects already exists separately.',
  },
  {
    title: 'Reports', icon: BarChart3, sectionKey: 'reports',
    desc: 'Pipeline value, conversion rate, and rep performance.',
    note: 'CRM reports are planned; Apex OS Analytics exists separately as its own live page.',
  },
];

const PLANNED_DETAIL: Partial<Record<SectionKey, { title: string; icon: LucideIcon; desc: string; note: string }>> = {
  leads: {
    title: 'Leads', icon: UserPlus,
    desc: 'Capture and qualify new sales leads before they become clients.',
    note: 'Not built yet. Will generate Apex OS follow-up tickets automatically once a lead is qualified.',
  },
  clients: {
    title: 'Clients', icon: Building2,
    desc: 'Company and client records tied to deals and delivery work.',
    note: 'Not built yet. Client requirements will become Apex OS project tickets.',
  },
  contacts: {
    title: 'Contacts', icon: Contact,
    desc: 'Individual contact people at each client or prospect.',
    note: 'Not built yet. Will connect to Apex OS notifications for follow-ups.',
  },
  deals: {
    title: 'Deals', icon: Handshake,
    desc: 'Sales opportunities moving through your pipeline.',
    note: 'Not built yet. Deal stages will reuse the Apex OS Project Stages pattern.',
  },
  followups: {
    title: 'Follow-ups', icon: Phone,
    desc: 'Scheduled calls, emails, and check-ins with prospects.',
    note: 'Not built yet. Sales follow-ups will become real Apex OS work items, using Apex OS approvals and notifications.',
  },
  proposals: {
    title: 'Proposals', icon: FileSignature,
    desc: 'Quotes and proposals sent to prospects and clients.',
    note: 'Not built yet. Will attach to the Deal record once built.',
  },
  pipeline: {
    title: 'Pipeline', icon: Workflow,
    desc: 'Visual stage-by-stage view of every open deal.',
    note: 'Not built yet. Will reuse the ordered, delete-protected pattern already used by Apex OS Project Stages.',
  },
  wonDeal: {
    title: 'Won Deal → Project', icon: ArrowRightLeft,
    desc: 'Convert a won deal directly into a real Apex OS project.',
    note: 'Not built yet. Will create a real Apex OS Project the moment a deal is marked Won — Apex OS Projects already exists separately as a live page.',
  },
  reports: {
    title: 'Reports', icon: BarChart3,
    desc: 'Pipeline value, conversion rate, and rep performance.',
    note: 'No CRM-specific report exists yet. Apex OS Analytics exists separately as its own live page — this is not a live CRM reports module.',
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

export default function SalesCRMPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#050505' }}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#7c3aed' }} />
      </div>
    }>
      <SalesCRMPageInner />
    </Suspense>
  );
}

function SalesCRMPageInner() {
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

  // No SALES role exists in frontend/lib/roles.ts yet, so access is Admin/SuperAdmin-only
  // until a real Sales role is introduced. No MANAGER preview tier — MANAGER has no
  // existing explicit product permission for CRM data, so it is not granted here.
  const hasAccess = isAdmin;

  if (!hasHydrated || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#050505' }}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#7c3aed' }} />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: '#050505' }}>
        <div className="max-w-xl w-full rounded-2xl p-8 text-center space-y-4" style={{ backgroundColor: '#0F172A', border: '1px solid #1E293B' }}>
          <div className="mx-auto w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(139,92,246,0.12)' }}>
            <ShieldAlert size={24} style={{ color: '#a78bfa' }} />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">Sales CRM is restricted</h1>
            <p className="text-sm mt-2" style={{ color: '#94a3b8' }}>
              Sales CRM is currently available to Admin roles only.
            </p>
          </div>
          <Link href="/dashboard" className="inline-flex justify-center px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors" style={{ backgroundColor: '#7c3aed' }}>
            Back to Apex OS Home
          </Link>
        </div>
      </div>
    );
  }

  const activeItem = PANEL_ITEMS.find((p) => p.key === section);
  const plannedDetail = section !== 'overview' ? PLANNED_DETAIL[section] : undefined;
  const currentLabel = activeItem?.label ?? 'CRM Overview';
  const roleBadge = ROLE_BADGE_COLOR[role] ?? { bg: 'rgba(100,116,139,0.15)', text: '#94a3b8' };

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: '#050505' }}>
      {/* Sales CRM workspace sidebar — standalone, no Apex OS global sidebar present */}
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
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, #4c1d95 0%, #7c3aed 100%)' }}>
              <Handshake size={16} style={{ color: '#fff' }} />
            </div>
            <div>
              <p className="font-bold text-white text-base leading-none">Sales CRM</p>
              <p className="text-[10px] text-slate-500 mt-0.5 font-mono uppercase tracking-widest">Revenue Operations</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {PANEL_ITEMS.map((item) => {
            const active = section === item.key;
            return (
              <button
                key={item.key}
                onClick={() => router.push(`/sales-crm?section=${item.key}`)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-sm font-medium transition-colors',
                  active ? 'bg-purple-600/15 text-purple-300' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200',
                )}
              >
                <item.icon size={16} className="flex-shrink-0" style={{ color: active ? '#a78bfa' : '#64748b' }} />
                <span className="flex-1 truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Sales CRM content column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* CRM header/top area */}
        <header
          className="h-14 px-6 flex items-center justify-between flex-shrink-0"
          style={{ borderBottom: '1px solid #1E293B', backgroundColor: '#0B1220' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-white truncate">{currentLabel}</span>
            <span
              className="text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full flex-shrink-0"
              style={{ background: 'rgba(139,92,246,0.12)', color: '#a78bfa' }}
            >
              Sales CRM Workspace
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span
              className="text-[10px] px-2 py-1 rounded font-mono uppercase tracking-wide"
              style={{ backgroundColor: roleBadge.bg, color: roleBadge.text }}
            >
              {role}
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
                  style={{ background: 'linear-gradient(135deg, #4c1d95 0%, #6d28d9 55%, #2563eb 100%)', padding: '36px 40px' }}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <Handshake size={13} style={{ color: 'rgba(255,255,255,0.65)' }} />
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                      Apex OS · Workspace
                    </span>
                  </div>
                  <h1 style={{ fontSize: 30, fontWeight: 900, color: '#fff', letterSpacing: '-0.4px', marginBottom: 8 }}>Sales CRM</h1>
                  <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, maxWidth: 660 }}>
                    The sales room inside Apex OS. No CRM backend exists yet — every section below is a preview.
                    Once built, sales follow-ups will become real Apex OS work items, won deals will become Apex OS
                    projects, client requirements will become project tickets, and approvals/handoffs will use the
                    same Apex OS approvals and notifications as the rest of the product. AI will later summarize
                    deal health, follow-ups, and pipeline risks.
                  </p>
                </motion.section>

                {/* Overview grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {OVERVIEW_CARDS.map((card, i) => (
                    <OverviewCardTile
                      key={card.title}
                      card={card}
                      index={i}
                      onOpen={() => router.push(`/sales-crm?section=${card.sectionKey}`)}
                    />
                  ))}
                </div>
              </>
            ) : (
              <PlannedPane detail={plannedDetail} onBack={() => router.push('/sales-crm')} />
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
        <div className="p-2.5 rounded-xl" style={{ background: 'rgba(139,92,246,0.12)' }}>
          <Icon size={16} style={{ color: '#a78bfa' }} />
        </div>
        <span
          className="text-[9px] font-mono uppercase tracking-widest px-2 py-1 rounded-full"
          style={{ background: 'rgba(148,163,184,0.12)', color: '#94a3b8' }}
        >
          Planned
        </span>
      </div>
      <h3 className="text-sm font-bold mb-1.5" style={{ color: '#e2e8f0' }}>{card.title}</h3>
      <p className="text-xs mb-3 flex-1" style={{ color: '#8892a4' }}>{card.desc}</p>
      <div className="pt-3" style={{ borderTop: '1px solid #1E293B' }}>
        <p className="text-[10px] font-mono" style={{ color: '#475569' }}>{card.note}</p>
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
        Back to CRM Overview
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
