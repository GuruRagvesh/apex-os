'use client';

// Adapted from intern source (src/components/layout/Sidebar.tsx). Structure,
// classes, and behavior are ported as-is; only the nav hrefs (real /sales-crm/*
// routes instead of intern's bare routes) and the active-path check (extended
// to also treat /sales-crm as the Dashboard item, since that route renders the
// same dashboard) were adapted. No "back to Apex Home" link — the strict
// containment rules for this step forbid linking to root /dashboard.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { APP_NAME } from '@apex/sales-crm-shared';
import styles from '@/styles/sales-crm/shell.module.css';
import {
  BarChart3,
  LayoutDashboard,
  Target,
  ClipboardList,
  Handshake,
  Database,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

const NAV_ITEMS = [
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
    <aside className={styles.sidebar}>
      {/* Logo */}
      <div className={styles['sidebar-logo']}>
        <div className={styles['sidebar-logo-icon']}>S</div>
        <span className={styles['sidebar-logo-text']}>{APP_NAME}</span>
        <button
          className={styles['sidebar-toggle']}
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className={styles['sidebar-nav']}>
        <ul className={styles['sidebar-nav-list']}>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isDashboard = item.href === '/sales-crm/dashboard';
            const isActive = isDashboard
              ? pathname === '/sales-crm' || pathname === item.href || pathname.startsWith(`${item.href}/`)
              : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`${styles['sidebar-nav-item']} ${isActive ? styles['sidebar-nav-item-active'] : ''}`}
                  title={collapsed ? item.label : undefined}
                  onClick={onNavItemClick}
                >
                  <span className={styles['sidebar-nav-icon']}>
                    <Icon size={20} />
                  </span>
                  <span className={styles['sidebar-nav-label']}>{item.label}</span>
                  {isActive && <div className={styles['sidebar-active-indicator']} />}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className={styles['sidebar-footer']}>
        <div className={styles['sidebar-footer-divider']} />
        <p className={styles['sidebar-footer-text']}>{APP_NAME} · Phase 1 · Local data</p>
      </div>
    </aside>
  );
}
