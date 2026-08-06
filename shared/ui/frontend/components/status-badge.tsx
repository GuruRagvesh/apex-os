import React from 'react';
import { cn } from '@apex/shared-utilities';

interface StatusBadgeProps {
  status: string;
  type?: 'ticket' | 'leave';
  className?: string;
}

export function StatusBadge({ status, type = 'ticket', className }: StatusBadgeProps) {
  if (type === 'leave') {
    switch (status) {
      case 'PENDING':
        return <span className={cn("apex-badge-warning px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", className)}>Pending</span>;
      case 'APPROVED':
        return <span className={cn("apex-badge-success px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", className)}>Approved</span>;
      case 'REJECTED':
        return <span className={cn("apex-badge-danger px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", className)}>Rejected</span>;
      case 'CANCELLED':
        return <span className={cn("bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded", className)}>Cancelled</span>;
      default:
        return <span className={cn("bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded text-[10px] font-bold uppercase", className)}>{status}</span>;
    }
  }

  // Ticket statuses
  switch (status) {
    case 'OPEN':
      return <span className={cn("apex-status-open px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded", className)}>Open</span>;
    case 'IN_PROGRESS':
      return <span className={cn("apex-status-progress px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded", className)}>In Progress</span>;
    case 'REVIEW':
      return <span className={cn("apex-status-review px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded", className)}>In Review</span>;
    case 'DONE':
      // Calmer done
      return <span className={cn("bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded", className)}>Done</span>;
    case 'CLOSED':
      return <span className={cn("bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded", className)}>Closed</span>;
    case 'BLOCKED':
      return <span className={cn("apex-badge-danger px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", className)}>Blocked</span>;
    default:
      return <span className={cn("bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded text-[10px] font-bold uppercase", className)}>{status}</span>;
  }
}

export function PriorityBadge({ priority, className }: { priority: string, className?: string }) {
  switch (priority) {
    case 'LOW':
      return <span className={cn("bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider", className)}>Low</span>;
    case 'MEDIUM':
      return <span className={cn("apex-status-open px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded", className)}>Medium</span>;
    case 'HIGH':
      return <span className={cn("apex-status-progress px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded", className)}>High</span>;
    case 'URGENT':
      // Solid red for urgent
      return <span className={cn("bg-red-600 text-white shadow-[0_0_8px_rgba(220,38,38,0.4)] px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider", className)}>Urgent</span>;
    default:
      return null;
  }
}
