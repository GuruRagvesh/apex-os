import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TVAService } from './tva.service';
import { formatInTimeZone } from 'date-fns-tz';

@Injectable()
export class CompanyDateService {
  constructor(
    private readonly config: ConfigService,
    private readonly tva: TVAService,
  ) {}

  /**
   * Get the company's official timezone.
   * Defaults to 'Asia/Kolkata' as per TVA-011.
   */
  getTimezone(): string {
    return this.tva.companyTimezone();
  }

  /**
   * Get the current date and time.
   */
  getNow(): Date {
    return this.tva.now();
  }

  /**
   * Get midnight (00:00:00.000) of the *current* day in the company timezone,
   * returned as a UTC Date object.
   */
  getTodayStart(): Date {
    return this.tva.companyDayStart();
  }

  /**
   * Get the end of the day (23:59:59.999) in the company timezone,
   * returned as a UTC Date object.
   */
  getTodayEnd(): Date {
    return this.tva.companyDayEnd();
  }

  /**
   * Given any JS Date, returns the start of that day (00:00:00.000) 
   * in the company timezone, as a UTC Date object.
   */
  getStartOfDay(date: Date): Date {
    return this.tva.companyDayStart(date);
  }

  /**
   * Given any JS Date, returns the end of that day (23:59:59.999) 
   * in the company timezone, as a UTC Date object.
   */
  getEndOfDay(date: Date): Date {
    return this.tva.companyDayEnd(date);
  }

  /**
   * Used for date string representation (e.g. YYYY-MM-DD) in the company timezone.
   */
  formatDate(date: Date, formatStr: string = 'yyyy-MM-dd'): string {
    return formatInTimeZone(date, this.getTimezone(), formatStr);
  }
}
