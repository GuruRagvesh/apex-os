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

  const { data: leaveData, isLoading } = useQuery({
    queryKey: ['leave', tab],
    queryFn: () => leaveApi.getAll(queryParams) as Promise<any>,
  });
  // API returns { items, total, page, limit, totalPages } — unwrap for backward compat
  const leaves: any[] = Array.isArray(leaveData) ? leaveData : (leaveData?.items ?? []);

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
    onSuccess: () => {
      toast.success('Approved!');
      qc.invalidateQueries({ queryKey: ['leave'] });
      qc.invalidateQueries({ queryKey: ['leave-stats'] });
    },
    onError: (err: any) => toast.error(err?.message || 'You do not have permission to perform this action.'),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => leaveApi.reject(id),
    onSuccess: () => {
      toast.success('Rejected');
      qc.invalidateQueries({ queryKey: ['leave'] });
      qc.invalidateQueries({ queryKey: ['leave-stats'] });
    },
    onError: (err: any) => toast.error(err?.message || 'You do not have permission to perform this action.'),
  });

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Leave Management</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>Manage leave requests and approvals</p>
        </div>
        <button onClick={() => setShowNew(true)} className="apex-btn-new-ticket">
          <Plus size={16} />Apply Leave
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total',    value: stats?.total    || 0, color: 'var(--text-secondary)',  bg: 'var(--bg-tertiary)'         },
          { label: 'Pending',  value: stats?.pending  || 0, color: 'var(--color-warning)',   bg: 'var(--color-warning-bg)'    },
          { label: 'Approved', value: stats?.approved || 0, color: 'var(--color-success)',   bg: 'var(--color-success-bg)'    },
          { label: 'Rejected', value: stats?.rejected || 0, color: 'var(--color-danger)',    bg: 'var(--color-danger-bg)'     },
        ].map((s) => (
          <div key={s.label} className="apex-card p-4">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-2" style={{ backgroundColor: s.bg }}>
              {s.label === 'Approved' ? <CheckCircle size={18} style={{ color: s.color }} /> : s.label === 'Rejected' ? <XCircle size={18} style={{ color: s.color }} /> : <Clock size={18} style={{ color: s.color }} />}
            </div>
            <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{s.value}</p>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs — managers see "Needs Action" first */}
      <div className="flex items-center gap-1 rounded-lg p-1 w-fit" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
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
            className={cn('flex items-center gap-1.5 text-xs font-medium px-4 py-1.5 rounded-md transition-colors', tab === key && 'shadow-sm')}
            style={{
              backgroundColor: tab === key ? 'var(--surface-card)' : 'transparent',
              color: tab === key ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
            onMouseEnter={(e) => { if (tab !== key) e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { if (tab !== key) e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            {label}
            {badge != null && badge > 0 && (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none"
                style={tab === key
                  ? { backgroundColor: 'var(--color-warning-bg)', color: 'var(--color-warning)' }
                  : { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
              >
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Leave List */}
      <div className="apex-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-40"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" /></div>
        ) : Array.isArray(leaves) && leaves.length > 0 ? (
          <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
            {leaves.map((leave: any) => (
              <div key={leave.id} className="flex items-center gap-4 px-5 py-4">
                <div className="w-9 h-9 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xs font-semibold">{getInitials(leave.user?.name || '')}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{leave.user?.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{leave.type}</span>
                    <span style={{ color: 'var(--border-primary)' }}>·</span>
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{formatDate(leave.startDate)} – {formatDate(leave.endDate)}</span>
                    {leave.user?.department && (
                      <><span style={{ color: 'var(--border-primary)' }}>·</span><span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{leave.user.department.name}</span></>
                    )}
                  </div>
                  {leave.reason && <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-tertiary)' }}>{leave.reason}</p>}
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
        <div className="apex-backdrop flex items-center justify-center p-4">
          <div className="apex-modal w-full max-w-md p-6 modal-enter">
            <h3 className="font-bold text-lg mb-5" style={{ color: 'var(--text-primary)' }}>Apply for Leave</h3>
            <div className="space-y-4">
              <div>
                <label className="apex-label">Leave Type</label>
                <select value={form.type} onChange={(e) => setForm(f => ({ ...f, type: e.target.value }))} className="apex-select w-full">
                  {LEAVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="apex-label">Start Date</label>
                  <input type="date" value={form.startDate} onChange={(e) => setForm(f => ({ ...f, startDate: e.target.value }))} className="apex-input" />
                </div>
                <div>
                  <label className="apex-label">End Date</label>
                  <input type="date" value={form.endDate} onChange={(e) => setForm(f => ({ ...f, endDate: e.target.value }))} className="apex-input" />
                </div>
              </div>
              <div>
                <label className="apex-label">Reason</label>
                <textarea value={form.reason} onChange={(e) => setForm(f => ({ ...f, reason: e.target.value }))} className="apex-textarea" rows={3} placeholder="Brief reason for leave..." />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => form.startDate && form.endDate && form.reason && createMutation.mutate(form)}
                disabled={createMutation.isPending || !form.startDate || !form.endDate || !form.reason}
                className="apex-btn apex-btn-primary flex-1 justify-center py-2.5 disabled:opacity-50"
              >
                {createMutation.isPending ? 'Submitting...' : 'Submit Request'}
              </button>
              <button onClick={() => setShowNew(false)} className="apex-btn apex-btn-secondary flex-1 justify-center py-2.5">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
