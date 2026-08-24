import { api } from '@apex/shared-auth';

/**
 * HR / manager attendance console transport (HC-1).
 *
 * Scope is decided by the server on every call, so nothing here needs to know
 * whether the caller is HR or a manager — the same endpoints return the data
 * that caller is entitled to.
 */

export interface ConsoleAccess {
  isHr: boolean;
  hasTeam: boolean;
}

export interface AttendanceSummary {
  businessDate: string;
  scope: 'COMPANY' | 'TEAM';
  expectedEmployees: number;
  present: number;
  late: number;
  leave: number;
  lwp: number;
  halfDay: number;
  absent: number;
  holiday: number;
  weeklyOff: number;
  needsReview: number;
  finalized: number;
  notEvaluated: number;
  exceptions: {
    missingPunch: number;
    missingPunchOut: number;
    outsideGeofence: number;
    lowAccuracy: number;
    /** null when the console cannot derive it. Never a fabricated zero. */
    configurationBlocked: number | null;
    partialLeaveFunding: number;
    regularizationPending: number;
  };
}

export interface RosterRow {
  employee: { id: string; name: string; email: string; employeeId: string | null; department: { id: string; name: string } | null };
  status: string | null;
  evaluationState: string;
  punchInAt: string | null;
  punchOutAt: string | null;
  workedMinutes: number | null;
  breakMinutes: number | null;
  exceptionFlags: string[];
  requiresReview: boolean;
  revision: number;
}

export interface EvaluationResult {
  businessDates: string[];
  requested: number;
  evaluated: number;
  unchanged: number;
  skipped: number;
  failed: Array<{ userId: string; businessDate: string; error: string }>;
}

export async function getConsoleAccess(): Promise<ConsoleAccess> {
  const res = await api.get('/attendance/console/access');
  return res.data;
}

export async function getSummary(businessDate?: string): Promise<AttendanceSummary> {
  const res = await api.get('/attendance/console/summary', { params: { businessDate } });
  return res.data;
}

export async function getRoster(params: {
  businessDate?: string;
  status?: string;
  evaluationState?: string;
  page?: number;
  limit?: number;
}): Promise<{ businessDate: string; page: number; limit: number; total: number; rows: RosterRow[] }> {
  const res = await api.get('/attendance/console/roster', { params });
  return res.data;
}

export async function getReviewQueue(from?: string, to?: string) {
  const res = await api.get('/attendance/console/review-queue', { params: { from, to } });
  return res.data;
}

export async function getRegister(from?: string, to?: string) {
  const res = await api.get('/attendance/console/register', { params: { from, to } });
  return res.data;
}

export async function getDayDetail(userId: string, businessDate: string) {
  const res = await api.get(`/attendance/console/detail/${userId}/${businessDate}`);
  return res.data;
}

/** Explicit evaluation. Never called on page load. */
export async function runEvaluation(body: {
  employeeId?: string;
  businessDate?: string;
  startDate?: string;
  endDate?: string;
}): Promise<EvaluationResult> {
  const res = await api.post('/attendance/console/evaluate', body);
  return res.data;
}

export async function finalizeDay(userId: string, businessDate: string) {
  const res = await api.post('/attendance/console/finalize', { userId, businessDate });
  return res.data;
}
