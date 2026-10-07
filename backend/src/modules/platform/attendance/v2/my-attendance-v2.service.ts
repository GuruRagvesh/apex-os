import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';
import { DailyAttendanceEvaluatorService } from '../evaluation/daily-attendance-evaluator.service';
import {
  mapDay,
  mapToday,
  type MyAttendanceDayV2,
  type MyAttendanceMonthV2,
  type MyAttendanceTodayV2,
} from './my-attendance-v2.contract';

/**
 * My Attendance V2 read service.
 *
 * READ-ONLY by construction. It calls the existing evaluator, which already
 * evaluates without persisting, and adds two WorkSession facts the V2 contract
 * needs and the evaluator result does not carry: whether any contributing
 * session was auto-closed, and whether a session exists for the day at all.
 *
 * It does NOT:
 *   - write anything
 *   - recompute any attendance figure
 *   - resolve any policy
 *   - decide any outcome
 *
 * Every verdict comes from the evaluator. This service arranges facts.
 *
 * SCOPE. Every method takes the authenticated userId from the controller, and
 * no path accepts an employee id from a caller, so this surface cannot be
 * pointed at another employee.
 */
@Injectable()
export class MyAttendanceV2Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly evaluator: DailyAttendanceEvaluatorService,
  ) {}

  /** Today plus the requested month — one round trip for the page. */
  async overview(
    userId: string,
    month: string,
  ): Promise<{ today: MyAttendanceTodayV2; month: MyAttendanceMonthV2 }> {
    const companyToday = this.tva.companyToday();
    const [year, monthNumber] = month.split('-').map(Number);

    const [today, days] = await Promise.all([
      this.today(userId, companyToday),
      this.monthDays(userId, month, companyToday),
    ]);

    return { today, month: { year, month: monthNumber, days } };
  }

  async today(userId: string, companyToday?: string): Promise<MyAttendanceTodayV2> {
    const date = companyToday ?? this.tva.companyToday();
    const result = await this.evaluator.evaluate(userId, date);
    const sessions = await this.sessionFacts(userId, date, date);

    return mapToday({
      result,
      date,
      companyToday: date,
      anySessionAutoClosed: sessions.autoClosed.has(date),
      hasWorkEvidence: sessions.present.has(date),
      // An open day has nothing settled to correct yet, so the action is not
      // offered. Whether the request would be ACCEPTED remains the
      // regularization route's decision; this is only whether to show it.
      correctionAllowed: !result.exceptionFlags.includes('WORKDAY_STILL_OPEN'),
    });
  }

  async day(userId: string, date: string): Promise<MyAttendanceDayV2> {
    const companyToday = this.tva.companyToday();

    // A future date is answered without evaluating anything: Document 1 §4 says
    // no row exists, and asking the evaluator would be asking it to judge a day
    // that has not happened.
    if (date > companyToday) {
      return mapDay({ result: null, date, companyToday });
    }

    const result = await this.evaluator.evaluate(userId, date);
    const sessions = await this.sessionFacts(userId, date, date);

    return mapDay({
      result,
      date,
      companyToday,
      anySessionAutoClosed: sessions.autoClosed.has(date),
      hasWorkEvidence: sessions.present.has(date),
    });
  }

  /**
   * Every date in the month.
   *
   * Dates after today are returned as empty days so the calendar can render a
   * complete grid without the frontend inventing cells — but they are never
   * evaluated, and they carry no figures.
   */
  private async monthDays(
    userId: string,
    month: string,
    companyToday: string,
  ): Promise<MyAttendanceDayV2[]> {
    const dates = datesInMonth(month);
    if (dates.length === 0) return [];

    const sessions = await this.sessionFacts(userId, dates[0], dates[dates.length - 1]);

    const days: MyAttendanceDayV2[] = [];
    for (const date of dates) {
      if (date > companyToday) {
        days.push(mapDay({ result: null, date, companyToday }));
        continue;
      }
      // Sequential on purpose, matching the existing employee range route: each
      // evaluation hits the database several times, and firing 31 of them
      // concurrently is a burst against a small production instance for no
      // user-visible gain.
      const result = await this.evaluator.evaluate(userId, date);
      days.push(
        mapDay({
          result,
          date,
          companyToday,
          anySessionAutoClosed: sessions.autoClosed.has(date),
          hasWorkEvidence: sessions.present.has(date),
        }),
      );
    }
    return days;
  }

  /**
   * The two WorkSession facts the V2 contract needs, for a whole range.
   *
   * `WorkSession.date` is a DATE column, so it is compared as a date and
   * converted back to yyyy-MM-dd for keying. Read in one query rather than per
   * day, because the per-day evaluation loop is already the expensive part.
   */
  private async sessionFacts(
    userId: string,
    from: string,
    to: string,
  ): Promise<{ autoClosed: Set<string>; present: Set<string> }> {
    const rows = await this.prisma.workSession.findMany({
      where: {
        userId,
        date: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
      },
      select: { date: true, autoClosed: true },
    });

    const autoClosed = new Set<string>();
    const present = new Set<string>();
    for (const row of rows) {
      const key = row.date.toISOString().slice(0, 10);
      present.add(key);
      if (row.autoClosed) autoClosed.add(key);
    }
    return { autoClosed, present };
  }
}

/** Every yyyy-MM-dd in a yyyy-MM month, walked in UTC to avoid DST surprises. */
export function datesInMonth(month: string): string[] {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(monthNumber)) return [];

  const out: string[] = [];
  const cursor = new Date(Date.UTC(year, monthNumber - 1, 1));
  while (cursor.getUTCMonth() === monthNumber - 1) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
