import type { MyAttendanceDayV2 } from './my-attendance-v2-api';

/** Counts existing canonical records. No day is classified from clocks or durations. */
export function finalizedRecords(days: MyAttendanceDayV2[]) {
  return days.filter(day => !day.isFuture && !day.isInProgress && day.evaluationState === 'FINALIZED');
}

export function reviewRecords(days: MyAttendanceDayV2[]) {
  return days.filter(day => !day.isFuture && !day.isInProgress &&
    (day.evaluationState === 'NEEDS_REVIEW' || day.outcome === 'UNRESOLVED'));
}

/** Calendar navigation only; future months are not fetched. */
export function monthsInYear(year: string, companyDate: string): string[] {
  return Array.from({ length: 12 }, (_, index) => year + '-' + String(index + 1).padStart(2, '0'))
    .filter(month => month <= companyDate.slice(0, 7));
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
