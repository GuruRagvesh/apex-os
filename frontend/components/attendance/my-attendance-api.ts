import { api, unwrap as r } from '@apex/shared-auth';
import type { MonthlyAttendanceSummaryRow } from './canonical-report-api';

/**
 * The employee's own canonical attendance, by YEAR.
 *
 * MONTH IS NOT HERE, DELIBERATELY. EmployeeAttendanceDashboard owns the month
 * through /attendance/employee/me/summary -- the richer, already-tested
 * surface. A second client for the same month would be two ways to ask one
 * question, free to answer differently.
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

export interface MyAttendanceYear {
  year: string;
  /**
   * Always twelve, in calendar order, including months before the employee
   * joined -- those carry a null summary rather than being omitted, so the
   * caller never has to work out which months are missing.
   */
  months: Array<{ month: string; summary: MonthlyAttendanceSummaryRow | null }>;
}

/** yyyy. Twelve monthly summaries, not a year of days. */
export async function getMyAttendanceYear(year: string): Promise<MyAttendanceYear> {
  return r(api.get(`/attendance/me/year/${year}`));
}
