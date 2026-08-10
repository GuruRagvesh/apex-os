'use client';

// Adapted from intern source (src/app/(protected)/layout.tsx). Uses the
// real intern shell pattern: one <Sidebar> instance whose visibility on
// mobile is handled entirely by shell.module.css (position: fixed +
// transform, driven by the "shell--mobile-open" class), not a duplicated
// Tailwind-only instance. Topbar reads the authenticated user itself via
// the auth adapter (see Topbar.tsx), so no user/role props are threaded
// through here — this keeps the shell's own signature identical to
// intern's ProtectedLayout ({ children }).
//
// Wraps everything in the CRM-local ThemeProvider and applies the theme
// as a data attribute on the .sales-crm-root wrapper only — never on
// document.documentElement/<html>/<body>. Topbar is wrapped in <Suspense>
// because it calls useSearchParams(), which Next.js requires a Suspense
// boundary for.

import { Suspense, useCallback, useState } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { ThemeProvider, useTheme } from '@/lib/sales-crm/theme';
import tokens from '../styles/tokens.module.css';
import shell from '../styles/shell.module.css';

const COLLAPSE_KEY = 'salescrm-sidebar-collapsed';

interface SalesCrmShellProps {
  children: React.ReactNode;
}

export default function SalesCrmShell({ children }: SalesCrmShellProps) {
  return (
    <ThemeProvider>
      <SalesCrmShellInner>{children}</SalesCrmShellInner>
    </ThemeProvider>
  );
}

function SalesCrmShellInner({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(COLLAPSE_KEY) === 'true';
    }
    return false;
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_KEY, String(next));
      return next;
    });
  }, []);

  const toggleMobile = useCallback(() => setMobileOpen((prev) => !prev), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  const shellClassName = [shell.shell, collapsed ? shell['shell--collapsed'] : '', mobileOpen ? shell['shell--mobile-open'] : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={tokens.salesCrmRoot} data-salescrm-theme={theme} suppressHydrationWarning>
      <div className={shellClassName}>
        <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapse} onNavItemClick={closeMobile} />
        <div className={shell['sidebar-overlay']} onClick={closeMobile} aria-hidden="true" />
        <div className={shell['shell-main']}>
          <Suspense fallback={<div style={{ height: 'var(--topbar-height)' }} />}>
            <Topbar onToggleMobile={toggleMobile} />
          </Suspense>
          <main className={shell['shell-content']}>{children}</main>
        </div>
      </div>
    </div>
  );
}
