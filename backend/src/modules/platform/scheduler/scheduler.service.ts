import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { EventsGateway } from '../gateway/events.gateway';
import { TicketLedgerService } from '../../operations/tickets/ticket-ledger.service';
import { NotificationEventService } from '../../operations/notifications/notification-event.service';
import { NotificationType, Prisma } from '@prisma/client';
import { TimezoneUtil } from '../../../common/utils/timezone.util';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { SettingsService } from '../settings/settings.service';
import { shouldPolicyAutoStop } from '../workday/workday.policy.helper';
import { WorkdayService } from '../workday/workday.service';
import { TVAService } from '../../../common/services/tva.service';
import { COMPANY_CRON_TIMEZONE } from '../../../common/constants/company-time.constants';
import { AttendanceAuthorityService } from '../../../common/services/attendance-authority.service';

const EARLY_WARNING_MS = 5 * 60_000;

export function resolveBreakWarningTransition(
  breakLog: { warningStage: string; estimatedMinutes: number | null; plannedEndAt: Date | null },
  now: Date,
): { phase: 'early' | 'final'; activeStage: 'EARLY_ACTIVE' | 'FINAL_ACTIVE' } | null {
  if (!breakLog.plannedEndAt || !['PENDING', 'FINAL_PENDING'].includes(breakLog.warningStage)) return null;
  const shortEstimate = breakLog.estimatedMinutes !== null && breakLog.estimatedMinutes <= 5;
  const finalPhase = breakLog.warningStage === 'FINAL_PENDING' || shortEstimate;
  const dueAt = finalPhase
    ? breakLog.plannedEndAt
    : new Date(breakLog.plannedEndAt.getTime() - EARLY_WARNING_MS);
  if (dueAt.getTime() > now.getTime()) return null;
  return finalPhase
    ? { phase: 'final', activeStage: 'FINAL_ACTIVE' }
    : { phase: 'early', activeStage: 'EARLY_ACTIVE' };
}

/** Database filter matching exactly the breaks resolveBreakWarningTransition would fire. */
export function dueBreakWarningsWhere(now: Date): Prisma.BreakLogWhereInput {
  const earlyCutoff = new Date(now.getTime() + EARLY_WARNING_MS);
  return {
    endAt: null,
    breakType: { not: 'MEETING' },
    OR: [
      // Over five minutes (or the 60-minute fallback): warn five minutes early.
      { warningStage: 'PENDING', estimatedMinutes: { gt: 5 }, plannedEndAt: { lte: earlyCutoff } },
      { warningStage: 'PENDING', estimatedMinutes: null, plannedEndAt: { lte: earlyCutoff } },
      // Five minutes or less: a single alarm at the end.
      { warningStage: 'PENDING', estimatedMinutes: { lte: 5 }, plannedEndAt: { lte: now } },
      // Armed by Later on the early warning.
      { warningStage: 'FINAL_PENDING', plannedEndAt: { lte: now } },
    ],
  };
}

// An unanswered alarm rings in up to three rounds: the sound plays 20 times,
// pauses five minutes, then the next round starts. Mirrors BreakWarningCenter.
export const BREAK_ALARM_ROUNDS = 3;
export const BREAK_ALARM_PLAYS_PER_ROUND = 20;
export const BREAK_ALARM_PAUSE_MS = 5 * 60_000;
// Length of one play of each selectable sound (frontend/public/sounds).
const BREAK_SOUND_SECONDS: Record<string, number> = { 'apex-break': 10.1, 'chicken-call': 5.7, fahhh: 2.7 };

