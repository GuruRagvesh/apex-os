// Operations Tickets — planning date/time in company time.
//
// Start Date / Start Time and Due Date / Due Time on the New Ticket form are
// planning fields: wall-clock values in the company timezone, never in the
// browser's own zone and never a UTC calendar date. They start no timer and
// never set actualStartAt; a new ticket is still created OPEN.

import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

/** The office timezone; mirrors frontend/lib/company-date.ts and the backend default. */
export const PLANNING_TIMEZONE = 'Asia/Kolkata';

/** The current company date ('yyyy-MM-dd') and time ('HH:mm'), for new-row defaults and date minimums. */
export function companyPlanningNow(now: Date = new Date()): { date: string; time: string } {
  return {
    date: formatInTimeZone(now, PLANNING_TIMEZONE, 'yyyy-MM-dd'),
    time: formatInTimeZone(now, PLANNING_TIMEZONE, 'HH:mm'),
  };
}

/**
 * Date + optional time (company wall clock) to an ISO instant. With a time,
 * the wall clock is read in the company timezone. Date only keeps the
 * system's existing convention (18:30 IST = 13:00 UTC). No date, no value.
 */
export function companyWallClockToIso(date: string, time: string): string | undefined {
  if (!date) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  if (!time) return `${date}T13:00:00.000Z`;
  if (!/^\d{2}:\d{2}$/.test(time)) return undefined;
  const instant = fromZonedTime(`${date}T${time}:00.000`, PLANNING_TIMEZONE);
  return Number.isNaN(instant.getTime()) ? undefined : instant.toISOString();
}

/** A date-time-local value ('yyyy-MM-ddTHH:mm') read as company wall clock. */
export function companyDateTimeLocalToIso(value: string): string | undefined {
  if (!value) return undefined;
  const [date, time] = value.split('T');
  if (!date || !time) return undefined;
  return companyWallClockToIso(date, time.slice(0, 5));
}

/** Setting Start Date: clearing it also clears Start Time (a time needs a day). */
export function withStartDate<T extends { startDate: string; startTime: string }>(row: T, startDate: string): T {
  return { ...row, startDate, startTime: startDate ? row.startTime : '' };
}
