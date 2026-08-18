'use client';

import { useAuthStore } from '@apex/core-identity';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rolesApi } from '@/lib/api';
import { dashboardApi } from '@apex/intelligence-dashboard/api';
import { changeRequestsApi } from '@apex/core-users-change-requests/api';
import { leaveApi } from '@apex/workforce-leave/api';
import { usersApi } from '@apex/core-users/api';
import { projectsApi } from '@apex/operations-projects/api';
import { departmentsApi } from '@apex/core-organization-departments/api';
import { ticketsApi } from '@apex/operations-tickets-lifecycle/api';
import Link from 'next/link';
import { Settings, Ticket, Clock, CalendarOff, FolderKanban, Network, Edit3, X, Plus, ArrowRight } from 'lucide-react';
import { TicketRow } from '@apex/operations-tickets-lifecycle/components/ticket-row';
import { ActivityItem } from '../components/activity-item';
import { Skeleton } from '@apex/shared-ui/components/skeleton';
import { useState, useMemo } from 'react';

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
  { label: 'Designation', value: 'DESIGNATION_CHANGE', field: 'designation' },
  { label: 'Department', value: 'DEPARTMENT_CHANGE', field: 'departmentId' },
  { label: 'Team Lead', value: 'TEAM_LEAD_CHANGE', field: 'teamLeadName' },
  { label: 'Department Manager', value: 'REPORTING_MANAGER_CHANGE', field: 'reportingManager' },
  { label: 'Role', value: 'ROLE_CHANGE', field: 'roleId' },
  { label: 'Leadership Responsibility', value: 'LEADERSHIP_RESPONSIBILITY_CHANGE', field: 'leadershipResponsibility' },
  { label: 'Multiple Changes', value: 'MULTI_FIELD_CHANGE', field: 'multiple' },
];

const MULTI_FIELDS = [
  { label: 'Designation', value: 'designation' },
  { label: 'Department', value: 'departmentId' },
  { label: 'Team Lead', value: 'teamLeadName' },
  { label: 'Department Manager', value: 'reportingManager' },
  { label: 'Role', value: 'roleId' },
];

const LEADERSHIP_OPTIONS = [
  { label: 'None', value: 'None' },
  { label: 'Team Lead', value: 'Team Lead' },
  { label: 'Manager', value: 'Manager' },
  { label: 'Department Owner', value: 'Department Owner' },
];

const STATUS_LABELS: Record<string, string> = {
  PENDING_TL_APPROVAL: 'Pending Team Lead Approval',
  PENDING_MANAGER_APPROVAL: 'Pending Manager Approval',
  PENDING_ADMIN_APPROVAL: 'Pending Admin Approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled'
};

