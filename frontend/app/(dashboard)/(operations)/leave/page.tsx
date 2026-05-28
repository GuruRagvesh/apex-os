'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { leaveApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { cn, LEAVE_STATUS_COLORS, formatDate, getInitials } from '@/lib/utils';
import { Plus, CheckCircle, XCircle, Clock } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import toast from 'react-hot-toast';
import { useSearchParams } from 'next/navigation';

const LEAVE_TYPES = ['ANNUAL', 'SICK', 'EMERGENCY', 'UNPAID', 'OTHER'];

export default function LeavePage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();

  const _roleName = (user?.role as any)?.name || (user?.role as any) || '';
  const scopeText =
    _roleName === 'SUPER_ADMIN' ? 'Showing company-wide leaves' :
    _roleName === 'ADMIN' ? 'Showing company-wide leaves' :
    _roleName === 'MANAGER' ? 'Showing managed department leaves' :
    _roleName === 'TEAM_LEAD' ? 'Showing your team leaves' :
    'Showing your leave requests';
  const _isAdmin  = _roleName === 'ADMIN' || _roleName === 'SUPER_ADMIN';
  const isManager = _roleName === 'MANAGER' || _roleName === 'TEAM_LEAD' || _isAdmin;
  const isSuperAdmin = _roleName === 'SUPER_ADMIN';

  // Managers land on "Needs Action" tab first; employees see their own requests
  const [showNew, setShowNew] = useState(false);
  const [tab, setTab] = useState<'all' | 'mine' | 'pending'>(isManager ? 'pending' : 'mine');

  const searchParams = useSearchParams();
  const queryString = searchParams.toString();

  useEffect(() => {
    const params = new URLSearchParams(queryString);
    const qTab = params.get('tab');
    if (qTab === 'needs-action' || qTab === 'pending') {
      setTab('pending');
    } else if (qTab === 'mine') {
      setTab('mine');
    } else if (qTab === 'all') {
      setTab('all');
    }
  }, [queryString]);
  const [form, setForm] = useState({ type: 'ANNUAL', startDate: '', endDate: '', reason: '' });

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [balances, setBalances] = useState<Record<string, any>>({});
  const [loadingBalances, setLoadingBalances] = useState<Record<string, boolean>>({});

  const toggleExpand = async (id: string, userId: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!balances[userId] && !loadingBalances[userId]) {
      setLoadingBalances(prev => ({ ...prev, [userId]: true }));
      try {
        const bal = await leaveApi.getBalance(userId);
        setBalances(prev => ({ ...prev, [userId]: bal }));
      } catch (err) {
        console.error('Failed to load balance', err);
      } finally {
        setLoadingBalances(prev => ({ ...prev, [userId]: false }));
      }
    }
  };

  const getLeaveDuration = (startStr: string, endStr: string, isHalfDay: boolean) => {
    if (isHalfDay) return 0.5;
    const start = new Date(startStr);
    const end = new Date(endStr);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    let days = 0;
    const current = new Date(start);
    while (current <= end) {
      const dayOfWeek = current.getDay();
      if (dayOfWeek !== 0) { // Mon-Sat working schedule
        days++;
      }
      current.setDate(current.getDate() + 1);
    }
    return days;
  };

  const getConflicts = (currentLeave: any) => {
    if (currentLeave.status === 'REJECTED' || currentLeave.status === 'CANCELLED') return [];
    const currentStart = new Date(currentLeave.startDate);
    const currentEnd = new Date(currentLeave.endDate);
    
    return leaves.filter((other: any) => {
      if (other.id === currentLeave.id) return false;
      if (other.status === 'REJECTED' || other.status === 'CANCELLED') return false;
      if (other.user?.department?.id !== currentLeave.user?.department?.id) return false;
      
      const otherStart = new Date(other.startDate);
      const otherEnd = new Date(other.endDate);
      return !(currentEnd < otherStart || currentStart > otherEnd);
    });
  };

  const checkApprovalAllowed = (leave: any) => {
    if (!user) return { allowed: false, reason: 'Not logged in' };
    if (leave.userId === user.id) return { allowed: false, reason: 'Self-approval not allowed' };
    if (leave.status !== 'PENDING') return { allowed: false, reason: `Already ${leave.status.toLowerCase()}` };

    const roleName = (user.role as any)?.name ?? user.role ?? '';
    const isHrOrAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(roleName) || (user as any).isHR;
    
    if (!isHrOrAdmin && !['MANAGER', 'TEAM_LEAD'].includes(roleName)) {
      return { allowed: false, reason: 'View only' };
    }

    const ROLE_LEVEL: Record<string, number> = {
      SUPER_ADMIN: 0, ADMIN: 1, MANAGER: 2, TEAM_LEAD: 3, EMPLOYEE: 4, INTERN: 5,
    };
    const reqLevel = ROLE_LEVEL[leave.user?.role?.name ?? 'EMPLOYEE'] ?? 4;
    const myLevel = ROLE_LEVEL[roleName] ?? 4;
    
    if (myLevel >= reqLevel) {
      return { allowed: false, reason: 'Self-approval not allowed (Cannot approve same or higher role level)' };
    }

    if (isHrOrAdmin) return { allowed: true };

    // Check department match
    const isDeptMatch = (user as any).departmentId && leave.user?.department?.id === (user as any).departmentId;
    if (!isDeptMatch) {
      return { allowed: false, reason: 'Outside your department scope' };
    }

    return { allowed: true };
  };

  const queryParams = tab === 'mine' ? { userId: user?.id } : tab === 'pending' ? { status: 'PENDING' } : {};

  const { data: leaveData, isLoading, isError, refetch } = useQuery({
    queryKey: ['leave', tab],
    queryFn: () => leaveApi.getAll(queryParams) as Promise<any>,
  });
  // API returns { items, total, page, limit, totalPages } — unwrap for backward compat
  const leaves: any[] = Array.isArray(leaveData) ? leaveData : (leaveData?.items ?? []);

  const { data: stats } = useQuery({
    queryKey: ['leave-stats'],
    queryFn: () => leaveApi.getStats() as Promise<any>,
  });

  const { data: myBalance, isLoading: loadingMyBalance } = useQuery({
    queryKey: ['my-leave-balance', user?.id],
    queryFn: () => leaveApi.getBalance() as Promise<any>,
    enabled: !!user,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => leaveApi.create(data),
    onSuccess: () => {
      toast.success('Leave request submitted!');
      qc.invalidateQueries({ queryKey: ['leave'] });
      qc.invalidateQueries({ queryKey: ['leave-stats'] });
      qc.invalidateQueries({ queryKey: ['my-leave-balance'] });
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
      qc.invalidateQueries({ queryKey: ['my-leave-balance'] });
    },
    onError: (err: any) => toast.error(err?.message || 'You do not have permission to perform this action.'),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => leaveApi.reject(id),
    onSuccess: () => {
      toast.success('Rejected');
      qc.invalidateQueries({ queryKey: ['leave'] });
      qc.invalidateQueries({ queryKey: ['leave-stats'] });
      qc.invalidateQueries({ queryKey: ['my-leave-balance'] });
    },
    onError: (err: any) => toast.error(err?.message || 'You do not have permission to perform this action.'),
  });

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Leave Management</h2>
            <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-650 px-2 py-0.5 rounded-full dark:bg-slate-800 dark:text-slate-400">
              {scopeText}
            </span>
          </div>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Manage leave requests and approvals. Click a row to expand details.</p>
        </div>
        <button onClick={() => setShowNew(true)} className="apex-btn-new-ticket">
          <Plus size={16} />Apply Leave
        </button>
      </div>

      {/* Stats & Personal Leave Balance */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="md:col-span-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
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
        <div className="md:col-span-1 apex-card p-4 flex flex-col justify-between" style={{ minHeight: '120px' }}>
          <p className="text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--text-secondary)' }}>My Leave Balance</p>
          {loadingMyBalance ? (
            <p className="text-sm font-semibold animate-pulse mt-2">Loading balance...</p>
          ) : myBalance ? (
            <div className="mt-2">
              <p className="text-3xl font-extrabold text-indigo-500">{myBalance.balance} <span className="text-xs font-normal text-slate-500">days</span></p>
              <p className="text-[10px] text-slate-400 mt-1 font-mono">Allocation: {myBalance.allocation}d · Approved: {myBalance.approved}d</p>
            </div>
          ) : (
            <p className="text-xs text-slate-500 mt-2">No balance data available</p>
          )}
        </div>
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
        ) : isError ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3">
            <p className="text-sm" style={{ color: 'var(--color-danger)' }}>Failed to load leave requests.</p>
            <button onClick={() => refetch()} className="apex-btn apex-btn-secondary text-xs">Retry</button>
          </div>
        ) : Array.isArray(leaves) && leaves.length > 0 ? (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {leaves.map((leave: any) => {
              const conflicts = getConflicts(leave);
              const duration = getLeaveDuration(leave.startDate, leave.endDate, leave.isHalfDay);
              const balanceData = balances[leave.userId];
              const isLoadingBalance = loadingBalances[leave.userId];
              const approvalState = checkApprovalAllowed(leave);

              return (
                <div key={leave.id} className="border-b last:border-0 hover:bg-slate-50/45 dark:hover:bg-slate-800/10 transition-colors">
                  <div
                    onClick={() => toggleExpand(leave.id, leave.userId)}
                    className="flex items-center gap-4 px-5 py-4 cursor-pointer"
                  >
                    <div className="w-9 h-9 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-xs font-semibold">{getInitials(leave.user?.name || '')}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{leave.user?.name}</p>
                        <span className="text-xs text-slate-400">({leave.user?.role?.name || 'Employee'})</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs font-semibold text-indigo-650 bg-indigo-50 dark:bg-indigo-950/30 dark:text-indigo-400 px-2 py-0.5 rounded">{leave.type}</span>
                        <span style={{ color: 'var(--border-primary)' }}>·</span>
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{formatDate(leave.startDate)} – {formatDate(leave.endDate)}</span>
                        {leave.user?.department && (
                          <><span style={{ color: 'var(--border-primary)' }}>·</span><span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{leave.user.department.name}</span></>
                        )}
                      </div>
                      {leave.reason && <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-tertiary)' }}>{leave.reason}</p>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium', LEAVE_STATUS_COLORS[leave.status])}>
                        {leave.status}
                      </span>
                      {approvalState.allowed && (
                        <div className="flex gap-1">
                          <button
                            onClick={() => approveMutation.mutate(leave.id)}
                            className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                            title="Approve Leave"
                          >
                            <CheckCircle size={15} />
                          </button>
                          <button
                            onClick={() => rejectMutation.mutate(leave.id)}
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            title="Reject Leave"
                          >
                            <XCircle size={15} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Expandable Details Drawer */}
                  {expandedId === leave.id && (
                    <div className="px-14 pb-4 pt-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/10 space-y-3">
                      {/* 2-column info */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                        <div className="space-y-1.5">
                          <p className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Employment Context</p>
                          <p><span className="text-slate-500 font-medium">Role:</span> <span className="text-slate-800 dark:text-gray-200 font-semibold">{leave.user?.role?.name ?? 'Employee'}</span></p>
                          <p><span className="text-slate-500 font-medium">Department:</span> <span className="text-slate-800 dark:text-gray-200 font-semibold">{leave.user?.department?.name ?? 'None'}</span></p>
                          <p><span className="text-slate-500 font-medium">Reporting TL/Manager:</span> <span className="text-slate-800 dark:text-gray-200 font-semibold">{leave.user?.teamLeadName || leave.user?.reportingManager || 'N/A'}</span></p>
                        </div>
                        <div className="space-y-1.5">
                          <p className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Request Details</p>
                          <p><span className="text-slate-500 font-medium">Duration:</span> <span className="text-slate-800 dark:text-gray-200 font-semibold">{duration} working days {leave.isHalfDay && `(Half-day: ${leave.halfDayType || 'First Half'})`}</span></p>
                          <p><span className="text-slate-500 font-medium">Reason:</span> <span className="text-slate-800 dark:text-gray-200">{leave.reason}</span></p>
                          {leave.status !== 'PENDING' && (
                            <p><span className="text-slate-500 font-medium">Processed by:</span> <span className="text-slate-800 dark:text-gray-200 font-semibold">{leave.approvedBy || leave.rejectedBy || 'System'}</span></p>
                          )}
                        </div>
                      </div>

                      {/* Leave Balance Section */}
                      <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
                        <p className="text-slate-400 font-semibold uppercase tracking-wider text-[10px] mb-1.5">Leave Balance Decision Support</p>
                        {isLoadingBalance ? (
                          <p className="text-xs text-slate-500 animate-pulse">Loading leave balance details...</p>
                        ) : balanceData ? (
                          <div className="flex items-center gap-6 text-xs bg-white dark:bg-slate-800/40 p-2.5 rounded-lg border border-slate-150 dark:border-slate-800 w-fit">
                            <div>
                              <p className="text-slate-405" style={{ color: 'var(--text-secondary)' }}>Quota</p>
                              <p className="font-bold" style={{ color: 'var(--text-primary)' }}>{balanceData.allocation} days</p>
                            </div>
                            <div className="w-px h-6 bg-slate-200 dark:bg-slate-700" />
                            <div>
                              <p className="text-slate-405" style={{ color: 'var(--text-secondary)' }}>Approved</p>
                              <p className="font-bold text-slate-700 dark:text-slate-350">{balanceData.approved} days</p>
                            </div>
                            <div className="w-px h-6 bg-slate-200 dark:bg-slate-700" />
                            <div>
                              <p className="text-slate-405" style={{ color: 'var(--text-secondary)' }}>Pending</p>
                              <p className="font-bold text-slate-700 dark:text-slate-350">{balanceData.pending} days</p>
                            </div>
                            <div className="w-px h-6 bg-slate-200 dark:bg-slate-700" />
                            <div>
                              <p className="text-slate-405" style={{ color: 'var(--text-secondary)' }}>Balance Before</p>
                              <p className="font-bold" style={{ color: 'var(--text-primary)' }}>{balanceData.balance} days</p>
                            </div>
                            <div className="w-px h-6 bg-slate-200 dark:bg-slate-700" />
                            <div>
                              <p className="text-slate-405" style={{ color: 'var(--text-secondary)' }}>Balance After Approval</p>
                              <p className={cn("font-extrabold", balanceData.balance - duration < 0 ? "text-red-500" : "text-emerald-500")}>
                                {Math.max(0, balanceData.balance - duration)} days
                              </p>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500">Failed to load leave balance.</p>
                        )}
                      </div>

                      {/* Conflict / Overlap warning */}
                      {conflicts.length > 0 && (
                        <div className="flex items-start gap-1.5 p-2 bg-amber-50 dark:bg-amber-955/20 text-amber-800 dark:text-amber-300 rounded-lg text-xs border border-amber-250/50">
                          <span className="font-bold">⚠️ Overlap Conflict:</span>
                          <span>
                            {conflicts.map((c: any) => c.user?.name).join(', ')} {conflicts.length === 1 ? 'is' : 'are'} also on leave during this period.
                          </span>
                        </div>
                      )}

                      {/* Read-only Explanations */}
                      {!approvalState.allowed && leave.status === 'PENDING' && (
                        <div className="flex items-center gap-1.5 text-xs text-slate-450 dark:text-gray-400 font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                          <span>Approval disabled: {approvalState.reason}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
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
