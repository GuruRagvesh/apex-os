import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { toZonedTime, formatInTimeZone } from 'date-fns-tz';
import { startOfDay, endOfDay } from 'date-fns';

@Injectable()
export class CompanyDateService {
  constructor(private readonly config: ConfigService) {}

  /**
   * Get the company's official timezone.
   * Defaults to 'Asia/Kolkata' as per TVA-011.
   */
  getTimezone(): string {
    return this.config.get<string>('COMPANY_TIMEZONE') || 'Asia/Kolkata';
  }

  /**
   * Get the current date and time.
   */
  getNow(): Date {
    return new Date();
  }

  /**
   * Get midnight (00:00:00.000) of the *current* day in the company timezone,
   * returned as a UTC Date object.
   */
  getTodayStart(): Date {
    return this.getStartOfDay(new Date());
  }

  /**
   * Get the end of the day (23:59:59.999) in the company timezone,
   * returned as a UTC Date object.
   */
  getTodayEnd(): Date {
    return this.getEndOfDay(new Date());
  }

  /**
   * Given any JS Date, returns the start of that day (00:00:00.000) 
   * in the company timezone, as a UTC Date object.
   */
  getStartOfDay(date: Date): Date {
    const tz = this.getTimezone();
    // 1. Interpret the point in time in the target timezone
    const zonedTime = toZonedTime(date, tz);
    // 2. Find the start of the day in that timezone's calendar
    const startOfZonedDay = startOfDay(zonedTime);
    // 3. To get the precise moment in UTC, we can format it to ISO and parse it
    // formatInTimeZone takes the original date, but we actually want the exact 
    // midnight of that day in that timezone.
    const isoString = formatInTimeZone(date, tz, "yyyy-MM-dd'T'00:00:00.000XXX");
    return new Date(isoString);
  }

  /**
   * Given any JS Date, returns the end of that day (23:59:59.999) 
   * in the company timezone, as a UTC Date object.
   */
  getEndOfDay(date: Date): Date {
    const tz = this.getTimezone();
    const isoString = formatInTimeZone(date, tz, "yyyy-MM-dd'T'23:59:59.999XXX");
    return new Date(isoString);
  }

  /**
   * Used for date string representation (e.g. YYYY-MM-DD) in the company timezone.
   */
  formatDate(date: Date, formatStr: string = 'yyyy-MM-dd'): string {
    return formatInTimeZone(date, this.getTimezone(), formatStr);
  }
}
