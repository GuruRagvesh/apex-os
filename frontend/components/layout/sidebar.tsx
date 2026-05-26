'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Ticket, Kanban, FolderKanban, CalendarOff,
  Users, Building2, BarChart3, LogOut, Zap, Settings,
  Calendar, Activity, ArrowRight,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { UserAvatar } from '@/components/ui/user-avatar';
import { motion } from 'motion/react';

// ── Skeleton shown before Zustand hydrates ────────────────────────────────────
function SidebarSkeleton() {
  return (
    <aside className="w-64 flex flex-col" style={{ backgroundColor: '#0B1220', borderRight: '1px solid rgba(30,41,59,0.5)' }}>
      {/* Logo */}
      <div className="p-5" style={{ borderBottom: '1px solid rgba(30,41,59,0.5)' }}>
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #1e40af 0%, #4f46e5 100%)' }}
          />
          <div className="space-y-1.5">
            <div className="h-3.5 w-16 bg-slate-700 rounded animate-pulse" />
            <div className="h-2.5 w-20 bg-slate-800 rounded animate-pulse" />
          </div>
        </div>
      </div>
      {/* Nav bars */}
      <nav className="flex-1 p-3 space-y-2">
        <div className="h-2.5 w-10 bg-slate-800 rounded mx-3 mb-3 animate-pulse" />
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-9 rounded-xl bg-slate-800 animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
        ))}
      </nav>
      {/* Bottom user area */}
      <div className="p-3" style={{ borderTop: '1px solid rgba(30,41,59,0.5)' }}>
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-800/60">
          <div className="w-8 h-8 rounded-full bg-slate-700 animate-pulse flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-24 bg-slate-700 rounded animate-pulse" />
            <div className="h-2.5 w-16 bg-slate-800 rounded animate-pulse" />
          </div>
        </div>
      </div>
    </aside>
  );
}

// ── Nav definitions ───────────────────────────────────────────────────────────
const BASE_NAV = [
  { href: '/dashboard', label: 'Home',          icon: LayoutDashboard },
  { href: '/tickets',   label: 'Tickets',       icon: Ticket          },
  { href: '/kanban',    label: 'Kanban Board',  icon: Kanban          },
  { href: '/projects',  label: 'Projects',      icon: FolderKanban    },
  { href: '/leave',     label: 'Leave',          icon: CalendarOff     },
  { href: '/calendar',  label: 'Calendar',       icon: Calendar        },
];

const TEAMLEAD_NAV  = [{ href: '/team',    label: 'Team',          icon: Users    }];
const MANAGER_NAV   = [{ href: '/analytics', label: 'Analytics',   icon: BarChart3 }];
const ADMIN_NAV     = [
  { href: '/users',       label: 'Users & Roles',  icon: Users     },
  { href: '/departments', label: 'Departments',     icon: Building2 },
];

const SETTINGS_NAV  = [{ href: '/settings', label: 'Settings',      icon: Settings  }];
const ACTIVITY_NAV  = [{ href: '/admin/activity', label: 'Activity Log', icon: Activity }];

// Streamlined nav for SUPER_ADMIN in team_lead mode
const TEAMLEAD_MODE_NAV = [
  { href: '/dashboard', label: 'Home',          icon: LayoutDashboard },
  { href: '/tickets',   label: 'My Team Tasks', icon: Ticket        },
  { href: '/kanban',    label: 'Kanban Board',  icon: Kanban        },
  { href: '/projects',  label: 'Projects',      icon: FolderKanban  },
  { href: '/leave',     label: 'Leave',          icon: CalendarOff   },
];

