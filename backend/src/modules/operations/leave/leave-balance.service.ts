import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SettingsService } from '../../platform/settings/settings.service';
import { LeaveStatus } from '@prisma/client';
import { TVAService } from '../../../common/services/tva.service';

@Injectable()
export class LeaveBalanceService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private tva: TVAService,
  ) {}

  // Standard public holidays for 2026 (YYYY-MM-DD)
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

  async getYearlyAllocation(userId: string, year = 2026): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (!user) return 0;
    const quotas = await this.settings.getLeaveQuotas();
    return quotas[user.role.name] ?? 12;
  }

  async calculateLeaveDuration(
    startDate: Date | string,
    endDate: Date | string,
    isHalfDay = false,
    workingDays = 'Mon–Sat',
  ): Promise<number> {
    if (isHalfDay) return 0.5;

    let duration = 0;
    // Normalize times to start of day in company timezone
    const current = this.tva.companyDayStart(new Date(startDate));
    const end = this.tva.companyDayStart(new Date(endDate));

    while (current <= end) {
      const dayOfWeek = current.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
      const dateString = current.toISOString().split('T')[0];

      // Check if it's a holiday
      const isHoliday = this.holidays.includes(dateString);

      // Check if it's a working day
      let isWorkingDay = true;
      if (workingDays === 'Mon–Fri') {
        isWorkingDay = dayOfWeek !== 0 && dayOfWeek !== 6; // exclude Sunday (0) and Saturday (6)
      } else if (workingDays === 'Mon–Sat') {
        isWorkingDay = dayOfWeek !== 0; // exclude Sunday (0)
      }

      if (isWorkingDay && !isHoliday) {
        duration++;
      }

      current.setDate(current.getDate() + 1);
    }

    return duration;
  }

  async getDurationForRequest(startDate: Date | string, endDate: Date | string, isHalfDay = false): Promise<number> {
    const policy = await this.settings.get('leave_policy');
    const workingDaysSetting = policy?.workingDays || 'Mon–Sat';
    return this.calculateLeaveDuration(startDate, endDate, isHalfDay, workingDaysSetting);
  }

  async getLeaveBalance(userId: string, year = 2026): Promise<{ allocation: number; approved: number; pending: number; balance: number }> {
    const allocation = await this.getYearlyAllocation(userId, year);

    // Fetch approved/pending leaves in this year
    const startOfYear = this.tva.companyDayStart(new Date(year, 0, 1));
    const endOfYear = this.tva.companyDayEnd(new Date(year, 11, 31));

    const leaves = await this.prisma.leaveRequest.findMany({
      where: {
        userId,
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
      );
      if (leave.status === LeaveStatus.APPROVED) {
        approvedDays += duration;
      } else if (leave.status === LeaveStatus.PENDING) {
        pendingDays += duration;
      }
    }

    const balance = Math.max(0, allocation - approvedDays);

    return {
      allocation,
      approved: approvedDays,
      pending: pendingDays,
      balance,
    };
  }

  async validateLeaveRequest(userId: string, startDate: Date | string, endDate: Date | string, isHalfDay = false): Promise<void> {
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
    const { balance } = await this.getLeaveBalance(userId, start.getFullYear());
    const policy = await this.settings.get('leave_policy');
    const workingDaysSetting = policy?.workingDays || 'Mon–Sat';

    const requestDuration = await this.calculateLeaveDuration(start, end, isHalfDay, workingDaysSetting);

    if (requestDuration === 0) {
      throw new ForbiddenException('Selected range contains no working days.');
    }

    if (balance < requestDuration) {
      throw new ForbiddenException(`Insufficient leave balance. Remaining: ${balance} days, Requested: ${requestDuration} days.`);
    }
  }
}
