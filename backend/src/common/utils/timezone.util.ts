import { formatInTimeZone, toZonedTime } from 'date-fns-tz';

export const DEFAULT_COMPANY_TIMEZONE = 'Asia/Kolkata';

export class TimezoneUtil {
  /**
   * Returns the company date boundary (start of today) in UTC for the given timezone.
   * If the current time in Asia/Kolkata is 2026-06-03 14:00, this returns 2026-06-03 00:00:00.000 +05:30.
   * We need the exact UTC Date object representing Midnight in the Company Timezone.
   */
  static getCompanyTodayDate(timezone: string = DEFAULT_COMPANY_TIMEZONE): Date {
    const now = new Date();
    // Get the zoned time representing the current time in the timezone
    const zonedNow = toZonedTime(now, timezone);
    // Set it to midnight in that timezone
    zonedNow.setHours(0, 0, 0, 0);
    // Convert back to UTC Date
    // Wait, date-fns-tz does this better with fromZonedTime or we can just parse the formatted string
    const dateString = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
    const midnightIso = `${dateString}T00:00:00.000`;
    // We parse it as if it's in the target timezone
    // e.g., Date.parse("2026-06-03T00:00:00.000+05:30")
    const offsetString = formatInTimeZone(now, timezone, 'xxx'); // e.g. +05:30
    return new Date(`${midnightIso}${offsetString}`);
  }

  static getCompanyTime(date: Date | string, timezone: string = DEFAULT_COMPANY_TIMEZONE): string {
    return formatInTimeZone(new Date(date), timezone, 'yyyy-MM-dd HH:mm:ssXXX');
  }

  static getCurrentCompanyHour(timezone: string = DEFAULT_COMPANY_TIMEZONE): number {
    const zoned = toZonedTime(new Date(), timezone);
    return zoned.getHours();
  }

  static isLate(
    actualStartTime: Date | null,
    expectedStartTime: string,
    timezone: string = DEFAULT_COMPANY_TIMEZONE,
  ): boolean {
    if (!actualStartTime) return false;
    
    // expectedStartTime is HH:mm
    const actualZoned = toZonedTime(actualStartTime, timezone);
    
    const [hours, minutes] = expectedStartTime.split(':').map(Number);
    const expectedMinutesSinceMidnight = hours * 60 + minutes;
    const actualMinutesSinceMidnight = actualZoned.getHours() * 60 + actualZoned.getMinutes();

    return actualMinutesSinceMidnight > expectedMinutesSinceMidnight;
  }
}
