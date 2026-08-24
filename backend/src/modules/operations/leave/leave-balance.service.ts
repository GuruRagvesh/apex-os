import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SettingsService } from '../../platform/settings/settings.service';
import { LeaveStatus, LeaveType } from '@prisma/client';
import { TVAService } from '../../../common/services/tva.service';
import { LeaveWorkingDayService } from './leave-working-day.service';
import {
  ATTENDANCE_V2_DEFAULTS,
  ATTENDANCE_V2_SETTING_KEY,
} from '../../platform/attendance/punch/punch-evidence.types';

@Injectable()
export class LeaveBalanceService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private tva: TVAService,
    private workingDays: LeaveWorkingDayService,
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
   * Paid-leave allocation for a year.
   *
   * V2 takes it from the employee's effective versioned LeavePolicy, which is
   * where the approved 14-leave policy actually lives. The legacy role-quota
   * table remains as compatibility configuration and still answers when the
   * flag is off.
   */
  async getYearlyAllocation(
    userId: string,
    year = 2026,
    leaveType?: LeaveType,
  ): Promise<number> {
    if (await this.v2AuthorityEnabled()) {
      const fromPolicy = await this.allocationFromLeavePolicy(userId, year, leaveType);
      if (fromPolicy !== null) return fromPolicy;
      // No effective policy assigned: fall through to the legacy quota rather
      // than inventing a number. Reported, not silently zeroed.
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (!user) return 0;
    const quotas = await this.settings.getLeaveQuotas();
    return quotas[user.role.name] ?? 12;
  }

  /** totalPaidLeaves from the employee's effective-dated LeavePolicy, if any. */
  private async allocationFromLeavePolicy(
    userId: string,
    year: number,
    leaveType?: LeaveType,
  ): Promise<number | null> {
    // Mid-year is a safe probe for "the policy that governs this year": it sits
    // inside every sane effective window for the year.
    const profile = await this.prisma.employeeAttendanceProfile.findFirst({
      where: {
        userId,
        effectiveFrom: { lte: this.tva.companyDayEnd(new Date(`${year}-07-01T00:00:00.000Z`)) },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: this.tva.companyDayStart(new Date(`${year}-07-01T00:00:00.000Z`)) } },
        ],
      },
      orderBy: { effectiveFrom: 'desc' },
      include: { assignedLeavePolicy: true },
    });

    const policy = profile?.assignedLeavePolicy;
    if (!policy) return null;
    if (leaveType === LeaveType.CASUAL) return policy.casualLeaveAllocation;
    if (leaveType === LeaveType.EMERGENCY) return policy.emergencyLeaveAllocation;
    if (leaveType === LeaveType.COMP_OFF) return 0;
    return typeof policy.totalPaidLeaves === 'number' ? policy.totalPaidLeaves : null;
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
    leaveType?: LeaveType,
  ): Promise<{ allocation: number; approved: number; pending: number; balance: number }> {
    const allocation = await this.getYearlyAllocation(userId, year, leaveType);

    const v2 = await this.v2AuthorityEnabled();
    const fy = v2 ? this.tva.financialYearBounds(`${year}-${year + 1}`) : null;
    // Flag OFF preserves the historical calendar-year reader. The management
    // policy authority uses TVA's April-to-March financial-year bounds.
    const startOfYear = this.tva.companyDayStart(
      fy?.start ?? new Date(`${year}-01-01T00:00:00.000Z`),
    );
    const endOfYear = this.tva.companyDayEnd(
      fy?.end ?? new Date(`${year}-12-31T00:00:00.000Z`),
    );

    const leaves = await this.prisma.leaveRequest.findMany({
      where: {
        userId,
        ...(leaveType ? { type: leaveType } : {}),
        startDate: { gte: startOfYear, lte: endOfYear },
        status: { in: [LeaveStatus.APPROVED, LeaveStatus.PENDING] },
      },
    });

    const policy = await this.settings.get('leave_policy');
    const workingDaysSetting = policy?.workingDays || 'Mon–Sat';

    let approvedDays = 0;
    let pendingDays = 0;

    for (const leave of leaves) {
      const duration = await this.calculateLeaveDuration(
        leave.startDate,
        leave.endDate,
        leave.isHalfDay,
        workingDaysSetting,
        userId,
      );
      if (leave.status === LeaveStatus.APPROVED) {
        approvedDays += duration;
      } else if (leave.status === LeaveStatus.PENDING) {
        pendingDays += duration;
      }
    }

    const balance = Math.max(0, allocation - approvedDays);

    return { allocation, approved: approvedDays, pending: pendingDays, balance };
  }

  async validateLeaveRequest(
    userId: string,
    startDate: Date | string,
    endDate: Date | string,
    isHalfDay = false,
    leaveType?: LeaveType,
  ): Promise<void> {
    const start = new Date(startDate);
    const end = new Date(endDate);

    // 1. Prevent overlapping leaves
    const overlapping = await this.prisma.leaveRequest.count({
      where: {
        userId,
        status: { in: [LeaveStatus.PENDING, LeaveStatus.APPROVED] },
        OR: [
          {
            startDate: { lte: end },
            endDate: { gte: start },
          },
        ],
      },
    });

    if (overlapping > 0) {
      throw new ForbiddenException('You have an overlapping pending or approved leave request for these dates.');
    }

    // 2. Validate leave balance
    const balanceYear = (await this.v2AuthorityEnabled())
      ? this.tva.financialYear(start).startYear
      : start.getFullYear();
    const { balance } = await this.getLeaveBalance(userId, balanceYear, leaveType);
    const policy = await this.settings.get('leave_policy');
    const workingDaysSetting = policy?.workingDays || 'Mon–Sat';

    const requestDuration = await this.calculateLeaveDuration(
      start,
      end,
      isHalfDay,
      workingDaysSetting,
      userId,
    );

    if (requestDuration === 0) {
      throw new ForbiddenException('Selected range contains no working days.');
    }

    if (leaveType === LeaveType.COMP_OFF) {
      if (isHalfDay || requestDuration !== 1) {
        throw new ForbiddenException('A Comp Off request must cover exactly one full working day.');
      }
      // Availability is serialized at final HR approval. Submission never
      // reserves a credit and never falls through to another entitlement.
      return;
    }

    // Legacy rejects an underfunded request here. LH-2 deliberately permits it
    // so final HR approval can record PAID/PARTIAL/UNPAID without rewriting the
    // employee's requested leave type.
    if (balance < requestDuration) {
      // Under LH-2, submission records what was requested; the serialized HR
      // approval transaction is the authority that settles PAID/PARTIAL/UNPAID.
      // The legacy path keeps its original pre-submission rejection.
      if (await this.approvalSettlementEnabled()) return;
      throw new ForbiddenException(`Insufficient leave balance. Remaining: ${balance} days, Requested: ${requestDuration} days.`);
    }
  }
}
