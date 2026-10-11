import { api, unwrap as r } from '@apex/shared-auth';

/**
 * Attendance correction transport (AR-1).
 *
 * Read and write are both scoped server-side to the authenticated employee, so
 * nothing here carries a user id.
 */

export type RegularizationRequestType =
  | 'MISSING_PUNCH'
  | 'LOCATION_EXCEPTION'
  | 'FACE_EXCEPTION'
  | 'LATE_CORRECTION'
  | 'HALF_DAY_CORRECTION';

export type RegularizationStatus =
  | 'PENDING'
  | 'MANAGER_APPROVED'
  | 'HR_APPROVED'
  | 'REJECTED';

export interface CorrectionScreenshot { id: string; filename: string; mimeType: string; byteSize: number; createdAt: string; }

export interface Regularization {
  screenshots?: CorrectionScreenshot[];
  id: string;
  date: string;
  requestType: RegularizationRequestType;
  reason: string;
  requestedPunchIn: string | null;
  requestedPunchOut: string | null;
  status: RegularizationStatus;
  managerDecisionAt: string | null;
  hrDecisionAt: string | null;
  createdAt: string;
}

export interface CreateRegularizationBody {
  businessDate: string;
  requestType: RegularizationRequestType;
  reason: string;
  requestedPunchIn?: string | null;
  requestedPunchOut?: string | null;
}

export async function createRegularization(
  body: CreateRegularizationBody,
  screenshots: File[] = [],
): Promise<Regularization> {
  if (!screenshots.length) return r(api.post('/attendance/regularization', body));
  const payload = new FormData();
  Object.entries(body).forEach(([key, value]) => { if (value !== null && value !== undefined) payload.append(key, value); });
  screenshots.forEach(file => payload.append('screenshots', file));
  return r(api.post('/attendance/regularization', payload, { headers: { 'Content-Type': 'multipart/form-data' } }));
}

export async function getMyRegularizations(): Promise<Regularization[]> {
  return r(api.get('/attendance/regularization/me'));
}

/** Requests awaiting this user's decision — their reports', or HR's queue. */
export async function getPendingRegularizations(): Promise<any[]> {
  return r(api.get('/attendance/regularization/pending'));
}

export async function managerApprove(id: string) {
  return r(api.patch(`/attendance/regularization/${id}/manager-approve`));
}

export async function hrApprove(id: string) {
  return r(api.patch(`/attendance/regularization/${id}/hr-approve`));
}

export async function rejectRegularization(id: string, reason?: string) {
  return r(api.patch(`/attendance/regularization/${id}/reject`, { reason }));
}

/** Plain-language stage label. Never asserts a pay consequence. */
export function stageLabel(status: RegularizationStatus): string {
  switch (status) {
    case 'PENDING':
      return 'Pending manager';
    case 'MANAGER_APPROVED':
      return 'Pending HR';
    case 'HR_APPROVED':
      return 'Approved';
    case 'REJECTED':
      return 'Rejected';
    default:
      return status;
  }
}

export async function getCorrectionScreenshot(requestId: string, screenshotId: string): Promise<Blob> {
  return r<Blob>(api.get(`/attendance/regularization/${encodeURIComponent(requestId)}/screenshots/${encodeURIComponent(screenshotId)}`, { responseType: 'blob' }));
}
