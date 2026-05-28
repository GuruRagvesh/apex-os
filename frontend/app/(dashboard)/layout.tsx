'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { Sidebar } from '@/components/layout/sidebar';
import { TopBar } from '@/components/layout/topbar';
import { ColdStartBanner } from '@/components/ui/cold-start-banner';
import { QuickActionDock } from '@/components/ui/QuickActionDock';
import { QuickActionPalette } from '@/components/ui/QuickActionPalette';
import {
  Ticket, CalendarDays, AlertTriangle, FolderKanban,
  Calendar, Activity, LogIn,
} from 'lucide-react';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuthStore();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const roleName = (user?.role as any)?.name ?? user?.role ?? '';
  const isLeadOrAbove = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleName);
  const isManagerOrAbove = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleName);

  useEffect(() => {
    if (!isAuthenticated) router.replace('/login');
  }, [isAuthenticated, router]);

  // Alt+K shortcut for Quick Action Palette (Ctrl+K is taken by CommandPalette in TopBar)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  const paletteActions = [
    {
      id: 'new-ticket',
      label: 'Create New Ticket',
      description: 'Open a new support or task ticket',
      icon: <Ticket size={15} />,
      shortcut: 'N',
      category: 'tickets',
      onClick: () => router.push('/tickets/new'),
    },
    {
      id: 'due-today',
      label: 'View Due Today',
      description: 'Tickets due today in your scope',
      icon: <CalendarDays size={15} />,
      shortcut: 'D',
      category: 'tickets',
      onClick: () => router.push('/tickets?filter=due-today'),
    },
    {
      id: 'high-priority',
      label: isLeadOrAbove ? 'High Priority Tickets' : 'My High Priority Tickets',
      description: isLeadOrAbove ? 'View high priority items in your scope' : 'View your high priority work',
      icon: <AlertTriangle size={15} />,
      category: 'tickets',
      onClick: () => router.push('/tickets?priority=HIGH'),
    },
    isLeadOrAbove
      ? {
        id: 'leave-review',
        label: 'Review Leave Requests',
        description: 'Leave requests and approvals in your scope',
        icon: <CalendarDays size={15} />,
        shortcut: 'L',
        category: 'hr',
        onClick: () => router.push('/leave'),
      }
      : {
        id: 'leave-self',
        label: 'Apply or View Leave',
        description: 'Open your own leave requests',
        icon: <CalendarDays size={15} />,
        shortcut: 'L',
        category: 'hr',
        onClick: () => router.push('/leave'),
      },
    {
      id: 'projects',
      label: 'Open Projects',
      description: 'View projects available to your role',
      icon: <FolderKanban size={15} />,
      shortcut: 'P',
      category: 'projects',
      onClick: () => router.push('/projects'),
    },
    ...(isLeadOrAbove ? [{
      id: 'team',
      label: 'Check Team Availability',
      description: 'Open roster and live team status',
      icon: <Activity size={15} />,
      category: 'team',
      onClick: () => router.push('/team'),
    }] : []),
    ...(isLeadOrAbove ? [{
      id: 'activity',
      label: isManagerOrAbove ? 'Activity Log' : 'Team Activity Log',
      description: 'View scoped operational activity',
      icon: <Activity size={15} />,
      category: 'workday',
      onClick: () => router.push('/admin/activity'),
    }] : []),
    {
      id: 'calendar',
      label: 'Calendar',
      description: isLeadOrAbove ? 'Open your scoped operations calendar' : 'Open your work calendar',
      icon: <Calendar size={15} />,
      shortcut: 'C',
      category: 'planning',
      onClick: () => router.push('/calendar'),
    },
    {
      id: 'login',
      label: 'Start Workday',
      description: 'Log in to start your working session',
      icon: <LogIn size={15} />,
      category: 'workday',
      onClick: () => router.push('/dashboard'),
    },
  ];

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />
        <main id="apex-main-content" className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
      <ColdStartBanner />
      {/* Existing FAB dock — kept as-is (Alt+Q) */}
      <QuickActionDock />
      {/* New command palette — Alt+K */}
      <QuickActionPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={paletteActions}
      />
    </div>
  );
}
