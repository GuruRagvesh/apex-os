'use client';

// Adapted from intern source (src/components/layout/Topbar.tsx). Structure,
// state, and behavior are ported as-is (search, import/add-lead actions,
// notifications, profile dropdown, theme toggle). Adapted pieces only:
//   - useAuth() now comes from lib/sales-crm/auth-adapter.ts (Apex real
//     auth), not intern's mock lib/auth.ts
//   - useTheme() now comes from lib/sales-crm/theme.tsx (CRM-local, scoped
//     theme), not intern's document.documentElement-writing version
//   - every route is prefixed with /sales-crm, and the bare /sales-crm
//     landing route is treated as the Dashboard page everywhere intern
//     checked pathname === "/dashboard"
//   - logout redirects to /login, which is Apex's real login page (the one
//     explicitly-allowed root link per the containment rules)
//   - a "Phase 1 · Local data" badge next to the page title

import { useState, useRef, useEffect } from 'react';
import { useAuth, ROLE_LABELS, Role, logAction, canImport } from '@apex/sales-crm-shared';
import { useTheme } from '@/lib/sales-crm/theme';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { filterLeadsFromDashboard } from '@/lib/sales-crm/dashboard-calculations';
import shell from '@/styles/sales-crm/shell.module.css';
import ui from '@apex/sales-crm-shared/styles/primitives.module.css';
import {
  type LucideIcon,
  Search,
  BarChart3,
  Import,
  Plus,
  Sun,
  Moon,
  Menu,
  LayoutDashboard,
  Target,
  ClipboardList,
  Handshake,
  Database,
  Settings,
  Bell,
  User,
  MapPin,
  LogOut,
} from 'lucide-react';

const PAGE_ICONS: Record<string, LucideIcon> = {
  '/sales-crm/dashboard': LayoutDashboard,
  '/sales-crm/analytics': BarChart3,
  '/sales-crm/leads': Target,
  '/sales-crm/requirements-sourcing': ClipboardList,
  '/sales-crm/deals': Handshake,
  '/sales-crm/database': Database,
  '/sales-crm/settings': Settings,
};

const PAGE_LABELS: Record<string, string> = {
  '/sales-crm/dashboard': 'Dashboard',
  '/sales-crm/analytics': 'Analytics',
  '/sales-crm/leads': 'Leads',
  '/sales-crm/requirements-sourcing': 'Requirements & Sourcing',
  '/sales-crm/deals': 'Deals',
  '/sales-crm/database': 'Database',
  '/sales-crm/settings': 'Settings',
};

interface TopbarProps {
  onToggleMobile: () => void;
}