export default function ProfileScreen() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ requestType: '', newValue: '', reason: '' });
  const [multiChanges, setMultiChanges] = useState<{field: string, newValue: string}[]>([]);

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

  const { data: departments } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.getAll() as Promise<any>,
    enabled: isModalOpen && (formData.requestType === 'DEPARTMENT_CHANGE' || formData.requestType === 'MULTI_FIELD_CHANGE')
  });

  const { data: allUsers } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => usersApi.getAll() as Promise<any>,
    enabled: isModalOpen && (formData.requestType === 'REPORTING_MANAGER_CHANGE' || formData.requestType === 'PRIMARY_MANAGER_CHANGE' || formData.requestType === 'MULTI_FIELD_CHANGE')
  });

  const { data: roles } = useQuery({
    queryKey: ['roles'],
    queryFn: () => rolesApi.getAll() as Promise<any>,
    enabled: isModalOpen && (formData.requestType === 'ROLE_CHANGE' || formData.requestType === 'MULTI_FIELD_CHANGE')
  });

  const submitRequest = useMutation({
    mutationFn: async (data: any) => {
      let changes = [];
      if (data.requestType === 'MULTI_FIELD_CHANGE') {
        changes = multiChanges;
      } else {
        const typeInfo = REQUEST_TYPES.find(r => r.value === data.requestType);
        changes = [{ field: typeInfo?.field, newValue: data.newValue }];
      }
      return changeRequestsApi.create(user!.id, data.requestType, changes, data.reason);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-change-requests'] });
      setIsModalOpen(false);
      setFormData({ requestType: '', newValue: '', reason: '' });
      setMultiChanges([]);
      alert('Change request submitted for approval.');
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

  const currentTypeInfo = REQUEST_TYPES.find(r => r.value === formData.requestType);
  const isMulti = formData.requestType === 'MULTI_FIELD_CHANGE';

  const getCurrentValueLabel = (field: string) => {
    if (!hierarchy) return 'Not assigned yet';
    if (field === 'designation') return hierarchy.designation || 'Not assigned yet';
    if (field === 'departmentId') return hierarchy.departmentsTiedTo?.[0]?.name || 'Not assigned yet';
    if (field === 'teamLeadName') return hierarchy.reportsTo?.name || 'Not assigned yet';
    if (field === 'reportingManager') return hierarchy.primaryManager?.name || 'Not assigned yet';
    if (field === 'roleId') return hierarchy.role || 'Not assigned yet';
    if (field === 'leadershipResponsibility') return hierarchy.reportsTo ? 'Has Reports' : 'None';
    return 'Not assigned yet';
  };

  const getNewValueLabel = (field: string, val: string) => {
    if (!val) return '...';
    if (field === 'departmentId') return departments?.find((d:any) => d.id === val)?.name || val;
    if (field === 'reportingManager' || field === 'teamLeadName') {
      const u = (allUsers?.users || []).find((u:any) => u.employeeId === val);
      return u ? `${u.name} (${u.employeeId})` : val;
    }
    if (field === 'roleId') return roles?.find((r:any) => r.id === val)?.name || val;
    return val;
  };

  const isFormValid = () => {
    if (!formData.requestType || !formData.reason.trim()) return false;
    if (isMulti) {
      if (multiChanges.length === 0) return false;
      return multiChanges.every(m => m.field && m.newValue);
    }
    if (!formData.newValue.trim()) return false;
    if (getCurrentValueLabel(currentTypeInfo!.field) === getNewValueLabel(currentTypeInfo!.field, formData.newValue)) return false;
    return true;
  };

  const renderFieldInput = (field: string, val: string, onChange: (v: string) => void) => {
    if (field === 'departmentId') {
      return (
        <select className="w-full border border-slate-300 rounded p-2 text-sm" value={val} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>Select Department</option>
          {departments?.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      );
    }
    if (field === 'teamLeadName') {
      const tls = (allUsers?.users || []).filter((u: any) => u.role?.name === 'TEAM_LEAD');
      return (
        <select className="w-full border border-slate-300 rounded p-2 text-sm" value={val} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>Select Team Lead</option>
          {tls.map((u: any) => <option key={u.id} value={u.employeeId}>{u.name} ({u.employeeId})</option>)}
        </select>
      );
    }
    if (field === 'reportingManager') {
      const mgrs = (allUsers?.users || []).filter((u: any) => ['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(u.role?.name));
      return (
        <select className="w-full border border-slate-300 rounded p-2 text-sm" value={val} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>Select Department Manager</option>
          {mgrs.map((u: any) => <option key={u.id} value={u.employeeId}>{u.name} ({u.employeeId})</option>)}
        </select>
      );
    }
    if (field === 'roleId') {
      const filteredRoles = roles?.filter((r: any) =>
        ['EMPLOYEE', 'INTERN'].includes(roleName) ? !['ADMIN', 'SUPER_ADMIN'].includes(r.name) : true
      );
      return (
        <select className="w-full border border-slate-300 rounded p-2 text-sm" value={val} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>Select Role</option>
          {filteredRoles?.map((r: any) => <option key={r.id} value={r.id}>{r.name.replace(/_/g, ' ')}</option>)}
        </select>
      );
    }
    if (field === 'leadershipResponsibility') {
      return (
        <select className="w-full border border-slate-300 rounded p-2 text-sm" value={val} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>Select Responsibility</option>
          {LEADERSHIP_OPTIONS.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    }
    return (
      <input className="w-full border border-slate-300 rounded p-2 text-sm" value={val} onChange={(e) => onChange(e.target.value)} placeholder="Enter new value" />
    );
  };

  const getApprovalPath = () => {
    if (formData.requestType === 'ROLE_CHANGE') return 'Role changes require Admin approval.';
    if (!hierarchy) return 'Approval route will be assigned automatically.';
    const path = ['Employee'];
    if (hierarchy.reportsTo) path.push('Team Lead');
    if (hierarchy.primaryManager || (!hierarchy.reportsTo && hierarchy.primaryManager)) path.push('Manager');
    if (path.length === 1 || (path.length === 2 && hierarchy.reportsTo)) path.push('Admin');
    return path.join(' → ');
  };

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
            <button className="px-3 py-1.5 text-sm font-medium bg-white border border-slate-300 rounded hover:bg-slate-50 flex items-center shadow-sm" onClick={() => setIsModalOpen(true)}>
              <Edit3 size={14} className="mr-2" /> Request Change
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
          <h2 className="font-semibold text-slate-800 mb-4">My Change Requests</h2>
          <div className="divide-y divide-slate-50 max-h-64 overflow-y-auto">
            {requestsLoading ? (
              <div className="space-y-2">{[1, 2].map((i) => <Skeleton key={i} className="h-10 w-full rounded" />)}</div>
            ) : changeRequests && changeRequests.length > 0 ? (
              changeRequests.map((req: any) => (
                <div key={req.id} className="py-3 text-sm">
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-semibold text-slate-700">{REQUEST_TYPES.find(r => r.value === req.requestType)?.label || req.requestType}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${req.status === 'APPROVED' ? 'bg-green-100 text-green-700' : req.status === 'REJECTED' ? 'bg-red-100 text-red-700' : req.status === 'CANCELLED' ? 'bg-slate-100 text-slate-700' : 'bg-blue-100 text-blue-700'}`}>
                      {STATUS_LABELS[req.status] || req.status}
                    </span>
                  </div>
                  <div className="text-slate-500 text-xs mb-1">
                    {req.changes.map((ch: any, idx: number) => (
                      <div key={idx}>
                        <span className="font-medium">{MULTI_FIELDS.find(f => f.value === ch.field)?.label || ch.field}:</span> {String(ch.oldValue || 'N/A')} &rarr; {String(ch.newValue)}
                      </div>
                    ))}
                  </div>
                  {req.status.startsWith('PENDING') && (
                    <div className="flex justify-between items-center mt-2">
                      <span className="text-xs text-slate-400">Approver: {req.currentApprover?.name || 'Admin'}</span>
                      <button onClick={() => cancelRequest.mutate(req.id)} className="text-red-500 text-xs font-medium hover:underline">Cancel</button>
                    </div>
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
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div>
                <h3 className="text-lg font-bold text-slate-800">Request Hierarchy Change</h3>
                <p className="text-xs text-slate-500 mt-0.5">Changes apply only after approval from your Team Lead, Manager, or Admin.</p>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 p-1.5 rounded-full transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {/* Type Selector */}
              <div>
                <label className="text-sm font-semibold text-slate-700 mb-3 block">What would you like to change?</label>
                <div className="flex flex-wrap gap-2">
                  {REQUEST_TYPES.map(rt => (
                    <button
                      key={rt.value}
                      onClick={() => {
                        setFormData({ requestType: rt.value, newValue: '', reason: '' });
                        setMultiChanges([]);
                      }}
                      className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${formData.requestType === rt.value ? 'bg-indigo-50 border-indigo-200 text-indigo-700 ring-1 ring-indigo-500' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`}
                    >
                      {rt.label}
                    </button>
                  ))}
                </div>
              </div>

              {formData.requestType === 'ROLE_CHANGE' && (
                <div className="bg-amber-50 text-amber-800 p-3 rounded-lg text-sm flex items-start gap-2 border border-amber-200">
                  <div className="font-medium mt-0.5">Warning:</div>
                  <div>Role changes directly affect your system permissions and require Admin approval.</div>
                </div>
              )}

              {formData.requestType && !isMulti && (
                <div className="space-y-4 bg-slate-50 p-5 rounded-xl border border-slate-100">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">Current {currentTypeInfo?.label}</label>
                      <div className="p-2.5 bg-slate-100 border border-slate-200 rounded text-sm text-slate-500 cursor-not-allowed">
                        {getCurrentValueLabel(currentTypeInfo!.field)}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block mb-1">New {currentTypeInfo?.label}</label>
                      {renderFieldInput(currentTypeInfo!.field, formData.newValue, (val) => setFormData({ ...formData, newValue: val }))}
                    </div>
                  </div>
                </div>
              )}

              {isMulti && (
                <div className="space-y-3 bg-slate-50 p-5 rounded-xl border border-slate-100">
                  <label className="text-sm font-semibold text-slate-700 block mb-2">Multiple Changes</label>
                  {multiChanges.map((mc, idx) => (
                    <div key={idx} className="flex gap-2 items-start">
                      <select className="w-1/3 border border-slate-300 rounded p-2 text-sm" value={mc.field} onChange={(e) => {
                        const newArr = [...multiChanges];
                        newArr[idx].field = e.target.value;
                        newArr[idx].newValue = '';
                        setMultiChanges(newArr);
                      }}>
                        <option value="" disabled>Select Field</option>
                        {MULTI_FIELDS.map(mf => <option key={mf.value} value={mf.value}>{mf.label}</option>)}
                      </select>
                      <div className="w-1/2">
                        {mc.field ? renderFieldInput(mc.field, mc.newValue, (val) => {
                          const newArr = [...multiChanges];
                          newArr[idx].newValue = val;
                          setMultiChanges(newArr);
                        }) : <input disabled className="w-full border border-slate-200 bg-slate-100 rounded p-2 text-sm" placeholder="..." />}
                      </div>
                      <button onClick={() => setMultiChanges(multiChanges.filter((_, i) => i !== idx))} className="text-red-500 hover:bg-red-50 p-2 rounded">
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  <button onClick={() => setMultiChanges([...multiChanges, {field: '', newValue: ''}])} className="text-sm text-indigo-600 font-medium flex items-center hover:underline mt-2">
                    <Plus size={14} className="mr-1" /> Add Change Row
                  </button>
                </div>
              )}

              {formData.requestType && (
                <div>
                  <label className="text-sm font-semibold text-slate-700 block mb-2">Reason for Request</label>
                  <textarea
                    className="w-full border border-slate-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow min-h-[80px]"
                    value={formData.reason}
                    onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                    placeholder="Provide a clear reason for the approvers..."
                  />
                </div>
              )}

              {formData.requestType && (isMulti ? multiChanges.length > 0 && multiChanges[0].newValue : formData.newValue) && (
                <div className="border border-indigo-100 bg-indigo-50/50 rounded-xl p-4">
                  <h4 className="text-xs font-semibold text-indigo-800 uppercase tracking-wider mb-3">Preview & Routing</h4>

                  <div className="space-y-2 mb-4">
                    {!isMulti && (
                      <div className="flex items-center gap-3 text-sm">
                        <span className="font-medium text-slate-700 w-32">{currentTypeInfo?.label}:</span>
                        <span className="px-2.5 py-1 bg-slate-200 text-slate-600 rounded text-xs line-through">{getCurrentValueLabel(currentTypeInfo!.field)}</span>
                        <ArrowRight size={14} className="text-slate-400" />
                        <span className="px-2.5 py-1 bg-indigo-100 text-indigo-700 font-medium rounded text-xs">{getNewValueLabel(currentTypeInfo!.field, formData.newValue)}</span>
                      </div>
                    )}
                    {isMulti && multiChanges.map((mc, idx) => mc.field && mc.newValue && (
                      <div key={idx} className="flex items-center gap-3 text-sm">
                        <span className="font-medium text-slate-700 w-32">{MULTI_FIELDS.find(f => f.value === mc.field)?.label}:</span>
                        <span className="px-2.5 py-1 bg-slate-200 text-slate-600 rounded text-xs line-through">{getCurrentValueLabel(mc.field)}</span>
                        <ArrowRight size={14} className="text-slate-400" />
                        <span className="px-2.5 py-1 bg-indigo-100 text-indigo-700 font-medium rounded text-xs">{getNewValueLabel(mc.field, mc.newValue)}</span>
                      </div>
                    ))}
                  </div>

                  <div className="pt-3 border-t border-indigo-100/50 flex items-center justify-between">
                    <span className="text-xs text-slate-500">Approval Route:</span>
                    <span className="text-xs font-medium text-indigo-600 bg-white px-2 py-1 rounded shadow-sm border border-indigo-100">
                      {getApprovalPath()}
                    </span>
                  </div>
                </div>
              )}

            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
              <button
                className="px-5 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-200 transition-colors"
                onClick={() => setIsModalOpen(false)}
              >
                Cancel
              </button>
              <button
                className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                onClick={() => submitRequest.mutate(formData)}
                disabled={submitRequest.isPending || !isFormValid()}
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
