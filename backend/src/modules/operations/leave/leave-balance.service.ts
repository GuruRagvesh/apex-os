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
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    // Intern leave is earned monthly, not made available as a 12-day annual
    // bank. The annual equivalent is returned here for reports; balance and
    // request validation below enforce the actual one-day monthly window.
    if (user?.role?.name === 'INTERN') {
      if (leaveType === LeaveType.EMERGENCY) return 0;
      return 12;
    }

    if (await this.v2AuthorityEnabled()) {
      const fromPolicy = await this.allocationFromLeavePolicy(userId, year, leaveType);
      if (fromPolicy !== null) return fromPolicy;
      // No effective policy assigned: fall through to the legacy quota rather
      // than inventing a number. Reported, not silently zeroed.
    }

    if (!user) return 0;
    if (leaveType === LeaveType.CASUAL) return 10;
    if (leaveType === LeaveType.EMERGENCY) return 4;
    const quotas = await this.settings.getLeaveQuotas();
    return quotas[user.role.name] ?? 14;
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
    asOf?: Date,
  ): Promise<{ allocation: number; approved: number; pending: number; balance: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    const isIntern = user?.role?.name === 'INTERN';
    const allocation = isIntern
      ? leaveType === LeaveType.EMERGENCY ? 0 : 1
      : await this.getYearlyAllocation(userId, year, leaveType);

    // THE BALANCE WINDOW IS THE FINANCIAL YEAR. ALWAYS.
    //
    // `year` has meant the FY START year at every caller for as long as this
    // method has had one -- LeaveService.getUserBalance() passes
    // financialYear().startYear, and so does the HR monthly register. The
    // window itself used to depend on attendance_v2.leaveAuthorityEnabled and
    // fell back to January-December when that was off, so the same argument
    // could name two different periods depending on a feature flag.
    //
    // For nine months of the year those two windows carry the same number and
    // the disagreement is invisible. From January to March it is real: leave
    // taken in Jan-Mar was counted against the WRONG financial year, and a
    // balance labelled "FY 2026-2027" was measuring January to December 2026.
    //
    // The company leave year is April to March. That is a policy fact, not a
    // rollout stage, so it no longer waits on a flag. Deliberately narrow: the
    // flag still governs leave DURATION and ALLOCATION, which are separate
    // decisions with their own blast radius, and neither is touched here.
    const fy = this.tva.financialYearBounds(`${year}-${year + 1}`);
    let startOfYear = this.tva.companyDayStart(fy.start);
    let endOfYear = this.tva.companyDayEnd(fy.end);

    // Interns receive one paid Casual day in each calendar month. Unused days
    // do not silently accumulate into an annual bank.
    if (isIntern) {
      const businessDate = this.tva.companyBusinessDate(asOf ?? this.tva.now());
      const [windowYear, windowMonth] = businessDate.split('-').map(Number);
      const monthStart = new Date(Date.UTC(windowYear, windowMonth - 1, 1));
      const monthEnd = new Date(Date.UTC(windowYear, windowMonth, 0));
      startOfYear = this.tva.companyDayStart(monthStart);
      endOfYear = this.tva.companyDayEnd(monthEnd);
    }

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
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    const isIntern = user?.role?.name === 'INTERN';

    if (isIntern) {
      const startMonth = this.tva.companyBusinessDate(start).slice(0, 7);
      const endMonth = this.tva.companyBusinessDate(end).slice(0, 7);
      if (startMonth !== endMonth) {
        throw new ForbiddenException('Intern paid-leave requests must stay within one calendar month.');
      }
      if (leaveType === LeaveType.EMERGENCY) {
        throw new ForbiddenException('Interns have one paid Casual leave day per month and no separate Emergency leave allocation.');
      }
    }

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
    //
    // THE YEAR NAMED HERE MUST MATCH THE WINDOW getLeaveBalance() MEASURES.
    //
    // This used to fall back to the calendar year when the flag was off, which
    // paired with the calendar-year window it also selected. The window is now
    // always the financial year, so a calendar year here would name FY 2027-28
    // for a February 2027 request -- a year that has not begun, holds no
    // leave, and would let an underfunded request through on an empty balance.
    // One authority for "which leave year is this date in", used on both sides.
    const balanceYear = this.tva.financialYear(start).startYear;
    const { balance } = await this.getLeaveBalance(userId, balanceYear, leaveType, start);
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
