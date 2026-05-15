// ── Role names ────────────────────────────────────────────────────────────────
export const ROLE_NAMES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN:       'ADMIN',
  MANAGER:     'MANAGER',
  TEAM_LEAD:   'TEAM_LEAD',
  EMPLOYEE:    'EMPLOYEE',
  INTERN:      'INTERN',
} as const;

export type RoleName = typeof ROLE_NAMES[keyof typeof ROLE_NAMES];

// ── Status labels ─────────────────────────────────────────────────────────────
export const STATUS_LABELS: Record<string, string> = {
  OPEN:             'Open',
  IN_PROGRESS:      'In Progress',
  REVIEW:           'Under Review',
  PENDING_APPROVAL: 'Pending Approval',
  DONE:             'Done',
  CLOSED:           'Closed',
  REJECTED:         'Rejected',
  TODO:             'To Do',
};

export const PRIORITY_LABELS: Record<string, string> = {
  LOW:      'Low',
  MEDIUM:   'Medium',
  HIGH:     'High',
  CRITICAL: 'Critical',
  URGENT:   'Urgent',
};

export const LEAVE_STATUS_LABELS: Record<string, string> = {
  PENDING:   'Pending',
  APPROVED:  'Approved',
  REJECTED:  'Rejected',
  CANCELLED: 'Cancelled',
};

export const PROJECT_STATUS_LABELS: Record<string, string> = {
  ACTIVE:    'Active',
  ON_HOLD:   'On Hold',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

// ── Department accent colours ─────────────────────────────────────────────────
// Primary source: ticket.department.color (from DB).
// These are fallbacks for cases where color is not stored.
export const DEPT_COLORS: Record<string, string> = {
  'IT':                    '#3b82f6',
  'Facilities':            '#f59e0b',
  'HR':                    '#ec4899',
  'Operations':            '#10b981',
  'Finance':               '#8b5cf6',
  'AI & R&D':              '#6366f1',
  'ID Team':               '#14b8a6',
  'Editors Team':          '#f97316',
  'Content Sales':         '#84cc16',
  'QC Team':               '#ef4444',
  'Marketing':             '#a855f7',
  'Retail Business':       '#06b6d4',
  'Corporate Training':    '#f59e0b',
  'AI & Media Production': '#8b5cf6',
  'Accounts':              '#10b981',
};
