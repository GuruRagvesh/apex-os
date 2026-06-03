'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { changeRequestsApi, departmentsApi, usersApi, rolesApi } from '@/lib/api';
import { useState, useMemo } from 'react';
import { ArrowRight, CheckCircle, XCircle } from 'lucide-react';

const REQUEST_TYPES = [
  { label: 'Designation', value: 'DESIGNATION_CHANGE' },
  { label: 'Department', value: 'DEPARTMENT_CHANGE' },
  { label: 'Team Lead', value: 'TEAM_LEAD_CHANGE' },
  { label: 'Department Manager', value: 'REPORTING_MANAGER_CHANGE' },
  { label: 'Role', value: 'ROLE_CHANGE' },
  { label: 'Leadership Responsibility', value: 'LEADERSHIP_RESPONSIBILITY_CHANGE' },
  { label: 'Multiple Changes', value: 'MULTI_FIELD_CHANGE' },
];

const MULTI_FIELDS = [
  { label: 'Designation', value: 'designation' },
  { label: 'Department', value: 'departmentId' },
  { label: 'Team Lead', value: 'teamLeadName' },
  { label: 'Department Manager', value: 'reportingManager' },
  { label: 'Role', value: 'roleId' },
];


export default function ApprovalsPage() {
  const queryClient = useQueryClient();
  const [selectedReq, setSelectedReq] = useState<any>(null);
  const [reason, setReason] = useState('');
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);

  const { data: requests, isLoading } = useQuery({
    queryKey: ['pending-approvals'],
    queryFn: () => changeRequestsApi.listPendingApprovals() as Promise<any[]>,
  });

  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: () => departmentsApi.getAll() as Promise<any> });
  const { data: allUsers } = useQuery({ queryKey: ['users-list'], queryFn: () => usersApi.getAll() as Promise<any> });
  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: () => rolesApi.getAll() as Promise<any> });

  const getLabel = (field: string, val: string) => {
    if (!val || val === 'None') return val || 'None';
    if (field === 'departmentId') return departments?.find((d:any) => d.id === val)?.name || val;
    if (field === 'reportingManager' || field === 'primaryManager') {
      const u = (allUsers?.users || []).find((u:any) => u.employeeId === val);
      return u ? `${u.name} (${u.employeeId})` : val;
    }
    if (field === 'roleId') return roles?.find((r:any) => r.id === val)?.name || val;
    return val;
  };

  const approveMutation = useMutation({
    mutationFn: (id: string) => changeRequestsApi.approve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-approvals'] });
      alert('Request approved');
    },
    onError: (err: any) => alert(err.message || 'Failed to approve'),
  });

  const rejectMutation = useMutation({
    mutationFn: (data: { id: string; reason: string }) => changeRequestsApi.reject(data.id, data.reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-approvals'] });
      setIsRejectModalOpen(false);
      setReason('');
      alert('Request rejected');
    },
    onError: (err: any) => alert(err.message || 'Failed to reject'),
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-6">Pending Approvals</h1>
        
        <div className="divide-y divide-slate-100">
          {isLoading ? (
            <div className="space-y-4">
              <div className="h-16 w-full rounded-lg bg-slate-100 animate-pulse" />
              <div className="h-16 w-full rounded-lg bg-slate-100 animate-pulse" />
            </div>
          ) : requests && requests.length > 0 ? (
            requests.map((req) => (
              <div key={req.id} className="py-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h3 className="font-semibold text-slate-800 text-lg">{REQUEST_TYPES.find(r => r.value === req.requestType)?.label || req.requestType}</h3>
                    <p className="text-sm text-slate-500 mt-0.5">
                      Requested by <span className="font-medium text-slate-700">{req.requestedBy?.name}</span> for <span className="font-medium text-indigo-700">{req.targetUser?.name} ({req.targetUser?.employeeId})</span>
                    </p>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 font-medium whitespace-nowrap">
                    Pending Your Approval
                  </span>
                </div>

                <div className="bg-slate-50 rounded-lg p-4 mb-4 border border-slate-100">
                  <div className="font-medium text-slate-700 mb-2">Requested Changes:</div>
                  <div className="space-y-2 mb-3">
                    {req.changes.map((ch: any, idx: number) => (
                      <div key={idx} className="flex items-center gap-3 text-sm">
                        <span className="font-medium text-slate-600 w-32">{MULTI_FIELDS.find(f => f.value === ch.field)?.label || ch.field}:</span>
                        <span className="px-2.5 py-1 bg-slate-200 text-slate-600 rounded text-xs line-through">{getLabel(ch.field, ch.oldValue) || 'None'}</span>
                        <ArrowRight size={14} className="text-slate-400" />
                        <span className="px-2.5 py-1 bg-indigo-100 text-indigo-700 font-medium rounded text-xs">{getLabel(ch.field, ch.newValue)}</span>
                      </div>
                    ))}
                  </div>
                  {req.reason && (
                    <div className="mt-2 text-sm text-slate-600 bg-white p-3 rounded border border-slate-200">
                      <span className="font-medium">Reason: </span>{req.reason}
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <button 
                    className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded font-medium hover:bg-green-700 disabled:opacity-50 transition-colors shadow-sm" 
                    onClick={() => approveMutation.mutate(req.id)}
                    disabled={approveMutation.isPending}
                  >
                    <CheckCircle size={16} /> {approveMutation.isPending ? 'Processing...' : 'Approve Request'}
                  </button>
                  <button 
                    className="flex items-center gap-1.5 px-4 py-2 bg-red-600 text-white rounded font-medium hover:bg-red-700 transition-colors shadow-sm" 
                    onClick={() => {
                      setSelectedReq(req.id);
                      setIsRejectModalOpen(true);
                    }}
                  >
                    <XCircle size={16} /> Reject
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center text-slate-500 py-10">
              No pending approvals in your queue.
            </div>
          )}
        </div>
      </div>

      {isRejectModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold mb-4">Reject Change Request</h3>
            <div className="py-2">
              <label className="text-sm font-medium mb-2 block">Reason for Rejection (Optional)</label>
              <input 
                className="w-full border border-slate-300 rounded p-2 text-sm"
                value={reason} 
                onChange={(e) => setReason(e.target.value)} 
                placeholder="Provide a reason..." 
              />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="px-4 py-2 border border-slate-300 rounded hover:bg-slate-50" onClick={() => setIsRejectModalOpen(false)}>Cancel</button>
              <button 
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50" 
                onClick={() => rejectMutation.mutate({ id: selectedReq, reason })}
                disabled={rejectMutation.isPending}
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
