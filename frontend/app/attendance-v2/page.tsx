'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { UnifiedAttendanceCard } from '@/components/workday/UnifiedAttendanceCard';

// Phase 2A-2 — hidden route for the unified attendance card. Not linked from
// the sidebar, topbar, dock, or dashboard; reachable only by direct URL.
// Sits outside the (dashboard) route group, so it does not inherit that
// layout's Sidebar/TopBar/QuickActionDock — replicates only the auth guard
// from (dashboard)/layout.tsx (via the same existing auth store), since a
// page that calls an authenticated API still needs one.
export default function AttendanceV2Page() {
  const { isAuthenticated, hasHydrated } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (hasHydrated && !isAuthenticated) router.replace('/login');
  }, [hasHydrated, isAuthenticated, router]);

  if (!hasHydrated || !isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="apex-fade-in min-h-screen" style={{ backgroundColor: 'var(--bg-primary, #f8fafc)' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '48px 24px' }}>
        <p className="font-mono text-[10px] uppercase tracking-widest mb-3" style={{ color: 'var(--text-tertiary, #94a3b8)' }}>
          Attendance V2 — Preview
        </p>
        <div style={{ maxWidth: 640 }}>
          <UnifiedAttendanceCard />
        </div>
      </div>
    </div>
  );
}
