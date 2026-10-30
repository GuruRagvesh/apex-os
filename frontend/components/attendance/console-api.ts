import { api, unwrap as r } from '@apex/shared-auth';
import { reportFileName } from './register-month';

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
  /** False for a former employee shown for the days they have a record. */
  isActive: boolean;
  userId: string;
  name: string;
  employeeId: string | null;
  avatar: string | null;
  photoUrl: string | null;
  department: string | null;
  daysPresent: number;
  daysAbsent: number;
  halfDays: number;
  leaveDays: number;
  leaveBalance: number | null;
  /** Late days: arrivals after the assigned shift start plus grace. */
  latePunchIns: number;
  daysBelowNineHours: number;
  /** Approved comp-off earned in the month, in hours. */
  approvedCompOff: number;
  /** Eligible days not yet settled; never counted as present or absent. */
  unresolvedDays: number;
  /** Blank (null) while any eligible day is unresolved. */
  attendanceCompletionPercentage: number | null;
  provisional: boolean;
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
  /** False while the month is still running. */
  monthComplete: boolean;
  /** True when any figure can still change. */
  provisional: boolean;
  employees: RegisterEmployee[];
}

/**
 * The on-screen Monthly Register. The server builds it from the same report
 * assembler and snapshot as the Excel and CSV downloads, so the three agree.
 */
export async function getRegister(from?: string, to?: string): Promise<RegisterResult> {
  return r(api.get('/attendance/console/register', { params: { from, to } }));
}

/**
 * Downloads the monthly attendance report through the AUTHENTICATED client.
 *
 * Not a plain <a href>: auth is a Bearer token injected by a request
 * interceptor, and a browser-initiated navigation carries no such header, so
 * the link would simply 401. The bytes are fetched with the token attached and
 * handed to the browser as an object URL, which is revoked immediately -- it
 * holds the whole file in memory until it is, and this page stays open all day.
 *
 * Every figure in the file is computed by the server from one snapshot; the
 * browser only names and saves the bytes. `xlsx` is the two-sheet workbook,
 * `zip` the CSV package holding the same two tables.
 */
export async function downloadRegister(month: string, format: 'xlsx' | 'zip'): Promise<void> {
  const blob = await r<Blob>(
    api.get(`/attendance/console/register/export.${format}`, {
      params: { month },
      responseType: 'blob',
    }),
  );

  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    // Named here rather than read from Content-Disposition: the response
    // interceptor returns response.data, so the headers never reach this code.
    // reportFileName() is pinned to the server's own naming by test.
    link.download = reportFileName(month, format);
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

export interface PunchReviewItem {
  id: string;
  status: 'PENDING' | 'REVIEWED' | 'DISMISSED';
  reasonCodes: string[];
  createdAt: string;
  employee: { id: string; name: string; employeeId: string | null };
  evidence: { id: string; type: string; businessDate: string; serverOccurredAt: string; deviceType: string | null; deviceCode: string | null; captureChannel: string | null; deviceLabel: string; source: string };
}
export async function getPunchReviews(status = 'PENDING'): Promise<{ status: string; items: PunchReviewItem[] }> { return r(api.get('/attendance/console/punch-reviews', { params: { status } })); }
export async function resolvePunchReview(id: string, status: 'REVIEWED' | 'DISMISSED', note?: string) { return r(api.post(`/attendance/console/punch-reviews/${id}/resolve`, { status, note })); }
