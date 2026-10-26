import { api, unwrap as r } from '@apex/shared-auth';

export type UnifiedRequestType =
  | 'ATTENDANCE_CORRECTION'
  | 'LEAVE_REQUEST'
  | 'DEPARTMENT_ROLE_TRANSFER'
  | 'PUNCH_EVIDENCE_REVIEW'
  | 'RETENTION_RULE_PROPOSAL'
  | 'LEGAL_HOLD_REQUEST'
  | 'FNF_ADJUSTMENT_REQUEST';

export interface UnifiedReviewItem {
  id: string;
  applicationId: string;
  requestType: UnifiedRequestType;
  requestTypeLabel: string;
  subjectUserId: string | null;
  employee: {
    id: string;
    employeeId: string | null;
    name: string;
    avatar: string | null;
    photoUrl: string | null;
    designation: string | null;
    role: { name: string } | null;
    department: { id: string; name: string } | null;
  } | null;
  reason: string;
  requestDate: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  sourceStatus: string;
  details: Record<string, unknown>;
  assignedReviewer: { id: string; employeeId: string | null; name: string } | null;
}

export interface ForwardCandidate {
  id: string;
  employeeId: string | null;
  name: string;
  role: string;
  department: { id: string; name: string } | null;
}

export interface UnifiedQueueResponse {
  scope: 'team' | 'company';
  total: number;
  items: UnifiedReviewItem[];
}

export interface UnifiedQueueCounts {
  team: number;
  company: number;
  canViewCompany: boolean;
}

const key = (value: string) => encodeURIComponent(value);

export async function getUnifiedReviewQueue(scope: 'team' | 'company'): Promise<UnifiedQueueResponse> {
  return r(api.get('/review-queue', { params: { scope } }));
}

export async function getUnifiedReviewCounts(): Promise<UnifiedQueueCounts> {
  return r(api.get('/review-queue/counts'));
}

export async function getForwardCandidates(type: UnifiedRequestType, id: string): Promise<{ items: ForwardCandidate[] }> {
  return r(api.get(`/review-queue/${key(type)}/${key(id)}/forward-candidates`));
}

export async function decideUnifiedRequest(
  item: Pick<UnifiedReviewItem, 'requestType' | 'id'>,
  decision: 'APPROVE' | 'REJECT',
  reason?: string,
) {
  return r(api.patch(`/review-queue/${key(item.requestType)}/${key(item.id)}/decision`, { decision, reason }));
}

export async function forwardUnifiedRequest(
  item: Pick<UnifiedReviewItem, 'requestType' | 'id'>,
  reviewerId: string,
  reason?: string,
) {
  return r(api.patch(`/review-queue/${key(item.requestType)}/${key(item.id)}/forward`, { reviewerId, reason }));
}
