import { api, unwrap as r } from '@apex/shared-auth';

/**
 * Company holiday calendar, read-only.
 *
 * A holiday is a date the COMPANY does not work. It is not leave entitlement,
 * and the two are never merged in the UI: see leave-balance-api.ts.
 *
 * `past` is computed server-side from company time rather than the browser
 * clock, so an employee in another timezone sees the same answer the
 * attendance evaluator does.
 */

export interface Holiday {
  id: string;
  /** yyyy-MM-dd company business date. */
  date: string;
  name: string;
  isOptional: boolean;
  past: boolean;
}

export interface HolidayCalendar {
  financialYear: string;
  /** Null when no ACTIVE calendar exists — a real state, not an empty list. */
  calendarName: string | null;
  total: number;
  upcoming: number;
  holidays: Holiday[];
}

export async function getHolidayCalendar(financialYear?: string): Promise<HolidayCalendar> {
  return r(
    api.get('/attendance/calendar/holidays', {
      params: financialYear ? { financialYear } : undefined,
    }),
  );
}

/** The holiday falling on a business date, or null. */
export function holidayOn(calendar: HolidayCalendar | undefined, date: string): Holiday | null {
  return calendar?.holidays.find((h) => h.date === date) ?? null;
}

/**
 * The next `count` holidays that have not yet passed.
 *
 * Uses the server's `past` flag rather than comparing against the browser
 * clock, so this cannot disagree with the calendar the evaluator used.
 */
export function upcomingHolidays(
  calendar: HolidayCalendar | undefined,
  count = 4,
): Holiday[] {
  return (calendar?.holidays ?? [])
    .filter((h) => !h.past)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, count);
}
