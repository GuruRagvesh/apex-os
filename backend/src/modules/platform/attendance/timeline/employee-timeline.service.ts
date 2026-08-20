import { Injectable } from '@nestjs/common';
import { AttendanceCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';
import {
  AttendanceCoverageReason,
  AttendanceCoverageState,
  AttendanceProfileFacts,
  EmployeeTimelineFacts,
  EmploymentFacts,
  OverlappingProfileError,
} from './employee-timeline.types';

/**
 * Employee Attendance Timeline (Attendance Base Layer, BL-3).
 *
 * Resolves who an employee was, for attendance purposes, on a given business
 * date -- and enforces that a timeline never contains two profiles covering
 * the same date.
 *
 * DATE-TYPE NOTE. effectiveFrom/effectiveTo are TIMESTAMP(3) columns that
 * already exist in production, and effectiveFrom defaults to CURRENT_TIMESTAMP,
 * so a row can legitimately carry a mid-day time (e.g. 2026-07-01T09:23:45Z).
 * Comparing such a row against UTC midnight would wrongly exclude it on its own
 * first day. Every comparison here is therefore normalised to the company
 * business DAY window rather than to a single instant:
 *
 *     in force on D  <=>  effectiveFrom <= companyDayEnd(D)
 *                    AND (effectiveTo IS NULL OR effectiveTo >= companyDayStart(D))
 *
 * This is correct both for rows written by this service (UTC-midnight encoded)
 * and for rows carrying a real timestamp. The column types are deliberately
 * left unchanged -- converting a live timestamp column to DATE is a separate,
 * riskier migration.
 */
@Injectable()
export class EmployeeTimelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
  ) {}

  private toBusinessDate(input?: Date | string): string {
    if (typeof input === 'string') return input;
    return this.tva.companyBusinessDate(input);
  }

  /** UTC-midnight encoding of a business date, matching TVAService.companyDateOnly(). */
  private toDateOnly(businessDate: string): Date {
    const d = new Date(`${businessDate}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`Invalid business date: ${businessDate}`);
    }
    return d;
  }

  /**
   * The Prisma predicate for "this profile version is in force on business
   * date D", normalised to the company business-day window. See the DATE-TYPE
   * note on the class.
   */
  private inForceOn(businessDate: string) {
    const anchor = this.toDateOnly(businessDate);
    return {
      effectiveFrom: { lte: this.tva.companyDayEnd(anchor) },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: this.tva.companyDayStart(anchor) } }],
    };
  }

  private formatOrNull(value: Date | null | undefined): string | null {
    return value ? this.tva.companyBusinessDate(value) : null;
  }

  /**
   * Employment status on a business date.
   *
   * joiningDate and lastWorkingDate are both INCLUSIVE: an employee is employed
   * on their joining date and still employed on their last working day, and not
   * from the day after.
   */
  private employmentOn(
    user: { joiningDate: Date | null; lastWorkingDate: Date | null } | null,
    businessDate: string,
  ): EmploymentFacts {
    if (!user) {
      return {
        employedOnDate: false,
        joiningDate: null,
        lastWorkingDate: null,
        reason: 'USER_NOT_FOUND',
      };
    }

    const joining = this.formatOrNull(user.joiningDate);
    const lastWorking = this.formatOrNull(user.lastWorkingDate);

    if (!joining) {
      return {
        employedOnDate: false,
        joiningDate: null,
        lastWorkingDate: lastWorking,
        reason: 'NO_JOINING_DATE',
      };
    }
    // String comparison is safe and timezone-free: all three are already
    // company business dates in 'yyyy-MM-dd', which sorts lexicographically.
    if (businessDate < joining) {
      return {
        employedOnDate: false,
        joiningDate: joining,
        lastWorkingDate: lastWorking,
        reason: 'BEFORE_JOINING',
      };
    }
    if (lastWorking && businessDate > lastWorking) {
      return {
        employedOnDate: false,
        joiningDate: joining,
        lastWorkingDate: lastWorking,
        reason: 'AFTER_LAST_WORKING_DATE',
      };
    }
    return {
      employedOnDate: true,
      joiningDate: joining,
      lastWorkingDate: lastWorking,
      reason: 'EMPLOYED',
    };
  }

  /**
   * Coverage state.
   *
   * The ordering matters. Employment is checked first, then the PRESENCE of a
   * profile, and only then its content. A missing profile can therefore never
   * fall through to EXEMPT: an unconfigured employee is UNRESOLVED, which is a
   * problem to surface, not a silent exemption.
   */
  private resolveCoverage(
    employment: EmploymentFacts,
    profile: AttendanceProfileFacts | null,
  ): { coverage: AttendanceCoverageState; coverageReason: AttendanceCoverageReason } {
    if (!employment.employedOnDate) {
      return {
        coverage: 'NOT_EMPLOYED',
        coverageReason: employment.reason as AttendanceCoverageReason,
      };
    }
    if (!profile) {
      return { coverage: 'UNRESOLVED', coverageReason: 'NO_PROFILE_FOR_DATE' };
    }
    if (profile.category === AttendanceCategory.MANAGEMENT_EXEMPT) {
      return { coverage: 'EXEMPT', coverageReason: 'MANAGEMENT_EXEMPT_CATEGORY' };
    }
    if (!profile.attendanceRequired) {
      return { coverage: 'EXEMPT', coverageReason: 'ATTENDANCE_NOT_REQUIRED' };
    }
    return { coverage: 'COVERED', coverageReason: 'COVERED' };
  }

  private toProfileFacts(profile: any): AttendanceProfileFacts {
    return {
      profileId: profile.id,
      category: profile.category,
      attendanceRequired: profile.attendanceRequired,
      assignedShiftId: profile.assignedShiftId ?? null,
      assignedLeavePolicyId: profile.assignedLeavePolicyId ?? null,
      assignedHolidayCalendarId: profile.assignedHolidayCalendarId ?? null,
      assignedWeeklyOffPolicyId: profile.assignedWeeklyOffPolicyId ?? null,
      reportingManagerId: profile.reportingManagerId ?? null,
      hrReviewerId: profile.hrReviewerId ?? null,
      effectiveFrom: this.tva.companyBusinessDate(profile.effectiveFrom),
      effectiveTo: this.formatOrNull(profile.effectiveTo),
    };
  }

  /**
   * The attendance profile in force for a user on a business date.
   *
   * Ordered by effectiveFrom descending so that if historical data ever does
   * contain an overlap -- rows predating this service, or inserted outside it
   * -- the most recent applicable version wins deterministically rather than
   * being chosen at random.
   */
  async findProfileOn(userId: string, input?: Date | string) {
    const businessDate = this.toBusinessDate(input);
    return this.prisma.employeeAttendanceProfile.findFirst({
      where: { userId, ...this.inForceOn(businessDate) },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /**
   * Full timeline facts for one employee on one business date.
   *
   * Accepts an instant (converted through company time), a 'yyyy-MM-dd'
   * business date, or nothing (meaning today).
   */
  async resolveEmployeeOn(userId: string, input?: Date | string): Promise<EmployeeTimelineFacts> {
    const businessDate = this.toBusinessDate(input);
    const inForce = this.inForceOn(businessDate);

    const [user, profileRow] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, joiningDate: true, lastWorkingDate: true },
      }),
      this.prisma.employeeAttendanceProfile.findFirst({
        where: { userId, ...inForce },
        orderBy: { effectiveFrom: 'desc' },
      }),
    ]);

    const employment = this.employmentOn(user, businessDate);
    const profile = profileRow ? this.toProfileFacts(profileRow) : null;
    const { coverage, coverageReason } = this.resolveCoverage(employment, profile);

    return {
      userId,
      businessDate,
      employment,
      profile,
      coverage,
      coverageReason,
      sources: {
        profileId: profile?.profileId ?? null,
        assignedShiftId: profile?.assignedShiftId ?? null,
        assignedLeavePolicyId: profile?.assignedLeavePolicyId ?? null,
        assignedHolidayCalendarId: profile?.assignedHolidayCalendarId ?? null,
        assignedWeeklyOffPolicyId: profile?.assignedWeeklyOffPolicyId ?? null,
      },
    };
  }

  /**
   * Finds any existing profile whose effective window intersects [from, to].
   *
   * Two windows overlap when each starts on or before the other ends. A null
   * effectiveTo means "still open", so it is treated as infinitely far in the
   * future on that side of the comparison.
   */
  private async findOverlapping(
    userId: string,
    from: Date,
    to: Date | null,
    tx: Prisma.TransactionClient,
  ) {
    return tx.employeeAttendanceProfile.findFirst({
      where: {
        userId,
        // existing.effectiveFrom <= to  (or no upper bound on the new window)
        ...(to ? { effectiveFrom: { lte: to } } : {}),
        // existing.effectiveTo >= from  (or the existing row is still open)
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
      },
      orderBy: { effectiveFrom: 'asc' },
    });
  }

  /**
   * Adds a profile version to an employee's timeline.
   *
   * Rejects any window that would overlap an existing version.
   *
   * CONCURRENCY. A transaction alone does NOT prevent two concurrent
   * assignments from both passing the overlap check and both inserting: under
   * READ COMMITTED neither sees the other's uncommitted row, and there is no
   * unique constraint to catch the collision afterwards. The employee's User
   * row is therefore locked FOR UPDATE first, which serialises all timeline
   * mutations for that employee -- the second caller blocks until the first
   * commits, then sees its row and is correctly rejected.
   *
   * The lock is taken via a tagged template, so the id is a bound parameter and
   * never interpolated into SQL. This matches the existing convention in
   * WorkdayService.finalizeWorkSession.
   *
   * Previous versions are never deleted or rewritten -- closing one is an
   * explicit closeProfile() call, so history stays intact.
   */
  async assignProfile(input: {
    userId: string;
    category: AttendanceCategory;
    effectiveFrom: Date | string;
    effectiveTo?: Date | string | null;
    attendanceRequired?: boolean;
    assignedShiftId?: string | null;
    assignedLeavePolicyId?: string | null;
    assignedHolidayCalendarId?: string | null;
    assignedWeeklyOffPolicyId?: string | null;
    reportingManagerId?: string | null;
    hrReviewerId?: string | null;
    updatedById?: string | null;
  }) {
    const from = this.toDateOnly(this.toBusinessDate(input.effectiveFrom));
    const to = input.effectiveTo
      ? this.toDateOnly(this.toBusinessDate(input.effectiveTo))
      : null;

    if (to && to.getTime() < from.getTime()) {
      throw new Error('effectiveTo cannot precede effectiveFrom');
    }

    return this.prisma.$transaction(async (tx) => {
      // Serialise timeline mutations for this employee. Must happen BEFORE the
      // overlap query, or two callers can interleave check-then-insert.
      await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${input.userId} FOR UPDATE`;

      const conflict = await this.findOverlapping(input.userId, from, to, tx);
      if (conflict) {
        throw new OverlappingProfileError(input.userId, conflict.id);
      }
      return tx.employeeAttendanceProfile.create({
        data: {
          userId: input.userId,
          category: input.category,
          attendanceRequired: input.attendanceRequired ?? true,
          assignedShiftId: input.assignedShiftId ?? null,
          assignedLeavePolicyId: input.assignedLeavePolicyId ?? null,
          assignedHolidayCalendarId: input.assignedHolidayCalendarId ?? null,
          assignedWeeklyOffPolicyId: input.assignedWeeklyOffPolicyId ?? null,
          reportingManagerId: input.reportingManagerId ?? null,
          hrReviewerId: input.hrReviewerId ?? null,
          effectiveFrom: from,
          effectiveTo: to,
          updatedById: input.updatedById ?? null,
        },
      });
    });
  }

  /**
   * Closes an open profile version by setting its effectiveTo.
   *
   * Takes the same per-employee lock as assignProfile, so closing one version
   * and opening the next cannot interleave with a competing assignment.
   *
   * It sets a boundary; it never edits the version's attendance content, so a
   * past date still resolves to exactly what applied at the time.
   */
  async closeProfile(profileId: string, effectiveTo: Date | string) {
    const to = this.toDateOnly(this.toBusinessDate(effectiveTo));
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.employeeAttendanceProfile.findUnique({
        where: { id: profileId },
      });
      if (!existing) throw new Error(`Attendance profile not found: ${profileId}`);

      await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${existing.userId} FOR UPDATE`;

      if (to.getTime() < existing.effectiveFrom.getTime()) {
        throw new Error('effectiveTo cannot precede effectiveFrom');
      }
      return tx.employeeAttendanceProfile.update({
        where: { id: profileId },
        data: { effectiveTo: to },
      });
    });
  }

  /** Every profile version for a user, oldest first. History, not just current. */
  async listTimeline(userId: string) {
    return this.prisma.employeeAttendanceProfile.findMany({
      where: { userId },
      orderBy: { effectiveFrom: 'asc' },
    });
  }
}
