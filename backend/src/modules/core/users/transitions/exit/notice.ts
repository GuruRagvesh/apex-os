/**
 * Notice-period arithmetic (decision D2/D3). Pure: no clock, no database.
 *
 * Notice is counted in CALENDAR days: 15 on probation, 30 once confirmed.
 * The last working day (LWD) is resignedOn + noticeDays. A contract term
 * (with a reference) or a management adjustment/waiver (with a reason) may
 * override the default. Separation happens after the END of the LWD in the
 * company timezone, so access ends at the START of LWD+1 there.
 */

import { fromZonedTime } from 'date-fns-tz';
import { addDays } from '../transitions-codes';

export const DEFAULT_NOTICE_DAYS = { PROBATION: 15, CONFIRMED: 30 } as const;
export const MAX_NOTICE_DAYS = 180;

export type ProbationStatus = 'PROBATION' | 'CONFIRMED';
export type NoticeSource = 'POLICY_PROBATION' | 'POLICY_CONFIRMED' | 'CONTRACT' | 'MANAGEMENT_ADJUSTMENT';

export function defaultNotice(status: ProbationStatus): { noticeDays: number; noticeSource: NoticeSource } {
  return status === 'PROBATION'
    ? { noticeDays: DEFAULT_NOTICE_DAYS.PROBATION, noticeSource: 'POLICY_PROBATION' }
    : { noticeDays: DEFAULT_NOTICE_DAYS.CONFIRMED, noticeSource: 'POLICY_CONFIRMED' };
}

export function lastWorkingDay(resignedOn: string, noticeDays: number): string {
  return addDays(resignedOn, noticeDays);
}

/** Start of `day` in the company timezone, as a UTC instant. */
export function companyDayStart(day: string, timezone: string): Date {
  return fromZonedTime(`${day}T00:00:00.000`, timezone);
}

/** The separation instant: start of LWD+1, company time. Access ends here. */
export function separationDueAt(lwd: string, timezone: string): Date {
  return companyDayStart(addDays(lwd, 1), timezone);
}

/** Withdrawal closes at the START of the LWD, company time (D6, correction 5). */
export function withdrawalClosesAt(lwd: string, timezone: string): Date {
  return companyDayStart(lwd, timezone);
}

export interface NoticeAdjustment {
  source: NoticeSource;
  noticeDays: number;
  reason?: string | null;
  reference?: string | null;
}

/**
 * Validates an adjustment. Returns a problem string, or null when valid.
 * A waiver is a MANAGEMENT_ADJUSTMENT to 0 days.
 */
export function adjustmentProblem(adj: NoticeAdjustment): string | null {
  if (!Number.isInteger(adj.noticeDays) || adj.noticeDays < 0 || adj.noticeDays > MAX_NOTICE_DAYS) {
    return `Notice must be a whole number of days between 0 and ${MAX_NOTICE_DAYS}.`;
  }
  if (adj.source === 'CONTRACT' && !(adj.reference ?? '').trim()) return 'A contract override needs the contract reference.';
  if (adj.source === 'MANAGEMENT_ADJUSTMENT' && !(adj.reason ?? '').trim()) return 'A management adjustment or waiver needs a reason.';
  if (adj.source === 'POLICY_PROBATION' || adj.source === 'POLICY_CONFIRMED') return 'Choose a contract term or a management adjustment.';
  return null;
}
