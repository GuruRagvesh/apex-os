'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Ticket, FolderKanban, Kanban, Users, Building2,
  BarChart3, CalendarOff, LogOut, ChevronRight,
} from 'lucide-react';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/tickets', label: 'Tickets', icon: Ticket },
  { href: '/kanban', label: 'Kanban Board', icon: Kanban },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/leave', label: 'Leave', icon: CalendarOff },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
];

const adminNavItems = [
  { href: '/users', label: 'Users', icon: Users },
  { href: '/departments', label: 'Departments', icon: Building2 },
];

const ACCENT = 'bg-indigo-50 text-indigo-700';
const ACCENT_ICON = 'text-indigo-600';
const ACCENT_CHEVRON = 'text-indigo-400';

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const isManager = ['Admin', 'Manager'].includes(user?.role?.name || '');

  const getInitials = (name: string) =>
    name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

  const roleBadgeColor: Record<string, string> = {
    Admin: 'bg-red-100 text-red-700',
    Manager: 'bg-orange-100 text-orange-700',
    'Team Lead': 'bg-indigo-100 text-indigo-700',
    Employee: 'bg-green-100 text-green-700',
  };

  return (
    <aside className="w-64 bg-white border-r border-slate-200 flex flex-col shadow-sm">
      {/* Logo */}
      <div className="p-5 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #1e40af 0%, #4f46e5 100%)' }}
          >
            <span className="text-white font-bold text-lg">N</span>
          </div>
          <div>
            <p className="font-bold text-slate-800 text-base leading-none">Nexus</p>
            <p className="text-[10px] text-slate-400 mt-0.5 font-medium tracking-wide uppercase">TechnoEdge</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-3 py-2">Main</p>
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group',
                active ? ACCENT : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
              )}
            >
              <item.icon
                size={18}
                className={active ? ACCENT_ICON : 'text-slate-400 group-hover:text-slate-600'}
              />
              {item.label}
              {active && <ChevronRight size={14} className={cn('ml-auto', ACCENT_CHEVRON)} />}
            </Link>
          );
        })}

        {isManager && (
          <>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-3 py-2 mt-3">Admin</p>
            {adminNavItems.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group',
                    active ? ACCENT : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                  )}
                >
                  <item.icon
                    size={18}
                    className={active ? ACCENT_ICON : 'text-slate-400 group-hover:text-slate-600'}
                  />
                  {item.label}
                  {active && <ChevronRight size={14} className={cn('ml-auto', ACCENT_CHEVRON)} />}
                </Link>
              );
            })}
          </>
        )}
      </nav>

      {/* User Profile */}
      <div className="p-3 border-t border-slate-100">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-slate-50">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #1e40af 0%, #4f46e5 100%)' }}
          >
            <span className="text-white text-xs font-semibold">{getInitials(user?.name || 'U')}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-800 truncate">{user?.name}</p>
            <span className={cn(
              'text-xs px-1.5 py-0.5 rounded font-medium',
              roleBadgeColor[user?.role?.name || 'Employee'] ?? 'bg-gray-100 text-gray-700',
            )}>
              {user?.role?.name}
            </span>
          </div>
          <button
            onClick={logout}
            className="text-slate-400 hover:text-red-500 transition-colors"
            title="Logout"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
