'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, Plus, CheckCheck, RefreshCw } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';
import { useSocket } from '@/hooks/useSocket';
import toast from 'react-hot-toast';

const pageNames: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/tickets': 'Tickets',
  '/kanban': 'Kanban Board',
  '/projects': 'Projects',
  '/users': 'Users',
  '/departments': 'Departments',
  '/reports': 'Reports',
  '/leave': 'Leave Management',
};

export function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [showNotifs, setShowNotifs] = useState(false);
  // Defensive: role may be an object { name } or a plain string
  const roleName = (user?.role as any)?.name || (user?.role as any) || '';
  const isSuperAdmin = roleName === 'SUPER_ADMIN';

  const { data: unreadCount } = useQuery({
    queryKey: ['notifications-count'],
    queryFn: () => notificationsApi.getUnreadCount() as Promise<{ count: number }>,
    refetchInterval: 60000,
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
    <header className="bg-white border-b border-slate-200 h-14 flex items-center justify-between px-6 flex-shrink-0">
      <div className="flex items-center gap-3">
        <h1 className="font-semibold text-slate-800">{pageName}</h1>
        {user?.department && (
          <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">
            {user.department.name}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Switch Mode — only for SUPER_ADMIN */}
        {isSuperAdmin && (
          <button
            onClick={() => router.push('/select-mode')}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors"
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
            className="relative p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <Bell size={18} />
            {count > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {count > 9 ? '9+' : count}
              </span>
            )}
          </button>

          {showNotifs && (
            <div className="absolute right-0 top-10 w-80 bg-white border border-slate-200 rounded-xl shadow-lg z-50">
              <div className="p-3 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-semibold text-sm text-slate-800">Notifications</h3>
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
                    className="text-xs text-slate-400 hover:text-slate-600"
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {Array.isArray(notifications) && notifications.length > 0 ? (
                  notifications.map((n: any) => (
                    <div
                      key={n.id}
                      className={`p-3 border-b border-slate-50 last:border-0 flex gap-2.5 ${!n.isRead ? 'bg-blue-50' : ''}`}
                    >
                      {!n.isRead && (
                        <span className="mt-1.5 flex-shrink-0 w-2 h-2 rounded-full bg-blue-500" />
                      )}
                      <div className={!n.isRead ? '' : 'pl-4'}>
                        <p className="text-sm font-medium text-slate-800">{n.title}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{n.message}</p>
                        <p className="text-xs text-slate-400 mt-1">{formatRelativeTime(n.createdAt)}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                    <span className="text-3xl mb-2" role="img" aria-label="All caught up">✓</span>
                    <p className="text-sm font-semibold text-slate-700">You&apos;re all caught up</p>
                    <p className="text-xs text-slate-400 mt-0.5">No new notifications</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
