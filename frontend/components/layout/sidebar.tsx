'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Ticket, Kanban, FolderKanban, CalendarOff,
  Users, Building2, BarChart3, LogOut, ChevronRight, Zap, Settings,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

// ── Skeleton shown before Zustand hydrates ────────────────────────────────────
function SidebarSkeleton() {
  return (
    <aside className="w-64 bg-white dark:bg-gray-900 border-r border-slate-200 dark:border-gray-800 flex flex-col shadow-sm">
      {/* Logo */}
      <div className="p-5 border-b border-slate-100 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #1e40af 0%, #4f46e5 100%)' }}
          />
          <div className="space-y-1.5">
            <div className="h-3.5 w-16 bg-slate-200 dark:bg-gray-700 rounded animate-pulse" />
            <div className="h-2.5 w-20 bg-slate-100 dark:bg-gray-800 rounded animate-pulse" />
          </div>
        </div>
      </div>
      {/* Nav bars */}
      <nav className="flex-1 p-3 space-y-2">
        <div className="h-2.5 w-10 bg-slate-100 dark:bg-gray-800 rounded mx-3 mb-3 animate-pulse" />
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-9 rounded-lg bg-slate-100 dark:bg-gray-800 animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
        ))}
      </nav>
      {/* Bottom user area */}
      <div className="p-3 border-t border-slate-100 dark:border-gray-800">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-gray-800">
          <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-gray-700 animate-pulse flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-24 bg-slate-200 dark:bg-gray-700 rounded animate-pulse" />
            <div className="h-2.5 w-16 bg-slate-100 dark:bg-gray-800 rounded animate-pulse" />
          </div>
        </div>
      </div>
    </aside>
  );
}

// ── Nav definitions ───────────────────────────────────────────────────────────
const BASE_NAV = [
  { href: '/dashboard', label: 'Home',          icon: LayoutDashboard },
  { href: '/tickets',   label: 'Tickets',      icon: Ticket          },
  { href: '/kanban',    label: 'Kanban Board',  icon: Kanban          },
  { href: '/projects',  label: 'Projects',      icon: FolderKanban    },
  { href: '/leave',     label: 'Leave',          icon: CalendarOff     },
];

const TEAMLEAD_NAV  = [{ href: '/team',    label: 'Team',          icon: Users    }];
const MANAGER_NAV   = [{ href: '/analytics', label: 'Analytics',    icon: BarChart3 }];
const ADMIN_NAV     = [
  { href: '/users',       label: 'Users & Roles',  icon: Users     },
  { href: '/departments', label: 'Departments',     icon: Building2 },
];

const SETTINGS_NAV  = [{ href: '/settings', label: 'Settings',      icon: Settings  }];

// Streamlined nav for SUPER_ADMIN in team_lead mode
const TEAMLEAD_MODE_NAV = [
  { href: '/dashboard', label: 'Home',          icon: LayoutDashboard },
  { href: '/tickets',   label: 'My Team Tasks', icon: Ticket        },
  { href: '/kanban',    label: 'Kanban Board',  icon: Kanban        },
  { href: '/projects',  label: 'Projects',      icon: FolderKanban  },
  { href: '/leave',     label: 'Leave',          icon: CalendarOff   },
];

const ROLE_BADGE_COLOR: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-100 text-purple-700',
  ADMIN:       'bg-red-100    text-red-700',
  MANAGER:     'bg-amber-100  text-amber-700',
  TEAM_LEAD:   'bg-blue-100   text-blue-700',
  EMPLOYEE:    'bg-green-100  text-green-700',
  INTERN:      'bg-teal-100   text-teal-700',
};

const ACCENT         = 'bg-indigo-50 dark:bg-gray-800 text-indigo-700 dark:text-indigo-400';
const ACCENT_ICON    = 'text-indigo-600 dark:text-indigo-400';
const ACCENT_CHEVRON = 'text-indigo-400 dark:text-indigo-500';

