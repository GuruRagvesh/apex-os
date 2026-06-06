import { toZonedTime, formatInTimeZone } from 'date-fns-tz';
import { startOfDay } from 'date-fns';

/**
 * Company Date Authority for Frontend
 * Ensures "today" calculations always respect the official company timezone,
 * regardless of the user's browser timezone.
 */

export const COMPANY_TIMEZONE = 'Asia/Kolkata';

export function getCompanyNow(): Date {
  return new Date();
}

/**
 * Get midnight (00:00:00.000) of the *current* day in the company timezone,
 * returned as a UTC Date object.
 */
export function getCompanyTodayStart(): Date {
  return getCompanyStartOfDay(new Date());
}

/**
 * Get the end of the day (23:59:59.999) in the company timezone,
 * returned as a UTC Date object.
 */
export function getCompanyTodayEnd(): Date {
  return getCompanyEndOfDay(new Date());
}

export function getCompanyStartOfDay(date: Date): Date {
  const zonedTime = toZonedTime(date, COMPANY_TIMEZONE);
  const startOfZonedDay = startOfDay(zonedTime);
  const isoString = formatInTimeZone(date, COMPANY_TIMEZONE, "yyyy-MM-dd'T'00:00:00.000XXX");
  return new Date(isoString);
}

export function getCompanyEndOfDay(date: Date): Date {
  const isoString = formatInTimeZone(date, COMPANY_TIMEZONE, "yyyy-MM-dd'T'23:59:59.999XXX");
  return new Date(isoString);
}

export function formatCompanyDate(date: Date, formatStr: string = 'yyyy-MM-dd'): string {
  return formatInTimeZone(date, COMPANY_TIMEZONE, formatStr);
}
