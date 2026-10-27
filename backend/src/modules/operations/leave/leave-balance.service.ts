import { Injectable, ForbiddenException, Optional } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SettingsService } from '../../platform/settings/settings.service';
import { LeaveStatus, LeaveType } from '@prisma/client';
import { TVAService } from '../../../common/services/tva.service';
import {
  LeaveCalendarUnresolvedError,
  LeaveWorkingDayService,
} from './leave-working-day.service';
import {
  ATTENDANCE_V2_DEFAULTS,
  ATTENDANCE_V2_SETTING_KEY,
} from '../../platform/attendance/punch/punch-evidence.types';
import { PolicyVersionService } from '../../platform/attendance/policy/policy-version.service';
import { EmployeeTimelineService } from '../../platform/attendance/timeline/employee-timeline.service';
import { allocationFor, bucketOf, type PaidBucket } from './leave-rules';

/** Balance for one paid bucket, or both together (no bucket). */
export interface LeaveBalanceResult {
  /** Null when no leave policy could be resolved (setup pending). Never invented. */
  allocation: number | null;
  approved: number;
  pending: number;
  balance: number | null;
  bucket: PaidBucket | null;
  setupStatus: 'RESOLVED' | 'POLICY_SETUP_PENDING';
  /** Requests whose duration could not be measured yet (calendar setup pending). */
  unmeasuredRequests: number;
}

/** Raised when no leave policy governs the date. The caller saves the request as setup-pending. */
export class LeavePolicyUnresolvedError extends Error {
  constructor() {
    super('No leave policy applies to this employee on this date. HR/Admin need to complete leave setup.');
    this.name = 'LeavePolicyUnresolvedError';
  }
}

