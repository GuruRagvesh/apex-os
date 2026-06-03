'use client';

import { useAuthStore } from '@/store/auth.store';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ticketsApi, dashboardApi, leaveApi, projectsApi, changeRequestsApi } from '@/lib/api';
import Link from 'next/link';
import { Settings, Ticket, Clock, CalendarOff, FolderKanban, Network, Edit3 } from 'lucide-react';
import { TicketRow } from '@/components/tickets/ticket-row';
import { ActivityItem } from '@/components/dashboard/activity-item';
import { Skeleton } from '@/components/ui/skeleton';
import { useState } from 'react';


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

const REQUEST_TYPES = [
  'DESIGNATION_CHANGE',
  'DEPARTMENT_CHANGE',
  'REPORTING_MANAGER_CHANGE',
  'PRIMARY_MANAGER_CHANGE',
  'ROLE_CHANGE',
  'LEADERSHIP_RESPONSIBILITY_CHANGE',
  'MULTI_FIELD_CHANGE'
];

export default function ProfilePage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ requestType: '', field: '', newValue: '', reason: '' });

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

  const { data: hierarchy, isLoading: hierarchyLoading } = useQuery({
    queryKey: ['my-hierarchy'],
    queryFn: () => changeRequestsApi.getHierarchySummary(user!.id) as Promise<any>,
    enabled: !!user?.id,
  });

  const { data: changeRequests, isLoading: requestsLoading } = useQuery({
    queryKey: ['my-change-requests'],
    queryFn: () => changeRequestsApi.listMyRequests() as Promise<any[]>,
    enabled: !!user?.id,
  });

  const submitRequest = useMutation({
    mutationFn: async (data: any) => {
      const changes = [{ field: data.field, newValue: data.newValue }];
      return changeRequestsApi.create(user!.id, data.requestType, changes, data.reason);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-change-requests'] });
      setIsModalOpen(false);
      setFormData({ requestType: '', field: '', newValue: '', reason: '' });
      alert('Request submitted successfully!');
    },
    onError: (err: any) => {
      alert(err.message || 'Failed to submit request');
    }
  });

  const cancelRequest = useMutation({
    mutationFn: (id: string) => changeRequestsApi.cancel(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-change-requests'] })
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
        {/* Current Approved Hierarchy */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
              <Network size={18} />
              Current Approved Details
            </h2>
            <button className="px-3 py-1.5 text-sm bg-white border border-slate-300 rounded hover:bg-slate-50" onClick={() => setIsModalOpen(true)}>
              <Edit3 size={14} className="inline mr-1" /> Request Change
            </button>
          </div>
          {hierarchyLoading ? (
             <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-6 w-full rounded" />)}</div>
          ) : hierarchy ? (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between border-b pb-2"><span className="text-slate-500">Role:</span> <span className="font-medium">{hierarchy.role}</span></div>
              <div className="flex justify-between border-b pb-2"><span className="text-slate-500">Designation:</span> <span className="font-medium">{hierarchy.designation || 'N/A'}</span></div>
              <div className="flex justify-between border-b pb-2"><span className="text-slate-500">Reports To:</span> <span className="font-medium">{hierarchy.reportsTo?.name || 'None'}</span></div>
              <div className="flex justify-between border-b pb-2"><span className="text-slate-500">Primary Manager:</span> <span className="font-medium">{hierarchy.primaryManager?.name || 'None'}</span></div>
              <div className="flex justify-between border-b pb-2"><span className="text-slate-500">Departments:</span> <span className="font-medium">{hierarchy.departmentsTiedTo?.map((d: any) => d.name).join(', ') || 'None'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Reporting To Me:</span> <span className="font-medium">{hierarchy.peopleReportingToMe?.length || 0} person(s)</span></div>
            </div>
          ) : (
            <div className="text-slate-400 text-sm">Unavailable</div>
          )}
        </div>

        {/* Pending Change Requests */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-800 mb-4">Change Requests</h2>
          <div className="divide-y divide-slate-50 max-h-64 overflow-y-auto">
            {requestsLoading ? (
              <div className="space-y-2">{[1, 2].map((i) => <Skeleton key={i} className="h-10 w-full rounded" />)}</div>
            ) : changeRequests && changeRequests.length > 0 ? (
              changeRequests.map((req: any) => (
                <div key={req.id} className="py-3 text-sm">
                  <div className="flex justify-between font-medium">
                    <span>{req.requestType.replace(/_/g, ' ')}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-100">{req.status.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="text-slate-500 mt-1">
                    {req.changes.map((ch: any, idx: number) => (
                      <div key={idx}>
                        {ch.field}: {String(ch.oldValue)} &rarr; {String(ch.newValue)}
                      </div>
                    ))}
                  </div>
                  {req.status.startsWith('PENDING') && (
                    <button onClick={() => cancelRequest.mutate(req.id)} className="text-red-500 text-xs mt-2 hover:underline">Cancel Request</button>
                  )}
                </div>
              ))
            ) : (
              <div className="text-center text-slate-400 text-sm py-4">No requests found</div>
            )}
          </div>
        </div>
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

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Request Hierarchy Change</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">&times;</button>
            </div>
            <div className="bg-yellow-50 text-yellow-800 p-3 rounded-md text-sm mb-4">
              Warning: Changes will apply only after approval by your Manager and/or Admin.
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium block mb-1">Request Type</label>
                <select 
                  className="w-full border border-slate-300 rounded p-2 text-sm"
                  value={formData.requestType} 
                  onChange={(e) => setFormData({ ...formData, requestType: e.target.value })}
                >
                  <option value="" disabled>Select type</option>
                  {REQUEST_TYPES.map(rt => <option key={rt} value={rt}>{rt.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Field to Change</label>
                <input 
                  className="w-full border border-slate-300 rounded p-2 text-sm"
                  value={formData.field} 
                  onChange={(e) => setFormData({ ...formData, field: e.target.value })} 
                  placeholder="e.g. designation, departmentId" 
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">New Value</label>
                <input 
                  className="w-full border border-slate-300 rounded p-2 text-sm"
                  value={formData.newValue} 
                  onChange={(e) => setFormData({ ...formData, newValue: e.target.value })} 
                  placeholder="New value" 
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Reason</label>
                <input 
                  className="w-full border border-slate-300 rounded p-2 text-sm"
                  value={formData.reason} 
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })} 
                  placeholder="Why are you requesting this?" 
                />
              </div>
              <button 
                className="w-full bg-indigo-600 text-white rounded p-2 font-medium hover:bg-indigo-700 disabled:opacity-50"
                onClick={() => submitRequest.mutate(formData)} 
                disabled={submitRequest.isPending}
              >
                {submitRequest.isPending ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
