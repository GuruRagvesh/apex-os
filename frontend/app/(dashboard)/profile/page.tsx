'use client';

import { useAuthStore } from '@/store/auth.store';
import { useQuery } from '@tanstack/react-query';
import { ticketsApi, dashboardApi, leaveApi, projectsApi } from '@/lib/api';
import Link from 'next/link';
import { Settings, Ticket, Clock, CalendarOff, FolderKanban } from 'lucide-react';
import { TicketRow } from '@/components/tickets/ticket-row';
import { ActivityItem } from '@/components/dashboard/activity-item';
import { Skeleton } from '@/components/ui/skeleton';

function getInitials(name: string) {
  return name?.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) ?? 'U';
}

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-100 text-purple-700',
  ADMIN: 'bg-red-100 text-red-700',
  MANAGER: 'bg-amber-100 text-amber-700',
  TEAM_LEAD: 'bg-blue-100 text-blue-700',
  EMPLOYEE: 'bg-green-100 text-green-700',
  INTERN: 'bg-teal-100 text-teal-700',
};

export default function ProfilePage() {
  const { user } = useAuthStore();

  const { data: myTickets, isLoading: ticketsLoading } = useQuery({
    queryKey: ['my-tickets'],
    queryFn: () => ticketsApi.getAll({ assignedToId: user?.id, status: 'OPEN', limit: 10 }) as Promise<any>,
    enabled: !!user?.id,
  });

  const { data: activity, isLoading: activityLoading } = useQuery({
    queryKey: ['my-activity'],
    queryFn: () => dashboardApi.getActivityFeed(10) as Promise<any[]>,
  });

  const { data: leaveBalance, isLoading: leaveLoading } = useQuery({
    queryKey: ['my-leave-balance-profile'],
    queryFn: () => leaveApi.getBalance() as Promise<any>,
    enabled: !!user?.id,
  });

  const { data: projectsData, isLoading: projectsLoading } = useQuery({
    queryKey: ['my-projects-profile'],
    queryFn: () => projectsApi.getAll({ limit: 100, page: 1 }) as Promise<any>,
    enabled: !!user?.id,
  });

  const roleName = (user?.role as any)?.name ?? user?.role ?? '';
  const deptName = (user?.department as any)?.name ?? '';
  const tickets: any[] = myTickets?.tickets ?? [];
  const projects: any[] = projectsData?.projects ?? (Array.isArray(projectsData) ? projectsData : []);
  const approvedLeaveDays = leaveBalance?.approved ?? 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Top profile card */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-5">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #1e40af 0%, #4f46e5 100%)' }}
            >
              {getInitials(user?.name ?? 'U')}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">{user?.name}</h1>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${ROLE_COLORS[roleName] ?? 'bg-gray-100 text-gray-700'}`}>
                  {roleName.replace('_', ' ')}
                </span>
                <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">{deptName}</span>
              </div>
              <p className="text-sm text-slate-400 mt-2">{user?.email}</p>
            </div>
          </div>
          <Link
            href="/settings"
            className="flex items-center gap-2 text-sm px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors text-slate-600"
          >
            <Settings size={14} />
            Edit Profile
          </Link>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Open Tickets', value: tickets.length, icon: <Ticket size={18} className="text-yellow-600" />, bg: 'bg-yellow-50' },
          { label: 'In Progress', value: myTickets?.tickets?.filter((t: any) => t.status === 'IN_PROGRESS').length ?? 0, icon: <Clock size={18} className="text-blue-600" />, bg: 'bg-blue-50' },
          { label: 'Leave Days', value: leaveLoading ? '...' : approvedLeaveDays, icon: <CalendarOff size={18} className="text-pink-600" />, bg: 'bg-pink-50' },
          { label: 'Projects', value: projectsLoading ? '...' : projects.length, icon: <FolderKanban size={18} className="text-indigo-600" />, bg: 'bg-indigo-50' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className={`w-9 h-9 rounded-lg ${s.bg} flex items-center justify-center mb-3`}>{s.icon}</div>
            <p className="text-xl font-bold text-slate-800">{s.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* My Open Tickets */}
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800">My Open Tickets</h2>
            <Link href="/tickets" className="text-xs text-indigo-600 hover:underline">View all</Link>
          </div>
          <div className="divide-y divide-slate-50">
            {ticketsLoading ? (
              <div className="p-4 space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}</div>
            ) : tickets.length > 0 ? (
              tickets.map((t) => <TicketRow key={t.id} ticket={t} compact />)
            ) : (
              <div className="p-6 text-center text-slate-400 text-sm">
                <Ticket size={24} className="mx-auto mb-2 text-slate-300" />
                No open tickets
              </div>
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">Recent Activity</h2>
          </div>
          <div className="divide-y divide-slate-50 max-h-64 overflow-y-auto">
            {activityLoading ? (
              <div className="p-4 space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}</div>
            ) : Array.isArray(activity) && activity.length > 0 ? (
              activity.map((item) => <ActivityItem key={item.id} item={item} />)
            ) : (
              <div className="p-6 text-center text-slate-400 text-sm">No recent activity</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
