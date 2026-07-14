'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  type LucideIcon,
  LayoutDashboard,
  Target,
  ClipboardList,
  Handshake,
  Database,
  BarChart3,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowLeft,
} from 'lucide-react';

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/sales-crm/dashboard', icon: LayoutDashboard },
  { label: 'Leads', href: '/sales-crm/leads', icon: Target },
  { label: 'Requirements & Sourcing', href: '/sales-crm/requirements-sourcing', icon: ClipboardList },
  { label: 'Deals', href: '/sales-crm/deals', icon: Handshake },
  { label: 'Database', href: '/sales-crm/database', icon: Database },
  { label: 'Analytics', href: '/sales-crm/analytics', icon: BarChart3 },
  { label: 'Settings', href: '/sales-crm/settings', icon: Settings },
];

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNavItemClick?: () => void;
}

export default function Sidebar({ collapsed, onToggleCollapse, onNavItemClick }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className="flex-shrink-0 flex flex-col h-screen sticky top-0 transition-all"
      style={{
        width: collapsed ? 'var(--sidebar-collapsed)' : 'var(--sidebar-width)',
        backgroundColor: 'var(--color-surface)',
        borderRight: '1px solid var(--color-border)',
      }}
    >
      <div className="p-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <Link
          href="/dashboard"
          className="flex items-center gap-1.5 text-xs font-medium mb-4 transition-colors hover:text-slate-300"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <ArrowLeft size={12} />
          {!collapsed && 'Apex OS Home'}
        </Link>
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #4c1d95 0%, #7c3aed 100%)' }}
          >
            <Handshake size={16} style={{ color: '#fff' }} />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="font-bold text-base leading-none truncate" style={{ color: 'var(--color-text-primary)' }}>
                Sales CRM
              </p>
              <p className="text-[10px] mt-0.5 font-mono uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
                Revenue Operations
              </p>
            </div>
          )}
          <button
            onClick={onToggleCollapse}
            className="ml-auto flex-shrink-0 p-1.5 rounded-lg transition-colors hover:bg-white/5"
            style={{ color: 'var(--color-text-muted)' }}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavItemClick}
              title={collapsed ? item.label : undefined}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors"
              style={{
                backgroundColor: isActive ? 'var(--color-primary-soft)' : 'transparent',
                color: isActive ? 'var(--color-primary-text)' : 'var(--color-text-secondary)',
              }}
            >
              <Icon size={16} className="flex-shrink-0" style={{ color: isActive ? 'var(--color-primary-text)' : 'var(--color-text-muted)' }} />
              {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="p-3" style={{ borderTop: '1px solid var(--color-border)' }}>
        {!collapsed && (
          <p className="text-[10px] font-mono uppercase tracking-widest text-center" style={{ color: 'var(--color-text-muted)' }}>
            Sales CRM Phase 1
          </p>
        )}
      </div>
    </aside>
  );
}
