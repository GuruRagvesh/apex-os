'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Menu, Bell, CheckCheck, Search, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationsApi, workdayApi } from '@/lib/api';
import { formatRelativeTime } from '@apex/shared-utilities';
import { useSocket } from '@/hooks/useSocket';
import { CommandPalette } from '@apex/apps-web/components/command-palette';
import toast from 'react-hot-toast';
import { pollWhileHealthy } from '@apex/shared-auth';

// /hrms and /sales-crm are standalone workspace pages (frontend/app/(workspaces)) —
// they no longer render inside the dashboard shell, so TopBar never mounts for them.
export function TopBar({ onOpenMenu, menuOpen = false }: { onOpenMenu?: () => void; menuOpen?: boolean } = {}) {
  const router = useRouter();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [showNotifs,      setShowNotifs]      = useState(false);
  const [paletteOpen,     setPaletteOpen]     = useState(false);
  const [showWorkdayMenu, setShowWorkdayMenu] = useState(false);
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
    refetchInterval: pollWhileHealthy(15000),
  });

  const { data: workdayData } = useQuery({
    queryKey: ['workday-today'],
    queryFn: () => workdayApi.getToday() as Promise<any>,
    refetchInterval: pollWhileHealthy(60000),
    staleTime: 30000,
    enabled: !!user,
  });
  const workStatus = (workdayData as any)?.session?.status ?? 'OFFLINE';

  const { data: notifRaw, isLoading: notifsLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.getAll() as Promise<any>,
    staleTime: 30000,
    refetchInterval: pollWhileHealthy(60000),
  });
  // Backend may return array directly OR { notifications: [...], total }
  const notifications: any[] = Array.isArray(notifRaw)
    ? notifRaw
    : (notifRaw as any)?.notifications ?? (notifRaw as any)?.data?.notifications ?? [];

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
      if (notification.entityType === 'announcement') {
        // Reuse the one existing app socket instead of polling a second live
        // channel. The lightweight feed opens the full-screen notice, while
        // the dashboard ticker refreshes from the same event.
        void qc.invalidateQueries({ queryKey: ['current-announcements'] });
        void qc.invalidateQueries({ queryKey: ['home-carousel'] });
      }
    },
    onLeaveStatusChanged: ({ status }) => {
      const word = status === 'APPROVED' ? 'approved ✓' : 'rejected';
      toast(`Leave request ${word}`, {
        icon: status === 'APPROVED' ? '✅' : '❌',
        duration: 5000,
      });
    },
  });

  const count = (unreadCount as any)?.count ?? 0;

  const workStatusColor =
    workStatus === 'WORKING' ? '#10B981' :
    workStatus === 'ON_BREAK' ? '#F97316' :
    workStatus === 'IDLE' ? '#FBBF24' :
    workStatus === 'ON_LEAVE' ? '#3B82F6' :
    '#94A3B8';

  const workStatusLabel =
    workStatus === 'WORKING' ? 'Working' :
    workStatus === 'ON_BREAK' ? 'On Break' :
    workStatus === 'IDLE' ? 'Idle' :
    workStatus === 'ON_LEAVE' ? 'On Leave' :
    workStatus === 'LOGGED_OUT' ? 'Ended' : 'Offline';

  const desktopSearchTrigger = (
    <button
      onClick={() => setPaletteOpen(true)}
      className="hidden sm:flex w-full max-w-xl items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs transition-colors"
      style={{
        backgroundColor: 'var(--bg-tertiary)',
        color: 'var(--text-secondary)',
        border: '1px solid var(--border-primary)',
      }}
    >
      <span className="flex items-center gap-2">
        <Search size={13} />
        <span>Search…</span>
      </span>
    </button>
  );

  return (
    <>
    <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    <header
      className="sticky top-0 z-30 flex h-16 flex-shrink-0 items-center gap-3 px-3 sm:px-6"
      style={{
        backgroundColor: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-subtle)',
        backdropFilter: 'blur(12px)',
      }}
    >
      {/* Phone menu button: opens the navigation drawer below 768px. */}
      {onOpenMenu && (
        <button
          type="button"
          onClick={onOpenMenu}
          className="md:hidden p-2 -ml-1 rounded-xl flex-shrink-0"
          style={{ color: 'var(--text-primary)' }}
          aria-label="Open navigation menu"
          aria-controls="apex-sidebar"
          aria-expanded={menuOpen}
          data-apex-menu-button
        >
          <Menu size={20} />
        </button>
      )}

      <Link
        href="/dashboard"
        className="flex flex-shrink-0 items-center gap-2.5 rounded-xl transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{ outlineColor: 'var(--accent)' }}
        title="TechnoEdge Learning Services"
        aria-label="Go to dashboard"
      >
        <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl">
          <Image src="/brand/technoedge-logo.png" alt="TechnoEdge" width={56} height={56} className="h-full w-full object-contain" priority />
        </span>
        <span className="hidden min-w-0 max-w-[13rem] xl:block">
          <span className="block truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>TechnoEdge Learning Services</span>
        </span>
      </Link>

      {/* The command bar keeps global search in the visual centre on every page. */}
      <div className="flex min-w-0 flex-1 justify-center">
        {desktopSearchTrigger}
      </div>

      {/* Right: immediate work actions. Personal account controls live in the sidebar. */}
      <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
        {/* Global search on phones (the labelled trigger below is hidden there) */}
        <button
          onClick={() => setPaletteOpen(true)}
          className="sm:hidden p-2 rounded-xl"
          style={{ color: 'var(--text-secondary)' }}
          aria-label="Search"
        >
          <Search size={16} />
        </button>
        {/* Keep the compact workday state in the header; detailed attendance remains on Home. */}
        <div className="relative">
          <button
            onClick={() => setShowWorkdayMenu((value) => !value)}
            className="flex items-center gap-1.5 rounded-xl px-2 py-2 transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(event) => (event.currentTarget.style.backgroundColor = 'var(--bg-tertiary)')}
            onMouseLeave={(event) => (event.currentTarget.style.backgroundColor = 'transparent')}
            title="Workday status"
          >
            <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: workStatusColor }} />
            <span className="hidden text-xs sm:inline" style={{ color: 'var(--text-primary)' }}>{workStatusLabel}</span>
          </button>

          {showWorkdayMenu && (
            <div
              className="absolute right-0 top-10 z-50 w-52 rounded-xl p-3"
              style={{ backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border-primary)', boxShadow: 'var(--shadow-lg)' }}
            >
              <p className="mb-2 text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>Workday</p>
              <p className="mb-3 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {workStatusLabel === 'Offline' ? 'Not started' : workStatusLabel}
              </p>
              <button
                onClick={() => { setShowWorkdayMenu(false); router.push('/dashboard'); }}
                className="w-full text-center text-xs hover:underline"
                style={{ color: 'var(--accent)' }}
              >
                Go to Home
              </button>
            </div>
          )}
        </div>

        {/* Notifications bell */}
        <div className="relative">
          <button
            onClick={() => setShowNotifs(!showNotifs)}
            className="relative p-2 rounded-xl transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <Bell size={18} />
            {count > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {count > 9 ? '9+' : count}
              </span>
            )}
          </button>

          {showNotifs && (
            <div
              className="absolute right-0 top-10 w-80 max-w-[calc(100vw-1.5rem)] rounded-xl shadow-lg z-50"
              style={{
                backgroundColor: 'var(--surface-elevated)',
                border: '1px solid var(--border-primary)',
              }}
            >
              <div
                className="p-3 flex items-center justify-between"
                style={{ borderBottom: '1px solid var(--border-subtle)' }}
              >
                <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Notifications</h3>
                <div className="flex items-center gap-2">
                  {count > 0 && (
                    <button
                      onClick={() => markAllRead.mutate()}
                      disabled={markAllRead.isPending}
                      className="flex items-center gap-1 text-xs disabled:opacity-40 hover:underline"
                      style={{ color: 'var(--accent)' }}
                      title="Mark all as read"
                    >
                      <CheckCheck size={13} />
                      Mark all read
                    </button>
                  )}
                  <button
                    onClick={() => setShowNotifs(false)}
                    className="text-xs hover:opacity-70"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {notifsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 size={18} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
                  </div>
                ) : notifications.length > 0 ? (
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
                        className="flex gap-2.5 transition-colors"
                        style={{
                          padding: '0.75rem',
                          borderBottom: '1px solid var(--border-subtle)',
                          backgroundColor: !n.isRead ? 'var(--accent-subtle)' : 'transparent',
                          cursor: href ? 'pointer' : 'default',
                        }}
                        onMouseEnter={(e) => { if (href) e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = !n.isRead ? 'var(--accent-subtle)' : 'transparent'; }}
                      >
                        {!n.isRead && (
                          <span className="mt-1.5 flex-shrink-0 w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
                        )}
                        <div className={!n.isRead ? 'flex-1' : 'pl-4 flex-1'}>
                          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{n.title}</p>
                          <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{n.message}</p>
                          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{formatRelativeTime(n.createdAt)}</p>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="apex-empty" style={{ padding: '2rem 1rem' }}>
                    <div className="apex-empty-icon" style={{ width: '40px', height: '40px', fontSize: '20px' }}>✓</div>
                    <p className="apex-empty-title">You&apos;re all caught up</p>
                    <p className="apex-empty-desc">No new notifications</p>
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
