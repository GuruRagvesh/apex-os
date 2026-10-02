import { api, unwrap as r } from '@apex/shared-auth';
import type {
  AttendanceReportMetadata,
  DailyAttendanceReportRow,
  MonthlyAttendanceSummaryRow,
} from './canonical-report-api';

/**
 * The employee's own canonical attendance.
 *
 * THE SAME ROWS HR READS, scoped to the caller by the server. The types are
 * reused from the HR client rather than redeclared, so the two cannot describe
 * the same server shape differently -- and if a column changes, both move
 * together or neither compiles.
 *
 * NOT /attendance/daily. That route re-evaluates history live, so a finalized
 * month can answer differently from the record Finance was given. These routes
 * read the stored official record.
 *
 * NOTHING HERE IS COMPUTED IN THE BROWSER. Every figure the dashboard shows is
 * a field on these responses. A KPI calculated in React would be a second
 * opinion with no way to tell which one payroll used.
 */

export interface MyAttendanceMonth {
  month: string;
  days: DailyAttendanceReportRow[];
  /** null when the employee was not employed during this month at all. */
  summary: MonthlyAttendanceSummaryRow | null;
  metadata: AttendanceReportMetadata;
}

export interface MyAttendanceYear {
  year: string;
  /**
   * Always twelve, in calendar order, including months before the employee
   * joined -- those carry a null summary rather than being omitted, so the
   * caller never has to work out which months are missing.
   */
  months: Array<{ month: string; summary: MonthlyAttendanceSummaryRow | null }>;
}

/** yyyy-MM. */
export async function getMyAttendanceMonth(month: string): Promise<MyAttendanceMonth> {
  return r(api.get(`/attendance/me/month/${month}`));
}

/** yyyy. Twelve monthly summaries, not a year of days. */
export async function getMyAttendanceYear(year: string): Promise<MyAttendanceYear> {
  return r(api.get(`/attendance/me/year/${year}`));
}
