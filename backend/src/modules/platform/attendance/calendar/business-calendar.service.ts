import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';
import {
  BusinessCalendarSources,
  BusinessDayFacts,
  BusinessDayOverrideKind,
  CalendarSourceResolution,
  WeeklyOffReason,
} from './business-calendar.types';

/**
 * Business Calendar (Attendance Base Layer, BL-2A).
 *
 * Resolves what a company business date IS, before any employee, punch, leave
 * or attendance status is considered. See business-calendar.types.ts for the
 * contract and why facts are never collapsed into a single label here.
 *
 * Company time is delegated entirely to TVAService — this service never reads
 * the server's local date and never computes a timezone itself.
 */
@Injectable()
export class BusinessCalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
  ) {}

  /**
   * Nth occurrence of a date's own weekday within its month (1-5).
   *
   * Derived arithmetically from the day of the month, never from a hardcoded
   * calendar: the 8th of any month is always the 2nd occurrence of whatever
   * weekday it falls on, the 22nd always the 4th, and a month can carry a 5th.
   */
  static weekdayOrdinal(dayOfMonth: number): number {
    return Math.floor((dayOfMonth - 1) / 7) + 1;
  }

  /**
   * Splits a 'yyyy-MM-dd' business date into its parts plus the weekday and
   * weekday ordinal, all evaluated in company time.
   *
   * The date string is anchored at UTC midnight — the same encoding
   * TVAService.companyDateOnly() produces — so getUTCDay() returns the company
   * weekday rather than a server-local one.
   */
  private describeDate(businessDate: string): {
    dayOfWeek: number;
    dayOfMonth: number;
    weekdayOrdinal: number;
    dateOnly: Date;
  } {
    const dateOnly = new Date(`${businessDate}T00:00:00.000Z`);
    if (Number.isNaN(dateOnly.getTime())) {
      throw new Error(`Invalid business date: ${businessDate}`);
    }
    const dayOfMonth = dateOnly.getUTCDate();
    return {
      dayOfWeek: dateOnly.getUTCDay(),
      dayOfMonth,
      weekdayOrdinal: BusinessCalendarService.weekdayOrdinal(dayOfMonth),
      dateOnly,
    };
  }

  /**
   * Normalises any accepted input to a company business date string.
   * A Date is an instant and is converted through the company timezone; a
   * string is already a business date and is taken as-is.
   */
  private toBusinessDate(input?: Date | string): string {
    if (typeof input === 'string') return input;
    return this.tva.companyBusinessDate(input);
  }

  /**
   * Every weekly-off rule that independently applies to this date.
   *
   * Returns all matching reasons rather than the first: a policy change that
   * later switches off one rule must not silently leave the date a working day
   * if another rule still covers it.
   */
  private weeklyOffReasons(
    policy: { everySunday: boolean; secondSaturday: boolean; fourthSaturday: boolean } | null,
    dayOfWeek: number,
    weekdayOrdinal: number,
  ): WeeklyOffReason[] {
    if (!policy) return [];
    const reasons: WeeklyOffReason[] = [];
    if (policy.everySunday && dayOfWeek === 0) reasons.push('SUNDAY');
    if (dayOfWeek === 6) {
      if (policy.secondSaturday && weekdayOrdinal === 2) reasons.push('SECOND_SATURDAY');
      if (policy.fourthSaturday && weekdayOrdinal === 4) reasons.push('FOURTH_SATURDAY');
    }
    return reasons;
  }

  /**
   * Resolves which HolidayCalendar applies, and how that choice was made.
   *
   * An explicit assignment wins and is resolved to the VERSION of that
   * calendar's series governing the date -- the assigned id may point at a
   * version since superseded, and the one that governed the date is correct.
   *
   * With no assignment under strict mode, candidates are COUNTED rather than
   * picked: exactly one becomes the company default, zero or several resolve to
   * no calendar at all. Taking findFirst there would silently attach an
   * employee to whichever row the database happened to return.
   */
  private async resolveCalendarId(
    assignedHolidayCalendarId: string | null | undefined,
    dateOnly: Date,
    strict: boolean,
  ): Promise<{ id: string | null; resolution: CalendarSourceResolution }> {
    if (assignedHolidayCalendarId) {
      const assigned = await this.prisma.holidayCalendar.findUnique({
        where: { id: assignedHolidayCalendarId },
        select: { id: true, policyKey: true },
      });
      if (!assigned) return { id: null, resolution: 'NONE' };

      const effective = await this.prisma.holidayCalendar.findFirst({
        where: {
          policyKey: assigned.policyKey,
          status: { in: ['ACTIVE', 'SUPERSEDED'] },
          effectiveFrom: { lte: this.tva.companyDayEnd(dateOnly) },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: this.tva.companyDayStart(dateOnly) } }],
        },
        orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
        select: { id: true },
      });

      // If no version of the assigned series governed this date, fall back to
      // the assigned row itself rather than silently switching series.
      return { id: effective?.id ?? assigned.id, resolution: 'ASSIGNED' };
    }

    if (!strict) return { id: null, resolution: 'NONE' };

    // take: 2 is all that is needed to tell 0 from 1 from many.
    const candidates = await this.prisma.holidayCalendar.findMany({
      where: {
        status: 'ACTIVE',
        effectiveFrom: { lte: this.tva.companyDayEnd(dateOnly) },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: this.tva.companyDayStart(dateOnly) } }],
      },
      select: { id: true },
      take: 2,
    });
    if (candidates.length === 0) return { id: null, resolution: 'NONE' };
    if (candidates.length > 1) return { id: null, resolution: 'AMBIGUOUS' };
    return { id: candidates[0].id, resolution: 'COMPANY_DEFAULT' };
  }

  /**
   * Resolves which WeeklyOffPolicy applies, and how. Same counting rule as
   * resolveCalendarId; WeeklyOffPolicy has no version series, so an assignment
   * is used directly.
   */
  private async resolveWeeklyOffPolicy(
    assignedWeeklyOffPolicyId: string | null | undefined,
    dateOnly: Date,
    strict: boolean,
  ): Promise<{ policy: any | null; resolution: CalendarSourceResolution }> {
    const window = {
      effectiveFrom: { lte: dateOnly },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: dateOnly } }],
    };

    if (assignedWeeklyOffPolicyId) {
      const policy = await this.prisma.weeklyOffPolicy.findFirst({
        where: { id: assignedWeeklyOffPolicyId, ...window },
        orderBy: { effectiveFrom: 'desc' },
      });
      return { policy, resolution: policy ? 'ASSIGNED' : 'NONE' };
    }

    if (!strict) {
      const policy = await this.prisma.weeklyOffPolicy.findFirst({
        where: { isActive: true, ...window },
        orderBy: { effectiveFrom: 'desc' },
      });
      return { policy, resolution: policy ? 'COMPANY_DEFAULT' : 'NONE' };
    }

    const candidates = await this.prisma.weeklyOffPolicy.findMany({
      where: { isActive: true, ...window },
      orderBy: { effectiveFrom: 'desc' },
      take: 2,
    });
    if (candidates.length === 0) return { policy: null, resolution: 'NONE' };
    if (candidates.length > 1) return { policy: null, resolution: 'AMBIGUOUS' };
    return { policy: candidates[0], resolution: 'COMPANY_DEFAULT' };
  }

  /**
   * Resolve the calendar facts for one company business date.
   *
   * Accepts an instant (converted through company time), a 'yyyy-MM-dd'
   * business date, or nothing (meaning today).
   *
   * `sources` lets a caller pin the employee-assigned HolidayCalendar and
   * WeeklyOffPolicy from their attendance profile. Omitted, the globally active
   * records are used, so pre-existing callers are unaffected.
   */
  async resolveBusinessDay(
    input?: Date | string,
    sources: BusinessCalendarSources = {},
  ): Promise<BusinessDayFacts> {
    const businessDate = this.toBusinessDate(input);
    const { dayOfWeek, weekdayOrdinal, dateOnly } = this.describeDate(businessDate);

    const strict = sources.strict === true;

    const [calendarSel, weeklyOffSel] = await Promise.all([
      this.resolveCalendarId(sources.holidayCalendarId, dateOnly, strict),
      this.resolveWeeklyOffPolicy(sources.weeklyOffPolicyId, dateOnly, strict),
    ]);
    const calendarId = calendarSel.id;
    const weeklyOffPolicy = weeklyOffSel.policy;

    const [holiday, override] = await Promise.all([
      // Under strict mode with no resolved calendar, no holiday lookup is made
      // at all -- an ambiguous or absent calendar must not be papered over by
      // whichever globally active row the database returns first.
      calendarId
        ? this.prisma.holiday.findFirst({
            where: { date: dateOnly, calendarId },
            include: { calendar: { select: { id: true } } },
          })
        : strict
          ? Promise.resolve(null)
          : this.prisma.holiday.findFirst({
              where: { date: dateOnly, calendar: { isActive: true } },
              include: { calendar: { select: { id: true } } },
            }),
      this.prisma.businessDayOverride.findFirst({
        where: { date: dateOnly, revokedAt: null },
      }),
    ]);

    const reasons = this.weeklyOffReasons(weeklyOffPolicy, dayOfWeek, weekdayOrdinal);
    const isHoliday = !!holiday;
    const isOptionalHoliday = isHoliday && holiday!.isOptional;

    // Ordinary expectation from the calendar itself. An optional holiday does
    // not by itself cancel the working day -- taking it is the employee's
    // choice, so it stays a fact and the later evaluator decides.
    let expectedCompanyWorkingDay =
      reasons.length === 0 && !(isHoliday && !isOptionalHoliday);

    // An override decides the expectation last, and only the expectation: the
    // weekly-off and holiday facts above are left exactly as found.
    const overrideType = override?.type as BusinessDayOverrideKind | undefined;
    if (overrideType === 'COMPANY_CLOSURE') expectedCompanyWorkingDay = false;
    if (overrideType === 'SPECIAL_WORKING_DAY') expectedCompanyWorkingDay = true;

    return {
      businessDate,
      dayOfWeek,
      weekdayOrdinal,
      weeklyOff: {
        isWeeklyOff: reasons.length > 0,
        reasons,
        policyId: weeklyOffPolicy?.id ?? null,
      },
      holiday: {
        isHoliday,
        holidayId: holiday?.id ?? null,
        calendarId: holiday?.calendarId ?? null,
        name: holiday?.name ?? null,
        optional: isOptionalHoliday,
      },
      override: override
        ? {
            id: override.id,
            type: override.type as BusinessDayOverrideKind,
            reason: override.reason,
            approvedById: override.approvedById ?? null,
          }
        : null,
      expectedCompanyWorkingDay,
      resolution: {
        holidayCalendar: calendarSel.resolution,
        weeklyOffPolicy: weeklyOffSel.resolution,
      },
      sources: {
        weeklyOffPolicyId: weeklyOffPolicy?.id ?? null,
        holidayCalendarId: holiday?.calendarId ?? calendarId ?? null,
        holidayId: holiday?.id ?? null,
        overrideId: override?.id ?? null,
      },
    };
  }

  /**
   * Working-day classification for every date in a month, in a handful of
   * queries rather than one round trip per day.
   *
   * resolveBusinessDay() answers one date and re-resolves the governing
   * calendar and weekly-off policy each time. Asking it thirty times to render
   * a monthly report is thirty times the work for an answer that does not
   * change between days -- and that per-date pattern is exactly what makes a
   * month view slow.
   *
   * So the policy and the calendar are resolved ONCE, the holidays and
   * overrides for the month are read in bulk, and the weekly-off rule is then
   * applied per date with the same helper resolveBusinessDay() uses. The rule
   * is not reimplemented here; only the fetching changes.
   */
  async classifyMonth(
    year: number,
    month: number,
    sources: BusinessCalendarSources = {},
  ): Promise<{
    month: string;
    workingDays: number;
    /**
     * How each authority was resolved.
     *
     * Reported rather than swallowed. If no weekly-off policy could be
     * resolved, every Sunday counts as a working day and the total is simply
     * wrong -- a caller that prints "Working Days: 30" beside an HR register
     * needs to know that, not discover it from a confused employee.
     */
    sources: {
      holidayCalendar: CalendarSourceResolution;
      weeklyOffPolicy: CalendarSourceResolution;
    };
    days: Array<{
      businessDate: string;
      isWorkingDay: boolean;
      reason: 'WORKING' | 'SUNDAY' | 'SECOND_SATURDAY' | 'FOURTH_SATURDAY' | 'HOLIDAY' | 'COMPANY_CLOSURE' | 'SPECIAL_WORKING_DAY';
      holidayName: string | null;
    }>;
  }> {
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const first = this.companyDateOnlyFor(`${monthKey}-01`);
    const last = this.companyDateOnlyFor(`${monthKey}-${String(daysInMonth).padStart(2, '0')}`);

    // STRICT BY DEFAULT here, unlike resolveBusinessDay(). A company-wide
    // report has no employee to inherit an assignment from, and non-strict
    // resolution returns NO calendar at all -- which would silently report
    // every holiday as a working day. Strict resolves the company default when
    // exactly one exists, and refuses to guess when zero or several do.
    const strict = sources.strict !== false;
    const [calendarSel, weeklyOffSel] = await Promise.all([
      this.resolveCalendarId(sources.holidayCalendarId, first, strict),
      this.resolveWeeklyOffPolicy(sources.weeklyOffPolicyId, first, strict),
    ]);

    const [holidays, overrides] = await Promise.all([
      calendarSel.id
        ? this.prisma.holiday.findMany({
            where: { calendarId: calendarSel.id, date: { gte: first, lte: last } },
            select: { date: true, name: true, isOptional: true },
          })
        : Promise.resolve([] as Array<{ date: Date; name: string; isOptional: boolean }>),
      this.prisma.businessDayOverride.findMany({
        // A revoked override is history, not policy.
        where: { date: { gte: first, lte: last }, revokedAt: null },
        select: { date: true, type: true },
      }),
    ]);

    const key = (d: Date) => new Date(d).toISOString().slice(0, 10);
    const holidayByDate = new Map<string, string>();
    for (const h of holidays) {
      // An optional holiday does not close the company.
      if (!h.isOptional) holidayByDate.set(key(h.date), h.name);
    }
    const overrideByDate = new Map<string, string>();
    for (const o of overrides) overrideByDate.set(key(o.date), o.type);

    const days = [];
    let workingDays = 0;

    for (let d = 1; d <= daysInMonth; d += 1) {
      const businessDate = `${monthKey}-${String(d).padStart(2, '0')}`;
      const { dayOfWeek, weekdayOrdinal } = this.describeDate(businessDate);

      const override = overrideByDate.get(businessDate);
      const holidayName = holidayByDate.get(businessDate) ?? null;
      const weeklyOff = this.weeklyOffReasons(weeklyOffSel.policy, dayOfWeek, weekdayOrdinal);

      // An explicit override outranks both the holiday list and the weekly-off
      // rule, in either direction -- that is what an override is for.
      let isWorkingDay: boolean;
      let reason: any;
      if (override === 'SPECIAL_WORKING_DAY') {
        isWorkingDay = true;
        reason = 'SPECIAL_WORKING_DAY';
      } else if (override === 'COMPANY_CLOSURE') {
        isWorkingDay = false;
        reason = 'COMPANY_CLOSURE';
      } else if (weeklyOff.length > 0) {
        isWorkingDay = false;
        reason = weeklyOff[0];
      } else if (holidayName) {
        isWorkingDay = false;
        reason = 'HOLIDAY';
      } else {
        isWorkingDay = true;
        reason = 'WORKING';
      }

      if (isWorkingDay) workingDays += 1;
      days.push({ businessDate, isWorkingDay, reason, holidayName });
    }

    return {
      month: monthKey,
      workingDays,
      sources: {
        holidayCalendar: calendarSel.resolution,
        weeklyOffPolicy: weeklyOffSel.resolution,
      },
      days,
    };
  }

  /** Same encoding resolveBusinessDay() uses: UTC midnight for a yyyy-MM-dd. */
  private companyDateOnlyFor(businessDate: string): Date {
    return new Date(`${businessDate}T00:00:00.000Z`);
  }
}
