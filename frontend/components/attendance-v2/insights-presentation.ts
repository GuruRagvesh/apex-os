import type { MyAttendanceDayV2 } from './my-attendance-v2-api';

/** Counts existing canonical records. No day is classified from clocks or durations. */
export function finalizedRecords(days: MyAttendanceDayV2[]) {
  return days.filter(day => !day.isFuture && !day.isInProgress && day.evaluationState === 'FINALIZED');
}

export function reviewRecords(days: MyAttendanceDayV2[]) {
  return days.filter(day => !day.isFuture && !day.isInProgress &&
    (day.evaluationState === 'NEEDS_REVIEW' || day.outcome === 'UNRESOLVED'));
}

/**
 * The months of a financial year that have started, in order.
 *
 * The year comes from the backend (April to March), so January to March belong to the
 * year that began the previous April and the yearly view never starts in January.
 * Future months are not fetched.
 */
export function monthsInFinancialYear(fy: { months: string[] }, companyDate: string): string[] {
  return fy.months.filter(month => month <= companyDate.slice(0, 7));
}

/**
 * The first month of the neighbouring financial year, or null when that year has not started.
 * Plain arithmetic on the backend-supplied start month, not a second definition of the year.
 */
export function adjacentFinancialYearMonth(
  fy: { startYear: number; endYear: number; startMonth: number },
  delta: -1 | 1,
  companyDate: string,
): string | null {
  const year = delta < 0 ? fy.startYear - 1 : fy.endYear;
  const month = year + '-' + String(fy.startMonth).padStart(2, '0');
  return month <= companyDate.slice(0, 7) ? month : null;
}

/** 'FY 2026-27' from the backend's start and end years. */
export function financialYearTitle(fy: { startYear: number; endYear: number }): string {
  return 'FY ' + fy.startYear + '-' + String(fy.endYear).slice(2);
}

export type TrendMeasure = 'punch' | 'worked';
export function recordedTrendValue(day: MyAttendanceDayV2, measure: TrendMeasure): number | null {
  if (day.isFuture) return null;
  if (measure === 'worked') {
    if (day.isInProgress || day.unavailable.some(field => field.field === 'workedMinutes')) return null;
    return day.workedMinutes !== null && Number.isFinite(day.workedMinutes) ? day.workedMinutes : null;
  }
  if (!day.punchInAt || day.unavailable.some(field => field.field === 'punchInAt')) return null;
  const instant = new Date(day.punchInAt);
  if (!Number.isFinite(instant.getTime())) return null;
  // Chart coordinate only: the recorded instant's time of day in the viewer's zone.
  return instant.getHours() * 60 + instant.getMinutes();
}
