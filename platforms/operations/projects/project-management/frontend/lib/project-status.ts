// Project status vocabulary — owned by this component.
//
// Moved verbatim from frontend/lib/utils.ts. It was never a shared utility:
// both consumers are this component's own screens, and shared/utilities'
// own README says domain vocabulary belongs to the feature that owns it.

export const PROJECT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const PROJECT_STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'apex-status-open',
  ON_HOLD: 'apex-status-progress',
  COMPLETED: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
  CANCELLED: 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500',
};