const ROLE_BADGE_COLOR: Record<string, { bg: string; text: string }> = {
  SUPER_ADMIN: { bg: 'rgba(139,92,246,0.15)', text: '#a78bfa' },
  ADMIN:       { bg: 'rgba(239,68,68,0.15)',  text: '#f87171' },
  MANAGER:     { bg: 'rgba(245,158,11,0.15)', text: '#fbbf24' },
  TEAM_LEAD:   { bg: 'rgba(37,99,235,0.15)',  text: '#60a5fa' },
  EMPLOYEE:    { bg: 'rgba(16,185,129,0.15)', text: '#34d399' },
  INTERN:      { bg: 'rgba(20,184,166,0.15)', text: '#2dd4bf' },
};

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

  const roleBadge = ROLE_BADGE_COLOR[role] ?? { bg: 'rgba(100,116,139,0.15)', text: '#94a3b8' };

  // ── Intern-style animated nav button ──────────────────────────────────────
  function NavItem({ href, label, icon: Icon }: { href: string; label: string; icon: any }) {
    const active = pathname === href || pathname.startsWith(href + '/');

    return (
      <Link href={href}>
        <motion.div
          whileHover="hover"
          initial="initial"
          className={cn(
            'group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors cursor-pointer overflow-hidden',
            active
              ? 'bg-blue-600/15 text-blue-400 border border-blue-900/40 shadow-inner'
              : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100 border border-transparent',
          )}
        >
          {/* Sliding ArrowRight on hover */}
          <motion.span
            variants={{
              initial: { x: -12, opacity: 0, width: 0 },
              hover: { x: 0, opacity: 1, width: 'auto' },
            }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="flex-shrink-0 overflow-hidden"
          >
            <ArrowRight
              size={14}
              className={active ? 'text-blue-400' : 'text-slate-400'}
            />
          </motion.span>

          <Icon
            size={18}
            className={cn(
              'flex-shrink-0 transition-colors',
              active ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300',
            )}
          />

          {/* Label with skew on hover */}
          <motion.span
            variants={{
              initial: { skewX: 0, color: active ? '#60a5fa' : '#94a3b8' },
              hover: { skewX: -6, color: '#307cf6' },
            }}
            transition={{ duration: 0.18 }}
            className="flex-1 leading-none"
          >
            {label}
          </motion.span>
        </motion.div>
      </Link>
    );
  }

  function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
      <p className="font-mono text-[10px] uppercase tracking-widest text-slate-500 px-3 mb-1 mt-4">
        {children}
      </p>
    );
  }

  return (
    <aside
      className="w-64 flex flex-col"
      style={{ backgroundColor: '#0B1220', borderRight: '1px solid rgba(30,41,59,0.5)' }}
    >
      {/* Logo */}
      <div className="p-5" style={{ borderBottom: '1px solid rgba(30,41,59,0.5)' }}>
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #1e40af 0%, #4f46e5 100%)' }}
          >
            <span className="text-white font-bold text-lg">A</span>
          </div>
          <div>
            <p className="font-bold text-white text-base leading-none">Apex</p>
            <p className="text-[10px] text-slate-500 mt-0.5 font-mono uppercase tracking-widest">TechnoEdge</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        <SectionLabel>Main</SectionLabel>

        {mainNav.map((item) => <NavItem key={item.href} {...item} />)}

        {/* Team — team leads and above */}
        {showTeam && (
          <>
            <SectionLabel>Team</SectionLabel>
            {TEAMLEAD_NAV.map((item) => <NavItem key={item.href} {...item} />)}
          </>
        )}

        {/* Reports — managers and above */}
        {showReports && (
          <>
            <SectionLabel>Analytics</SectionLabel>
            {MANAGER_NAV.map((item) => <NavItem key={item.href} {...item} />)}
          </>
        )}

        {/* Admin section */}
        {showAdminSect && (
          <>
            <SectionLabel>Admin</SectionLabel>
            {ADMIN_NAV.map((item) => <NavItem key={item.href} {...item} />)}
          </>
        )}

        {/* Activity Log — team leads and above */}
        {isTeamLead && !(isSuperAdmin && apexMode === 'team_lead') && (
          <>
            <SectionLabel>Workday</SectionLabel>
            {ACTIVITY_NAV.map((item) => <NavItem key={item.href} {...item} />)}
          </>
        )}

        {/* Settings — everyone */}
        <div className="mt-3 pt-2" style={{ borderTop: '1px solid rgba(30,41,59,0.5)' }}>
          {SETTINGS_NAV.map((item) => <NavItem key={item.href} {...item} />)}
        </div>
      </nav>

      {/* Footer area */}
      <div className="p-3 space-y-2.5" style={{ borderTop: '1px solid rgba(30,41,59,0.5)' }}>
        {/* OPERATIONS PANEL status block */}
        <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800/40 font-mono text-[9px] text-slate-500 space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span className="font-bold uppercase tracking-tight">OPERATIONS PANEL</span>
            <span className="text-emerald-500 font-black">● LIVE</span>
          </div>
          <p className="truncate">SLA_SHIELD: STABLE_BOUND</p>
          <p>METRICS_CONNEC: DYNAMIC</p>
        </div>

        {/* User profile card */}
        <div
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors hover:bg-slate-800/60"
          onClick={() => router.push('/profile')}
        >
          <UserAvatar name={user?.name ?? 'U'} avatar={user?.avatar} photoUrl={(user as any)?.photoUrl} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">{user?.name}</p>
            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wide"
                style={{ backgroundColor: roleBadge.bg, color: roleBadge.text }}
              >
                {role}
              </span>
              {isSuperAdmin && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-semibold flex items-center gap-0.5"
                  style={{
                    background: apexMode === 'super_admin'
                      ? 'linear-gradient(135deg,rgba(88,28,135,0.15) 0%,rgba(109,40,217,0.10) 100%)'
                      : 'linear-gradient(135deg,rgba(30,64,175,0.15) 0%,rgba(79,70,229,0.10) 100%)',
                    border: apexMode === 'super_admin' ? '1px solid rgba(139,92,246,0.3)' : '1px solid rgba(96,165,250,0.3)',
                    color: apexMode === 'super_admin' ? '#a78bfa' : '#60a5fa',
                  }}
                >
                  {apexMode === 'super_admin'
                    ? <><Zap size={9} />SA</>
                    : <><Users size={9} />TL</>}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); logout(); }}
            className="text-slate-500 hover:text-red-400 transition-colors flex-shrink-0"
            title="Logout"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
