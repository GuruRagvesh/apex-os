import { api } from '@apex/shared-auth';

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

export interface Regularization {
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
): Promise<Regularization> {
  const res = await api.post('/attendance/regularization', body);
  return res.data;
}

export async function getMyRegularizations(): Promise<Regularization[]> {
  const res = await api.get('/attendance/regularization/me');
  return res.data;
}

/** Requests awaiting this user's decision — their reports', or HR's queue. */
export async function getPendingRegularizations(): Promise<any[]> {
  const res = await api.get('/attendance/regularization/pending');
  return res.data;
}

export async function managerApprove(id: string) {
  const res = await api.patch(`/attendance/regularization/${id}/manager-approve`);
  return res.data;
}

export async function hrApprove(id: string) {
  const res = await api.patch(`/attendance/regularization/${id}/hr-approve`);
  return res.data;
}

export async function rejectRegularization(id: string, reason?: string) {
  const res = await api.patch(`/attendance/regularization/${id}/reject`, { reason });
  return res.data;
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
