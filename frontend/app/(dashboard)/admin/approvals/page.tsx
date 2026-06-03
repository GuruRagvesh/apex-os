'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { changeRequestsApi } from '@/lib/api';
import { useState } from 'react';


export default function ApprovalsPage() {
  const queryClient = useQueryClient();
  const [selectedReq, setSelectedReq] = useState<any>(null);
  const [reason, setReason] = useState('');
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);

  const { data: requests, isLoading } = useQuery({
    queryKey: ['pending-approvals'],
    queryFn: () => changeRequestsApi.listPendingApprovals() as Promise<any[]>,
  });

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
                    <h3 className="font-semibold">{req.requestType.replace(/_/g, ' ')}</h3>
                    <p className="text-sm text-slate-500">
                      Requested by: {req.requestedBy?.name} for {req.targetUser?.name} ({req.targetUser?.employeeId})
                    </p>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 font-medium">
                    {req.status.replace(/_/g, ' ')}
                  </span>
                </div>

                <div className="bg-slate-50 rounded p-3 mb-3 text-sm">
                  <div className="font-medium text-slate-700 mb-1">Requested Changes:</div>
                  {req.changes.map((ch: any, idx: number) => (
                    <div key={idx} className="text-slate-600">
                      <span className="font-medium">{ch.field}:</span> {String(ch.oldValue || 'None')} &rarr; {String(ch.newValue)}
                    </div>
                  ))}
                  {req.reason && <div className="mt-2 text-slate-500 italic">Reason: {req.reason}</div>}
                </div>

                <div className="flex gap-2">
                  <button 
                    className="px-4 py-2 bg-green-600 text-white rounded font-medium hover:bg-green-700 disabled:opacity-50" 
                    onClick={() => approveMutation.mutate(req.id)}
                    disabled={approveMutation.isPending}
                  >
                    {approveMutation.isPending ? 'Processing...' : 'Approve'}
                  </button>
                  <button 
                    className="px-4 py-2 bg-red-600 text-white rounded font-medium hover:bg-red-700" 
                    onClick={() => {
                      setSelectedReq(req.id);
                      setIsRejectModalOpen(true);
                    }}
                  >
                    Reject
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
              <label className="text-sm font-medium mb-2 block">Reason for Rejection</label>
              <input 
                className="w-full border border-slate-300 rounded p-2 text-sm"
                value={reason} 
                onChange={(e) => setReason(e.target.value)} 
                placeholder="Provide a required reason..." 
              />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="px-4 py-2 border border-slate-300 rounded hover:bg-slate-50" onClick={() => setIsRejectModalOpen(false)}>Cancel</button>
              <button 
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50" 
                onClick={() => rejectMutation.mutate({ id: selectedReq, reason })}
                disabled={!reason.trim() || rejectMutation.isPending}
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
