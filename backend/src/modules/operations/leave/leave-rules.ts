/**
 * Leave rules (Phase 3), as pure functions.
 *
 * Paid leave is one annual pool. Historical Casual, Sick, Emergency, Annual and
 * Other rows all consume that same pool without rewriting their stored type.
 * Comp Off and Unpaid remain separate and never draw on annual leave.
 */

export type PaidBucket = 'ANNUAL';
export const PAID_BUCKETS: readonly PaidBucket[] = ['ANNUAL'];

/** Leave types a NEW request may carry. Historical types stay readable. */
export const NEW_REQUEST_TYPES = ['ANNUAL', 'COMP_OFF', 'UNPAID'] as const;

/**
 * Which paid pool a leave row draws from. fundingBucket is intentionally
 * ignored: it remains only as historical evidence of the superseded split.
 */
export function bucketOf(row: { type: string; fundingBucket?: string | null }): PaidBucket | null {
  switch (row.type) {
    case 'CASUAL':
    case 'SICK':
    case 'EMERGENCY':
    case 'ANNUAL':
    case 'OTHER':
      return 'ANNUAL';
    default:
      return null;
  }
}

/** The allocation for one bucket from a resolved LeavePolicy row. */
export function allocationFor(
  policy: { totalPaidLeaves: number },
  _bucket: PaidBucket,
): number {
  return policy.totalPaidLeaves;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The company's standard weekly schedule: Monday to Friday and the 1st, 3rd
 * and 5th Saturdays are working days; Sundays and the 2nd and 4th Saturdays
 * are weekly offs. No WFH/WFO classification exists. Holidays are supplied by
 * the caller from the resolved holiday calendar.
 */
export function isStandardScheduledWorkingDay(businessDate: string, holidays: ReadonlySet<string> = new Set()): boolean {
  if (holidays.has(businessDate)) return false;
  const d = new Date(`${businessDate}T12:00:00.000Z`);
  const dow = d.getUTCDay();
  if (dow === 0) return false;
  if (dow === 6) {
    const ordinal = Math.ceil(d.getUTCDate() / 7);
    return ordinal === 1 || ordinal === 3 || ordinal === 5;
  }
  return true;
}

/**
 * The Nth scheduled working day AFTER `from` (exclusive), e.g. the evidence and
 * review deadlines for an Emergency Leave submitted on `from` (N = 3).
 */
export function nthScheduledWorkingDayAfter(
  from: string,
  n: number,
  isWorkingDay: (businessDate: string) => boolean,
): string {
  let cursor = from;
  let found = 0;
  for (let guard = 0; guard < 120; guard++) {
    cursor = addDays(cursor, 1);
    if (isWorkingDay(cursor)) {
      found += 1;
      if (found === n) return cursor;
    }
  }
  return cursor;
}

/**
 * A STANDARD request is late when it is submitted later than `noticeDays`
 * before its start date. An Emergency submission is never late: same-day is
 * the point of it. Late is a review status, never a penalty.
 */
export function isLateStandardSubmission(submittedOn: string, startDate: string, noticeDays: number): boolean {
  return submittedOn > addDays(startDate, -Math.max(0, noticeDays));
}

/** Days remaining before a deadline (negative once overdue). */
export function daysUntil(today: string, deadline: string): number {
  const a = new Date(`${today}T12:00:00.000Z`).getTime();
  const b = new Date(`${deadline}T12:00:00.000Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}
