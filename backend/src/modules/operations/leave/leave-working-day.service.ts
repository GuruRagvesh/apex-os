import { Injectable } from '@nestjs/common';
import { TVAService } from '../../../common/services/tva.service';
import { EmployeeTimelineService } from '../../platform/attendance/timeline/employee-timeline.service';
import { BusinessCalendarService } from '../../platform/attendance/calendar/business-calendar.service';

/**
 * Working-day counting for leave, using the attendance foundation (LH-1).
 *
 * This exists to remove a duplicate authority, not to add one. Before LH-1 the
 * leave module answered "is this date a working day?" from its own hardcoded
 * holiday array and a `workingDays` settings string, while the attendance
 * foundation answered the same question from HolidayCalendar, WeeklyOffPolicy
 * and BusinessDayOverride. Two answers for one question is how a company ends
 * up disputing a payslip.
 *
 * It deliberately owns no calendar data of its own: it resolves the employee's
 * effective-dated profile, then asks BusinessCalendarService, exactly as the
 * BL-5 daily context does.
 */

export type LeaveCalendarBlockingReason =
  | 'NO_PROFILE_FOR_DATE'
  | 'MISSING_HOLIDAY_CALENDAR'
  | 'AMBIGUOUS_HOLIDAY_CALENDAR'
  | 'MISSING_WEEKLY_OFF_POLICY'
  | 'AMBIGUOUS_WEEKLY_OFF_POLICY';

export interface LeaveDayBreakdown {
  businessDate: string;
  isWorkingDay: boolean;
  isHoliday: boolean;
  isWeeklyOff: boolean;
  overrideType: string | null;
  holidayName: string | null;
}

export interface LeaveWorkingDayResult {
  resolved: boolean;
  workingDays: number;
  days: LeaveDayBreakdown[];
  blockingReasons: LeaveCalendarBlockingReason[];
  holidayCalendarId: string | null;
  weeklyOffPolicyId: string | null;
}

/**
 * Raised when the employee's calendar configuration cannot be resolved.
 *
 * Refusing to answer is the safe direction. Counting a leave against an
 * arbitrary globally-active calendar would produce a confident, wrong number
 * that silently costs somebody a day.
 */
export class LeaveCalendarUnresolvedError extends Error {
  constructor(public readonly reasons: LeaveCalendarBlockingReason[]) {
    super(
      'This employee\'s holiday or weekly-off configuration could not be resolved, ' +
        'so leave duration cannot be calculated. HR needs to complete the setup.',
    );
    this.name = 'LeaveCalendarUnresolvedError';
  }
}

@Injectable()
export class LeaveWorkingDayService {
  constructor(
    private readonly tva: TVAService,
    private readonly timeline: EmployeeTimelineService,
    private readonly calendar: BusinessCalendarService,
  ) {}

  /**
   * Inclusive list of company business dates between two instants.
   *
   * Anchored at UTC noon and stepped in whole UTC days, so the cursor can never
   * drift across a midnight boundary — the failure mode that made the previous
   * implementation read 26 January as 25 January.
   */
  enumerateBusinessDates(start: Date | string, end: Date | string): string[] {
    const first = this.tva.companyBusinessDate(new Date(start));
    const last = this.tva.companyBusinessDate(new Date(end));
    if (first > last) return [];

    const out: string[] = [];
    const cursor = new Date(`${first}T12:00:00.000Z`);
    const stop = new Date(`${last}T12:00:00.000Z`);

    while (cursor.getTime() <= stop.getTime()) {
      out.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      // A runaway loop here would hang a request thread; leave ranges are never
      // years long, so this ceiling is unreachable in practice.
      if (out.length > 400) break;
    }
    return out;
  }

  /**
   * Working days for one employee across a date range.
   *
   * Employee-specific by construction: two people on different holiday
   * calendars or weekly-off policies legitimately get different answers for the
   * same dates.
   */
  async resolveForEmployee(
    userId: string,
    start: Date | string,
    end: Date | string,
  ): Promise<LeaveWorkingDayResult> {
    const dates = this.enumerateBusinessDates(start, end);
    const blockingReasons: LeaveCalendarBlockingReason[] = [];

    if (dates.length === 0) {
      return {
        resolved: true,
        workingDays: 0,
        days: [],
        blockingReasons,
        holidayCalendarId: null,
        weeklyOffPolicyId: null,
      };
    }

    // The profile is effective-dated, so it is resolved per date rather than
    // once for the range: a leave spanning a profile change must respect both
    // sides of that change.
    const days: LeaveDayBreakdown[] = [];
    let workingDays = 0;
    let holidayCalendarId: string | null = null;
    let weeklyOffPolicyId: string | null = null;

    for (const businessDate of dates) {
      const employee = await this.timeline.resolveEmployeeOn(userId, businessDate);

      if (!employee.profile) {
        // No profile covering this date. BL-3 already established that a
        // missing profile is never silently treated as exempt or as covered.
        this.addReason(blockingReasons, 'NO_PROFILE_FOR_DATE');
        continue;
      }

      const facts = await this.calendar.resolveBusinessDay(businessDate, {
        holidayCalendarId: employee.profile.assignedHolidayCalendarId ?? null,
        weeklyOffPolicyId: employee.profile.assignedWeeklyOffPolicyId ?? null,
        // Strict: an unassigned source is resolved by counting candidates,
        // never by taking whichever active row comes back first.
        strict: true,
      });

      const res = facts.resolution;
      if (res.holidayCalendar === 'NONE') this.addReason(blockingReasons, 'MISSING_HOLIDAY_CALENDAR');
      if (res.holidayCalendar === 'AMBIGUOUS') this.addReason(blockingReasons, 'AMBIGUOUS_HOLIDAY_CALENDAR');
      if (res.weeklyOffPolicy === 'NONE') this.addReason(blockingReasons, 'MISSING_WEEKLY_OFF_POLICY');
      if (res.weeklyOffPolicy === 'AMBIGUOUS') this.addReason(blockingReasons, 'AMBIGUOUS_WEEKLY_OFF_POLICY');

      holidayCalendarId = holidayCalendarId ?? facts.sources?.holidayCalendarId ?? null;
      weeklyOffPolicyId = weeklyOffPolicyId ?? facts.weeklyOff.policyId ?? null;

      // expectedCompanyWorkingDay already folds in COMPANY_CLOSURE,
      // SPECIAL_WORKING_DAY, weekly off and non-optional holidays. Re-deriving
      // that here would be a third authority.
      const isWorkingDay = facts.expectedCompanyWorkingDay;
      if (isWorkingDay) workingDays += 1;

      days.push({
        businessDate,
        isWorkingDay,
        isHoliday: facts.holiday.isHoliday,
        isWeeklyOff: facts.weeklyOff.isWeeklyOff,
        overrideType: facts.override?.type ?? null,
        holidayName: facts.holiday.name,
      });
    }

    return {
      resolved: blockingReasons.length === 0,
      workingDays,
      days,
      blockingReasons,
      holidayCalendarId,
      weeklyOffPolicyId,
    };
  }

  /** Working-day count, refusing rather than guessing when unresolved. */
  async countWorkingDays(userId: string, start: Date | string, end: Date | string): Promise<number> {
    const result = await this.resolveForEmployee(userId, start, end);
    if (!result.resolved) throw new LeaveCalendarUnresolvedError(result.blockingReasons);
    return result.workingDays;
  }

  private addReason(list: LeaveCalendarBlockingReason[], reason: LeaveCalendarBlockingReason) {
    if (!list.includes(reason)) list.push(reason);
  }
}
