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
import { COMPANY_CRON_TIMEZONE } from '../../../common/constants/company-time.constants';
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
    const occurrenceDate = formatInTimeZone(
      this.tva.now(),
      this.tva.companyTimezone(),
      'yyyy-MM-dd',
    );
    const recipientIds = new Set<string>();
    if (ticket.assignedTo?.id) recipientIds.add(ticket.assignedTo.id);
    for (const a of ticket.assignees ?? []) {
      if (a.user?.id) recipientIds.add(a.user.id);
    }
    for (const uid of recipientIds) {
      try {
        await this.notificationEventService.sendNotification(uid, 'statusChanged', {
            title: `${prefix} reminder`,
            message: `Ticket ${ticket.ticketId}: ${ticket.title}`,
            type: NotificationType.INFO,
            link: `/tickets/${ticket.id}`,
            entityId: ticket.id,
            entityType: 'TICKET',
            // Cron catch-up can see the same ticket more than once in an hour.
            // The company date prevents duplicates while allowing the next
            // daily/weekly/monthly occurrence to notify again.
            dedupeKey: `scheduled-ticket:${ticket.id}:${prefix}:${occurrenceDate}`,
        });
      } catch (err) {
        this.logger.error(`[scheduler] Failed to notify user ${uid}: ${err}`);
      }
    }
  }

  /** Server-owned planned-break reminders; works even when the initiating tab is backgrounded. */
  @Cron('* * * * *', { name: 'planned-break-overrun-reminders' })
  async plannedBreakOverrunReminders() {
    const now = this.tva.now();
    const overdueBreaks = await this.prisma.breakLog.findMany({
      where: { endAt: null, plannedEndAt: { not: null, lte: now } },
      select: { id: true, userId: true, breakType: true, plannedEndAt: true },
      take: 500,
    });
    for (const breakLog of overdueBreaks) {
      try {
        await this.notificationEventService.sendNotification(breakLog.userId, 'breakOverrun', {
          title: 'Your planned break has ended',
          message: 'You are still on break. Resume work when you are ready.',
          type: NotificationType.WARNING,
          link: '/dashboard',
          entityType: 'BREAK',
          entityId: breakLog.id,
          dedupeKey: `break-overrun:${breakLog.id}`,
        });
      } catch (error) {
        this.logger.error(`[scheduler] Planned-break reminder failed for ${breakLog.id}: ${error}`);
      }
    }
  }

  /** Runs every hour — handles both one-time and recurring scheduled tickets */
  @Cron('0 * * * *', { name: 'scheduled-ticket-reminders' })
  async checkScheduledTickets() {
    const now = this.tva.now();
    // Company-local hour, weekday and day of month, never the host's: on a UTC
    // host getHours() made "daily morning (9 AM)" fire at 14:30 IST, and the
    // weekly/monthly match used the host's calendar day.
    const timezone = this.tva.companyTimezone();
    const hour = Number(formatInTimeZone(now, timezone, 'H'));
    const dayOfWeek = Number(formatInTimeZone(now, timezone, 'i')) % 7; // 0=Sun..6=Sat
    const dayOfMonth = Number(formatInTimeZone(now, timezone, 'd'));
    const companyWeekday = (d: Date) => Number(formatInTimeZone(d, timezone, 'i')) % 7;
    const companyDayOfMonth = (d: Date) => Number(formatInTimeZone(d, timezone, 'd'));

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
          shouldFire = dayOfWeek === companyWeekday(new Date(ticket.createdAt));
        } else if (recurrence === 'monthly' && hour === 9) {
          shouldFire = dayOfMonth === companyDayOfMonth(new Date(ticket.createdAt));
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

  // 1. MIDNIGHT LEAVE STATUS SETTER — 00:01 every day, COMPANY time.
  // Without the explicit zone this fired at 00:01 UTC (05:31 IST), which for
  // a job that stamps "today" is not merely late -- it is the wrong day for
  // part of its own run.
  @Cron('1 0 * * *', { timeZone: COMPANY_CRON_TIMEZONE })
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
            // Session close, break closure, timer pause and LOGGED_OUT commit
            // together (Phase 2D2); the notification follows only a real close.
            const closed = await this.workdayService.finalizeWorkSessionWithPresence(session.id, {
              effectiveEndAt: cutoffUtc,
              terminalStatus: 'AUTO_CLOSED',
              closureReason: 'POLICY_AUTO_STOP',
              autoClosedAt: nowGlobal,
              eventSource: 'system',
              attendanceEventType: 'POLICY_AUTO_STOP',
              ticketPauseReason: 'POLICY_AUTO_STOP',
            }, 'LOGGED_OUT');

            if (closed.didClose) {
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
            }

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

        // Session close, break closure, timer pause and LOGGED_OUT commit
        // together (Phase 2D2); the notification follows only a real close.
        const closed = await this.workdayService.finalizeWorkSessionWithPresence(session.id, {
          effectiveEndAt: retrospectiveCutoff,
          terminalStatus: 'AUTO_CLOSED',
          closureReason: 'AUTO_CLOSE',
          autoClosedAt: nowGlobal,
          eventSource: 'system',
          attendanceEventType: 'AUTO_CLOSE',
          ticketPauseReason: 'SYSTEM',
        }, 'LOGGED_OUT');

        // Notify user about auto-close
        if (closed.didClose) {
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
        }
        
        closedCount++;
      }
      if (closedCount > 0 || policyStopCount > 0) {
        this.logger.log(`[scheduler] Auto-closed ${closedCount} stale sessions and ${policyStopCount} policy-stopped sessions.`);
      }
    } catch (err) {
      this.logger.error(`[scheduler] Auto-close stale sessions error: ${err}`);
    }
  }

  // 2a. WORKDAY START REMINDER — every 15 minutes for 90 minutes after 9:30.
  @Cron('*/15 9-11 * * 1-6', { timeZone: COMPANY_CRON_TIMEZONE })
  async workdayStartReminder() {
    const now = this.tva.now();
    const timezone = this.tva.companyTimezone();
    const minutes = Number(formatInTimeZone(now, timezone, 'H')) * 60 + Number(formatInTimeZone(now, timezone, 'm'));
    if (minutes < 570 || minutes > 660) return;
    const dateKey = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
    const today = this.tva.companyDateOnly();
    const [users, sessions] = await Promise.all([
      this.prisma.user.findMany({ where: { isActive: true, currentStatus: { not: 'ON_LEAVE' } }, select: { id: true } }),
      this.prisma.workSession.findMany({ where: { date: today }, select: { userId: true, startWorkAt: true, status: true } }),
    ]);
    const started = new Set(sessions.filter((session) => session.startWorkAt || session.status === 'ON_LEAVE').map((session) => session.userId));
    for (const user of users) {
      if (started.has(user.id)) continue;
      await this.notificationEventService.sendNotification(user.id, 'workdayStart', {
        title: 'Start your workday',
        message: 'Your shift has started — log in to begin tracking your workday.',
        type: NotificationType.INFO,
        link: '/dashboard',
        entityType: 'WORKDAY',
        entityId: dateKey,
        dedupeKey: `workday-start:${dateKey}`,
      });
    }
  }

  // 2b. WORKDAY END REMINDER — every 15 minutes for 90 minutes after 6:30 PM.
  @Cron('*/15 18-20 * * 1-6', { timeZone: COMPANY_CRON_TIMEZONE })
  async workdayEndReminder() {
    const now = this.tva.now();
    const timezone = this.tva.companyTimezone();
    const minutes = Number(formatInTimeZone(now, timezone, 'H')) * 60 + Number(formatInTimeZone(now, timezone, 'm'));
    if (minutes < 1110 || minutes > 1200) return;
    const dateKey = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
    const stillWorking = await this.prisma.user.findMany({
      where: { currentStatus: { in: ['WORKING', 'ON_BREAK', 'IDLE'] }, isActive: true },
    });

    for (const user of stillWorking) {
      await this.notificationEventService.sendNotification(user.id, 'workdayEnd', {
          title: 'End your workday',
          message: 'Official work hours (9:30 AM – 6:30 PM) are over. Remember to end your workday.',
          type: NotificationType.INFO,
          link: '/dashboard',
          entityType: 'WORKDAY',
          entityId: dateKey,
          dedupeKey: `workday-end:${dateKey}`,
      });
    }
    console.log(`[Scheduler] Workday end reminder sent to ${stillWorking.length} users.`);
  }

  // 3. AUTO LOGOUT — every hour
  @Cron('0 * * * *')
  async autoLogoutInactive() {
    const now = this.tva.now();
    // Company-local hour, not server-local. `getHours()` reads the HOST's
    // timezone, so on Render this 9am-8pm guard was really 09:00-20:00 UTC --
    // 14:30-01:30 IST, which both skipped the morning and ran overnight.
    const hour = Number(formatInTimeZone(now, this.tva.companyTimezone(), 'H'));
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
        // Session close, timer pause and OFFLINE commit together (Phase 2D2).
        await this.workdayService.finalizeWorkSessionWithPresence(session.id, {
          effectiveEndAt: now,
          terminalStatus: 'LOGGED_OUT',
          closureReason: 'AUTO_LOGOUT_INACTIVE',
          eventSource: 'system',
          attendanceEventType: 'AUTO_LOGOUT',
          eventMetadata: { reason: '2 hours idle' },
          ticketPauseReason: 'AUTO_LOGOUT',
        }, 'OFFLINE');
      } else {
        // No idle session to close: presence is the only change.
        await this.attendanceAuthority.setUserStatus(user.id, 'OFFLINE');
      }
    }
    if (idleUsers.length > 0) {
      console.log(`[Scheduler] Auto-logout: ${idleUsers.length} idle users logged out.`);
    }
  }
}