@Injectable()
export class LeaveBalanceService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private tva: TVAService,
    private workingDays: LeaveWorkingDayService,
    @Optional() private policies?: PolicyVersionService,
    @Optional() private timeline?: EmployeeTimelineService,
  ) {}

  /**
   * Legacy holiday list.
   *
   * COMPATIBILITY DATA ONLY as of LH-1. It disagrees with the official 2026
   * calendar the company approved (it contains Good Friday, which the official
   * calendar deliberately excludes, and is missing several supplied holidays).
   * It is consulted only when the Attendance V2 leave authority is OFF, and is
   * kept solely so live behaviour is unchanged until that flag is switched on.
   *
   * Do not add to it. The authority is HolidayCalendar + Holiday +
   * BusinessDayOverride, reached through LeaveWorkingDayService.
   */
  private readonly holidays = [
    '2026-01-01', // New Year's Day
    '2026-01-26', // Republic Day
    '2026-03-06', // Holi
    '2026-04-15', // Good Friday
    '2026-05-01', // May Day
    '2026-08-15', // Independence Day
    '2026-10-02', // Gandhi Jayanti
    '2026-10-20', // Dussehra
    '2026-11-08', // Diwali
    '2026-12-25', // Christmas
  ];

  /** Whether the attendance foundation is the authority for leave maths. */
  private async v2AuthorityEnabled(): Promise<boolean> {
    const cfg = await this.settings.get(ATTENDANCE_V2_SETTING_KEY);
    return (
      (cfg?.leaveAuthorityEnabled ?? ATTENDANCE_V2_DEFAULTS.leaveAuthorityEnabled) === true
    );
  }

  /** LH-2 final approval may settle a request as paid, partial, or unpaid. */
  private async approvalSettlementEnabled(): Promise<boolean> {
    const cfg = await this.settings.get(ATTENDANCE_V2_SETTING_KEY);
    return (
      (cfg?.leaveApprovalEnabled ?? ATTENDANCE_V2_DEFAULTS.leaveApprovalEnabled) === true
    );
  }

  /**
   * The LeavePolicy governing this employee on a date (Phase 3).
   *
   * The profile's assigned leave policy names a SERIES; the continuity
   * resolver picks the version governing the date (a successor applies from
   * its own date, a gap continues the predecessor). With no assignment, the
   * company's leave policy by the same rule. Null only when no leave policy
   * exists at all -- the caller treats that as setup pending, never as zero
   * and never as an invented number.
   */
  async resolveLeavePolicy(userId: string, businessDate: string): Promise<any | null> {
    if (!this.policies) return null;
    const profile = this.timeline ? await this.timeline.findProfileOn(userId, businessDate).catch(() => null) : null;
    if (profile?.assignedLeavePolicyId) {
      const assigned = await this.policies.resolvePolicyOn('LEAVE_POLICY', businessDate, { id: profile.assignedLeavePolicyId });
      if (assigned) return assigned;
    }
    return this.policies.resolvePolicyOn('LEAVE_POLICY', businessDate, {});
  }

  /**
   * Paid-leave allocation for one bucket (Phase 3).
   *
   * The ONLY entitlement authority is LeavePolicy.totalPaidLeaves (14 by
   * default). Historical type labels do not create separate entitlements.
   *
   * `leaveType` is accepted for compatibility; every paid historical type maps
   * to the same ANNUAL pool. Throws LeavePolicyUnresolvedError when no policy applies.
   */
  async getYearlyAllocation(
    userId: string,
    year = 2026,
    leaveType?: LeaveType | PaidBucket,
    asOf?: Date | string,
  ): Promise<number> {
    const probe = this.allocationProbeDate(year, asOf);
    const policy = await this.resolveLeavePolicy(userId, probe);
    if (!policy) throw new LeavePolicyUnresolvedError();
    const bucket = leaveType ? bucketOf({ type: leaveType }) : null;
    if (leaveType && !bucket) return 0;
    if (bucket) return allocationFor(policy, bucket);
    return allocationFor(policy, 'ANNUAL');
  }

  /** The date whose governing policy answers for a leave year. */
  private allocationProbeDate(year: number, asOf?: Date | string): string {
    if (asOf) return typeof asOf === 'string' ? asOf.slice(0, 10) : this.tva.companyBusinessDate(asOf);
    const fy = this.tva.financialYearBounds(`${year}-${year + 1}`);
    const today = this.tva.companyBusinessDate(this.tva.now());
    const start = this.tva.companyBusinessDate(fy.start);
    const end = this.tva.companyBusinessDate(fy.end);
    // Today when it falls inside the year, otherwise the nearer end of it.
    return today >= start && today <= end ? today : today < start ? start : end;
  }


  /**
   * Working days in a leave range.
   *
   * `userId` is optional so every existing caller keeps compiling, but it is
   * what makes an employee-specific calendar possible — without it the V2
   * authority cannot be used and the legacy path answers.
   */
  async calculateLeaveDuration(
    startDate: Date | string,
    endDate: Date | string,
    isHalfDay = false,
    workingDaysSetting = 'Mon–Sat',
    userId?: string,
  ): Promise<number> {
    if (isHalfDay) return 0.5;

    if (userId && (await this.v2AuthorityEnabled())) {
      return this.workingDays.countWorkingDays(userId, startDate, endDate);
    }

    return this.legacyDuration(startDate, endDate, workingDaysSetting);
  }

  /**
   * Canonical form of a `workingDays` setting value.
   *
   * The stored value has historically been written with two different dashes:
   * `company.workingDays` defaults to an ASCII hyphen, `leave_policy.workingDays`
   * to an en-dash. Comparing the raw string against one spelling meant the other
   * matched NEITHER branch, so every calendar day -- Sundays included -- counted
   * as a working day and leave durations were silently inflated.
   *
   * Normalising once here is deliberate: adding a second literal to each
   * comparison would fix today's two spellings and quietly fail on the next
   * one (an em-dash pasted from a document, a stray space).
   */
  private normalizeWorkingDays(value: string | null | undefined): string {
    return (value ?? 'Mon-Sat')
      // Every Unicode dash variant, plus the minus sign, becomes a hyphen.
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
      .replace(/\s+/g, '')
      .toLowerCase();
  }

  /**
   * The pre-LH-1 rule set, with its company-date defect fixed.
   *
   * The correctness fix is deliberately NOT flag-gated. The old code derived
   * the comparison date from `companyDayStart(d).toISOString().split('T')[0]`,
   * which in IST yields the PREVIOUS calendar day, so 26 January never matched
   * the holiday list and 27 January did. It also called `Date.getDay()`, which
   * reads the SERVER's timezone — on a UTC host an IST Monday reports as
   * Sunday and was excluded from a Mon–Sat week. Both produced silently wrong
   * leave durations, and preserving a defect is not the same as preserving
   * behaviour.
   *
   * Which holiday list and which weekly-off rule are consulted is still
   * flag-gated; only the date arithmetic changed here.
   */
  private legacyDuration(
    startDate: Date | string,
    endDate: Date | string,
    workingDaysSetting: string,
  ): number {
    let duration = 0;
    const schedule = this.normalizeWorkingDays(workingDaysSetting);

    for (const businessDate of this.workingDays.enumerateBusinessDates(startDate, endDate)) {
      // A yyyy-MM-dd parsed as UTC midnight has a stable weekday that equals
      // the company-local weekday for that business date, whatever the server
      // timezone happens to be.
      const dayOfWeek = new Date(`${businessDate}T00:00:00.000Z`).getUTCDay();

      // Compared as business-date strings on both sides. No timezone shifting.
      const isHoliday = this.holidays.includes(businessDate);

      let isWorkingDay = true;
      if (schedule === 'mon-fri') {
        isWorkingDay = dayOfWeek !== 0 && dayOfWeek !== 6;
      } else if (schedule === 'mon-sat') {
        isWorkingDay = dayOfWeek !== 0;
      }

      if (isWorkingDay && !isHoliday) duration++;
    }

    return duration;
  }

  async getDurationForRequest(
    startDate: Date | string,
    endDate: Date | string,
    isHalfDay = false,
    userId?: string,
  ): Promise<number> {
    const policy = await this.settings.get('leave_policy');
    const workingDaysSetting = policy?.workingDays || 'Mon–Sat';
    return this.calculateLeaveDuration(startDate, endDate, isHalfDay, workingDaysSetting, userId);
  }

  async getLeaveBalance(
    userId: string,
    year = 2026,
    leaveType?: LeaveType | PaidBucket,
    asOf?: Date,
  ): Promise<LeaveBalanceResult> {
    const bucket = leaveType ? bucketOf({ type: leaveType }) : null;

    // THE BALANCE WINDOW IS THE FINANCIAL YEAR (April to March). Unchanged by
    // Phase 3; every caller passes the FY start year.
    const fy = this.tva.financialYearBounds(`${year}-${year + 1}`);
    const startOfYear = this.tva.companyDayStart(fy.start);
    const endOfYear = this.tva.companyDayEnd(fy.end);

    let allocation: number | null;
    try {
      allocation = await this.getYearlyAllocation(userId, year, bucket ?? undefined, asOf);
    } catch (error) {
      if (!(error instanceof LeavePolicyUnresolvedError)) throw error;
      allocation = null;
    }

    const rows = await this.prisma.leaveRequest.findMany({
      where: {
        userId,
        startDate: { gte: startOfYear, lte: endOfYear },
        status: { in: [LeaveStatus.APPROVED, LeaveStatus.PENDING] },
      },
    });

    const policy = await this.settings.get('leave_policy');
    const workingDaysSetting = policy?.workingDays || 'Mon–Sat';

    // Leave records that predate the employee's first V2 attendance profile
    // keep their original legacy calculation (see LH-1).
    const firstV2Profile = await this.prisma.employeeAttendanceProfile.findFirst({
      where: { userId },
      orderBy: { effectiveFrom: 'asc' },
      select: { effectiveFrom: true },
    });

    let approvedDays = 0;
    let pendingDays = 0;
    let unmeasured = 0;

    for (const leave of rows) {
      const rowBucket = bucketOf(leave);
      // Comp Off and Unpaid never draw on a paid bucket.
      if (!rowBucket) continue;
      if (bucket && rowBucket !== bucket) continue;

      // An approved request whose settlement was recorded uses what it was
      // actually funded with, never a re-measurement.
      if (leave.status === LeaveStatus.APPROVED && typeof leave.paidDays === 'number') {
        approvedDays += leave.paidDays;
        continue;
      }

      let duration: number;
      try {
        duration = await this.calculateLeaveDuration(
          leave.startDate,
          leave.endDate,
          leave.isHalfDay,
          workingDaysSetting,
          userId,
        );
      } catch (error) {
        if (!(error instanceof LeaveCalendarUnresolvedError)) throw error;
        const isPreFoundationRecord =
          firstV2Profile?.effectiveFrom && leave.createdAt < firstV2Profile.effectiveFrom;
        if (!isPreFoundationRecord) {
          // Phase 3: a request that cannot be measured yet (calendar setup
          // pending) is counted separately rather than failing the balance.
          unmeasured += 1;
          continue;
        }
        duration = this.legacyDuration(leave.startDate, leave.endDate, workingDaysSetting);
      }
      if (leave.status === LeaveStatus.APPROVED) approvedDays += duration;
      else pendingDays += duration;
    }

    return {
      allocation,
      approved: approvedDays,
      pending: pendingDays,
      balance: allocation === null ? null : Math.max(0, allocation - approvedDays),
      bucket,
      setupStatus: allocation === null ? 'POLICY_SETUP_PENDING' : 'RESOLVED',
      unmeasuredRequests: unmeasured,
    };
  }

  /**
   * Submission checks for a new request (Phase 3).
   *
   * Overlap with a pending or approved request is always refused. Balance is
   * NOT a reason to refuse: final approval records PAID/PARTIAL/UNPAID, and an
   * underfunded request is saved and flagged, never turned into LWP here.
   * Configuration gaps throw LeaveCalendarUnresolvedError /
   * LeavePolicyUnresolvedError so the caller saves the request setup-pending.
   */
  async validateLeaveRequest(
    userId: string,
    startDate: Date | string,
    endDate: Date | string,
    isHalfDay = false,
    leaveType?: LeaveType,
    fundingBucket?: PaidBucket | null,
  ): Promise<{ duration: number; balance: number | null; insufficient: boolean }> {
    const start = new Date(startDate);
    const end = new Date(endDate);

    await this.assertNoOverlap(userId, start, end);

    const policy = await this.settings.get('leave_policy');
    const workingDaysSetting = policy?.workingDays || 'Mon–Sat';
    const requestDuration = await this.calculateLeaveDuration(start, end, isHalfDay, workingDaysSetting, userId);
    if (requestDuration === 0) {
      throw new ForbiddenException('Selected range contains no working days.');
    }

    if (leaveType === LeaveType.COMP_OFF) {
      if (isHalfDay || requestDuration !== 1) {
        throw new ForbiddenException('A Comp Off request must cover exactly one full working day.');
      }
      return { duration: requestDuration, balance: null, insufficient: false };
    }

    const bucket = fundingBucket ?? (leaveType ? bucketOf({ type: leaveType }) : null);
    if (!bucket) return { duration: requestDuration, balance: null, insufficient: false };

    const balanceYear = this.tva.financialYear(start).startYear;
    const result = await this.getLeaveBalance(userId, balanceYear, bucket, start);
    if (result.allocation === null) throw new LeavePolicyUnresolvedError();
    const available = (result.balance ?? 0) - result.pending;
    return { duration: requestDuration, balance: result.balance, insufficient: available < requestDuration };
  }

  /** Overlap with a pending or approved request is refused in every mode. */
  async assertNoOverlap(userId: string, start: Date, end: Date): Promise<void> {
    const overlapping = await this.prisma.leaveRequest.count({
      where: {
        userId,
        status: { in: [LeaveStatus.PENDING, LeaveStatus.APPROVED] },
        startDate: { lte: end },
        endDate: { gte: start },
      },
    });
    if (overlapping > 0) {
      throw new ForbiddenException('You have an overlapping pending or approved leave request for these dates.');
    }
  }
}
