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
import { WorkdayService } from '../workday/workday.service';
import { TVAService } from '../../../common/services/tva.service';
import { AttendanceAuthorityService } from '../../../common/services/attendance-authority.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger('SchedulerService');

  constructor(
    private prisma: PrismaService,
    private gateway: EventsGateway,
    private ticketLedger: TicketLedgerService,
    private notificationEventService: NotificationEventService,
    private settingsService: SettingsService,
    private tva: TVAService,
    private attendanceAuthority: AttendanceAuthorityService,
    private workdayService: WorkdayService,
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
    const now = this.tva.now();
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
          status: { notIn: ['PENDING_APPROVAL', 'DONE', 'CLOSED'] },
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
    // Two distinct values on purpose: `today` is the real instant, correct
    // for comparing against LeaveRequest's DateTime start/end range below.
    // `todayDateOnly` is the @db.Date-safe encoding, correct for
    // WorkSession.date (see TVAService.companyDateOnly).
    const today = this.tva.companyDayStart();
    const todayDateOnly = this.tva.companyDateOnly();

    const approvedLeaves = await this.prisma.leaveRequest.findMany({
      where: {
        status: 'APPROVED',
        startDate: { lte: today },
        endDate: { gte: today },
      },
    });

    for (const leave of approvedLeaves) {
      let existingSession = await this.prisma.workSession.findFirst({
        where: { userId: leave.userId, date: todayDateOnly },
        orderBy: { createdAt: 'desc' }
      });

      if (existingSession) {
        await this.attendanceAuthority.updateWorkSession(existingSession.id, {
          status: 'ON_LEAVE',
          leaveId: leave.id,
        });
      } else {
        await this.attendanceAuthority.createWorkSession({
          userId: leave.userId,
          date: todayDateOnly,
          status: 'ON_LEAVE',
          leaveId: leave.id,
        });
      }
      await this.attendanceAuthority.setUserStatus(leave.userId, 'ON_LEAVE');
    }

    // Reset all non-leave users to OFFLINE
    const leaveUserIds = approvedLeaves.map((l) => l.userId);
    await this.attendanceAuthority.updateManyUserStatus(
      leaveUserIds.length > 0 ? leaveUserIds : ['__none__'],
      'OFFLINE'
    );

    console.log(`[Scheduler] Leave statuses set. ${approvedLeaves.length} users on leave today.`);
  }

  // 1b. AUTO-CLOSE MIDNIGHT SESSIONS & POLICY AUTO STOP — every 15 minutes
  @Cron('*/15 * * * *')
  async autoCloseMidnightSessions() {
    try {
      const policy = await this.settingsService.getWorkdayPolicy();
      if (policy?.autoClose === false) {
        return; // Skip all automatic workday closing behavior if general autoClose is disabled
      }
      const timezone = this.tva.companyTimezone();
      const autoCloseTimeConfig = policy?.autoCloseTime || '23:59';

      const openSessions = await this.prisma.workSession.findMany({
        where: { logoutAt: null },
        include: { breakLogs: true, user: { include: { role: true } } },
      });

      const nowGlobal = this.tva.now();
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
            await this.workdayService.finalizeWorkSession(session.id, {
              effectiveEndAt: cutoffUtc,
              terminalStatus: 'AUTO_CLOSED',
              closureReason: 'POLICY_AUTO_STOP',
              autoClosedAt: nowGlobal,
              eventSource: 'system',
              attendanceEventType: 'POLICY_AUTO_STOP',
              ticketPauseReason: 'POLICY_AUTO_STOP',
            });

            await this.attendanceAuthority.setUserStatus(session.userId, 'LOGGED_OUT');

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

        // The session belongs to `sessionCompanyDateStr`. We want the configured
        // autoCloseTime on THAT same day — the intended retrospective cutoff,
        // i.e. the time the session logically ended, not the current instant.
        const cutoffIso = `${sessionCompanyDateStr}T${autoCloseTimeConfig}:00.000`;
        const offsetString = formatInTimeZone(sessionAnchor, timezone, 'xxx');
        const retrospectiveCutoff = new Date(`${cutoffIso}${offsetString}`);

        await this.workdayService.finalizeWorkSession(session.id, {
          effectiveEndAt: retrospectiveCutoff,
          terminalStatus: 'AUTO_CLOSED',
          closureReason: 'AUTO_CLOSE',
          autoClosedAt: nowGlobal,
          eventSource: 'system',
          attendanceEventType: 'AUTO_CLOSE',
          ticketPauseReason: 'SYSTEM',
        });

        await this.attendanceAuthority.setUserStatus(session.userId, 'LOGGED_OUT');

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
    const now = this.tva.now();
    const hour = now.getHours();
    if (hour < 9 || hour > 20) return;

    const cutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const today = this.tva.companyDateOnly();

    const idleUsers = await this.prisma.user.findMany({
      where: { currentStatus: 'IDLE', lastActiveAt: { lte: cutoff }, isActive: true },
    });

    for (const user of idleUsers) {
      // Status stays LOGGED_OUT (unchanged from today) — only closureReason
      // is added, since existing status/closure semantics for this path must
      // be preserved rather than reinterpreted as AUTO_CLOSED.
      const session = await this.prisma.workSession.findFirst({
        where: { userId: user.id, date: today, status: 'IDLE' },
        orderBy: { createdAt: 'desc' },
      });

      if (session) {
        await this.workdayService.finalizeWorkSession(session.id, {
          effectiveEndAt: now,
          terminalStatus: 'LOGGED_OUT',
          closureReason: 'AUTO_LOGOUT_INACTIVE',
          eventSource: 'system',
          attendanceEventType: 'AUTO_LOGOUT',
          eventMetadata: { reason: '2 hours idle' },
          ticketPauseReason: 'AUTO_LOGOUT',
        });
      }

      await this.attendanceAuthority.setUserStatus(user.id, 'OFFLINE');
    }
    if (idleUsers.length > 0) {
      console.log(`[Scheduler] Auto-logout: ${idleUsers.length} idle users logged out.`);
    }
  }
}
