'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, Plus, CheckCheck, RefreshCw, Search, Loader2, User, Palette, SlidersHorizontal, Camera, LogOut, ChevronDown } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationsApi, workdayApi } from '@/lib/api';
import { formatRelativeTime } from '@apex/shared-utilities';
import { useSocket } from '@/hooks/useSocket';
import { CommandPalette } from '@/components/ui/command-palette';
import { UserAvatar } from '@apex/shared-ui/components/user-avatar';
import { downloadScreenshot } from '@apex/shared-utilities/download-screenshot';
import toast from 'react-hot-toast';

// /hrms and /sales-crm are standalone workspace pages (frontend/app/(workspaces)) —
// they no longer render inside the dashboard shell, so TopBar never mounts for them.
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
  const [showNotifs,      setShowNotifs]      = useState(false);
  const [paletteOpen,     setPaletteOpen]     = useState(false);
  const [showWorkdayMenu, setShowWorkdayMenu] = useState(false);
  const [showUserMenu,    setShowUserMenu]    = useState(false);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close user menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    if (showUserMenu) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showUserMenu]);

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
    refetchInterval: 15000,
  });

  const { data: workdayData } = useQuery({
    queryKey: ['workday-today'],
    queryFn: () => workdayApi.getToday() as Promise<any>,
    refetchInterval: 60000,
    staleTime: 30000,
    enabled: !!user,
  });
  const workStatus = (workdayData as any)?.session?.status ?? 'OFFLINE';

  const { data: notifRaw, isLoading: notifsLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.getAll() as Promise<any>,
    staleTime: 30000,
    refetchInterval: 60000,
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
  
  const { logout } = useAuthStore();

  const handleLogout = () => {
    if (['WORKING', 'ON_BREAK', 'IDLE'].includes(workStatus)) {
      const confirmLogout = window.confirm(
        "Logout closes your app session, but does not end your workday. Use 'End Day' to close attendance.\n\nAre you sure you want to log out anyway?"
      );
      if (!confirmLogout) return;
    }
    logout();
  };

  const handleScreenshot = async () => {
    setScreenshotLoading(true);
    setShowUserMenu(false);
    try {
      const segments = pathname.split('/').filter(Boolean);
      const page = segments[segments.length - 1] || 'dashboard';
      await downloadScreenshot(page);
      toast.success('Screenshot downloaded!');
    } catch {
      toast.error('Failed to capture screenshot');
    } finally {
      setScreenshotLoading(false);
    }
  };

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

  const count = (unreadCount as any)?.count ?? 0;

  return (
    <>
    <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    <header
      className="sticky top-0 z-30 h-14 px-6 flex items-center gap-4 flex-shrink-0"
      style={{
        backgroundColor: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-subtle)',
        backdropFilter: 'blur(12px)',
      }}
    >
      {/* Left: page name */}
      <div className="flex items-center gap-3 flex-1">
        <h1 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{pageName}</h1>
        {user?.department && (
          <span
            className="text-xs px-2 py-0.5 rounded-full hidden sm:inline"
            style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
          >
            {user.department.name}
          </span>
        )}
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2">
        {/* Global search trigger */}
        <button
          onClick={() => setPaletteOpen(true)}
          className="hidden sm:flex items-center gap-2 text-xs px-3 py-2 rounded-xl transition-colors"
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-primary)',
          }}
        >
          <Search size={13} />
          <span>Search…</span>
          <kbd
            className="hidden lg:inline font-mono text-[10px] px-1.5 py-0.5 rounded"
            style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-tertiary)', border: '1px solid var(--border-primary)' }}
          >
            Ctrl K
          </kbd>
        </button>

        {/* Switch Mode — only for SUPER_ADMIN */}
        {isSuperAdmin && (
          <button
            onClick={() => router.push('/select-mode')}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl transition-colors"
            style={{
              backgroundColor: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-primary)',
            }}
            title="Switch between Super Admin and Team Lead mode"
          >
            <RefreshCw size={13} />
            <span className="hidden sm:inline">Switch Mode</span>
          </button>
        )}

        {/* New Ticket */}
        <Link
          href="/tickets/new"
          className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl text-white transition-colors"
          style={{ backgroundColor: '#2563EB' }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1D4ED8')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#2563EB')}
        >
          <Plus size={14} />
          New Ticket
        </Link>

        {/* Workday status dot */}
        <div className="relative">
          <button
            onClick={() => setShowWorkdayMenu((v) => !v)}
            className="flex items-center gap-1.5 px-2 py-2 rounded-xl transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            title="Workday status"
          >
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: workStatusColor }}
            />
            <span className="hidden sm:inline text-xs" style={{ color: 'var(--text-secondary)' }}>
              {workStatusLabel}
            </span>
          </button>

          {showWorkdayMenu && (
            <div
              className="absolute right-0 top-10 w-52 rounded-xl z-50 p-3"
              style={{
                backgroundColor: 'var(--surface-elevated)',
                border: '1px solid var(--border-primary)',
                boxShadow: 'var(--shadow-lg)',
              }}
            >
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-tertiary)' }}>Workday</p>
              <p className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
                {workStatusLabel === 'Offline' ? 'Not started' : workStatusLabel}
              </p>
              <button
                onClick={() => { setShowWorkdayMenu(false); router.push('/dashboard'); }}
                className="w-full text-xs text-center hover:underline"
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
              className="absolute right-0 top-10 w-80 rounded-xl shadow-lg z-50"
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

        {/* User avatar + profile dropdown */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => { setShowUserMenu((v) => !v); setShowNotifs(false); setShowWorkdayMenu(false); }}
            className="flex items-center gap-2 px-2 py-1 rounded-xl transition-all"
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <UserAvatar name={user?.name ?? 'U'} avatar={user?.avatar} photoUrl={(user as any)?.photoUrl} size="sm" />
            <div className="hidden sm:block text-left">
              <p className="text-sm font-semibold max-w-[100px] truncate leading-none" style={{ color: 'var(--text-primary)' }}>
                {user?.name?.split(' ')[0]}
              </p>
              <p className="text-[10px] font-mono uppercase text-slate-400 mt-0.5 truncate leading-none">
                {roleName}
              </p>
            </div>
            <ChevronDown size={12} style={{ color: 'var(--text-tertiary)' }} />
          </button>

          {showUserMenu && (
            <div
              className="absolute right-0 top-11 w-56 z-50 rounded-xl overflow-hidden"
              style={{
                backgroundColor: 'var(--surface-elevated)',
                border: '1px solid var(--border-primary)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
              }}
            >
              {/* User info header */}
              <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{user?.name}</p>
                <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{user?.email}</p>
              </div>

              {/* Menu items */}
              <div className="p-1.5">
                {[
                  { icon: User, label: 'My Profile', href: '/settings?tab=profile' },
                  { icon: Palette, label: 'Appearance', href: '/settings?tab=appearance' },
                  { icon: SlidersHorizontal, label: 'Preferences', href: '/settings?tab=preferences' },
                ].map(({ icon: Icon, label, href }) => (
                  <button
                    key={href}
                    onClick={() => { router.push(href); setShowUserMenu(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left"
                    style={{ color: 'var(--text-secondary)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                ))}
              </div>

              <div className="p-1.5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button
                  onClick={handleScreenshot}
                  disabled={screenshotLoading}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left disabled:opacity-50"
                  style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  {screenshotLoading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                  {screenshotLoading ? 'Capturing…' : 'Download Screenshot'}
                </button>
              </div>

              <div className="p-1.5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button
                  onClick={() => { setShowUserMenu(false); handleLogout(); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left"
                  style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
                    e.currentTarget.style.color = 'var(--color-danger)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                  }}
                >
                  <LogOut size={14} />
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
    </>
  );
}
