'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { motion } from 'motion/react';
import {
  type LucideIcon,
  Users, Clock, CalendarOff, FileText, ClipboardCheck, UserPlus,
  Target, BarChart3, ShieldAlert, ArrowRight,
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
    title: 'Employees', icon: Users, href: '/users', badge: 'Live',
    desc: 'Company-wide employee directory, roles, and department assignment.',
    note: 'Synced with Apex OS Users & Roles.',
  },
  {
    title: 'Attendance / Workday', icon: Clock, href: '/dashboard', badge: 'Live',
    desc: 'Live work sessions, breaks, and daily attendance tracking.',
    note: 'Powered by live Apex OS Workday sessions.',
  },
  {
    title: 'Leave', icon: CalendarOff, href: '/leave', badge: 'Live',
    desc: 'Apply, approve, and track leave requests across the company.',
    note: 'Same leave engine used across Apex OS.',
  },
  {
    title: 'Documents', icon: FileText, badge: 'Planned',
    desc: 'Employee documents, ID proofs, and HR paperwork storage.',
    note: 'Will connect to employee profiles once built.',
  },
  {
    title: 'HR Approvals', icon: ClipboardCheck, badge: 'Planned',
    desc: 'Centralized inbox for pending HR approvals.',
    note: 'Will combine Leave and Profile Change approvals already running in Apex OS.',
  },
  {
    title: 'Onboarding / Offboarding', icon: UserPlus, badge: 'Planned',
    desc: 'Structured checklists for new and exiting employees.',
    note: 'Will auto-generate Apex OS tickets for each step.',
  },
  {
    title: 'Performance Preview', icon: Target, badge: 'Planned',
    desc: 'KRA/KPI tracking and periodic performance review cycles.',
    note: 'Not built yet — ticket-level review ratings already exist in Apex OS.',
  },
  {
    title: 'Reports Preview', icon: BarChart3, href: '/analytics', badge: 'Planned',
    desc: 'Headcount, attrition, leave trends, and attendance summaries.',
    note: 'Will extend Apex OS Analytics with HR-specific views.',
  },
];

export default function HRMSPage() {
  const { user, hasHydrated } = useAuthStore();
  const router = useRouter();

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
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>HRMS is restricted</h1>
          <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
            HRMS is available to HR and Admin roles. Use Team, Leave, or Profile for your own HR-related actions.
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
          The HR room inside Apex OS. Employees, attendance, and leave already run on live Apex OS data —
          approvals, onboarding, and performance workflows connect through the same tickets and approval engine
          as the rest of Apex OS.
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
        <div className="p-2.5 rounded-xl" style={{ background: 'rgba(59,130,246,0.12)' }}>
          <Icon size={16} style={{ color: '#60a5fa' }} />
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
