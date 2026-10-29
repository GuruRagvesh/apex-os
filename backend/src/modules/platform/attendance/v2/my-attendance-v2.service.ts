import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';
import { DailyAttendanceEvaluatorService } from '../evaluation/daily-attendance-evaluator.service';
import { BusinessCalendarService } from '../calendar/business-calendar.service';
import { EmployeeTimelineService } from '../timeline/employee-timeline.service';
import {
  HISTORICAL_RECOVERY_REASON,
  financialYearV2,
  summarizeAttendanceDays,
  type AttendanceSummaryV2,
  type FinancialYearV2,
  mapDay,
  mapRecoveredDay,
  mapToday,
  type StoredRecoveredDay,
  type MyAttendanceDayDetailV2,
  type MyAttendanceDayV2,
  type MyAttendanceMonthV2,
  type MyAttendanceTodayV2,
  type MyAttendanceWorkSessionV2,
} from './my-attendance-v2.contract';

/**
 * My Attendance V2 read service.
 *
 * READ-ONLY by construction. It calls the existing evaluator, which already
 * evaluates without persisting, and adds stored WorkSession facts the V2
 * contract needs and the evaluator result does not carry. Month reads only add
 * whether a session exists or was auto-closed; the single-day detail read also
 * exposes its recorded session, break, ticket, meeting and note context.
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
    @Optional() private readonly calendar?: BusinessCalendarService,
    @Optional() private readonly timeline?: EmployeeTimelineService,
  ) {}

  /** Today plus the requested month — one round trip for the page. */
  async overview(
    userId: string,
    month: string,
  ): Promise<{ today: MyAttendanceTodayV2; month: MyAttendanceMonthV2; financialYear: FinancialYearV2 }> {
    const companyToday = this.tva.companyToday();
    const [year, monthNumber] = month.split('-').map(Number);

    const [today, days] = await Promise.all([
      this.today(userId, companyToday),
      this.monthDays(userId, month, companyToday),
    ]);

    // The financial year the requested month belongs to, from the ONE company
    // definition (TVAService, April start by default). The screen builds its
    // yearly view from these months and never works out a year of its own.
    const fy = this.tva.financialYear(new Date(`${month}-01T12:00:00.000Z`));
    return {
      today,
      month: { year, month: monthNumber, days, summary: summarizeAttendanceDays(days) },
      financialYear: financialYearV2(fy.startYear, this.tva.financialYearStartMonth()),
    };
  }

  /**
   * Canonical calendar for an already-authorized internal reader.
   *
   * Team dashboards use this after applying their hierarchy scope. Keeping the
   * evaluation here prevents a leader's view from assigning different day
   * colours than the employee's own attendance calendar.
   */
  async calendarMonth(userId: string, month: string): Promise<MyAttendanceMonthV2> {
    const companyToday = this.tva.companyToday();
    const [year, monthNumber] = month.split('-').map(Number);
    const days = await this.monthDays(userId, month, companyToday);
    return { year, month: monthNumber, days, summary: summarizeAttendanceDays(days) };
  }

  /** The authenticated employee's recorded attendance for one backend-defined financial year. */
  async financialYear(
    userId: string,
    label: string,
  ): Promise<{ financialYear: FinancialYearV2; months: MyAttendanceMonthV2[]; summary: AttendanceSummaryV2 }> {
    const bounds = this.tva.financialYearBounds(label);
    const financialYear = financialYearV2(
      bounds.financialYear.startYear,
      this.tva.financialYearStartMonth(),
    );
    const companyToday = this.tva.companyToday();
    const months: MyAttendanceMonthV2[] = [];

    // Keep evaluation bounded and sequential. Each month already batches its
    // stored-session and recovered-row reads, and future dates are never evaluated.
    for (const key of financialYear.months) {
      const [year, month] = key.split('-').map(Number);
      const days = await this.monthDays(userId, key, companyToday);
      months.push({ year, month, days, summary: summarizeAttendanceDays(days) });
    }

    return {
      financialYear,
      months,
      summary: summarizeAttendanceDays(months.flatMap((value) => value.days)),
    };
  }

  async today(userId: string, companyToday?: string): Promise<MyAttendanceTodayV2> {
    const date = companyToday ?? this.tva.companyToday();
    const [result, sessions, calendar] = await Promise.all([
      this.evaluator.evaluate(userId, date),
      this.sessionFacts(userId, date, date),
      this.calendarDay(userId, date),
    ]);

    return mapToday({
      result,
      date,
      companyToday: date,
      anySessionAutoClosed: sessions.autoClosed.has(date),
      hasWorkEvidence: sessions.present.has(date),
      calendar,
      // An open day has nothing settled to correct yet, so the action is not
      // offered. Whether the request would be ACCEPTED remains the
      // regularization route's decision; this is only whether to show it.
      correctionAllowed: !result.exceptionFlags.includes('WORKDAY_STILL_OPEN'),
    });
  }

  async day(userId: string, date: string): Promise<MyAttendanceDayDetailV2> {
    const companyToday = this.tva.companyToday();

    // A future date is answered without evaluating anything: Document 1 §4 says
    // no row exists, and asking the evaluator would be asking it to judge a day
    // that has not happened.
    if (date > companyToday) {
      return { ...mapDay({ result: null, date, companyToday, calendar: await this.calendarDay(userId, date) }), workSessions: [] };
    }

    const workSessions = await this.sessionDetails(userId, date);

    // A recovered historical day is shown as stored: the live evaluator has no
    // policy or profile for those dates and would answer NOT_EMPLOYED.
    const recovered = (await this.recoveredDays(userId, date, date)).get(date);
    if (recovered) return { ...mapRecoveredDay(recovered, companyToday), workSessions };

    const [result, sessions, calendar] = await Promise.all([
      this.evaluator.evaluate(userId, date),
      this.sessionFacts(userId, date, date),
      this.calendarDay(userId, date),
    ]);

    return {
      ...mapDay({
        result,
        date,
        companyToday,
        anySessionAutoClosed: sessions.autoClosed.has(date),
        hasWorkEvidence: sessions.present.has(date),
        calendar,
      }),
      workSessions,
    };
  }

  /**
   * Stored session details for one employee and business date.
   *
   * No duration is calculated here. Work and break durations come from the
   * corresponding stored totals, while a missing value remains null. “For
   * what” is limited to linked ticket work, session notes, or meeting purpose.
   */
  private async sessionDetails(userId: string, date: string): Promise<MyAttendanceWorkSessionV2[]> {
    const rows = await this.prisma.workSession.findMany({
      where: { userId, date: new Date(`${date}T00:00:00.000Z`) },
      orderBy: [{ startWorkAt: 'asc' }, { loginAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        loginAt: true,
        startWorkAt: true,
        logoutAt: true,
        status: true,
        totalWorkMinutes: true,
        autoClosed: true,
        autoClosedAt: true,
        closureReason: true,
        breakLogs: {
          orderBy: { startAt: 'asc' },
          select: {
            id: true,
            breakType: true,
            startAt: true,
            endAt: true,
            durationMinutes: true,
            note: true,
            reason: true,
            meeting: { select: { topic: true, purpose: true, clientName: true } },
          },
        },
        ticketTimeLogs: {
          where: { countsAsWork: true },
          orderBy: { startedAt: 'asc' },
          select: {
            id: true,
            startedAt: true,
            endedAt: true,
            durationSeconds: true,
            ticket: { select: { ticketId: true, title: true } },
          },
        },
        workdayNotes: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, content: true, createdAt: true },
        },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      startedAt: (row.startWorkAt ?? row.loginAt)?.toISOString() ?? null,
      endedAt: row.logoutAt?.toISOString() ?? null,
      workedMinutes: Number.isFinite(row.totalWorkMinutes) ? row.totalWorkMinutes : null,
      status: row.status,
      autoClosed: row.autoClosed,
      autoClosedAt: row.autoClosedAt?.toISOString() ?? null,
      closureReason: row.closureReason ?? null,
      breaks: row.breakLogs.map((entry) => ({
        id: entry.id,
        type: entry.breakType,
        startedAt: entry.startAt.toISOString(),
        endedAt: entry.endAt?.toISOString() ?? null,
        durationMinutes: entry.durationMinutes ?? null,
        note: entry.note ?? entry.reason ?? null,
        purpose: entry.meeting
          ? [entry.meeting.topic, entry.meeting.purpose, entry.meeting.clientName].filter(Boolean).join(' · ') || null
          : null,
      })),
      workItems: row.ticketTimeLogs.map((entry) => ({
        id: entry.id,
        ticketId: entry.ticket.ticketId,
        title: entry.ticket.title,
        startedAt: entry.startedAt.toISOString(),
        endedAt: entry.endedAt?.toISOString() ?? null,
        durationSeconds: entry.durationSeconds ?? null,
      })),
      notes: row.workdayNotes.map((entry) => ({
        id: entry.id,
        content: entry.content,
        createdAt: entry.createdAt.toISOString(),
      })),
    }));
  }

  /**
   * Recovered historical days (calculationReason HISTORICAL_RECOVERY_IMPORT) for
   * one employee, keyed by yyyy-MM-dd. Read-only; nothing else is consulted, so
   * a native day is never replaced by anything here.
   */
  private async recoveredDays(userId: string, from: string, to: string): Promise<Map<string, StoredRecoveredDay>> {
    const rows = await this.prisma.dailyAttendance.findMany({
      where: {
        userId,
        calculationReason: HISTORICAL_RECOVERY_REASON,
        date: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
      },
      select: { date: true, status: true, evaluationState: true, punchInAt: true, punchOutAt: true, workedMinutes: true, exceptionFlags: true },
    });
    const out = new Map<string, StoredRecoveredDay>();
    for (const r of rows) {
      const date = r.date.toISOString().slice(0, 10);
      out.set(date, {
        date,
        status: r.status,
        evaluationState: r.evaluationState,
        punchInAt: r.punchInAt,
        punchOutAt: r.punchOutAt,
        workedMinutes: r.workedMinutes,
        exceptionFlags: (r.exceptionFlags as string[]) ?? [],
      });
    }
    return out;
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
    const recovered = await this.recoveredDays(userId, dates[0], dates[dates.length - 1]);
    const [year, monthNumber] = month.split('-').map(Number);
    const profile = await this.timeline?.findProfileOn(userId, dates[0]);
    const calendarMonth = this.calendar
      ? await this.calendar.classifyMonth(year, monthNumber, {
          holidayCalendarId: profile?.assignedHolidayCalendarId ?? null,
          weeklyOffPolicyId: profile?.assignedWeeklyOffPolicyId ?? null,
          strict: true,
        })
      : null;
    const calendarByDate = new Map((calendarMonth?.days ?? []).map((day) => [day.businessDate, this.toCalendarDay(day)]));

    const days: MyAttendanceDayV2[] = [];
    for (const date of dates) {
      if (date > companyToday) {
        days.push(mapDay({ result: null, date, companyToday, calendar: calendarByDate.get(date) ?? null }));
        continue;
      }
      const stored = recovered.get(date);
      if (stored) {
        days.push(mapRecoveredDay(stored, companyToday));
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
          calendar: calendarByDate.get(date) ?? null,
        }),
      );
    }
    return days;
  }

  private toCalendarDay(day: { isWorkingDay: boolean; reason: string; holidayName: string | null }) {
    return {
      isWorkingDay: day.isWorkingDay,
      status: (day.reason === 'HOLIDAY' || day.reason === 'COMPANY_CLOSURE'
        ? 'HOLIDAY'
        : day.isWorkingDay ? 'WORKING' : 'WEEKLY_OFF') as 'WORKING' | 'WEEKLY_OFF' | 'HOLIDAY',
      reason: day.reason,
      holidayName: day.holidayName,
    };
  }

  private async calendarDay(userId: string, date: string) {
    if (!this.calendar || !this.timeline) return null;
    const profile = await this.timeline.findProfileOn(userId, date);
    const facts = await this.calendar.resolveBusinessDay(date, {
      holidayCalendarId: profile?.assignedHolidayCalendarId ?? null,
      weeklyOffPolicyId: profile?.assignedWeeklyOffPolicyId ?? null,
      strict: true,
    });
    return this.toCalendarDay({
      isWorkingDay: facts.expectedCompanyWorkingDay,
      reason: facts.holiday.isHoliday
        ? 'HOLIDAY'
        : facts.weeklyOff.reasons[0] ?? (facts.expectedCompanyWorkingDay ? 'WORKING' : 'COMPANY_CLOSURE'),
      holidayName: facts.holiday.name,
    });
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
