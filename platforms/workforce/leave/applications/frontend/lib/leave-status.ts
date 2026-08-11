// Leave status vocabulary — owned by this component.
//
// Moved verbatim from frontend/lib/utils.ts. LEAVE_STATUS_COLORS is used by
// LeaveScreen; LEAVE_STATUS_LABELS currently has no consumer but is the same
// vocabulary and moves with its pair rather than being orphaned in legacy.

export const LEAVE_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

export const LEAVE_STATUS_COLORS: Record<string, string> = {
  PENDING: 'apex-badge-warning',
  APPROVED: 'apex-badge-success',
  REJECTED: 'apex-badge-danger',
  CANCELLED: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
};
