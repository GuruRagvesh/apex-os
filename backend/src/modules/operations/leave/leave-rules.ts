/**
 * Leave rules (Phase 3), as pure functions.
 *
 * Paid leave is two independent annual buckets from the versioned LeavePolicy:
 * 10 Casual and 4 Sick, 14 in total. Emergency is a SUBMISSION MODE funded from
 * one of those two buckets, never a third bucket, so no reader can arrive at
 * 18. Comp Off and Unpaid are separate and never draw on either bucket.
 */

export type PaidBucket = 'CASUAL' | 'SICK';
export const PAID_BUCKETS: readonly PaidBucket[] = ['CASUAL', 'SICK'];

/** Leave types a NEW request may carry. Historical types stay readable. */
export const NEW_REQUEST_TYPES = ['CASUAL', 'SICK', 'COMP_OFF', 'UNPAID'] as const;

/**
 * Which paid bucket a leave row draws from.
 *
 * An explicit fundingBucket wins. Otherwise by type: CASUAL draws Casual and
 * SICK draws Sick. Historical types are mapped without rewriting them:
 * EMERGENCY (the retired 4-day pool) draws Sick one-for-one, so an employee who
 * used their old Emergency days cannot receive another 4 Sick days; ANNUAL and
 * OTHER (the old pooled entitlement) draw Casual. COMP_OFF and UNPAID draw
 * nothing.
 */
export function bucketOf(row: { type: string; fundingBucket?: string | null }): PaidBucket | null {
  if (row.fundingBucket === 'CASUAL' || row.fundingBucket === 'SICK') return row.fundingBucket;
  switch (row.type) {
    case 'CASUAL':
    case 'ANNUAL':
    case 'OTHER':
      return 'CASUAL';
    case 'SICK':
    case 'EMERGENCY':
      return 'SICK';
    default:
      return null;
  }
}

/** The allocation for one bucket from a resolved LeavePolicy row. */
export function allocationFor(
  policy: { casualLeaveAllocation: number; sickLeaveAllocation: number },
  bucket: PaidBucket,
): number {
  return bucket === 'CASUAL' ? policy.casualLeaveAllocation : policy.sickLeaveAllocation;
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
