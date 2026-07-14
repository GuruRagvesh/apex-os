'use client';

import { useCallback, useState } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import tokens from '@/styles/sales-crm/tokens.module.css';

const COLLAPSE_KEY = 'salescrm-sidebar-collapsed';

interface SalesCrmShellProps {
  userName: string;
  role: string;
  children: React.ReactNode;
}

export default function SalesCrmShell({ userName, role, children }: SalesCrmShellProps) {
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

  return (
    <div className={`${tokens.salesCrmRoot} flex min-h-screen`}>
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapse} />
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/60" onClick={closeMobile} aria-hidden="true" />
          <div className="relative z-50">
            <Sidebar collapsed={false} onToggleCollapse={closeMobile} onNavItemClick={closeMobile} />
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <Topbar userName={userName} role={role} onToggleMobile={toggleMobile} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6" style={{ backgroundColor: 'var(--color-bg)' }}>
          <div style={{ maxWidth: 1400, margin: '0 auto' }}>{children}</div>
        </main>
      </div>
    </div>
  );
}
