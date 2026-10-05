import { api, unwrap as r } from '@apex/shared-auth';

/**
 * The canonical attendance report, as the server builds it.
 *
 * ONE FETCH SERVES THE TABLE AND THE DOWNLOAD. Both read
 * GET /attendance/report/:month, which calls one service method, so the
 * spreadsheet cannot contain a different answer from the screen.
 *
 * These types mirror the server's row shapes deliberately and the frontend
 * computes NOTHING from them. Every displayed string -- status, presence,
 * lateness, completion, remarks, data source -- is already decided server-side
 * and rendered verbatim. The console previously read
 * /attendance/console/register, which ran a second, independent calculation.
 */

/** One employee-day. The 26 visible columns, plus machine-readable companions. */
export interface DailyAttendanceReportRow {
  /** Internal key. Not displayed. */
  userId: string;

  employeeName: string;
  employeeId: string;
  department: string;
  designation: string;
  employeeType: string;
  date: string;
  attendanceStatus: string;
  present: string;
  absent: string;
  halfDay: string;
  leave: string;
  punchIn: string;
  punchOut: string;
  totalPresenceTime: string;
  hoursWorked: string;
  breakTime: string;
  lateArrival: string;
  completion: string;
  leaveType: string;
  leaveDeducted: string;
  lwpUnpaid: string;
  compOff: string;
  manualCorrection: string;
  missingPunch: string;
  remarks: string;
  dataSource: string;

  /** For sorting and filtering only. Never rendered in place of the strings. */
  raw: {
    presenceMinutes: number | null;
    workedMinutes: number | null;
    breakMinutes: number | null;
    lateMinutes: number | null;
    requiredMinutes: number | null;
    belowRequirement: boolean | null;
    leaveDeducted: number;
    lwpDeducted: number;
    unresolved: boolean;
  };
}

/** One employee's month. The 19 visible columns. */
export interface MonthlyAttendanceSummaryRow {
  userId: string;

  employeeName: string;
  employeeId: string;
  department: string;
  designation: string;
  employeeType: string;
  workingDays: number;
  presentDays: number;
  absentDays: number;
  halfDays: number;
  leaveDays: number;
  lateDays: number;
  daysBelowNineHours: number;
  totalPresenceHours: number;
  totalWorkHours: number;
  totalBreakHours: number;
  clUsed: number;
  lwpUnpaidDays: number;
  attendanceDeductions: number;
  unresolvedDays: number;
}

export interface AttendanceMonthReport {
  month: string;
  dailyRows: DailyAttendanceReportRow[];
  summaryRows: MonthlyAttendanceSummaryRow[];
  metadata: AttendanceReportMetadata;
}

export interface AttendanceReportMetadata {
  generatedAt: string;
  employees: number;
  days: number;
  unresolvedDays: number;
  employeesWithUnresolved: number;
  /**
   * The late cutoff the server classified these rows against.
   *
   * READ, NEVER ASSUMED. A screen that printed its own "late after 10:30" would
   * be a second copy of the rule, free to drift from the one the rows were
   * actually judged by. `source` says whether it was configured, defaulted, or
   * misconfigured -- the last of which is worth showing somebody.
   */
  lateCutoff: { clock: string; source: string };
}

/** yyyy-MM. */
export async function getAttendanceReport(month: string): Promise<AttendanceMonthReport> {
  return r(api.get(`/attendance/report/${month}`));
}

/**
 * The same month as the approved two-sheet workbook.
 *
 * Fetched through the AUTHENTICATED client rather than a plain link: auth is a
 * Bearer token added by a request interceptor, and a browser navigation carries
 * no such header, so an <a href> would simply 401.
 */
export async function downloadAttendance(month: string): Promise<void> {
  const blob = await r<Blob>(
    api.get(`/attendance/report/${month}/download`, { responseType: 'blob' }),
  );

  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    // Named here rather than read from Content-Disposition: the response
    // interceptor returns response.data, so headers never reach this code. The
    // server uses the same name, pinned by test.
    link.download = `Apex_OS_Attendance_${month}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Revoked immediately: the object URL holds the whole file in memory until
    // it is, and this page stays open all day.
    URL.revokeObjectURL(url);
  }
}
