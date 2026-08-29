import { api, unwrap as r } from '@apex/shared-auth';

/**
 * Attendance Exception Queue transport (EQ-1).
 *
 * There are two GETs and no POST, because the queue resolves nothing. Every
 * item names an action that already exists elsewhere — approve a correction,
 * record a manual recovery, finalize a day — and the screen links to that
 * surface rather than adding a second way to change attendance.
 *
 * Scope is decided server-side per request. Nothing here can widen it: the
 * filters below only narrow a set the server already decided this person may
 * see.
 */

export type ExceptionCategory =
  | 'MISSING_PUNCH_IN'
  | 'MISSING_PUNCH_OUT'
  | 'OUTSIDE_GEOFENCE'
  | 'LOW_ACCURACY_LOCATION'
  | 'LOCATION_UNVERIFIED'
  | 'PHOTO_MISSING'
  | 'NEEDS_REVIEW'
  | 'PENDING_REGULARIZATION'
  | 'MANUAL_RECOVERY_AWAITING_HR'
  | 'FAILED_OR_EXPIRED_HANDOFF';

export type ResolutionState = 'OPEN' | 'AWAITING_MANAGER' | 'AWAITING_HR';

export type ResolverRole =
  | 'EMPLOYEE_THEN_APPROVAL'
  | 'MANAGER_OR_HR'
  | 'MANAGER_THEN_HR'
  | 'HR_ONLY';

export interface ExceptionItem {
  key: string;
  userId: string;
  employee: {
    id: string;
    name: string;
    employeeId: string | null;
    department: string | null;
  } | null;
  businessDate: string;
  category: ExceptionCategory;
  /** Every category that applies. A day can be several things at once. */
  categories: ExceptionCategory[];
  problem: string;
  whyFlagged: string;
  evidence: Record<string, unknown>;
  resolvableBy: ResolverRole;
  resolvingAction: {
    kind:
      | 'RAISE_REGULARIZATION'
      | 'MANUAL_RECOVERY'
      | 'MANAGER_DECISION'
      | 'HR_DECISION'
      | 'REVIEW_AND_FINALIZE'
      | 'RETRY_PUNCH';
    label: string;
    regularizationId?: string;
  };
  state: ResolutionState;
  raisedAt: string | null;
  sourceIds: {
    dailyAttendanceId?: string;
    regularizationId?: string;
    handoffId?: string;
  };
}

export interface ExceptionQueue {
  from: string;
  to: string;
  scope: 'COMPANY' | 'TEAM';
  summary: {
    total: number;
    employees: number;
    byCategory: Record<string, number>;
    byState: Record<ResolutionState, number>;
  };
  items: ExceptionItem[];
  /** Failures that leave no server record. Shown so an empty queue is not
   *  mistaken for a quiet day. */
  notRepresented: Array<{ what: string; why: string }>;
}

export interface ExceptionFilters {
  from?: string;
  to?: string;
  category?: string;
  state?: string;
  userId?: string;
  department?: string;
}

export async function getExceptions(filters: ExceptionFilters = {}): Promise<ExceptionQueue> {
  return r(api.get('/attendance/exceptions', { params: filters }));
}

export const CATEGORY_LABEL: Record<ExceptionCategory, string> = {
  MISSING_PUNCH_IN: 'No punch in',
  MISSING_PUNCH_OUT: 'No punch out',
  OUTSIDE_GEOFENCE: 'Outside approved location',
  LOW_ACCURACY_LOCATION: 'Location too imprecise',
  LOCATION_UNVERIFIED: 'Location never checked',
  PHOTO_MISSING: 'No photo evidence',
  NEEDS_REVIEW: 'Needs review',
  PENDING_REGULARIZATION: 'Correction requested',
  MANUAL_RECOVERY_AWAITING_HR: 'Manual entry awaiting HR',
  FAILED_OR_EXPIRED_HANDOFF: 'Phone handoff expired',
};

export const STATE_LABEL: Record<ResolutionState, string> = {
  OPEN: 'Not started',
  AWAITING_MANAGER: 'With the manager',
  AWAITING_HR: 'With HR',
};

export const RESOLVER_LABEL: Record<ResolverRole, string> = {
  EMPLOYEE_THEN_APPROVAL: 'Employee, then approval',
  MANAGER_OR_HR: 'Manager or HR',
  MANAGER_THEN_HR: 'Manager, then HR',
  HR_ONLY: 'HR only',
};

/** Where the person acting on this item needs to go. The queue itself changes
 *  nothing, so these are links into the surfaces that already own the action. */
export function actionHref(item: ExceptionItem): string | null {
  switch (item.resolvingAction.kind) {
    case 'MANAGER_DECISION':
      return '/attendance/reviews?mode=manager';
    case 'HR_DECISION':
      return '/attendance/reviews?mode=hr';
    case 'REVIEW_AND_FINALIZE':
    case 'MANUAL_RECOVERY':
      return `/attendance/admin?businessDate=${item.businessDate}`;
    default:
      return null;
  }
}
