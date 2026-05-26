'use client';

import React from 'react';
import { FileCheck2, User, Calendar, Check, X, BookmarkCheck } from 'lucide-react';

interface LeaveRequest {
  id: string;
  employeeName?: string;
  employee?: { name?: string };
  dates?: string;
  startDate?: string;
  endDate?: string;
  type?: string;
  leaveType?: string;
  reason?: string;
  status?: string;
}

interface LeavesApproverProps {
  leaves: LeaveRequest[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onViewAllLeaves?: () => void;
}

export default function LeavesApprover({
  leaves,
  onApprove,
  onReject,
  onViewAllLeaves,
}: LeavesApproverProps) {
  const pendingRequestList = leaves.filter(
    (l) => !l.status || l.status === 'PENDING' || l.status === 'pending',
  );

  const getEmployeeName = (req: LeaveRequest) =>
    req.employeeName || req.employee?.name || 'Unknown Employee';

  const getDates = (req: LeaveRequest) => {
    if (req.dates) return req.dates;
    if (req.startDate && req.endDate) return `${req.startDate} – ${req.endDate}`;
    if (req.startDate) return req.startDate;
    return 'Dates not specified';
  };

  const getType = (req: LeaveRequest) => req.type || req.leaveType || 'Annual Leave';

  return (
    <div className="space-y-6">
      <div className="p-3.5 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 rounded-xl flex items-start gap-3">
        <BookmarkCheck className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-800 dark:text-blue-300 leading-relaxed font-sans font-medium">
          The following crew leaves require Team Leader evaluation. Approved applications log to rosters and update team availability counters.
        </p>
      </div>

      <div className="space-y-3.5">
        {pendingRequestList.length === 0 ? (
          <div className="p-8 text-center bg-slate-50 dark:bg-slate-900/20 border rounded-xl border-dashed border-slate-200 dark:border-slate-800 space-y-2">
            <div className="text-2xl">🎉</div>
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">Roster Fully Approved</h4>
            <p className="text-xs text-slate-400 dark:text-slate-500 font-medium font-sans">
              No leave requests are waiting in the queue bounds.
            </p>
          </div>
        ) : (
          pendingRequestList.map((req) => (
            <div
              key={req.id}
              className="p-4 bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-xl space-y-4 hover:shadow-sm hover:border-slate-300 dark:hover:border-slate-700 transition-all group"
            >
              {/* Header info */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-slate-400 dark:text-slate-500 group-hover:text-blue-500 transition-colors">
                    {req.id}
                  </span>
                  <span className="px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-900/40 text-indigo-700 dark:text-indigo-400 font-mono text-[9px] font-bold rounded uppercase tracking-wider">
                    {getType(req)}
                  </span>
                </div>

                <span className="text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded">
                  Pending Approval
                </span>
              </div>

              {/* Title / Name */}
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <User className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
                  <span>{getEmployeeName(req)}</span>
                </h4>
                <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 font-semibold pl-6">
                  <Calendar className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                  <span>Dates: {getDates(req)}</span>
                </div>
              </div>

              {/* Reason */}
              {req.reason && (
                <div className="p-2.5 bg-slate-50 dark:bg-slate-900/60 rounded-lg text-xs text-slate-500 dark:text-slate-400 font-medium font-sans leading-relaxed">
                  <span>Reason: </span>
                  <span className="text-slate-700 dark:text-slate-300 italic">"{req.reason}"</span>
                </div>
              )}

              {/* Buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-1.5 border-t border-slate-50 dark:border-slate-800">
                <button
                  onClick={() => onReject(req.id)}
                  className="px-3.5 py-2 hover:bg-red-50 dark:hover:bg-red-950/25 border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-400 rounded-lg font-bold text-xs flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Reject</span>
                </button>
                <button
                  onClick={() => onApprove(req.id)}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs flex items-center gap-1 shadow-sm cursor-pointer transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Approve Leave</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer controls */}
      <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
        <span className="text-xs text-slate-400 dark:text-slate-500 font-bold font-mono">
          {pendingRequestList.length} Awaiting Review
        </span>
        {onViewAllLeaves && (
          <button
            onClick={onViewAllLeaves}
            className="text-xs px-3.5 py-2 font-bold text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-lg cursor-pointer bg-white dark:bg-slate-900/20"
          >
            View Leave Calendar
          </button>
        )}
      </div>
    </div>
  );
}
