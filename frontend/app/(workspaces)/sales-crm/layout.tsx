'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth.store';
import { ShieldAlert } from 'lucide-react';
import SalesCrmShell from '@/components/sales-crm/shell/SalesCrmShell';

// Shared shell + auth gate for the entire /sales-crm route tree. This
// workspace is standalone (not under (dashboard)), so it must replicate the
// auth-redirect guard (dashboard)/layout.tsx normally provides — same
// pattern as the original standalone page.tsx, now applied once here so
// every route under /sales-crm (dashboard, leads, database, analytics,
// settings, deals, requirements-sourcing) is protected without repeating
// this logic in each page file.
export default function SalesCrmLayout({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, hasHydrated } = useAuthStore();
  const router = useRouter();

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

  return (
    <SalesCrmShell>
      {children}
    </SalesCrmShell>
  );
}
