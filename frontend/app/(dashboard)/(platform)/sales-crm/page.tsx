'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { motion } from 'motion/react';
import {
  type LucideIcon,
  Handshake, UserPlus, Building2, Contact, Phone, FileSignature,
  Workflow, ArrowRightLeft, BarChart3, ShieldAlert, ArrowRight,
} from 'lucide-react';

interface RoomSection {
  title: string;
  icon: LucideIcon;
  desc: string;
  note: string;
  href?: string;
  badge: 'Live' | 'Planned';
}

const SECTIONS: RoomSection[] = [
  {
    title: 'Leads', icon: UserPlus, badge: 'Planned',
    desc: 'Capture and qualify new sales leads before they become clients.',
    note: 'Will generate Apex OS follow-up tickets automatically.',
  },
  {
    title: 'Clients', icon: Building2, badge: 'Planned',
    desc: 'Company and client records tied to deals and delivery work.',
    note: 'Will link to Apex OS Projects once a client converts.',
  },
  {
    title: 'Contacts', icon: Contact, badge: 'Planned',
    desc: 'Individual contact people at each client or prospect.',
    note: 'Will connect to Apex OS notifications for follow-ups.',
  },
  {
    title: 'Deals', icon: Handshake, badge: 'Planned',
    desc: 'Sales opportunities moving through your pipeline.',
    note: 'Deal stages will reuse the Apex OS Project Stages pattern.',
  },
  {
    title: 'Follow-ups', icon: Phone, badge: 'Planned',
    desc: 'Scheduled calls, emails, and check-ins with prospects.',
    note: 'Will connect to Apex OS tickets and notifications.',
  },
  {
    title: 'Proposals', icon: FileSignature, badge: 'Planned',
    desc: 'Quotes and proposals sent to prospects and clients.',
    note: 'Will attach to the Deal record once built.',
  },
  {
    title: 'Pipeline', icon: Workflow, badge: 'Planned',
    desc: 'Visual stage-by-stage view of every open deal.',
    note: 'Reuses the ordered, delete-protected pattern from Apex OS Project Stages.',
  },
  {
    title: 'Won Deal → Project Handoff', icon: ArrowRightLeft, badge: 'Planned',
    desc: 'Convert a won deal directly into a real Apex OS project.',
    note: 'Will create an actual Apex OS Project the moment a deal is marked Won.',
  },
  {
    title: 'Sales Reports Preview', icon: BarChart3, href: '/analytics', badge: 'Planned',
    desc: 'Pipeline value, conversion rate, and rep performance.',
    note: 'Will extend Apex OS Analytics once CRM data exists.',
  },
];

export default function SalesCRMPage() {
  const { user, hasHydrated } = useAuthStore();
  const router = useRouter();

  const roleObj = user?.role as any;
  const role: string = roleObj?.name ?? (typeof roleObj === 'string' ? roleObj : '') ?? '';
  const isSuperAdmin = role === 'SUPER_ADMIN';
  const isAdmin = role === 'ADMIN' || isSuperAdmin;

  // No SALES role exists in frontend/lib/roles.ts yet, so access is Admin/SuperAdmin-only
  // until a real Sales role is introduced. No MANAGER preview tier — MANAGER has no
  // existing explicit product permission for CRM data, so it is not granted here.
  const hasAccess = isAdmin;

  if (!hasHydrated) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--accent)' }} />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="max-w-xl mx-auto apex-card p-8 text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--accent-subtle)' }}>
          <ShieldAlert size={24} style={{ color: 'var(--accent)' }} />
        </div>
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Sales CRM is restricted</h1>
          <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
            Sales CRM is currently available to Admin roles only.
          </p>
        </div>
        <Link href="/dashboard" className="apex-btn-primary inline-flex justify-center px-4 py-2 rounded-lg text-sm">
          Back to Home
        </Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', paddingBottom: 48 }}>
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
        <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, maxWidth: 640 }}>
          The sales room inside Apex OS. This is a UI preview — no CRM backend exists yet. Once built, every
          sales action here will connect to Apex OS tickets, follow-ups, projects, and approvals, the same way
          Query and Help routing already does.
        </p>
      </motion.section>

      {/* Section grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {SECTIONS.map((section, i) => (
          <SectionCard key={section.title} section={section} index={i} onOpen={() => section.href && router.push(section.href)} />
        ))}
      </div>
    </div>
  );
}

function SectionCard({ section, index, onOpen }: { section: RoomSection; index: number; onOpen: () => void }) {
  const Icon = section.icon;
  const clickable = Boolean(section.href);
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.03 }}
      onClick={onOpen}
      className="rounded-2xl overflow-hidden border p-5 flex flex-col"
      style={{ backgroundColor: '#0F172A', borderColor: '#1E293B', cursor: clickable ? 'pointer' : 'default' }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="p-2.5 rounded-xl" style={{ background: 'rgba(139,92,246,0.12)' }}>
          <Icon size={16} style={{ color: '#a78bfa' }} />
        </div>
        <span
          className="text-[9px] font-mono uppercase tracking-widest px-2 py-1 rounded-full"
          style={{
            background: section.badge === 'Live' ? 'rgba(16,185,129,0.12)' : 'rgba(148,163,184,0.12)',
            color: section.badge === 'Live' ? '#34d399' : '#94a3b8',
          }}
        >
          {section.badge}
        </span>
      </div>
      <h3 className="text-sm font-bold mb-1.5" style={{ color: '#e2e8f0' }}>{section.title}</h3>
      <p className="text-xs mb-3 flex-1" style={{ color: '#8892a4' }}>{section.desc}</p>
      <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid #1E293B' }}>
        <p className="text-[10px] font-mono" style={{ color: '#475569' }}>{section.note}</p>
        {clickable && <ArrowRight size={12} style={{ color: '#475569', flexShrink: 0, marginLeft: 8 }} />}
      </div>
    </motion.div>
  );
}
