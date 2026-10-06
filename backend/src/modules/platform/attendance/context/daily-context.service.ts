import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';
import { BusinessCalendarService } from '../calendar/business-calendar.service';
import { EmployeeTimelineService } from '../timeline/employee-timeline.service';
import { PolicyVersionService } from '../policy/policy-version.service';
import { applyLegacyEmploymentFallback } from './legacy-employment-fallback';
import {
  AttendanceApplicability,
  AttendancePolicyContext,
  ContextBlockingReason,
  DAILY_CONTEXT_RESOLVER_VERSION,
  DailyAttendanceContext,
  LeavePolicyContext,
  ShiftContext,
} from './daily-context.types';

/**
 * Daily Attendance Context (Attendance Base Layer, BL-5).
 *
 * The integrity gate for everything built on top of the base layer. See
 * daily-context.types.ts for the contract and the governing rule.
 *
 * Read-only and deterministic: it performs no writes, and two calls for the
 * same employee and date return the same answer apart from resolvedAt.
 *
 * It deliberately does NOT read punches, WorkSessions, breaks, or leave
 * requests, and never produces an attendance status.
 */
@Injectable()
export class DailyContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly calendar: BusinessCalendarService,
    private readonly timeline: EmployeeTimelineService,
    private readonly policies: PolicyVersionService,
  ) {}

  /**
   * Resolves the full rule context for one employee on one business date.
   *
   * Accepts an instant (converted through company time), a 'yyyy-MM-dd'
   * business date, or nothing (meaning today).
   */
  async resolveDailyContext(
    employeeId: string,
    input?: Date | string,
  ): Promise<DailyAttendanceContext> {
    const businessDate =
      typeof input === 'string' ? input : this.tva.companyBusinessDate(input);

    // Sequenced, not parallel, and deliberately so: the calendar must be
    // resolved through the HolidayCalendar and WeeklyOffPolicy assigned to THIS
    // employee's profile, so two people on the same date can legitimately sit
    // on different calendars. Resolving them concurrently would force the
    // calendar back onto the globally active records.
    const employee = await this.timeline.resolveEmployeeOn(employeeId, businessDate);

    // Legacy compatibility, ATTENDANCE ONLY. An employee with no joining date
    // is attendance-applicable from their profile's effectiveFrom onward. It is
    // applied here rather than in EmployeeTimelineService because comp-off and
    // leave-working-day consume that service too, and relaxing employment there
    // would change leave semantics as a side effect.
    const { coverage, coverageReason, legacyFallbackApplied } =
      applyLegacyEmploymentFallback({
        coverage: employee.coverage,
        coverageReason: employee.coverageReason,
        employment: employee.employment,
        profile: employee.profile,
        businessDate,
      });

    const calendar = await this.calendar.resolveBusinessDay(businessDate, {
      holidayCalendarId: employee.profile?.assignedHolidayCalendarId ?? null,
      weeklyOffPolicyId: employee.profile?.assignedWeeklyOffPolicyId ?? null,
      // Strict: an unassigned source is resolved by counting candidates, never
      // by taking whichever active row comes back first.
      strict: true,
    });

    const blockingReasons: ContextBlockingReason[] = [];
    let shift: ShiftContext | null = null;
    let attendancePolicy: AttendancePolicyContext | null = null;
    let leavePolicy: LeavePolicyContext | null = null;

    // Policies are only meaningful for someone actually subject to attendance.
    // An exempt or non-employed person needs no shift, and demanding one would
    // manufacture a blocking reason out of a complete answer.
    if (coverage === 'UNRESOLVED') {
      blockingReasons.push('NO_PROFILE_FOR_DATE');
    }

    if (coverage === 'COVERED' && employee.profile) {
      const p = employee.profile;

      // Calendar sources are only required for someone actually subject to
      // attendance. An exempt or non-employed person needs no calendar, so an
      // absent or ambiguous one is not their problem.
      if (calendar.resolution.holidayCalendar === 'NONE') {
        blockingReasons.push('MISSING_HOLIDAY_CALENDAR');
      } else if (calendar.resolution.holidayCalendar === 'AMBIGUOUS') {
        blockingReasons.push('AMBIGUOUS_HOLIDAY_CALENDAR');
      }
      if (calendar.resolution.weeklyOffPolicy === 'NONE') {
        blockingReasons.push('MISSING_WEEKLY_OFF_POLICY');
      } else if (calendar.resolution.weeklyOffPolicy === 'AMBIGUOUS') {
        blockingReasons.push('AMBIGUOUS_WEEKLY_OFF_POLICY');
      }

      if (!p.assignedShiftId) {
        // Covered, but nobody said which shift. The timing rules that decide
        // late/early/insufficient-hours are simply unknown for this day.
        blockingReasons.push('MISSING_SHIFT_ASSIGNMENT');
      } else {
        const shiftRow = await this.policies.resolvePolicyOn(
          'SHIFT_POLICY',
          businessDate,
          { id: p.assignedShiftId },
        );
        if (!shiftRow) {
          // Assigned, but no version of that shift governed this date -- e.g.
          // it is still a DRAFT, or its effective window does not cover the day.
          blockingReasons.push('MISSING_SHIFT_POLICY');
        } else {
          shift = {
            policyId: shiftRow.id,
            policyKey: shiftRow.policyKey,
            version: shiftRow.version,
            name: shiftRow.name,
            category: shiftRow.category,
            startTime: shiftRow.startTime,
            endTime: shiftRow.endTime,
            graceMinutes: shiftRow.graceMinutes,
            minimumWorkingMinutes: shiftRow.minimumWorkingMinutes,
          };

          const apRow = await this.policies.resolvePolicyOn(
            'ATTENDANCE_POLICY',
            businessDate,
            { id: shiftRow.attendancePolicyId },
          );
          if (!apRow) {
            blockingReasons.push('MISSING_ATTENDANCE_POLICY');
          } else {
            attendancePolicy = {
              policyId: apRow.id,
              policyKey: apRow.policyKey,
              version: apRow.version,
              minimumWorkingMinutes: apRow.minimumWorkingMinutes,
              permittedBreakMinutes: apRow.permittedBreakMinutes ?? 60,
              minimumEffectiveWorkMinutes: apRow.minimumEffectiveWorkMinutes ?? null,
              lateExemptionEnabled: apRow.lateExemptionEnabled,
              regularizationEnabled: apRow.regularizationEnabled,
              geoFenceEnabled: apRow.geoFenceEnabled,
              afterPunchWindowAction: apRow.afterPunchWindowAction,
              insufficientHoursAction: apRow.insufficientHoursAction,
              automaticHalfDayEnabled: apRow.automaticHalfDayEnabled,
            };
          }
        }
      }

      // Reference only, and deliberately NOT blocking: leave policy matters
      // when a leave request exists, which is a later layer's concern. A day
      // with no leave is perfectly finalizable without one.
      if (p.assignedLeavePolicyId) {
        const lpRow = await this.policies.resolvePolicyOn('LEAVE_POLICY', businessDate, {
          id: p.assignedLeavePolicyId,
        });
        if (lpRow) {
          leavePolicy = {
            policyId: lpRow.id,
            policyKey: lpRow.policyKey,
            version: lpRow.version,
            firstHalfInEarliest: lpRow.firstHalfInEarliest,
            firstHalfInLatest: lpRow.firstHalfInLatest,
            firstHalfRequiredPresenceMinutes: lpRow.firstHalfRequiredPresenceMinutes,
            secondHalfInEarliest: lpRow.secondHalfInEarliest,
            secondHalfInLatest: lpRow.secondHalfInLatest,
            secondHalfOutTime: lpRow.secondHalfOutTime,
            compOffExpiryDays: lpRow.compOffExpiryDays,
          };
        }
      }
    }

    // Two separate questions, deliberately not collapsed into one boolean:
    //
    //   contextResolved        -- could the foundation explain this day at all?
    //   attendanceApplicability -- given that it could, does attendance apply?
    //
    // A single "finalizable" flag conflated "nothing to attend" with "we cannot
    // tell", which is exactly the ambiguity that turns a configuration mistake
    // into a payroll mistake.
    const contextResolved = blockingReasons.length === 0;

    let attendanceApplicability: AttendanceApplicability;
    if (!contextResolved) {
      attendanceApplicability = 'BLOCKED';
    } else if (coverage === 'NOT_EMPLOYED') {
      attendanceApplicability = 'NOT_EMPLOYED';
    } else if (coverage === 'EXEMPT') {
      attendanceApplicability = 'EXEMPT';
    } else {
      attendanceApplicability = 'REQUIRED';
    }

    return {
      employeeId,
      businessDate,
      employment: employee.employment,
      coverage,
      coverageReason,
      legacyEmploymentFallbackApplied: legacyFallbackApplied,
      calendar,
      profile: employee.profile
        ? {
            profileId: employee.profile.profileId,
            category: employee.profile.category,
            effectiveFrom: employee.profile.effectiveFrom,
            effectiveTo: employee.profile.effectiveTo,
          }
        : null,
      shift,
      attendancePolicy,
      leavePolicy,
      contextResolved,
      attendanceApplicability,
      requiresHrReview: !contextResolved,
      blockingReasons,
      sources: {
        assignedHolidayCalendarId: employee.profile?.assignedHolidayCalendarId ?? null,
        assignedWeeklyOffPolicyId: employee.profile?.assignedWeeklyOffPolicyId ?? null,
        assignedAttendanceLocationId: employee.profile?.assignedAttendanceLocationId ?? null,
        resolvedHolidayCalendarId: calendar.sources.holidayCalendarId,
        resolvedWeeklyOffPolicyId: calendar.sources.weeklyOffPolicyId,
        holidayCalendarResolution: calendar.resolution.holidayCalendar,
        weeklyOffPolicyResolution: calendar.resolution.weeklyOffPolicy,
        weeklyOffPolicyId: calendar.sources.weeklyOffPolicyId,
        holidayCalendarId: calendar.sources.holidayCalendarId,
        holidayId: calendar.sources.holidayId,
        businessDayOverrideId: calendar.sources.overrideId,
        employeeProfileId: employee.sources.profileId,
        shiftPolicyId: shift?.policyId ?? null,
        shiftPolicyVersion: shift?.version ?? null,
        attendancePolicyId: attendancePolicy?.policyId ?? null,
        attendancePolicyVersion: attendancePolicy?.version ?? null,
        leavePolicyId: leavePolicy?.policyId ?? null,
        leavePolicyVersion: leavePolicy?.version ?? null,
      },
      resolverVersion: DAILY_CONTEXT_RESOLVER_VERSION,
      resolvedAt: this.tva.now().toISOString(),
    };
  }
}
