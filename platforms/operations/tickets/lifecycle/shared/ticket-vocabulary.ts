// Ticket presentation vocabulary — owned by this component.
//
// Moved verbatim from frontend/lib/utils.ts, which is retired by this change.
// Every one of these presents TICKET data: status, category, department accent
// and the requester's role, as rendered by the ticket screens, ticket-row and
// the ticket rollup on the user detail screen.
//
// Priority vocabulary is deliberately NOT here: the Prisma Priority enum backs
// Project as well as Ticket, so it lives in shared/configuration.
//
// CATEGORY_LABELS, CATEGORY_COLORS and ROLE_LABELS currently have no consumer.
// They moved with their vocabulary rather than being orphaned in legacy, and are
// published only because they belong to the same contract.

export const STATUS_COLORS: Record<string, string> = {
  PENDING_APPROVAL: 'bg-amber-100 text-amber-700 border-amber-200',
  OPEN: 'apex-status-open',
  IN_PROGRESS: 'apex-status-progress',
  REVIEW: 'apex-status-review',
  DONE: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700',
  CLOSED: 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700',
};

export const CATEGORY_COLORS: Record<string, string> = {
  IT: 'bg-indigo-100 text-indigo-700',
  FACILITIES: 'bg-amber-100 text-amber-700',
  HR: 'bg-pink-100 text-pink-700',
  OPERATIONS: 'bg-emerald-100 text-emerald-700',
  PROJECT: 'bg-cyan-100 text-cyan-700',
  ADMIN: 'bg-gray-100 text-gray-700',
};

export const STATUS_LABELS: Record<string, string> = {
  PENDING_APPROVAL: 'Pending Approval',
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  REVIEW: 'Under Review',
  DONE: 'Done',
  CLOSED: 'Closed',
  TODO: 'To Do',
};

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  TEAM_LEAD: 'Team Lead',
  EMPLOYEE: 'Employee',
  INTERN: 'Intern',
};

export const CATEGORY_LABELS: Record<string, string> = {
  IT: 'IT',
  FACILITIES: 'Facilities',
  HR: 'Human Resources',
  OPERATIONS: 'Operations',
  PROJECT: 'Project',
  ADMIN: 'Admin',
};

export const DEPT_COLORS: Record<string, string> = {
  'IT':                     '#3b82f6',
  'Facilities':             '#f59e0b',
  'HR':                     '#ec4899',
  'Operations':             '#10b981',
  'Accounts':               '#8b5cf6',
  'AI & R&D':               '#6366f1',
  'ID Team':                '#14b8a6',
  'Editors Team':           '#f97316',
  'Content Sales':          '#84cc16',
  'QC Team':                '#ef4444',
  'Marketing':              '#a855f7',
  'Retail Business':        '#06b6d4',
  'Corporate Training':     '#f59e0b',
  'AI & Media Production':  '#8b5cf6',
};

export function formatRole(role?: string | { name?: string } | null): string {
  const name = typeof role === 'string' ? role : role?.name ?? '';
  if (!name) return '';
  return ROLE_LABELS[name] ?? name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
