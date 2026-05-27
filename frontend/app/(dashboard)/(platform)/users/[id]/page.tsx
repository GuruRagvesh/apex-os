'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { usersApi, ticketsApi } from '@/lib/api';
import { ArrowLeft, Mail, Building2, BadgeCheck, Calendar, Ticket, ExternalLink, AlertCircle, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { cn, STATUS_COLORS, PRIORITY_COLORS, formatDate } from '@/lib/utils';

const roleBadge: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-100 text-purple-700',
  ADMIN: 'bg-red-100 text-red-700',
  MANAGER: 'bg-orange-100 text-orange-700',
  TEAM_LEAD: 'bg-blue-100 text-blue-700',
  EMPLOYEE: 'bg-green-100 text-green-700',
  INTERN: 'bg-slate-100 text-slate-600',
};

function Avatar({ name, avatar }: { name: string; avatar?: string }) {
  if (avatar) {
    return <img src={avatar} alt={name} className="w-20 h-20 rounded-full object-cover border-4 border-white shadow-md flex-shrink-0" />;
  }
  return (
    <div className="w-20 h-20 rounded-full bg-indigo-600 text-white font-bold text-2xl flex items-center justify-center border-4 border-white shadow-md flex-shrink-0">
      {name?.slice(0, 2).toUpperCase()}
    </div>
  );
}

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromContext = searchParams.get('from');
  const deptId = searchParams.get('deptId');
  const deptName = searchParams.get('deptName')
    ? decodeURIComponent(searchParams.get('deptName')!)
    : null;

  const { data: user, isLoading, isError } = useQuery({
    queryKey: ['user', id],
    queryFn: () => usersApi.getOne(id) as Promise<any>,
  });

  const { data: ticketsData } = useQuery({
    queryKey: ['user-tickets', id],
    queryFn: () => ticketsApi.getAll({ assignedToId: id, limit: 10 }) as Promise<any>,
    enabled: !!id,
  });

  const tickets: any[] = ticketsData?.tickets ?? (Array.isArray(ticketsData) ? ticketsData : []);

  const breadcrumbs = useMemo(() => {
    if (fromContext === 'department' && deptId && deptName) {
      return [
        { label: 'Departments', href: '/departments' },
        { label: deptName, href: `/departments/${deptId}` },
        { label: user?.name || 'Member', href: null },
      ];
    }
    return [
      { label: 'Users', href: '/users' },
      { label: user?.name || 'Member', href: null },
    ];
  }, [fromContext, deptId, deptName, user]);

  const handleBack = () => {
    if (fromContext === 'department' && deptId) {
      router.push(`/departments/${deptId}`);
    } else {
      router.push('/users');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-60">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (isError || !user) {
    return (
      <div className="flex flex-col items-center justify-center h-60 gap-3">
        <AlertCircle size={32} className="text-slate-300" />
        <p className="text-slate-500">User not found</p>
        <button onClick={() => router.back()} className="text-sm text-blue-600 hover:underline">
          Go back
        </button>
      </div>
    );
  }

  const openTickets = tickets.filter((t) => !['DONE', 'CLOSED'].includes(t.status)).length;
  const completedTickets = tickets.filter((t) => ['DONE', 'CLOSED'].includes(t.status)).length;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <nav className="flex items-center gap-1 text-sm mb-4 flex-wrap" style={{ color: 'var(--text-secondary)' }}>
        {breadcrumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="w-3 h-3 flex-shrink-0" />}
            {crumb.href ? (
              <Link
                href={crumb.href}
                className="transition-colors"
                style={{ color: 'var(--text-secondary)' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{crumb.label}</span>
            )}
          </span>
        ))}
      </nav>
      {/* Back button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleBack}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ArrowLeft size={18} className="text-slate-500" />
        </button>
        <h1 className="text-lg font-semibold text-slate-700">User Profile</h1>
      </div>

      {/* Profile card */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {/* Banner */}
        <div className="h-24 bg-gradient-to-r from-indigo-500 to-blue-600" />
        <div className="px-6 pb-6">
          <div className="flex items-end gap-4 -mt-10 mb-4">
            <Avatar name={user.name} avatar={user.avatar} />
            <div className="pb-1">
              <h2 className="text-xl font-bold text-slate-800">{user.name}</h2>
              {!user.isActive && (
                <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">
                  Inactive
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2 text-slate-600">
              <Mail size={14} className="text-slate-400 flex-shrink-0" />
              <span className="truncate">{user.email}</span>
            </div>
            {user.department && (
              <div className="flex items-center gap-2 text-slate-600">
                <Building2 size={14} className="text-slate-400 flex-shrink-0" />
                <span>{user.department.name}</span>
              </div>
            )}
            {user.role && (
              <div className="flex items-center gap-2">
                <BadgeCheck size={14} className="text-slate-400 flex-shrink-0" />
                <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', roleBadge[user.role.name] ?? 'bg-gray-100 text-gray-700')}>
                  {user.role.name}
                </span>
              </div>
            )}
            {user.createdAt && (
              <div className="flex items-center gap-2 text-slate-600">
                <Calendar size={14} className="text-slate-400 flex-shrink-0" />
                <span>Member since {formatDate(user.createdAt)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Open Tickets', value: openTickets, color: 'text-orange-600 bg-orange-50' },
          { label: 'Completed', value: completedTickets, color: 'text-green-600 bg-green-50' },
          { label: 'Total Assigned', value: tickets.length, color: 'text-blue-600 bg-blue-50' },
          { label: 'Role Level', value: user.role?.level ?? '—', color: 'text-indigo-600 bg-indigo-50' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-4 text-center">
            <p className={cn('text-2xl font-bold mb-0.5', s.color.split(' ')[0])}>{s.value}</p>
            <p className="text-xs text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Assigned Tickets */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2">
            <Ticket size={16} className="text-slate-400" />
            Assigned Tickets
            <span className="text-xs font-normal text-slate-400">({tickets.length})</span>
          </h2>
        </div>
        <div className="divide-y divide-slate-50">
          {tickets.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-8">No tickets assigned</p>
          )}
          {tickets.map((t: any) => (
            <Link
              key={t.id}
              href={`/tickets/${t.id}`}
              className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors group"
            >
              <span className="text-xs text-slate-400 font-mono w-20 flex-shrink-0">{t.ticketId}</span>
              <p className="flex-1 text-sm text-slate-700 truncate">{t.title}</p>
              <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0', STATUS_COLORS[t.status] ?? 'bg-slate-100 text-slate-600')}>
                {t.status}
              </span>
              <span className={cn('text-xs font-semibold flex-shrink-0', PRIORITY_COLORS[t.priority] ?? 'text-slate-500')}>
                {t.priority}
              </span>
              <ExternalLink size={13} className="text-slate-300 group-hover:text-slate-500 transition-colors flex-shrink-0" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
