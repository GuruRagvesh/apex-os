import { describeSettlement, settlementBlocking, businessMonthOf } from '../evaluation/attendance-settlement';
import type { AttendanceDayBundle, DayWindow } from './recovery.types';

/**
 * Which days may ever become recovery candidates.
 *
 * Two existing rules are REUSED, not re-invented:
 *
 *   attendance-settlement.ts  — a month that is FINALIZED or SENT is closed for
 *     payroll, and BULK_IMPORT authority is refused by every settlement reason.
 *     Recovery is a bulk operation, so a day in a closed month is never an
 *     automatic candidate; it goes to a human, exactly like a bulk correction.
 *
 *   company time (TVAService) — "today" is the COMPANY business date. The caller
 *     passes it in; nothing here reads a clock.
 *
 * Plus the recovery-specific rules:
 *
 *   LIVE        businessDate >= today      never a candidate
 *   SETTLING    businessDate = yesterday   never a candidate (sessions may still close)
 *   HISTORICAL  older                      may be a candidate
 *
 *   A candidate's own DailyAttendance must have been FINALIZED or locked when it
 *   was captured: only finished history is recoverable automatically.
 *
 *   A bundle containing an OPEN WorkSession (logoutAt = null) is never a
 *   candidate, however old: the scheduler's stale-session auto-close
 *   (SchedulerService.autoCloseMidnightSessions) rewrites every past-dated open
 *   session within fifteen minutes, so inserting one would hand it to a job
 *   that changes history. The rule lives here instead of in the scheduler.
 */

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function dayWindow(businessDate: string, companyToday: string): DayWindow {
  if (businessDate >= companyToday) return 'LIVE';
  if (businessDate === addDays(companyToday, -1)) return 'SETTLING';
  return 'HISTORICAL';
}

export function hasOpenSession(bundle: Pick<AttendanceDayBundle, 'workSessions'>): boolean {
  return bundle.workSessions.some((s) => s.logoutAt === null);
}

/**
 * Reasons a recovery-only bundle is NOT safe to propose for automatic repair.
 * Empty array = passes the safety window. Codes only.
 */
export function recoveryWindowBlockers(input: {
  bundle: AttendanceDayBundle;
  companyToday: string;
  /** AttendanceMonthClose.status for businessMonthOf(businessDate), or null. */
  monthCloseStatus: string | null;
}): string[] {
  const out: string[] = [];
  const window = dayWindow(input.bundle.businessDate, input.companyToday);
  if (window === 'LIVE') out.push('ACTIVE_DAY');
  if (window === 'SETTLING') out.push('SETTLING_DAY');

  const da = input.bundle.dailyAttendance;
  if (!da || !(da.evaluationState === 'FINALIZED' || da.locked === true)) out.push('NOT_FINALIZED_IN_SOURCE');

  // The month is judged by the existing settlement rule with BULK_IMPORT authority.
  // The day facts are deliberately null: the day does not exist in the target yet.
  const blocked = settlementBlocking(
    describeSettlement({ day: null, monthClose: input.monthCloseStatus ? { status: input.monthCloseStatus } : null }),
    'BULK_IMPORT',
  );
  for (const r of blocked) out.push(`MONTH_SETTLED_${r}`);

  if (hasOpenSession(input.bundle)) out.push('OPEN_SESSION');
  return out;
}

export { businessMonthOf };
