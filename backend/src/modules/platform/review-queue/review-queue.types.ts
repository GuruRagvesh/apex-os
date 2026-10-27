export const REVIEW_REQUEST_TYPES = [
  'ATTENDANCE_CORRECTION',
  'LEAVE_REQUEST',
  'DEPARTMENT_ROLE_TRANSFER',
  'PUNCH_EVIDENCE_REVIEW',
  'RETENTION_RULE_PROPOSAL',
  'LEGAL_HOLD_REQUEST',
  'FNF_ADJUSTMENT_REQUEST',
] as const;

export type ReviewRequestType = (typeof REVIEW_REQUEST_TYPES)[number];
export type ReviewDecision = 'APPROVE' | 'REJECT';

export interface ReviewQueueEmployee {
  id: string;
  employeeId: string | null;
  name: string;
  avatar: string | null;
  photoUrl: string | null;
  designation: string | null;
  role: { name: string } | null;
  department: { id: string; name: string } | null;
}

export interface ReviewQueueItem {
  id: string;
  applicationId: string;
  requestType: ReviewRequestType;
  requestTypeLabel: string;
  subjectUserId: string | null;
  employee: ReviewQueueEmployee | null;
  reason: string;
  requestDate: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  sourceStatus: string;
  details: Record<string, unknown>;
  assignedReviewer: { id: string; employeeId: string | null; name: string } | null;
}

export const REVIEW_TYPE_LABEL: Record<ReviewRequestType, string> = {
  ATTENDANCE_CORRECTION: 'Attendance Correction',
  LEAVE_REQUEST: 'Leave Request',
  DEPARTMENT_ROLE_TRANSFER: 'Department/Role Transfer',
  PUNCH_EVIDENCE_REVIEW: 'Punch Evidence Review',
  RETENTION_RULE_PROPOSAL: 'Retention Rule Proposal',
  LEGAL_HOLD_REQUEST: 'Legal Hold Request',
  FNF_ADJUSTMENT_REQUEST: 'F&F Adjustment Request',
};

export function isReviewRequestType(value: unknown): value is ReviewRequestType {
  return typeof value === 'string' && (REVIEW_REQUEST_TYPES as readonly string[]).includes(value);
}
