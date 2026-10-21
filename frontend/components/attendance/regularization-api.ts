import { api, unwrap as r } from '@apex/shared-auth';

export type RegularizationRequestType = 'MISSING_PUNCH' | 'LOCATION_EXCEPTION' | 'FACE_EXCEPTION' | 'LATE_CORRECTION' | 'HALF_DAY_CORRECTION' | 'OTHER';
export type RegularizationStatus = 'PENDING' | 'STALE_REVIEW_REQUIRED' | 'APPROVED' | 'REJECTED' | 'MANAGER_APPROVED' | 'HR_APPROVED';
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
export interface CreateRegularizationBody { businessDate: string; requestType: RegularizationRequestType; reason: string; requestedPunchIn?: string | null; requestedPunchOut?: string | null; }
export interface RegularizationQueuePage { scope: 'team' | 'company'; page: number; limit: number; total: number; counts: { team: number; company: number | null; canViewCompany: boolean }; items: Regularization[]; }

export async function createRegularization(body: CreateRegularizationBody, screenshots: File[] = []): Promise<Regularization> {
  if (!screenshots.length) return r(api.post('/attendance/regularization', body));
  const payload = new FormData();
  Object.entries(body).forEach(([key, value]) => { if (value !== null && value !== undefined) payload.append(key, value); });
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
