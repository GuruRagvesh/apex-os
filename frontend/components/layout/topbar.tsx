'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, Plus, CheckCheck, RefreshCw, Search } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';
import { useSocket } from '@/hooks/useSocket';
import { CommandPalette } from '@/components/ui/command-palette';
import toast from 'react-hot-toast';

const pageNames: Record<string, string> = {
  '/dashboard': 'Home',
  '/tickets': 'Tickets',
  '/kanban': 'Kanban Board',
  '/projects': 'Projects',
  '/users': 'Users',
  '/departments': 'Departments',
  '/analytics': 'Analytics',
  '/leave': 'Leave Management',
  '/settings': 'Settings',
  '/profile': 'My Profile',
  '/team': 'Team',
};

export function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [showNotifs,   setShowNotifs]   = useState(false);
  const [paletteOpen,  setPaletteOpen]  = useState(false);
  // Defensive: role may be an object { name } or a plain string
  const roleName     = (user?.role as any)?.name || (user?.role as any) || '';
  const isSuperAdmin = roleName === 'SUPER_ADMIN';

  // Global keyboard shortcut: Ctrl+K / Cmd+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const { data: unreadCount } = useQuery({
    queryKey: ['notifications-count'],
    queryFn: () => notificationsApi.getUnreadCount() as Promise<{ count: number }>,
    refetchInterval: 30000,
  });

  const { data: notifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.getAll() as Promise<any[]>,
    enabled: showNotifs,
    refetchInterval: showNotifs ? 60000 : false,
  });

  const markAllRead = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications-count'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  // Real-time socket: bump count + toast when a new notification arrives
  useSocket({
    onNotificationNew: ({ notification }) => {
      qc.setQueryData(['notifications-count'], (old: any) => ({
        count: (old?.count ?? 0) + 1,
      }));
      // Prepend to the open panel list if it's visible
      qc.setQueryData(['notifications'], (old: any) =>
        Array.isArray(old) ? [{ ...notification, isRead: false }, ...old] : old,
      );
      toast(notification.title ?? 'New notification', {
        icon: '🔔',
        duration: 4000,
        style: { fontSize: '13px' },
      });
    },
    onLeaveStatusChanged: ({ status }) => {
      const word = status === 'APPROVED' ? 'approved ✓' : 'rejected';
      toast(`Leave request ${word}`, {
        icon: status === 'APPROVED' ? '✅' : '❌',
        duration: 5000,
      });
    },
  });

  const pageName = Object.entries(pageNames).find(([key]) => pathname.startsWith(key))?.[1] || 'Apex OS';
  const count = (unreadCount as any)?.count ?? 0;

  return (
    <>
    <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    <header className="bg-white dark:bg-gray-900 border-b border-slate-200 dark:border-gray-800 h-14 flex items-center justify-between px-6 flex-shrink-0">
      <div className="flex items-center gap-3">
        <h1 className="font-semibold text-slate-800 dark:text-white">{pageName}</h1>
        {user?.department && (
          <span className="text-xs px-2 py-0.5 bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-400 rounded-full">
            {user.department.name}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Global search trigger */}
        <button
          onClick={() => setPaletteOpen(true)}
          className="hidden sm:flex items-center gap-2 text-xs text-slate-400 dark:text-gray-500 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 hover:border-slate-300 dark:hover:border-gray-600 hover:text-slate-600 dark:hover:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors"
        >
          <Search size={13} />
          <span>Search…</span>
          <kbd className="hidden lg:inline font-mono text-[10px] bg-slate-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-slate-400 dark:text-gray-500">
            ⌘K
          </kbd>
        </button>

        {/* Switch Mode — only for SUPER_ADMIN */}
        {isSuperAdmin && (
          <button
            onClick={() => router.push('/select-mode')}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-800 hover:border-slate-300 dark:hover:border-gray-600 transition-colors"
            title="Switch between Super Admin and Team Lead mode"
          >
            <RefreshCw size={13} />
            Switch Mode
          </button>
        )}

        <Link
          href="/tickets/new"
          className="flex items-center gap-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition-colors"
        >
          <Plus size={14} />
          New Ticket
        </Link>

        {/* Notifications bell */}
        <div className="relative">
          <button
            onClick={() => setShowNotifs(!showNotifs)}
            className="relative p-2 text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <Bell size={18} />
            {count > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {count > 9 ? '9+' : count}
              </span>
            )}
          </button>

          {showNotifs && (
            <div className="absolute right-0 top-10 w-80 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-xl shadow-lg z-50">
              <div className="p-3 border-b border-slate-100 dark:border-gray-800 flex items-center justify-between">
                <h3 className="font-semibold text-sm text-slate-800 dark:text-white">Notifications</h3>
                <div className="flex items-center gap-2">
                  {count > 0 && (
                    <button
                      onClick={() => markAllRead.mutate()}
                      disabled={markAllRead.isPending}
                      className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40"
                      title="Mark all as read"
                    >
                      <CheckCheck size={13} />
                      Mark all read
                    </button>
                  )}
                  <button
                    onClick={() => setShowNotifs(false)}
                    className="text-xs text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300"
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {Array.isArray(notifications) && notifications.length > 0 ? (
                  notifications.map((n: any) => {
                    const href = n.entityType === 'TICKET' && n.entityId
                      ? `/tickets/${n.entityId}`
                      : n.entityType === 'PROJECT' && n.entityId
                      ? `/projects/${n.entityId}`
                      : n.entityType === 'LEAVE'
                      ? '/leave'
                      : n.link || null;

                    const handleClick = () => {
                      if (!n.isRead) {
                        notificationsApi.markRead(n.id).then(() => {
                          qc.invalidateQueries({ queryKey: ['notifications-count'] });
                          qc.invalidateQueries({ queryKey: ['notifications'] });
                        });
                      }
                      if (href) { router.push(href); setShowNotifs(false); }
                    };

                    return (
                      <div
                        key={n.id}
                        onClick={handleClick}
                        className={`p-3 border-b border-slate-50 dark:border-gray-800 last:border-0 flex gap-2.5 transition-colors ${!n.isRead ? 'bg-blue-50 dark:bg-blue-900/20' : ''} ${href ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-gray-800' : ''}`}
                      >
                        {!n.isRead && (
                          <span className="mt-1.5 flex-shrink-0 w-2 h-2 rounded-full bg-blue-500" />
                        )}
                        <div className={!n.isRead ? 'flex-1' : 'pl-4 flex-1'}>
                          <p className="text-sm font-medium text-slate-800 dark:text-gray-200">{n.title}</p>
                          <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">{n.message}</p>
                          <p className="text-xs text-slate-400 dark:text-gray-500 mt-1">{formatRelativeTime(n.createdAt)}</p>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                    <span className="text-3xl mb-2" role="img" aria-label="All caught up">✓</span>
                    <p className="text-sm font-semibold text-slate-700 dark:text-gray-300">You&apos;re all caught up</p>
                    <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">No new notifications</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
    </>
  );
}
