import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { toZonedTime, formatInTimeZone } from 'date-fns-tz';
import { isSameDay } from 'date-fns';

export interface ClockSnapshot {
  serverNow: string;
  companyNow: string;
  companyDate: string;
  timezone: string;
  source: 'SERVER_TVA';
  status: 'SYNCED';
}

/**
 * A company financial year, derived from the COMPANY business date.
 *
 * The label is the canonical string form used across attendance policy
 * records (AttendancePolicy.financialYear, HolidayCalendar.financialYear,
 * LeavePolicy.financialYear all already store this shape).
 */
export interface FinancialYear {
  startYear: number;
  endYear: number;
  label: string;
}

/**
 * Inclusive company-business-date bounds of a financial year.
 *
 * Both values use the same @db.Date-safe encoding as companyDateOnly(), so
 * they compare directly against date-only columns (WorkSession.date, and
 * later DailyAttendance.date) without a timezone shift.
 */
export interface FinancialYearBounds {
  start: Date;
  end: Date;
  financialYear: FinancialYear;
}

@Injectable()
export class TVAService {
  constructor(private readonly config: ConfigService) {}

  companyTimezone(): string {
    return this.config.get<string>('COMPANY_TIMEZONE') || 'Asia/Kolkata';
  }

  now(): Date {
    return new Date();
  }

  companyNow(): string {
    return formatInTimeZone(this.now(), this.companyTimezone(), "yyyy-MM-dd'T'HH:mm:ss.SSSXXX");
  }

  companyToday(): string {
    return this.companyBusinessDate();
  }

  /**
   * The company business date ('yyyy-MM-dd') for any instant, or for now.
   *
   * This is the single authority for 'which business day is this?'. It is
   * deliberately derived from the configured company timezone and never from
   * the server's local date: on a UTC host, 2026-08-20T19:15:00Z is already
   * 2026-08-21 in IST and must resolve to 2026-08-21.
   */
  companyBusinessDate(date?: Date): string {
    return formatInTimeZone(date || this.now(), this.companyTimezone(), 'yyyy-MM-dd');
  }

  companyDayStart(date?: Date): Date {
    const tz = this.companyTimezone();
    const targetDate = date || this.now();
    const isoString = formatInTimeZone(targetDate, tz, "yyyy-MM-dd'T'00:00:00.000XXX");
    return new Date(isoString);
  }

  companyDayEnd(date?: Date): Date {
    const tz = this.companyTimezone();
    const targetDate = date || this.now();
    const isoString = formatInTimeZone(targetDate, tz, "yyyy-MM-dd'T'23:59:59.999XXX");
    return new Date(isoString);
  }

  /**
   * Returns the company-timezone calendar date as a Date safe for @db.Date
   * columns (e.g. WorkSession.date). companyDayStart() returns the real
   * midnight-IST instant, which for IST (UTC+5:30) falls on the *previous*
   * UTC calendar day — Prisma's @db.Date mapping reads a Date's UTC
   * calendar date, so storing companyDayStart() there silently shifts every
   * business day back by one. This encodes the date directly as UTC
   * midnight so the stored/queried date matches the intended business day.
   */
  companyDateOnly(date?: Date): Date {
    const tz = this.companyTimezone();
    const targetDate = date || this.now();
    const dateString = formatInTimeZone(targetDate, tz, 'yyyy-MM-dd');
    return new Date(`${dateString}T00:00:00.000Z`);
  }

  /**
   * First month of the company financial year. Defaults to April (4),
   * matching the Indian FY used by TechnoEdge. Configurable through the same
   * ConfigService channel as COMPANY_TIMEZONE.
   *
   * Range is 2-12, not 1-12, on purpose: the FinancialYear label contract is
   * a two-calendar-year span ('2026-2027'). A January start would be a single
   * calendar year and needs a different label contract, so it is treated as
   * unconfigured rather than silently producing a 24-month range.
   */
  financialYearStartMonth(): number {
    const raw = Number(this.config.get<string>('FINANCIAL_YEAR_START_MONTH'));
    return Number.isInteger(raw) && raw >= 2 && raw <= 12 ? raw : 4;
  }

  /**
   * The financial year containing an instant, resolved through the COMPANY
   * business date rather than the server's local date.
   *
   *   2026-04-01 -> 2026-2027
   *   2027-03-31 -> 2026-2027
   *   2027-04-01 -> 2027-2028
   */
  financialYear(date?: Date): FinancialYear {
    const businessDate = this.companyBusinessDate(date);
    const [year, month] = businessDate.split('-').map(Number);
    const startMonth = this.financialYearStartMonth();
    const startYear = month >= startMonth ? year : year - 1;
    return { startYear, endYear: startYear + 1, label: `${startYear}-${startYear + 1}` };
  }

  /**
   * Inclusive company-business-date bounds of a financial year.
   *
   * Accepts an instant, a FinancialYear, a label ('2026-2027'), or nothing
   * (meaning the financial year in progress). Both bounds are encoded exactly
   * as companyDateOnly() encodes a date, so they are directly comparable to
   * @db.Date columns.
   */
  financialYearBounds(input?: Date | FinancialYear | string): FinancialYearBounds {
    const fy = this.resolveFinancialYear(input);
    const startMonth = String(this.financialYearStartMonth()).padStart(2, '0');
    const endMonth = String(((this.financialYearStartMonth() + 10) % 12) + 1).padStart(2, '0');
    const start = new Date(`${fy.startYear}-${startMonth}-01T00:00:00.000Z`);
    const endMonthStart = new Date(`${fy.endYear}-${endMonth}-01T00:00:00.000Z`);
    // Last day of the closing month, leap-year safe: step back one day from
    // the first of the following month in UTC.
    const end = new Date(Date.UTC(
      endMonthStart.getUTCFullYear(),
      endMonthStart.getUTCMonth() + 1,
      0,
    ));
    return { start, end, financialYear: fy };
  }

  private resolveFinancialYear(input?: Date | FinancialYear | string): FinancialYear {
    if (input instanceof Date) return this.financialYear(input);
    if (typeof input === 'string') {
      const startYear = Number(input.split('-')[0]);
      if (!Number.isInteger(startYear)) {
        throw new Error(`Invalid financial year label: ${input}`);
      }
      return { startYear, endYear: startYear + 1, label: `${startYear}-${startYear + 1}` };
    }
    if (input) return input;
    return this.financialYear();
  }

  elapsedMinutes(start: Date, end?: Date): number {
    const endTime = end || this.now();
    const diffMs = endTime.getTime() - start.getTime();
    return Math.max(0, Math.floor(diffMs / 60_000));
  }

  elapsedSeconds(start: Date, end?: Date): number {
    const endTime = end || this.now();
    const diffMs = endTime.getTime() - start.getTime();
    return Math.max(0, Math.floor(diffMs / 1000));
  }

  isSameCompanyDay(a: Date, b: Date): boolean {
    const tz = this.companyTimezone();
    const zonedA = toZonedTime(a, tz);
    const zonedB = toZonedTime(b, tz);
    return isSameDay(zonedA, zonedB);
  }

  getClockSnapshot(): ClockSnapshot {
    return {
      serverNow: this.now().toISOString(),
      companyNow: this.companyNow(),
      companyDate: this.companyToday(),
      timezone: this.companyTimezone(),
      source: 'SERVER_TVA',
      status: 'SYNCED',
    };
  }
}
