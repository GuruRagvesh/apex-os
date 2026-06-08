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
    return formatInTimeZone(this.now(), this.companyTimezone(), 'yyyy-MM-dd');
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
