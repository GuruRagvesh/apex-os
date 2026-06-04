import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { EventsGateway } from '../gateway/events.gateway';
import { TicketLedgerService } from '../../operations/tickets/ticket-ledger.service';
import { NotificationEventService } from '../../operations/notifications/notification-event.service';
import { NotificationType } from '@prisma/client';
import { TimezoneUtil } from '../../../common/utils/timezone.util';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { SettingsService } from '../settings/settings.service';
import { shouldPolicyAutoStop } from '../workday/workday.policy.helper';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger('SchedulerService');

  constructor(
    private prisma: PrismaService,
    private gateway: EventsGateway,
    private ticketLedger: TicketLedgerService,
    private notificationEventService: NotificationEventService,
    private settingsService: SettingsService,
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
      // NOTE: scheduleRecurring is String? — Prisma's notIn does not accept null as an element.
      // Use AND to separately exclude null and the sentinel string 'none'.
      const recurringTickets = await this.prisma.ticket.findMany({
        where: {
          status: { notIn: ['DONE', 'CLOSED'] },
          AND: [
            { scheduleRecurring: { not: null } },
            { scheduleRecurring: { not: 'none' } },
          ],
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
      let existingSession = await this.prisma.workSession.findFirst({
        where: { userId: leave.userId, date: today },
        orderBy: { createdAt: 'desc' }
      });

      if (existingSession) {
        await this.prisma.workSession.update({
          where: { id: existingSession.id },
          data: { status: 'ON_LEAVE', leaveId: leave.id },
        });
      } else {
        await this.prisma.workSession.create({
          data: { userId: leave.userId, date: today, status: 'ON_LEAVE', leaveId: leave.id },
        });
      }
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

  // 1b. AUTO-CLOSE MIDNIGHT SESSIONS & POLICY AUTO STOP — every 15 minutes
  @Cron('*/15 * * * *')
  async autoCloseMidnightSessions() {
    try {
      const policy = await this.settingsService.getWorkdayPolicy();
      const timezone = policy?.timezone || 'Asia/Kolkata';

      const openSessions = await this.prisma.workSession.findMany({
        where: { logoutAt: null },
        include: { breakLogs: true, user: { include: { role: true } } },
      });

      const nowGlobal = new Date();
      const currentCompanyDateStr = formatInTimeZone(nowGlobal, timezone, 'yyyy-MM-dd');

      let closedCount = 0;
      let policyStopCount = 0;
      for (const session of openSessions) {
        const sessionAnchor = session.loginAt || session.createdAt;
        const sessionCompanyDateStr = formatInTimeZone(sessionAnchor, timezone, 'yyyy-MM-dd');

        if (sessionCompanyDateStr >= currentCompanyDateStr) {
          // It's from today (or the future), check policy auto-stop
          const { shouldStop, cutoffUtc } = shouldPolicyAutoStop(session, session.user, policy, nowGlobal, currentCompanyDateStr, sessionCompanyDateStr);
          
          if (shouldStop && cutoffUtc) {
            await this.ticketLedger.pauseActiveLogsForUser({
              userId: session.userId,
              pauseReason: 'POLICY_AUTO_STOP',
              endedAt: cutoffUtc,
            });

            let totalBreakMinutes = 0;
            for (const breakLog of session.breakLogs) {
              if (breakLog.endAt) {
                totalBreakMinutes += breakLog.durationMinutes ?? 0;
              } else {
                const duration = Math.max(0, Math.floor((cutoffUtc.getTime() - breakLog.startAt.getTime()) / 60000));
                await this.prisma.breakLog.update({
                  where: { id: breakLog.id },
                  data: { endAt: cutoffUtc, durationMinutes: duration, source: 'POLICY_AUTO_STOP' },
                });
                totalBreakMinutes += duration;
              }
            }

            let totalWorkMinutes = 0;
            if (session.startWorkAt) {
              const elapsed = Math.floor((cutoffUtc.getTime() - session.startWorkAt.getTime()) / 60000);
              totalWorkMinutes = Math.max(0, elapsed - totalBreakMinutes);
            }

            await this.prisma.workSession.update({
              where: { id: session.id },
              data: {
                logoutAt: cutoffUtc,
                status: 'AUTO_CLOSED',
                autoClosed: true,
                autoClosedAt: nowGlobal,
                closureReason: 'POLICY_AUTO_STOP',
                totalBreakMinutes,
                totalWorkMinutes,
              },
            });

            await this.prisma.attendanceEvent.create({
              data: {
                userId: session.userId,
                workSessionId: session.id,
                eventType: 'POLICY_AUTO_STOP',
                source: 'system',
              },
            });

            await this.prisma.user.update({
              where: { id: session.userId },
              data: { currentStatus: 'LOGGED_OUT' },
            });

            try {
              await this.notificationEventService.sendNotification(session.userId, 'system', {
                title: 'Workday auto-stopped',
                message: 'Your workday was automatically stopped based on the company workday policy.',
                type: NotificationType.WARNING,
                link: '/dashboard',
                entityType: 'WORKDAY',
                entityId: session.id,
              });
            } catch (_e) {}

            policyStopCount++;
          }
          continue; // Skip midnight stale-close for current/future day
        }

        // Calculate the exact midnight moment AFTER the session's date in company timezone
        // The session belongs to `sessionCompanyDateStr`. We want 00:00 AM of the NEXT day.
        const nextDayDateStr = formatInTimeZone(new Date(sessionAnchor.getTime() + 24 * 60 * 60 * 1000), timezone, 'yyyy-MM-dd');
        const nextMidnightIso = `${nextDayDateStr}T00:00:00.000`;
        const offsetString = formatInTimeZone(sessionAnchor, timezone, 'xxx');
        const autoCloseTime = new Date(`${nextMidnightIso}${offsetString}`);
        
        // We use autoCloseTime (the midnight boundary) as the time the session logically ended, unless now is earlier? 
        // No, we are closing it retrospectively.
        const now = autoCloseTime; 
        
        await this.ticketLedger.pauseActiveLogsForUser({
          userId: session.userId,
          pauseReason: 'SYSTEM',
          endedAt: now,
        });

        let totalBreakMinutes = 0;
        for (const breakLog of session.breakLogs) {
          if (breakLog.endAt) {
            totalBreakMinutes += breakLog.durationMinutes ?? 0;
          } else {
            const duration = Math.max(0, Math.floor((now.getTime() - breakLog.startAt.getTime()) / 60000));
            await this.prisma.breakLog.update({
              where: { id: breakLog.id },
              data: { endAt: now, durationMinutes: duration, source: 'AUTO_CLOSE' },
            });
            totalBreakMinutes += duration;
          }
        }

        let totalWorkMinutes = 0;
        if (session.startWorkAt) {
          const elapsed = Math.floor((now.getTime() - session.startWorkAt.getTime()) / 60000);
          totalWorkMinutes = Math.max(0, elapsed - totalBreakMinutes);
        }

        await this.prisma.workSession.update({
          where: { id: session.id },
          data: {
            logoutAt: now,
            status: 'AUTO_CLOSED',
            autoClosed: true,
            autoClosedAt: now,
            closureReason: 'AUTO_MIDNIGHT_CLOSE',
            totalBreakMinutes,
            totalWorkMinutes,
          },
        });

        await this.prisma.attendanceEvent.create({
          data: {
            userId: session.userId,
            workSessionId: session.id,
            eventType: 'AUTO_CLOSE',
            source: 'system',
          },
        });

        await this.prisma.user.update({
          where: { id: session.userId },
          data: { currentStatus: 'LOGGED_OUT' },
        });

        // Notify user about auto-close
        try {
          await this.notificationEventService.sendNotification(session.userId, 'system', {
            title: 'Workday auto-closed',
            message: 'Your workday was automatically closed at the company day boundary.',
            type: NotificationType.WARNING,
            link: '/dashboard',
            entityType: 'WORKDAY',
            entityId: session.id,
          });
        } catch (_e) {}
        
        closedCount++;
      }
      if (closedCount > 0 || policyStopCount > 0) {
        this.logger.log(`[scheduler] Auto-closed ${closedCount} stale sessions and ${policyStopCount} policy-stopped sessions.`);
      }
    } catch (err) {
      this.logger.error(`[scheduler] Auto-close stale sessions error: ${err}`);
    }
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
