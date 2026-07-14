'use client';

import { usePathname } from 'next/navigation';
import { Menu, type LucideIcon, LayoutDashboard, Target, ClipboardList, Handshake, Database, BarChart3, Settings } from 'lucide-react';

const PAGE_META: Record<string, { label: string; icon: LucideIcon }> = {
  '/sales-crm/dashboard': { label: 'Dashboard', icon: LayoutDashboard },
  '/sales-crm/leads': { label: 'Leads', icon: Target },
  '/sales-crm/requirements-sourcing': { label: 'Requirements & Sourcing', icon: ClipboardList },
  '/sales-crm/deals': { label: 'Deals', icon: Handshake },
  '/sales-crm/database': { label: 'Database', icon: Database },
  '/sales-crm/analytics': { label: 'Analytics', icon: BarChart3 },
  '/sales-crm/settings': { label: 'Settings', icon: Settings },
};

const ROLE_BADGE_COLOR: Record<string, { bg: string; text: string }> = {
  SUPER_ADMIN: { bg: 'rgba(139,92,246,0.15)', text: '#a78bfa' },
  ADMIN: { bg: 'rgba(239,68,68,0.15)', text: '#f87171' },
  MANAGER: { bg: 'rgba(245,158,11,0.15)', text: '#fbbf24' },
  TEAM_LEAD: { bg: 'rgba(37,99,235,0.15)', text: '#60a5fa' },
  EMPLOYEE: { bg: 'rgba(16,185,129,0.15)', text: '#34d399' },
  INTERN: { bg: 'rgba(20,184,166,0.15)', text: '#2dd4bf' },
};

interface TopbarProps {
  userName: string;
  role: string;
  onToggleMobile: () => void;
}

export default function Topbar({ userName, role, onToggleMobile }: TopbarProps) {
  const pathname = usePathname();

  const pageKey = Object.keys(PAGE_META).find((key) => pathname === key || pathname.startsWith(`${key}/`));
  const meta = pageKey ? PAGE_META[pageKey] : PAGE_META['/sales-crm/dashboard'];
  const PageIcon = meta.icon;
  const roleBadge = ROLE_BADGE_COLOR[role] ?? { bg: 'rgba(100,116,139,0.15)', text: '#94a3b8' };

  return (
    <header
      className="flex items-center justify-between flex-shrink-0 px-4 sm:px-6 gap-3"
      style={{ height: 'var(--topbar-height)', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-elevated)' }}
    >
      <button
        className="lg:hidden p-1.5 rounded-lg flex-shrink-0"
        style={{ color: 'var(--color-text-secondary)' }}
        onClick={onToggleMobile}
        aria-label="Toggle menu"
      >
        <Menu size={20} />
      </button>

      <div className="flex items-center gap-2 min-w-0 flex-1">
        <PageIcon size={18} style={{ color: 'var(--color-text-muted)' }} className="flex-shrink-0" />
        <h1 className="text-sm font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
          {meta.label}
        </h1>
        <span
          className="hidden sm:inline-flex text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full flex-shrink-0"
          style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary-text)' }}
        >
          Phase 1 · Local data
        </span>
      </div>

      <div className="flex items-center gap-2.5 flex-shrink-0">
        <div className="hidden sm:flex flex-col items-end leading-tight">
          <span className="text-xs font-medium truncate max-w-[140px]" style={{ color: 'var(--color-text-primary)' }}>
            {userName}
          </span>
          <span
            className="text-[9px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wide mt-0.5"
            style={{ backgroundColor: roleBadge.bg, color: roleBadge.text }}
          >
            {role}
          </span>
        </div>
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold"
          style={{ backgroundColor: roleBadge.bg, color: roleBadge.text }}
        >
          {userName.charAt(0).toUpperCase()}
        </div>
      </div>
    </header>
  );
}
