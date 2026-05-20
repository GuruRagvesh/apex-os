import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { EventsGateway } from '../gateway/events.gateway';
import { NotificationType } from '@prisma/client';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger('SchedulerService');

  constructor(
    private prisma: PrismaService,
    private gateway: EventsGateway,
  ) {}

  private async sendScheduleNotification(ticket: any, prefix: string) {
    const recipientIds = new Set<string>();
    if (ticket.assignedTo?.id) recipientIds.add(ticket.assignedTo.id);
    for (const a of ticket.assignees ?? []) {
      if (a.user?.id) recipientIds.add(a.user.id);
    }
    for (const uid of recipientIds) {
      try {
        await this.prisma.notification.create({
          data: {
            userId: uid,
            title: `${prefix} reminder`,
            message: `Ticket ${ticket.ticketId}: ${ticket.title}`,
            type: NotificationType.INFO,
            isRead: false,
            link: `/tickets/${ticket.id}`,
            entityId: ticket.id,
            entityType: 'TICKET',
          },
        });
        this.gateway.emitNotificationToUser(uid, {
          title: `${prefix} reminder`,
          message: `${ticket.ticketId}: ${ticket.title}`,
        });
      } catch (err) {
        this.logger.error(`[scheduler] Failed to notify user ${uid}: ${err}`);
      }
    }
  }

  /** Runs every hour — handles both one-time and recurring scheduled tickets */
  @Cron('0 * * * *', { name: 'scheduled-ticket-reminders' })
  async checkScheduledTickets() {
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay(); // 0=Sun..6=Sat
    const dayOfMonth = now.getDate();

    try {
      // ONE-TIME: tickets scheduled within last 5 minutes (for backwards compat, check last hour)
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const oneTimeTickets = await this.prisma.ticket.findMany({
        where: {
          scheduledFor: { lte: now, gt: oneHourAgo },
          status: 'OPEN',
          OR: [
            { scheduleRecurring: null },
            { scheduleRecurring: 'none' },
          ],
        },
        include: {
          assignedTo: { select: { id: true, name: true } },
          assignees: { include: { user: { select: { id: true, name: true } } } },
        },
      });

      for (const ticket of oneTimeTickets) {
        this.logger.log(`[scheduler] One-time reminder for ${ticket.ticketId}`);
        await this.sendScheduleNotification(ticket, 'Scheduled ticket');
      }

      // RECURRING: query tickets with a recurring type and active (not past scheduleEndDate)
      const recurringTickets = await this.prisma.ticket.findMany({
        where: {
          status: { notIn: ['DONE', 'CLOSED'] },
          scheduleRecurring: { notIn: [null as any, 'none'] },
          OR: [
            { scheduleEndDate: null },
            { scheduleEndDate: { gte: now } },
          ],
        },
        include: {
          assignedTo: { select: { id: true, name: true } },
          assignees: { include: { user: { select: { id: true, name: true } } } },
        },
      });

      for (const ticket of recurringTickets) {
        const recurrence = ticket.scheduleRecurring!;
        let shouldFire = false;

        if (recurrence === 'daily_morning' && hour === 9) {
          shouldFire = true;
        } else if (recurrence === 'daily_evening' && hour === 18) {
          shouldFire = true;
        } else if (recurrence === 'weekly' && hour === 9) {
          const createdDay = new Date(ticket.createdAt).getDay();
          shouldFire = dayOfWeek === createdDay;
        } else if (recurrence === 'monthly' && hour === 9) {
          const createdDate = new Date(ticket.createdAt).getDate();
          shouldFire = dayOfMonth === createdDate;
        } else if ((recurrence === '1_month' || recurrence === '6_months') && hour === 9) {
          // Daily morning reminder for duration-based recurrence
          shouldFire = true;
        }

        if (shouldFire) {
          this.logger.log(`[scheduler] Recurring (${recurrence}) reminder for ${ticket.ticketId}`);
          await this.sendScheduleNotification(ticket, `Recurring ticket`);
        }
      }

      const total = oneTimeTickets.length + recurringTickets.filter(() => true).length;
      if (total > 0) this.logger.log(`[scheduler] Processed ${oneTimeTickets.length} one-time + recurring checks`);
    } catch (err) {
      this.logger.error(`[scheduler] checkScheduledTickets error: ${err}`);
    }
  }

  // 1. MIDNIGHT LEAVE STATUS SETTER — 00:01 every day
  @Cron('1 0 * * *')
  async setLeaveStatuses() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const approvedLeaves = await this.prisma.leaveRequest.findMany({
      where: {
        status: 'APPROVED',
        startDate: { lte: today },
        endDate: { gte: today },
      },
    });

    for (const leave of approvedLeaves) {
      await this.prisma.workSession.upsert({
        where: { userId_date: { userId: leave.userId, date: today } },
        update: { status: 'ON_LEAVE', leaveId: leave.id },
        create: { userId: leave.userId, date: today, status: 'ON_LEAVE', leaveId: leave.id },
      });
      await this.prisma.user.update({
        where: { id: leave.userId },
        data: { currentStatus: 'ON_LEAVE' },
      });
    }

    // Reset all non-leave users to OFFLINE
    const leaveUserIds = approvedLeaves.map((l) => l.userId);
    await this.prisma.user.updateMany({
      where: {
        isActive: true,
        id: { notIn: leaveUserIds.length > 0 ? leaveUserIds : ['__none__'] },
      },
      data: { currentStatus: 'OFFLINE' },
    });

    console.log(`[Scheduler] Leave statuses set. ${approvedLeaves.length} users on leave today.`);
  }

  // 2. WORKDAY END REMINDER — 6:30 PM Mon-Sat
  @Cron('30 18 * * 1-6')
  async workdayEndReminder() {
    const stillWorking = await this.prisma.user.findMany({
      where: { currentStatus: { in: ['WORKING', 'ON_BREAK', 'IDLE'] }, isActive: true },
    });

    for (const user of stillWorking) {
      await this.prisma.notification.create({
        data: {
          userId: user.id,
          title: 'End your workday',
          message: 'Official work hours (9:30 AM – 6:30 PM) are over. Remember to end your workday.',
          type: NotificationType.INFO,
          isRead: false,
          link: '/dashboard',
        },
      });
      this.gateway.server?.to(`user:${user.id}`).emit('notification:new', {
        title: 'End your workday',
        message: 'Official work hours are over.',
      });
    }
    console.log(`[Scheduler] Workday end reminder sent to ${stillWorking.length} users.`);
  }

  // 3. AUTO LOGOUT — every hour
  @Cron('0 * * * *')
  async autoLogoutInactive() {
    const hour = new Date().getHours();
    if (hour < 9 || hour > 20) return;

    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const idleUsers = await this.prisma.user.findMany({
      where: { currentStatus: 'IDLE', lastActiveAt: { lte: cutoff }, isActive: true },
    });

    for (const user of idleUsers) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { currentStatus: 'OFFLINE' },
      });
      await this.prisma.workSession.updateMany({
        where: { userId: user.id, date: today, status: 'IDLE' },
        data: { status: 'LOGGED_OUT', logoutAt: new Date() },
      });
      await this.prisma.attendanceEvent.create({
        data: {
          userId: user.id,
          eventType: 'AUTO_LOGOUT',
          source: 'system',
          metadata: { reason: '2 hours idle' },
        },
      });
    }
    if (idleUsers.length > 0) {
      console.log(`[Scheduler] Auto-logout: ${idleUsers.length} idle users logged out.`);
    }
  }
}
