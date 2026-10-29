import { Injectable, Logger } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { NotificationEventService } from '../../../operations/notifications/notification-event.service';

const OPEN_REGULARIZATION_STATUSES = ['PENDING', 'MANAGER_APPROVED', 'HR_APPROVED', 'APPROVED', 'STALE_REVIEW_REQUIRED'] as const;

function databaseDay(day: string) {
  return new Date(`${day}T00:00:00.000Z`);
}

function nextMonth(month: string) {
  const [year, value] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, value, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function isLastCalendarDay(day: string) {
  const date = databaseDay(day);
  const tomorrow = new Date(date.getTime() + 86_400_000);
  return tomorrow.getUTCMonth() !== date.getUTCMonth();
}

function readableDay(day: string) {
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(databaseDay(day));
}

@Injectable()
export class AttendanceRegularizationReminderService {
  private readonly logger = new Logger(AttendanceRegularizationReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationEventService,
  ) {}

  private async unresolvedRows(from: string, toExclusive: string) {
    const rows = await this.prisma.dailyAttendance.findMany({
      where: {
        date: { gte: databaseDay(from), lt: databaseDay(toExclusive) },
        evaluationState: 'NEEDS_REVIEW',
        user: { isActive: true, isSystemAccount: false },
      },
      select: { id: true, userId: true, date: true },
      orderBy: [{ userId: 'asc' }, { date: 'asc' }],
    });
    if (!rows.length) return [];

    const requests = await this.prisma.attendanceRegularization.findMany({
      where: {
        status: { in: [...OPEN_REGULARIZATION_STATUSES] },
        OR: rows.map((row) => ({ userId: row.userId, date: row.date })),
      },
      select: { userId: true, date: true },
    });
    const requested = new Set(requests.map((row) => `${row.userId}:${row.date.toISOString().slice(0, 10)}`));
    return rows.filter((row) => !requested.has(`${row.userId}:${row.date.toISOString().slice(0, 10)}`));
  }

  /** One durable reminder for one unresolved employee-day. Safe to call repeatedly. */
  async remindForDate(businessDate: string) {
    const tomorrow = new Date(databaseDay(businessDate).getTime() + 86_400_000).toISOString().slice(0, 10);
    const rows = await this.unresolvedRows(businessDate, tomorrow);
    let sent = 0;
    for (const row of rows) {
      try {
        await this.notifications.sendNotification(row.userId, 'attendanceCorrection', {
          title: `Attendance needs review · ${readableDay(businessDate)}`,
          message: 'Please review this attendance day and submit a regularization request if a correction is required.',
          type: NotificationType.WARNING,
          link: '/attendance',
          entityType: 'DAILY_ATTENDANCE',
          entityId: row.id,
          dedupeKey: `attendance-regularization:day:${row.id}`,
        });
        sent += 1;
      } catch (error) {
        this.logger.error(`Could not send regularization reminder for ${row.id}: ${error}`);
      }
    }
    return sent;
  }

  /** Last-day summary for every still-unregularized Needs Review day in the month. */
  async remindMonthEnd(month: string) {
    const rows = await this.unresolvedRows(`${month}-01`, `${nextMonth(month)}-01`);
    const byUser = new Map<string, typeof rows>();
    for (const row of rows) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);
    let sent = 0;
    for (const [userId, userRows] of byUser) {
      const dates = userRows.map((row) => readableDay(row.date.toISOString().slice(0, 10)));
      const preview = dates.slice(0, 4).join(', ');
      const remainder = dates.length > 4 ? ` and ${dates.length - 4} more` : '';
      try {
        await this.notifications.sendNotification(userId, 'attendanceCorrection', {
          title: `${dates.length} attendance ${dates.length === 1 ? 'day needs' : 'days need'} review`,
          message: `Before the month closes, regularize unresolved attendance for ${preview}${remainder}.`,
          type: NotificationType.WARNING,
          link: '/attendance',
          entityType: 'ATTENDANCE_MONTH',
          entityId: month,
          dedupeKey: `attendance-regularization:month-end:${userId}:${month}`,
        });
        sent += 1;
      } catch (error) {
        this.logger.error(`Could not send month-end regularization reminder to ${userId}: ${error}`);
      }
    }
    return sent;
  }
}
