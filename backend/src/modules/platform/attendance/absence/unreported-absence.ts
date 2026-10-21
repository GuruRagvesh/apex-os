/**
 * Three-day unreported absence (Phase 3), the pure rule.
 *
 * A run of at least three CONSECUTIVE scheduled working days on which the
 * employee has no punch evidence, no work session, no leave application (any
 * status except cancelled) and no recorded report of the absence becomes Leave
 * Without Pay. Weekly offs and holidays are skipped over without breaking the
 * run and without counting toward it. A day outside the employee's attendance
 * profile (not employed, not yet configured) breaks the run: nothing is
 * concluded across an inactive gap.
 *
 * Paid balance is deliberately not consulted: having balance left does not
 * turn an unreported absence into paid leave.
 */

export const UNREPORTED_RUN_THRESHOLD = 3;

export interface DayFact {
  businessDate: string;
  /** False for weekly offs and holidays. */
  isWorkingDay: boolean;
  /** False when no attendance profile covers the date. */
  covered: boolean;
  /** Any punch, work session, leave application or recorded report. */
  reported: boolean;
}

export interface UnreportedRun {
  runStartDate: string;
  days: string[];
}

/** Runs of unreported working days of at least the threshold length. */
export function findUnreportedRuns(facts: readonly DayFact[], threshold = UNREPORTED_RUN_THRESHOLD): UnreportedRun[] {
  const sorted = [...facts].sort((a, b) => a.businessDate.localeCompare(b.businessDate));
  const runs: UnreportedRun[] = [];
  let current: string[] = [];
  const close = () => {
    if (current.length >= threshold) runs.push({ runStartDate: current[0], days: current });
    current = [];
  };
  for (const day of sorted) {
    if (!day.covered) {
      close();
      continue;
    }
    if (!day.isWorkingDay) continue;
    if (day.reported) {
      close();
      continue;
    }
    current.push(day.businessDate);
  }
  close();
  return runs;
}