export default function Topbar({ onToggleMobile }: TopbarProps) {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isDashboardPath = pathname === '/sales-crm' || pathname === '/sales-crm/dashboard';
  const showAddLead = pathname.startsWith('/sales-crm/leads');
  const showImport = isDashboardPath || showAddLead || pathname.startsWith('/sales-crm/database');

  const [searchQuery, setSearchQuery] = useState('');
  const [uiMessage, setUiMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);

  // Mock notifications state
  const [notifications, setNotifications] = useState([
    { id: 1, type: 'Lead', text: 'New lead assigned', read: false },
    { id: 2, type: 'System', text: 'Maintenance at 10 PM', read: true },
  ]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setIsNotificationsOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsProfileOpen(false);
        setIsNotificationsOpen(false);
      }
    }
    if (isProfileOpen || isNotificationsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isProfileOpen, isNotificationsOpen]);

  // Find current page info
  const pageKey = isDashboardPath
    ? '/sales-crm/dashboard'
    : Object.keys(PAGE_LABELS).find((key) => pathname === key || pathname.startsWith(`${key}/`));
  const PageIcon = pageKey ? PAGE_ICONS[pageKey] : LayoutDashboard;
  const pageLabel = pageKey ? PAGE_LABELS[pageKey] : 'Dashboard';

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    // Only trigger search on pages that support it
    if (pathname.startsWith('/sales-crm/leads')) {
      const params = new URLSearchParams(searchParams?.toString() || '');
      params.set('search', searchQuery);
      router.push(`/sales-crm/leads?${params.toString()}`);
    } else if (isDashboardPath) {
      filterLeadsFromDashboard('search', searchQuery);
    }
    // Other pages: no-op (search not wired yet)
  };

  const handleImportClick = () => {
    if (!user) return;
    const userRole = user.role as Role;

    if (!canImport(userRole)) {
      setUiMessage('You do not have permission to import data.');
      return;
    }

    if (pathname.startsWith('/sales-crm/database')) {
      window.dispatchEvent(new Event('salescrm:open-database-import'));
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setUiMessage(`File selected: ${e.target.files[0].name}. Upload functionality coming soon.`);
    }
    e.target.value = '';
  };

  const markNotificationsRead = () => {
    setNotifications(notifications.map((n) => ({ ...n, read: true })));
    if (user) {
      logAction({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: 'update',
        collection: 'System',
        details: 'Marked all notifications as read.',
      });
    }
  };

  const getSearchPlaceholder = () => {
    if (isDashboardPath) return 'Search leads, deals, companies...';
    if (pathname.startsWith('/sales-crm/analytics')) return 'Search analytics reports...';
    if (pathname.startsWith('/sales-crm/leads')) return 'Search leads, companies, contacts...';
    if (pathname.startsWith('/sales-crm/requirements-sourcing')) return 'Search requirements...';
    if (pathname.startsWith('/sales-crm/deals')) return 'Search deals, companies...';
    if (pathname.startsWith('/sales-crm/database')) return 'Search database records...';
    if (pathname.startsWith('/sales-crm/settings')) return 'Search settings...';
    return 'Search...';
  };

  if (!user) return null;

  return (
    <header className={shell.topbar}>
      {/* Mobile hamburger */}
      <button className={shell['topbar-hamburger']} onClick={onToggleMobile} aria-label="Toggle menu">
        <Menu size={22} />
      </button>

      {/* Page Title */}
      <div className={shell['topbar-left']}>
        <h1 className={shell['topbar-page-title']}>
          {PageIcon && (
            <span className={shell['topbar-page-icon']}>
              <PageIcon size={20} />
            </span>
          )}
          {pageLabel}
        </h1>
        <span className={`${ui['ui-badge']} ${ui['ui-badge-primary']}`}>Phase 1 · Local data</span>
      </div>

      {/* Search */}
      <div className={shell['topbar-search']}>
        <form onSubmit={handleSearch} className={ui['ui-search-wrapper']}>
          <Search size={16} className={ui['ui-search-icon']} />
          <input
            type="text"
            placeholder={getSearchPlaceholder()}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={ui['ui-search-input']}
          />
        </form>
      </div>

      {/* Right section */}
      <div className={shell['topbar-right']}>
        {/* Actions */}
        {(showAddLead || showImport) && (
          <div className={shell['topbar-actions']}>
            <input type="file" ref={fileInputRef} className="hidden" accept=".csv, .xlsx, .xls" onChange={handleFileChange} />
            {showImport && (
              <button className={`${ui['ui-btn']} ${ui['ui-btn-secondary']} ${ui['ui-btn-sm']}`} onClick={handleImportClick}>
                <Import size={16} />
                <span className="hidden lg:inline">Import</span>
              </button>
            )}
            {showAddLead && (
              <button
                className={`${ui['ui-btn']} ${ui['ui-btn-primary']} ${ui['ui-btn-sm']}`}
                onClick={() => router.push('/sales-crm/leads?action=add')}
              >
                <Plus size={16} />
                <span className="hidden lg:inline">Add Lead</span>
              </button>
            )}
          </div>
        )}

        <button
          className={shell['topbar-theme-toggle']}
          aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
          title={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
        >
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>

        <div ref={notificationsRef} style={{ position: 'relative' }}>
          <button
            className={shell['topbar-theme-toggle']}
            aria-label="Notifications"
            title="Notifications"
            onClick={() => {
              setIsNotificationsOpen(!isNotificationsOpen);
              setIsProfileOpen(false);
            }}
          >
            <Bell size={18} />
            {notifications.some((n) => !n.read) && (
              <span
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 6,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--color-danger)',
                }}
              />
            )}
          </button>

          {isNotificationsOpen && (
            <div
              className={ui['ui-card']}
              style={{ position: 'absolute', right: 0, top: '110%', width: 300, zIndex: 60 }}
            >
              <div className={ui['ui-card-header']}>
                <span className={ui['ui-card-title']}>Notifications</span>
                {notifications.some((n) => !n.read) && (
                  <button onClick={markNotificationsRead} className={`${ui['ui-btn']} ${ui['ui-btn-ghost']} ${ui['ui-btn-sm']}`}>
                    Mark all read
                  </button>
                )}
              </div>
              <div className={ui['ui-card-body']} style={{ maxHeight: 260, overflowY: 'auto' }}>
                {notifications.length === 0 ? (
                  <p className={ui['ui-empty-desc']}>No notifications.</p>
                ) : (
                  notifications.map((n) => (
                    <div key={n.id} style={{ display: 'flex', gap: 8, padding: '8px 0' }}>
                      <div
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          marginTop: 6,
                          flexShrink: 0,
                          background: n.read ? 'var(--color-border-strong)' : 'var(--color-primary)',
                        }}
                      />
                      <div>
                        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-muted)' }}>{n.type}</div>
                        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>{n.text}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Info / Profile Dropdown */}
        <div ref={profileRef} style={{ position: 'relative' }}>
          <button
            className={shell['topbar-user-info']}
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
            onClick={() => {
              setIsProfileOpen(!isProfileOpen);
              setIsNotificationsOpen(false);
            }}
          >
            <div className={shell['topbar-user-avatar']} style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>
              {user.name.charAt(0)}
            </div>
            <div className={shell['topbar-user-details']}>
              <span className={shell['topbar-user-name']}>{user.name}</span>
              <span className={shell['topbar-user-role']} style={{ background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>
                {ROLE_LABELS[user.role as Role]}
              </span>
            </div>
          </button>

          {isProfileOpen && (
            <div className={ui['ui-card']} style={{ position: 'absolute', right: 0, top: '110%', width: 260, zIndex: 60 }}>
              <div className={ui['ui-card-body']} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <p style={{ fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>{user.name}</p>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0 }}>{user.email}</p>
              </div>

              <div style={{ borderTop: '1px solid var(--color-border)', padding: 'var(--space-2)' }}>
                <button className={`${ui['ui-btn']} ${ui['ui-btn-ghost']} ${ui['ui-btn-sm']}`} style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => setIsProfileOpen(false)}>
                  <User size={16} /> My Profile
                </button>

                <button
                  className={`${ui['ui-btn']} ${ui['ui-btn-ghost']} ${ui['ui-btn-sm']}`}
                  style={{ width: '100%', justifyContent: 'flex-start' }}
                  onClick={() => {
                    setUiMessage('Location feature coming soon.');
                    setIsProfileOpen(false);
                  }}
                >
                  <MapPin size={16} /> Location
                </button>

                <button
                  className={`${ui['ui-btn']} ${ui['ui-btn-ghost']} ${ui['ui-btn-sm']}`}
                  style={{ width: '100%', justifyContent: 'flex-start' }}
                  onClick={() => {
                    setIsProfileOpen(false);
                    if (isDashboardPath) {
                      window.dispatchEvent(new Event('salescrm:refresh-dashboard'));
                      logAction({ userId: user.id, userName: user.name, userRole: user.role, action: 'update', collection: 'System', details: 'Refreshed dashboard from My Dashboards.' });
                    } else {
                      router.push('/sales-crm/dashboard');
                      logAction({ userId: user.id, userName: user.name, userRole: user.role, action: 'update', collection: 'System', details: 'Opened dashboard from My Dashboards.' });
                    }
                  }}
                >
                  <LayoutDashboard size={16} /> My Dashboards
                </button>

                <button
                  className={`${ui['ui-btn']} ${ui['ui-btn-ghost']} ${ui['ui-btn-sm']}`}
                  style={{ width: '100%', justifyContent: 'flex-start' }}
                  onClick={() => {
                    router.push('/sales-crm/settings');
                    setIsProfileOpen(false);
                  }}
                >
                  <Settings size={16} /> Settings
                </button>

                <button
                  className={`${ui['ui-btn']} ${ui['ui-btn-ghost']} ${ui['ui-btn-sm']}`}
                  style={{ width: '100%', justifyContent: 'flex-start', color: 'var(--color-danger)' }}
                  onClick={() => {
                    logout();
                    router.replace('/login');
                  }}
                >
                  <LogOut size={16} /> Log out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* UI Message Modal */}
      {uiMessage && (
        <div className={ui['ui-modal-overlay']} onClick={() => setUiMessage(null)}>
          <div className={ui['ui-modal']} onClick={(e) => e.stopPropagation()}>
            <div className={ui['ui-modal-body']}>
              <h3 className={ui['ui-modal-title']}>Notice</h3>
              <p style={{ marginTop: 8, color: 'var(--color-text-secondary)' }}>{uiMessage}</p>
            </div>
            <div className={ui['ui-modal-footer']}>
              <button className={`${ui['ui-btn']} ${ui['ui-btn-primary']}`} onClick={() => setUiMessage(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
