import { api, unwrap as r } from '@apex/shared-auth';

/**
 * Attendance correction transport (AR-1).
 *
 * Read and write are both scoped server-side to the authenticated employee, so
 * nothing here carries a user id.
 */

export type RegularizationRequestType =
  | 'MISSING_PUNCH_IN'
  | 'MISSING_PUNCH_OUT'
  | 'INCORRECT_PUNCH_IN'
  | 'INCORRECT_PUNCH_OUT'
  | 'INCORRECT_ATTENDANCE_STATUS'
  // Legacy values remain readable on historical requests.
  | 'MISSING_PUNCH'
  | 'LOCATION_EXCEPTION'
  | 'FACE_EXCEPTION'
  | 'LATE_CORRECTION'
  | 'HALF_DAY_CORRECTION'
  /** Review-only: status / worked-hours / other concerns. Approval never rewrites the official day. */
  | 'OTHER';

export type AttendanceCorrectionConcern =
  | 'MISSING_PUNCH_IN'
  | 'MISSING_PUNCH_OUT'
  | 'WRONG_PUNCH_IN'
  | 'WRONG_PUNCH_OUT'
  | 'INCORRECT_ATTENDANCE_STATUS';

export type RegularizationStatus =
  | 'PENDING'
  | 'STALE_REVIEW_REQUIRED'
  | 'APPROVED'
  | 'MANAGER_APPROVED'
  | 'HR_APPROVED'
  | 'REJECTED';
export interface CorrectionScreenshot { id: string; filename: string; mimeType: string; byteSize: number; createdAt: string; }
export interface OfficialDayView { status: string | null; punchInAt: string | null; punchOutAt: string | null; evaluationState: string | null; locked: boolean; revision: number; fingerprint: string | null; }
export interface Regularization {
  screenshots?: CorrectionScreenshot[]; id: string; date: string; requestType: RegularizationRequestType; reason: string;
  requestedPunchIn: string | null; requestedPunchOut: string | null; originalPunchIn?: string | null; originalPunchOut?: string | null;
  proposedStatus?: string | null; status: RegularizationStatus; applicationStatus?: 'APPLIED' | 'REVIEW_REQUIRED' | 'NOT_REQUIRED' | null;
  applicationFailureReason?: string | null; decidedByRole?: string | null; decisionReason?: string | null; decidedAt?: string | null;
  entrySource?: string | null; createdById?: string | null;
  decidedBy?: { id: string; name: string } | null;
  managerDecisionAt: string | null; hrDecisionAt: string | null; createdAt: string; current?: OfficialDayView | null;
  eligibleVia?: string | null; user?: { id: string; name: string; email?: string; employeeId?: string | null };
}
export interface RegularizationQueuePage { scope: 'team' | 'company'; page: number; limit: number; total: number; counts: { team: number; company: number | null; canViewCompany: boolean }; items: Regularization[]; }

export interface CreateRegularizationBody {
  businessDate: string;
  requestType?: RegularizationRequestType;
  concern?: AttendanceCorrectionConcern;
  reason: string;
  requestedPunchIn?: string | null;
  requestedPunchOut?: string | null;
}

export async function createRegularization(
  body: CreateRegularizationBody,
  screenshots: File[] = [],
): Promise<Regularization> {
  const concern = body.concern;
  const requestType = body.requestType ?? ({
    MISSING_PUNCH_IN: 'MISSING_PUNCH_IN',
    MISSING_PUNCH_OUT: 'MISSING_PUNCH_OUT',
    WRONG_PUNCH_IN: 'INCORRECT_PUNCH_IN',
    WRONG_PUNCH_OUT: 'INCORRECT_PUNCH_OUT',
    INCORRECT_ATTENDANCE_STATUS: 'INCORRECT_ATTENDANCE_STATUS',
  } as const)[concern!];
  const concernLabel = concern?.toLowerCase().replaceAll('_', ' ');
  const normalized = {
    businessDate: body.businessDate,
    requestType,
    reason: concernLabel ? `[${concernLabel}] ${body.reason}` : body.reason,
    requestedPunchIn: body.requestedPunchIn,
    requestedPunchOut: body.requestedPunchOut,
  };
  if (!screenshots.length) return r(api.post('/attendance/regularization', normalized));
  const payload = new FormData();
  Object.entries(normalized).forEach(([key, value]) => { if (value !== null && value !== undefined) payload.append(key, value); });
  screenshots.forEach(file => payload.append('screenshots', file));
  return r(api.post('/attendance/regularization', payload, { headers: { 'Content-Type': 'multipart/form-data' } }));
}
export async function getMyRegularizations(): Promise<Regularization[]> { return r(api.get('/attendance/regularization/me')); }
export async function getPendingRegularizations(scope: 'team' | 'company', page = 1, limit = 50): Promise<RegularizationQueuePage> { return r(api.get('/attendance/regularization/pending', { params: { scope, page, limit } })); }
export async function getRegularizationCounts(): Promise<RegularizationQueuePage['counts']> { return r(api.get('/attendance/regularization/pending/counts')); }
export async function getHeldRegularizations(): Promise<{ items: Regularization[] }> { return r(api.get('/attendance/regularization/held')); }
export async function decideRegularization(id: string, input: { decision: 'APPROVE' | 'REJECT'; reason: string; reviewedFingerprint?: string | null; confirmCreatorDecision?: boolean }) { return r(api.patch(`/attendance/regularization/${id}/decision`, input)); }
export async function applyHeldRegularization(id: string, reviewedFingerprint?: string | null) { return r(api.post(`/attendance/regularization/${id}/apply`, { reviewedFingerprint })); }
export async function managerApprove(id: string) { return r(api.patch(`/attendance/regularization/${id}/manager-approve`)); }
export async function hrApprove(id: string) { return r(api.patch(`/attendance/regularization/${id}/hr-approve`)); }
export async function rejectRegularization(id: string, reason?: string) { return r(api.patch(`/attendance/regularization/${id}/reject`, { reason })); }
export function stageLabel(status: RegularizationStatus, applicationStatus?: string | null): string {
  if (status === 'APPROVED' && applicationStatus === 'REVIEW_REQUIRED') return 'Approved · needs application';
  if (status === 'APPROVED' && applicationStatus === 'NOT_REQUIRED') return 'Approved · no change needed';
  switch (status) { case 'PENDING': return 'Awaiting decision'; case 'STALE_REVIEW_REQUIRED': return 'Changed · review again'; case 'MANAGER_APPROVED': return 'Legacy · awaiting final decision'; case 'HR_APPROVED': case 'APPROVED': return 'Approved'; case 'REJECTED': return 'Rejected'; default: return status; }
}
export async function getCorrectionScreenshot(requestId: string, screenshotId: string): Promise<Blob> { return r<Blob>(api.get(`/attendance/regularization/${encodeURIComponent(requestId)}/screenshots/${encodeURIComponent(screenshotId)}`, { responseType: 'blob' })); }