/** 0-based round of an unanswered alarm that is ringing or most recently rang, or null once all rounds are spent. */
export function breakAlarmRound(triggeredAt: Date, sound: unknown, now: Date): number | null {
  const seconds = BREAK_SOUND_SECONDS[String(sound)] ?? BREAK_SOUND_SECONDS['apex-break'];
  const cycleMs = seconds * BREAK_ALARM_PLAYS_PER_ROUND * 1000 + BREAK_ALARM_PAUSE_MS;
  const round = Math.floor((now.getTime() - triggeredAt.getTime()) / cycleMs);
  return round >= 0 && round < BREAK_ALARM_ROUNDS ? round : null;
}

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

  @Cron('* * * * *', { name: 'meeting-start-and-end' })
  async processMeetings() {
  }

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

  /**
   * Server-owned break alarms. An estimate over five minutes first warns five
   * minutes early; the end-time alarm is armed only when the person chooses
   * Later. Estimates of five minutes or less have one alarm at their end.
   */
  @Cron('* * * * *', { name: 'planned-break-overrun-reminders' })
  async plannedBreakOverrunReminders() {
    const now = this.tva.now();
    // One indexed query returns only the alarms that are due this minute.
    const dueBreaks = await this.prisma.breakLog.findMany({
      where: dueBreakWarningsWhere(now),
      select: { id: true, userId: true, estimatedMinutes: true, plannedEndAt: true, warningStage: true },
      take: 500,
    });
    for (const breakLog of dueBreaks) {
      const transition = resolveBreakWarningTransition(breakLog, now);
      if (!transition) continue;
      const { phase, activeStage } = transition;
      try {
        // Claim the alarm with a conditional update before delivery, so two
        // scheduler instances (or a break ending meanwhile) cannot ring twice.
        const { count } = await this.prisma.breakLog.updateMany({
          where: { id: breakLog.id, endAt: null, warningStage: breakLog.warningStage },
          data: {
            warningStage: activeStage,
            warningUpdatedAt: now,
            ...(phase === 'early' ? { earlyWarningSentAt: now } : { finalWarningSentAt: now }),
          },
        });
        if (!count) continue;
        await this.notificationEventService.sendNotification(breakLog.userId, 'breakOverrun', {
          title: phase === 'early' ? 'Your break ends in 5 minutes' : 'Your planned break has ended',
          message: phase === 'early'
            ? 'Your estimated break time is nearly complete.'
            : 'You are still on break. Resume work when you are ready.',
          type: NotificationType.WARNING,
          link: '/dashboard',
          entityType: 'BREAK',
          entityId: breakLog.id,
          dedupeKey: `break-warning:${breakLog.id}:${phase}`,
          forceDelivery: true,
        });
        this.notificationEventService.emitBreakWarningChanged?.(breakLog.userId, breakLog.id);
      } catch (error) {
        this.logger.error(`[scheduler] Break reminder failed for ${breakLog.id}: ${error}`);
      }
    }
    await this.repeatUnansweredBreakAlarms(now);
  }

  /**
   * Rounds 2 and 3 of an alarm nobody answered: push again so a sleeping phone
   * or a closed tab rings and vibrates again. Later or Resume ends the rounds,
   * because either one moves the break out of an *_ACTIVE stage.
   */
  private async repeatUnansweredBreakAlarms(now: Date) {
    const ringing = await this.prisma.breakLog.findMany({
      where: { endAt: null, warningStage: { in: ['EARLY_ACTIVE', 'FINAL_ACTIVE'] }, warningUpdatedAt: { not: null } },
      select: { id: true, userId: true, warningStage: true, warningUpdatedAt: true, plannedEndAt: true },
      take: 500,
    });
    if (!ringing.length) return;
    const prefRows = await this.prisma.appSetting.findMany({
      where: { key: { in: [...new Set(ringing.map((row) => `user-prefs-${row.userId}`))] } },
      select: { key: true, value: true },
    });
    const soundByUser = new Map(prefRows.map((row) => [row.key.slice('user-prefs-'.length), (row.value as any)?.breakWarningSound]));

    for (const breakLog of ringing) {
      const round = breakAlarmRound(breakLog.warningUpdatedAt!, soundByUser.get(breakLog.userId), now);
      if (!round) continue; // Round 1 was the alarm itself; null means all rounds are spent.
      const phase = breakLog.warningStage === 'EARLY_ACTIVE' ? 'early' : 'final';
      const dedupeKey = `break-warning:${breakLog.id}:${phase}:round${round + 1}`;
      try {
        const sent = await this.prisma.notification.findFirst({ where: { userId: breakLog.userId, dedupeKey }, select: { id: true } });
        if (sent) continue;
        const ended = !breakLog.plannedEndAt || breakLog.plannedEndAt.getTime() <= now.getTime();
        await this.notificationEventService.sendNotification(breakLog.userId, 'breakOverrun', {
          title: ended ? 'Your planned break has ended' : 'Your break is about to end',
          message: `Reminder ${round + 1} of ${BREAK_ALARM_ROUNDS}. Resume work, or choose Later in Apex OS.`,
          type: NotificationType.WARNING,
          link: '/dashboard',
          entityType: 'BREAK',
          entityId: breakLog.id,
          dedupeKey,
          forceDelivery: true,
        });
      } catch (error) {
        this.logger.error(`[scheduler] Break reminder round failed for ${breakLog.id}: ${error}`);
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
        // Never auto-close a workday while its owner is in a running meeting,
        // even past midnight. The normal rules apply again once it ends.
        if (session.breakLogs.some((b: any) => !b.endAt && b.breakType === 'MEETING')) continue;
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
