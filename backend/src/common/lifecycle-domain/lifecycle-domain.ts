/**
 * Lifecycle domain vocabulary (Phase 1 foundation).
 *
 * TypeScript mirrors of the lifecycle enums in schema.prisma, plus the
 * read-time derivations that give legacy rows their meaning without ever
 * rewriting them. Every later phase reads lifecycle state through these
 * helpers so that "legacy" is decided in exactly one place.
 */

export const EMPLOYMENT_STATES = ['SCHEDULED_TO_JOIN', 'ACTIVE', 'DEACTIVATED', 'ARCHIVED'] as const;
export type EmploymentStateValue = (typeof EMPLOYMENT_STATES)[number];

export const SETUP_ISSUE_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'WAIVED'] as const;
export type SetupIssueStatusValue = (typeof SETUP_ISSUE_STATUSES)[number];

/**
 * Setup-issue codes that may be WAIVED. Empty in Phase 1: mandatory issues
 * (missing legacy employee ID, missing joining date, pending rehire terms and
 * the rest) can only be OPEN, ACKNOWLEDGED or RESOLVED.
 */
export const WAIVABLE_SETUP_ISSUE_CODES: readonly string[] = [];

export const LEGAL_HOLD_STATUSES = ['REQUESTED', 'ACTIVE', 'REJECTED', 'WITHDRAWN', 'RELEASED'] as const;
export type LegalHoldStatusValue = (typeof LEGAL_HOLD_STATUSES)[number];

export const LEAVE_SUBMISSION_MODES = ['STANDARD', 'EMERGENCY'] as const;
export type LeaveSubmissionModeValue = (typeof LEAVE_SUBMISSION_MODES)[number];

/** Stored setup statuses, plus the API-only value for rows that predate them. */
export type LeaveSetupStatusValue = 'RESOLVED' | 'POLICY_SETUP_PENDING' | 'LEGACY_UNASSESSED';

export const LEAVE_FUNDING_BUCKETS = ['CASUAL', 'SICK'] as const;
export type LeaveFundingBucketValue = (typeof LEAVE_FUNDING_BUCKETS)[number];

export const EXIT_CASE_STATES = ['NOTICE_RUNNING', 'CLEARANCE_IN_PROGRESS', 'CLEARED', 'WITHDRAWN', 'COMPLETED'] as const;
export const FNF_STATES = ['NOT_STARTED', 'ON_HOLD_REVIEW_REQUIRED', 'READY_FOR_RELEASE', 'RELEASED'] as const;
export const ROUTING_TIERS = [
  'ORIGINAL_REVIEWER', 'EMPLOYEE_TL', 'ORIGINAL_DEPT_TL', 'ORIGINAL_DEPT_MANAGER',
  'DEPT_TL', 'DEPT_MANAGER', 'COMPANY_MANAGER', 'HR', 'ADMIN',
] as const;

/**
 * The person's employment state. A stored value wins; otherwise it is derived
 * exactly as before Phase 1: active users are ACTIVE, users whose latest
 * lifecycle event is an archive are ARCHIVED, and everyone else DEACTIVATED.
 * `isActive` stays the login authority until every reader is migrated.
 */
export function deriveEmploymentState(
  user: { employmentState?: string | null; isActive: boolean },
  latestLifecycleEvent?: string | null,
  archiveEventNames: readonly string[] = ['USER_ARCHIVED_AFTER_BACKUP', 'USER_ARCHIVED'],
): EmploymentStateValue {
  if (user.employmentState && (EMPLOYMENT_STATES as readonly string[]).includes(user.employmentState)) {
    return user.employmentState as EmploymentStateValue;
  }
  if (user.isActive) return 'ACTIVE';
  if (latestLifecycleEvent && archiveEventNames.includes(latestLifecycleEvent)) return 'ARCHIVED';
  return 'DEACTIVATED';
}

/** Legacy leave rows have no submissionMode: an EMERGENCY type reads as EMERGENCY, anything else as STANDARD. */
export function deriveLeaveSubmissionMode(leave: { submissionMode?: string | null; type: string }): LeaveSubmissionModeValue {
  if (leave.submissionMode === 'STANDARD' || leave.submissionMode === 'EMERGENCY') return leave.submissionMode;
  return leave.type === 'EMERGENCY' ? 'EMERGENCY' : 'STANDARD';
}

/** Legacy leave rows were never assessed: NULL reads as LEGACY_UNASSESSED, never as RESOLVED. */
export function deriveLeaveSetupStatus(leave: { setupStatus?: string | null }): LeaveSetupStatusValue {
  if (leave.setupStatus === 'RESOLVED' || leave.setupStatus === 'POLICY_SETUP_PENDING') return leave.setupStatus;
  return 'LEGACY_UNASSESSED';
}

/** NULL means unknown for legacy rows; it is never read as "on time". */
export function deriveLateSubmission(leave: { isLateSubmission?: boolean | null }): boolean | null {
  return typeof leave.isLateSubmission === 'boolean' ? leave.isLateSubmission : null;
}

export interface HoldRow {
  status?: string | null;
  releasedAt?: Date | string | null;
}

/**
 * The single hold reader. ACTIVE and REQUESTED holds block Permanent Delete, and
 * so does a legacy row (status NULL) that was never released -- exactly what
 * such a row meant before Phase 1. REJECTED, WITHDRAWN and RELEASED do not.
 */
export function isHoldActive(row: HoldRow): boolean {
  if (row.status === 'ACTIVE' || row.status === 'REQUESTED') return true;
  if (row.status === null || row.status === undefined) return row.releasedAt === null || row.releasedAt === undefined;
  return false;
}

/** How a hold reads on screens and in remediation. LEGACY_ACTIVE is a pre-migration row that blocks like ACTIVE. */
export type HoldStatusView = 'ACTIVE' | 'REQUESTED' | 'LEGACY_ACTIVE';

export function holdStatusOf(row: HoldRow): HoldStatusView | null {
  if (row.status === 'ACTIVE') return 'ACTIVE';
  if (row.status === 'REQUESTED') return 'REQUESTED';
  if ((row.status === null || row.status === undefined) && (row.releasedAt === null || row.releasedAt === undefined)) return 'LEGACY_ACTIVE';
  return null;
}

/**
 * The strongest blocking hold among a person's rows: an ACTIVE (or legacy-active)
 * hold outranks a REQUESTED one. Null when nothing blocks.
 */
export function strongestHold(rows: HoldRow[]): HoldStatusView | null {
  const views = rows.map(holdStatusOf).filter((v): v is HoldStatusView => v !== null);
  if (views.includes('ACTIVE')) return 'ACTIVE';
  if (views.includes('LEGACY_ACTIVE')) return 'LEGACY_ACTIVE';
  if (views.includes('REQUESTED')) return 'REQUESTED';
  return null;
}

/** Prisma where-fragment selecting exactly the rows isHoldActive() accepts (a fresh object per call). */
export function activeHoldWhere(): { OR: Array<Record<string, unknown>> } {
  return { OR: [{ status: { in: ['ACTIVE', 'REQUESTED'] } }, { status: null, releasedAt: null }] };
}