function getInitials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
export function Sidebar() {
  const pathname            = usePathname();
  const router              = useRouter();
  const { user, logout, hasHydrated } = useAuthStore();
  const [apexMode, setApexMode]       = useState<string>('super_admin');

  useEffect(() => {
    setApexMode(localStorage.getItem('apexMode') ?? 'super_admin');
  }, [pathname]);

  // Show skeleton until Zustand has rehydrated from localStorage
  if (!hasHydrated) return <SidebarSkeleton />;

  const role        = (user?.role as any)?.name ?? (typeof user?.role === 'string' ? user.role : '');
  const isSuperAdmin = role === 'SUPER_ADMIN';
  const isAdmin      = role === 'ADMIN' || isSuperAdmin;
  const isManager    = role === 'MANAGER' || isAdmin;
  const isTeamLead   = role === 'TEAM_LEAD' || isManager;

  // Nav items based on role / mode
  const mainNav = isSuperAdmin && apexMode === 'team_lead' ? TEAMLEAD_MODE_NAV : BASE_NAV;
  const showTeam      = isTeamLead && !(isSuperAdmin && apexMode === 'team_lead');
  const showReports   = isManager  && !(isSuperAdmin && apexMode === 'team_lead');
  const showAdminSect = isAdmin    && !(isSuperAdmin && apexMode === 'team_lead');

  function NavItem({ href, label, icon: Icon }: { href: string; label: string; icon: any }) {
    const active = pathname === href || pathname.startsWith(href + '/');
    return (
      <Link
        href={href}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group',
          active ? ACCENT : 'text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-800 hover:text-slate-900 dark:hover:text-white',
        )}
      >
        <Icon size={18} className={active ? ACCENT_ICON : 'text-slate-400 dark:text-gray-500 group-hover:text-slate-600 dark:group-hover:text-gray-300'} />
        {label}
        {active && <ChevronRight size={14} className={cn('ml-auto', ACCENT_CHEVRON)} />}
      </Link>
    );
  }

  return (
    <aside className="w-64 bg-white dark:bg-gray-900 border-r border-slate-200 dark:border-gray-800 flex flex-col shadow-sm">
      {/* Logo */}
      <div className="p-5 border-b border-slate-100 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #1e40af 0%, #4f46e5 100%)' }}
          >
            <span className="text-white font-bold text-lg">A</span>
          </div>
          <div>
            <p className="font-bold text-slate-800 dark:text-white text-base leading-none">Apex</p>
            <p className="text-[10px] text-slate-400 dark:text-gray-500 mt-0.5 font-medium tracking-wide uppercase">TechnoEdge</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        <p className="text-xs font-semibold text-slate-400 dark:text-gray-600 uppercase tracking-wider px-3 py-2">Main</p>

        {mainNav.map((item) => <NavItem key={item.href} {...item} />)}

        {/* Team — team leads and above */}
        {showTeam && (
          <>
            <p className="text-xs font-semibold text-slate-400 dark:text-gray-600 uppercase tracking-wider px-3 py-2 mt-3">Team</p>
            {TEAMLEAD_NAV.map((item) => <NavItem key={item.href} {...item} />)}
          </>
        )}

        {/* Reports — managers and above */}
        {showReports && (
          <>
            <p className="text-xs font-semibold text-slate-400 dark:text-gray-600 uppercase tracking-wider px-3 py-2 mt-3">Analytics</p>
            {MANAGER_NAV.map((item) => <NavItem key={item.href} {...item} />)}
          </>
        )}

        {/* Admin section */}
        {showAdminSect && (
          <>
            <p className="text-xs font-semibold text-slate-400 dark:text-gray-600 uppercase tracking-wider px-3 py-2 mt-3">Admin</p>
            {ADMIN_NAV.map((item) => <NavItem key={item.href} {...item} />)}
          </>
        )}

        {/* Settings — everyone */}
        <div className="mt-3 border-t border-slate-100 dark:border-gray-800 pt-2">
          {SETTINGS_NAV.map((item) => <NavItem key={item.href} {...item} />)}
        </div>
      </nav>

      {/* Mode badge (SUPER_ADMIN only) */}
      {isSuperAdmin && (
        <div className="mx-3 mb-2">
          {apexMode === 'super_admin' ? (
            <div
              className="px-3 py-1.5 rounded-lg flex items-center gap-2 text-xs font-semibold"
              style={{
                background: 'linear-gradient(135deg,rgba(88,28,135,0.12) 0%,rgba(109,40,217,0.08) 100%)',
                border: '1px solid rgba(139,92,246,0.25)',
              }}
            >
              <Zap size={12} className="text-purple-500" />
              <span className="text-purple-700">Super Admin</span>
            </div>
          ) : (
            <div
              className="px-3 py-1.5 rounded-lg flex items-center gap-2 text-xs font-semibold"
              style={{
                background: 'linear-gradient(135deg,rgba(30,64,175,0.12) 0%,rgba(79,70,229,0.08) 100%)',
                border: '1px solid rgba(96,165,250,0.25)',
              }}
            >
              <Users size={12} className="text-blue-500" />
              <span className="text-blue-700">AI & R&D Lead</span>
            </div>
          )}
        </div>
      )}

      {/* User profile card */}
      <div className="p-3 border-t border-slate-100 dark:border-gray-800">
        <div
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-gray-800 cursor-pointer hover:bg-slate-100 dark:hover:bg-gray-700 transition-colors"
          onClick={() => router.push('/profile')}
        >
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #1e40af 0%, #4f46e5 100%)' }}
          >
            <span className="text-white text-xs font-semibold">
              {getInitials(user?.name ?? 'U')}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-800 dark:text-gray-200 truncate">{user?.name}</p>
            <span className={cn(
              'text-xs px-1.5 py-0.5 rounded font-medium',
              ROLE_BADGE_COLOR[role] ?? 'bg-gray-100 text-gray-700',
            )}>
              {role}
            </span>
          </div>
          <button
            onClick={logout}
            className="text-slate-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors flex-shrink-0"
            title="Logout"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
