'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { leaveApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { cn, LEAVE_STATUS_COLORS, formatDate, getInitials } from '@/lib/utils';
import { Plus, CheckCircle, XCircle, Clock } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import toast from 'react-hot-toast';

const LEAVE_TYPES = ['ANNUAL', 'SICK', 'EMERGENCY', 'UNPAID', 'OTHER'];

export default function LeavePage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();

  // Defensive role check — handles object { name } or plain string, all name variants
  const _roleName = (user?.role as any)?.name || (user?.role as any) || '';
  const _isAdmin  = _roleName === 'ADMIN' || _roleName === 'SUPER_ADMIN';
  const isManager = _roleName === 'MANAGER' || _roleName === 'TEAM_LEAD' || _isAdmin;
  const isSuperAdmin = _roleName === 'SUPER_ADMIN';

  // Managers land on "Needs Action" tab first; employees see their own requests
  const [showNew, setShowNew] = useState(false);
  const [tab, setTab] = useState<'all' | 'mine' | 'pending'>(isManager ? 'pending' : 'mine');
  const [form, setForm] = useState({ type: 'ANNUAL', startDate: '', endDate: '', reason: '' });

  const queryParams = tab === 'mine' ? { userId: user?.id } : tab === 'pending' ? { status: 'PENDING' } : {};

  const { data: leaves, isLoading } = useQuery({
    queryKey: ['leave', tab],
    queryFn: () => leaveApi.getAll(queryParams) as Promise<any[]>,
  });

  const { data: stats } = useQuery({
    queryKey: ['leave-stats'],
    queryFn: () => leaveApi.getStats() as Promise<any>,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => leaveApi.create(data),
    onSuccess: () => {
      toast.success('Leave request submitted!');
      qc.invalidateQueries({ queryKey: ['leave'] });
      setShowNew(false);
      setForm({ type: 'ANNUAL', startDate: '', endDate: '', reason: '' });
    },
    onError: () => toast.error('Failed to submit leave request'),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => leaveApi.approve(id),
    onSuccess: () => { toast.success('Approved!'); qc.invalidateQueries({ queryKey: ['leave'] }); },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => leaveApi.reject(id),
    onSuccess: () => { toast.success('Rejected'); qc.invalidateQueries({ queryKey: ['leave'] }); },
  });

  const inputCls = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white';

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Leave Management</h2>
          <p className="text-sm text-slate-500 mt-0.5">Manage leave requests and approvals</p>
        </div>
        {!isSuperAdmin && (
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={16} />Apply Leave
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total', value: stats?.total || 0, icon: <Clock size={18} className="text-slate-600" />, bg: 'bg-slate-50' },
          { label: 'Pending', value: stats?.pending || 0, icon: <Clock size={18} className="text-yellow-600" />, bg: 'bg-yellow-50' },
          { label: 'Approved', value: stats?.approved || 0, icon: <CheckCircle size={18} className="text-green-600" />, bg: 'bg-green-50' },
          { label: 'Rejected', value: stats?.rejected || 0, icon: <XCircle size={18} className="text-red-600" />, bg: 'bg-red-50' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center mb-2', s.bg)}>{s.icon}</div>
            <p className="text-2xl font-bold text-slate-800">{s.value}</p>
            <p className="text-xs text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs — managers see "Needs Action" first */}
      <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {(isManager
          ? [
              { key: 'pending', label: 'Needs Action', badge: stats?.pending ?? 0 },
              { key: 'all',     label: 'All Requests' },
              { key: 'mine',    label: 'My Requests'  },
            ]
          : [
              { key: 'mine', label: 'My Requests'  },
              { key: 'all',  label: 'All Requests' },
            ]
        ).map(({ key, label, badge }) => (
          <button
            key={key}
            onClick={() => setTab(key as any)}
            className={cn(
              'flex items-center gap-1.5 text-xs font-medium px-4 py-1.5 rounded-md transition-colors',
              tab === key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {label}
            {badge != null && badge > 0 && (
              <span className={cn(
                'text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none',
                tab === key ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-600',
              )}>
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Leave List */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-40"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" /></div>
        ) : Array.isArray(leaves) && leaves.length > 0 ? (
          <div className="divide-y divide-slate-50">
            {leaves.map((leave: any) => (
              <div key={leave.id} className="flex items-center gap-4 px-5 py-4">
                <div className="w-9 h-9 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xs font-semibold">{getInitials(leave.user?.name || '')}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{leave.user?.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-slate-500">{leave.type}</span>
                    <span className="text-slate-300">·</span>
                    <span className="text-xs text-slate-500">{formatDate(leave.startDate)} – {formatDate(leave.endDate)}</span>
                    {leave.user?.department && (
                      <><span className="text-slate-300">·</span><span className="text-xs text-slate-400">{leave.user.department.name}</span></>
                    )}
                  </div>
                  {leave.reason && <p className="text-xs text-slate-400 mt-1 truncate">{leave.reason}</p>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium', LEAVE_STATUS_COLORS[leave.status])}>
                    {leave.status}
                  </span>
                  {(() => {
                    if (!isManager || leave.status !== 'PENDING') return null;
                    if (leave.userId === user?.id) return null;
                    const ROLE_LEVEL: Record<string, number> = {
                      SUPER_ADMIN: 0, ADMIN: 1, MANAGER: 2, TEAM_LEAD: 3, EMPLOYEE: 4, INTERN: 5,
                    };
                    const reqLevel = ROLE_LEVEL[leave.user?.role?.name ?? 'EMPLOYEE'] ?? 4;
                    const myLevel = ROLE_LEVEL[_roleName] ?? 4;
                    if (myLevel >= reqLevel) return null;
                    return true;
                  })() && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => approveMutation.mutate(leave.id)}
                        className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                        title="Approve"
                      >
                        <CheckCircle size={15} />
                      </button>
                      <button
                        onClick={() => rejectMutation.mutate(leave.id)}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="Reject"
                      >
                        <XCircle size={15} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="📅"
            title="No leave requests yet"
            description="Apply for leave and track approvals here"
            actionLabel="Apply Leave"
            onAction={() => setShowNew(true)}
          />
        )}
      </div>

      {/* New Leave Modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6 shadow-2xl">
            <h3 className="font-bold text-slate-800 text-lg mb-5">Apply for Leave</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Leave Type</label>
                <select value={form.type} onChange={(e) => setForm(f => ({ ...f, type: e.target.value }))} className={inputCls}>
                  {LEAVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Start Date</label>
                  <input type="date" value={form.startDate} onChange={(e) => setForm(f => ({ ...f, startDate: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">End Date</label>
                  <input type="date" value={form.endDate} onChange={(e) => setForm(f => ({ ...f, endDate: e.target.value }))} className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Reason</label>
                <textarea value={form.reason} onChange={(e) => setForm(f => ({ ...f, reason: e.target.value }))} className={`${inputCls} resize-none`} rows={3} placeholder="Brief reason for leave..." />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => form.startDate && form.endDate && form.reason && createMutation.mutate(form)}
                disabled={createMutation.isPending || !form.startDate || !form.endDate || !form.reason}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50 text-sm"
              >
                {createMutation.isPending ? 'Submitting...' : 'Submit Request'}
              </button>
              <button onClick={() => setShowNew(false)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-lg hover:bg-slate-50 text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
