/**
 * The working-day calendar for F&F deadlines, the day-9 escalation, the
 * every-3-working-days reminders and legal-hold reminders (correction 13).
 *
 * Source: the holiday calendar and weekly-off policy on the employee's
 * attendance profile in force on the LWD (for a hold with no exit case, the
 * latest profile). Applied to the dates after the LWD as the standard schedule
 * minus that calendar's (non-optional) holidays, with the weekly offs the
 * policy declares (every Sunday, 2nd and 4th Saturday by default). With no profile, calendar or policy
 * the standard weekday rule is used and the basis says STANDARD_WEEKDAY_FALLBACK,
 * which the caller records as a setup warning.
 *
 * The basis is stored with the settlement so a later calendar edit never
 * rewrites a computed deadline.
 */

import { isStandardScheduledWorkingDay, nthScheduledWorkingDayAfter } from '../../../../operations/leave/leave-rules';
import { dateOnly } from '../transitions-codes';

export const FALLBACK_BASIS = 'STANDARD_WEEKDAY_FALLBACK';
export const FNF_DEADLINE_WORKING_DAYS = 8;
export const ESCALATION_INTERVAL_WORKING_DAYS = 3;

export interface CalendarBasis {
  source: 'PROFILE_CALENDAR' | typeof FALLBACK_BASIS;
  profileId: string | null;
  holidayCalendarId: string | null;
  weeklyOffPolicyId: string | null;
  /** Holidays (YYYY-MM-DD) known when the basis was computed. */
  holidays: string[];
  /** The weekly-off policy flags in force; the standard schedule when null. */
  weeklyOff: { everySunday: boolean; secondSaturday: boolean; fourthSaturday: boolean } | null;
  computedFor: string;
  computedAt: string;
}

export interface WorkingCalendar {
  basis: CalendarBasis;
  isWorkingDay(day: string): boolean;
}

export function calendarFromBasis(basis: CalendarBasis): WorkingCalendar {
  const holidays = new Set(basis.holidays);
  const off = basis.weeklyOff;
  return {
    basis,
    isWorkingDay(day: string) {
      if (!off) return isStandardScheduledWorkingDay(day, holidays);
      if (holidays.has(day)) return false;
      const d = dateOnly(day);
      const dow = d.getUTCDay();
      if (dow === 0) return !off.everySunday;
      if (dow === 6) {
        const ordinal = Math.ceil(d.getUTCDate() / 7);
        if (ordinal === 2) return !off.secondSaturday;
        if (ordinal === 4) return !off.fourthSaturday;
      }
      return true;
    },
  };
}

/** Day N after `from` (exclusive) on this calendar. `from` itself is never day 1. */
export function nthWorkingDayAfter(cal: WorkingCalendar, from: string, n: number): string {
  return nthScheduledWorkingDayAfter(from, n, (d) => cal.isWorkingDay(d));
}

/** The F&F deadline: the end of the 8th scheduled working day after the LWD. */
export function fnfDeadline(cal: WorkingCalendar, lwd: string): string {
  return nthWorkingDayAfter(cal, lwd, FNF_DEADLINE_WORKING_DAYS);
}

/** First escalation: working day 9 after the LWD. */
export function firstEscalationOn(cal: WorkingCalendar, lwd: string): string {
  return nthWorkingDayAfter(cal, lwd, FNF_DEADLINE_WORKING_DAYS + 1);
}

/** The next escalation after one sent on `last`: every 3 working days. */
export function nextEscalationAfter(cal: WorkingCalendar, last: string): string {
  return nthWorkingDayAfter(cal, last, ESCALATION_INTERVAL_WORKING_DAYS);
}

/**
 * Resolves the calendar for a person on `onDay`. Reads only. When anything
 * is missing the result is the standard weekday fallback.
 */
export async function resolveWorkingCalendar(db: any, userId: string, onDay: string, now: Date): Promise<WorkingCalendar> {
  const at = dateOnly(onDay);
  const profile =
    (await db.employeeAttendanceProfile.findFirst({
      where: { userId, effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }] },
      orderBy: { effectiveFrom: 'desc' },
      select: { id: true, assignedHolidayCalendarId: true, assignedWeeklyOffPolicyId: true },
    })) ??
    (await db.employeeAttendanceProfile.findFirst({
      where: { userId },
      orderBy: { effectiveFrom: 'desc' },
      select: { id: true, assignedHolidayCalendarId: true, assignedWeeklyOffPolicyId: true },
    }));

  const fallback = (): WorkingCalendar =>
    calendarFromBasis({
      source: FALLBACK_BASIS, profileId: profile?.id ?? null, holidayCalendarId: null, weeklyOffPolicyId: null,
      holidays: [], weeklyOff: null, computedFor: onDay, computedAt: now.toISOString(),
    });

  if (!profile?.assignedHolidayCalendarId || !profile?.assignedWeeklyOffPolicyId) return fallback();

  const [calendar, policy] = await Promise.all([
    db.holidayCalendar.findUnique({ where: { id: profile.assignedHolidayCalendarId } }).catch(() => null),
    db.weeklyOffPolicy.findUnique({ where: { id: profile.assignedWeeklyOffPolicyId } }).catch(() => null),
  ]);
  if (!calendar || !policy) return fallback();

  // Holidays for the window an F&F deadline and its escalations can reach.
  const to = new Date(at.getTime() + 120 * 86_400_000);
  const holidayRows = await db.holiday
    .findMany({ where: { calendarId: calendar.id, isOptional: false, date: { gte: at, lte: to } }, select: { date: true } })
    .catch(() => [] as Array<{ date: Date }>);

  return calendarFromBasis({
    source: 'PROFILE_CALENDAR',
    profileId: profile.id,
    holidayCalendarId: calendar.id,
    weeklyOffPolicyId: policy.id,
    holidays: holidayRows.map((h: { date: Date }) => h.date.toISOString().slice(0, 10)).sort(),
    weeklyOff: { everySunday: !!policy.everySunday, secondSaturday: !!policy.secondSaturday, fourthSaturday: !!policy.fourthSaturday },
    computedFor: onDay,
    computedAt: now.toISOString(),
  });
}
