import { api, unwrap as r } from '@apex/shared-auth';
import { monthRange, registerFileName } from './register-month';

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
  return r(api.get('/attendance/console/access'));
}

export async function getSummary(businessDate?: string): Promise<AttendanceSummary> {
  return r(api.get('/attendance/console/summary', { params: { businessDate } }));
}

export async function getRoster(params: {
  businessDate?: string;
  status?: string;
  evaluationState?: string;
  page?: number;
  limit?: number;
}): Promise<{ businessDate: string; page: number; limit: number; total: number; rows: RosterRow[] }> {
  return r(api.get('/attendance/console/roster', { params }));
}

export async function getReviewQueue(from?: string, to?: string) {
  return r(api.get('/attendance/console/review-queue', { params: { from, to } }));
}

/** One employee's row, exactly as the register presents it. */
export interface RegisterEmployee {
  userId: string;
  name: string;
  daysPresent: number;
  daysAbsent: number;
  halfDays: number;
  leaveBalance: number | null;
  latePunchIns: number;
  attendanceCompletionPercentage: number | null;
}

export interface RegisterResult {
  from: string;
  to: string;
  /** yyyy-MM */
  month: string;
  /** Scheduled working days in the WHOLE month, for the header metric. */
  workingDays: number;
  /** Working days elapsed so far, which is what the figures are measured on. */
  elapsedWorkingDays: number;
  /** False when the weekly-off policy could not be resolved, so the total is wrong. */
  calendarResolved: boolean;
  /** Which financial year (April-March) the Leave Balance column answers for. */
  leaveBalanceFinancialYear: string;
  employees: RegisterEmployee[];
}

export async function getRegister(from?: string, to?: string): Promise<RegisterResult> {
  return r(api.get('/attendance/console/register', { params: { from, to } }));
}

/**
 * Downloads the register through the AUTHENTICATED client.
 *
 * Not a plain <a href>: auth is a Bearer token injected by a request
 * interceptor, and a browser-initiated navigation carries no such header, so
 * the link would simply 401. The bytes are fetched with the token attached and
 * handed to the browser as an object URL, which is revoked immediately -- it
 * holds the whole file in memory until it is, and this page stays open all day.
 *
 * The server names the file, and the same server call produces the numbers on
 * screen, so a download can never contain a different answer from the table.
 */
export async function downloadRegister(
  month: string,
  format: 'xlsx' | 'csv',
): Promise<void> {
  const { from, to } = monthRange(month);
  const blob = await r<Blob>(
    api.get(`/attendance/console/register/export.${format}`, {
      params: { from, to },
      responseType: 'blob',
    }),
  );

  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    // Named here rather than read from Content-Disposition: the response
    // interceptor returns response.data, so the headers never reach this code.
    // registerFileName() is pinned to the server's own naming by test.
    link.download = registerFileName(month, format);
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function getDayDetail(userId: string, businessDate: string) {
  return r(api.get(`/attendance/console/detail/${userId}/${businessDate}`));
}

/** Explicit evaluation. Never called on page load. */
export async function runEvaluation(body: {
  employeeId?: string;
  businessDate?: string;
  startDate?: string;
  endDate?: string;
}): Promise<EvaluationResult> {
  return r(api.post('/attendance/console/evaluate', body));
}

export async function finalizeDay(userId: string, businessDate: string) {
  return r(api.post('/attendance/console/finalize', { userId, businessDate }));
}
