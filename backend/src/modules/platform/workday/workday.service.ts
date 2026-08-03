import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';
import { TimezoneUtil, DEFAULT_COMPANY_TIMEZONE } from '../../../common/utils/timezone.util';
import { calculateWorkdayRuntime } from './workday.calculation';
import { buildCompanyDateTimeUtc } from './workday.policy.helper';
import { TicketLedgerService } from '../../operations/tickets/ticket-ledger.service';
import { NotificationEventService } from '../../operations/notifications/notification-event.service';
import { NotificationType } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';

import { AttendanceAuthorityService } from '../../../common/services/attendance-authority.service';
import { TVAService } from '../../../common/services/tva.service';

// Combined daily allowance for all break types (lunch + restroom + tea + other).
// Soft policy only — usage beyond this is reported via exceededBreakMinutes, never blocked.
const DAILY_BREAK_ALLOWANCE_MINUTES = 60;

export interface FinalizeWorkSessionOptions {
  effectiveEndAt: Date;
  terminalStatus: 'LOGGED_OUT' | 'AUTO_CLOSED';
  closureReason: string;
  autoClosedAt?: Date;
  actorUserId?: string;
  eventSource: 'manual' | 'system';
  attendanceEventType: string;
  eventMetadata?: Record<string, any>;
  ticketPauseReason: string;
}

@Injectable()
export class WorkdayService {
  constructor(
    private prisma: PrismaService,
    private accessPolicy: AccessPolicyService,
    private eventLogger: EventLoggerService,
    private ticketLedger: TicketLedgerService,
    private notificationEventService: NotificationEventService,
    private attendanceAuthority: AttendanceAuthorityService,
    private tva: TVAService,
  ) {}

  async getHistory(userId: string, requester: any) {
    const targetUser = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true, department: true },
    });
    if (!targetUser) throw new NotFoundException('User not found');
    const canView = await this.accessPolicy.canViewUser(requester, targetUser);
    if (!canView) throw new ForbiddenException('You do not have permission to view this user\'s work history');

    const sessions = await this.prisma.workSession.findMany({
      where: {
        userId,
        NOT: {
          status: 'LOGGED_IN',
          startWorkAt: null,
          totalWorkMinutes: 0,
        },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 90,
      include: {
        breakLogs: { orderBy: { startAt: 'asc' } },
      },
    });

    const grouped = new Map<string, any>();
    const currentCompanyDateStr = formatInTimeZone(this.tva.now(), DEFAULT_COMPANY_TIMEZONE, 'yyyy-MM-dd');

    for (const session of sessions) {
      const isLoginOnlyArtifact =
        session.status === 'LOGGED_IN' &&
        !session.startWorkAt &&
        (session.totalWorkMinutes || 0) === 0;

      if (isLoginOnlyArtifact) continue;

      const sessionStart = session.startWorkAt;

      const dateStr = session.date instanceof Date
        ? formatInTimeZone(session.date, 'UTC', 'yyyy-MM-dd')
        : String(session.date).split('T')[0];

      if (!grouped.has(dateStr)) {
        grouped.set(dateStr, {
          companyDate: dateStr,
          firstStartTime: sessionStart ?? null,
          lastEndTime: session.logoutAt,
          sessionCount: 0,
          autoClosedCount: 0,
          totalWorkMinutes: 0,
          totalBreakMinutes: 0,
          netWorkMinutes: 0,
          status: 'NOT_STARTED',
          closureReasons: new Set<string>(),
          hasOpenSession: false,
          hasSuspiciousDuration: false,
          needsReview: false,
          sessions: [],
        });
      }

      const summary = grouped.get(dateStr)!;
      summary.sessionCount += 1;
      if (session.autoClosed) summary.autoClosedCount += 1;

      const workMins = session.totalWorkMinutes || 0;
      const breakMins = session.totalBreakMinutes || 0;
      summary.totalWorkMinutes += workMins;
      summary.totalBreakMinutes += breakMins;
      summary.netWorkMinutes += workMins;

      if (session.closureReason) summary.closureReasons.add(session.closureReason);

      if (!session.logoutAt && session.startWorkAt) summary.hasOpenSession = true;

      if (sessionStart && (!summary.firstStartTime || sessionStart < summary.firstStartTime)) {
        summary.firstStartTime = sessionStart;
      }

      if (session.logoutAt && (!summary.lastEndTime || session.logoutAt > summary.lastEndTime)) {
        summary.lastEndTime = session.logoutAt;
      }

      summary.sessions.push(session);
    }

    const result = Array.from(grouped.values()).map(summary => {
      summary.closureReasons = Array.from(summary.closureReasons);
      if (summary.netWorkMinutes > 960) summary.hasSuspiciousDuration = true;

      const isToday = summary.companyDate === currentCompanyDateStr;

      if (summary.hasSuspiciousDuration) {
        summary.status = 'NEEDS_REVIEW';
        summary.needsReview = true;
      } else if (summary.hasOpenSession) {
        if (isToday) {
          const openSession = summary.sessions.find((s: any) => !s.logoutAt && s.startWorkAt);
          summary.status = openSession?.status || 'WORKING';
        } else {
          summary.status = 'NEEDS_REVIEW';
          summary.needsReview = true;
        }
      } else {
        if (summary.autoClosedCount > 0) {
          summary.status = 'AUTO_CLOSED';
        } else {
          summary.status = 'ENDED';
        }
      }

      summary.isToday = isToday;

      return summary;
    });

    return result.sort((a, b) => b.companyDate.localeCompare(a.companyDate)).slice(0, 7);
  }

  private getTodayDate(): Date {
    return this.tva.companyDateOnly();
  }

  private isClosedSession(session: any): boolean {
    return !!session?.logoutAt || ['LOGGED_OUT', 'AUTO_CLOSED'].includes(session?.status);
  }

  private isOpenSession(session: any): boolean {
    return !!session && !this.isClosedSession(session);
  }

  private isOpenWorkSession(session: any): boolean {
    return this.isOpenSession(session) && ['WORKING', 'ON_BREAK', 'IDLE', 'LOGGED_IN'].includes(session.status);
  }

  async startWork(userId: string) {
    const today = this.getTodayDate();
    const now = this.tva.now();

    const latestSession = await this.prisma.workSession.findFirst({
      where: { userId, date: today },
      orderBy: { createdAt: 'desc' },
    });

    let session = latestSession;
    const shouldCreateSession = !session || this.isClosedSession(session);
    const wasAutoClosed = !!session && (session.status === 'AUTO_CLOSED' || session.autoClosed);

    if (shouldCreateSession) {
      session = await this.attendanceAuthority.createWorkSession({
        userId,
        date: today,
        loginAt: now,
        startWorkAt: now,
        status: 'WORKING',
        ...(latestSession ? { continuationOfSessionId: latestSession.id } : {}),
      });
    } else if (session.status === 'LOGGED_IN') {
      session = await this.attendanceAuthority.updateWorkSession(session.id, {
        status: 'WORKING',
        startWorkAt: session.startWorkAt ?? now,
        loginAt: session.loginAt ?? now,
      });
    } else if (!this.isOpenWorkSession(session)) {
      throw new Error('No active session');
    }

    if (wasAutoClosed) {
      try {
        await this.notificationEventService.sendNotification(userId, 'system', {
          title: 'Workday resumed',
          message: 'Your workday has been resumed and will be counted with your previous session for today.',
          type: NotificationType.SUCCESS,
          link: '/dashboard',
          entityType: 'WORKDAY',
          entityId: session.id,
        });
      } catch (_e) {}
    }

    await this.prisma.attendanceEvent.create({
      data: { userId, workSessionId: session.id, eventType: 'START_WORK', source: 'manual' },
    });

    await this.attendanceAuthority.setUserStatus(userId, 'WORKING', now);

    this.eventLogger.log({
      actorId: userId,
      entityType: 'WorkdaySession',
      entityId: session.id,
      action: OperationalAction.WORKDAY_STARTED,
    }).catch(() => {});

    return { session, message: 'Workday started' };
  }

  async endWork(userId: string) {
    const today = this.getTodayDate();
    const now = this.tva.now();

    const session = await this.prisma.workSession.findFirst({
      where: { userId, date: today },
      orderBy: { createdAt: 'desc' },
      include: { breakLogs: true },
    });

    if (!session) return { message: 'No session found' };

    if (this.isClosedSession(session)) {
      return {
        session,
        summary: {
          totalWorkMinutes: session.totalWorkMinutes ?? 0,
          totalBreakMinutes: session.totalBreakMinutes ?? 0,
        },
      };
    }

    const result = await this.finalizeWorkSession(session.id, {
      effectiveEndAt: now,
      terminalStatus: 'LOGGED_OUT',
      closureReason: 'ENDED_BY_USER',
      actorUserId: userId,
      eventSource: 'manual',
      attendanceEventType: 'LOGOUT',
      ticketPauseReason: 'LOGOUT',
    });

    await this.attendanceAuthority.setUserStatus(userId, 'LOGGED_OUT');

    return {
      session: result.session,
      summary: { totalWorkMinutes: result.totalWorkMinutes, totalBreakMinutes: result.totalBreakMinutes },
    };
  }

  // Single shared closer for every Workday session-ending path (manual
  // endWork, policy auto-stop, stale/midnight auto-close, idle auto-logout).
  // The corruption-prone core — break-closing, totals, terminal fields,
  // ticket-log pause — runs inside one Prisma transaction; audit events fire
  // after commit so a logging failure can never roll back a real closure.
  //
  // Idempotency: a session that is already terminal AND has no open breaks
  // AND has no active ticket logs is a true no-op (zero writes). A session
  // that is already terminal but still has leftover open breaks / active
  // ticket logs / stale totals (e.g. a session closed by a pre-fix bug) is
  // reconciled — breaks closed, totals recomputed, logs paused — but its
  // existing status/logoutAt/closureReason are preserved rather than
  // overwritten, and no duplicate closure audit event is emitted.
  async finalizeWorkSession(sessionId: string, options: FinalizeWorkSessionOptions) {
    const txResult = await this.prisma.$transaction(async (tx) => {
      // Row lock so two concurrent finalizer calls for the same session
      // serialize instead of racing on the terminal-field write below —
      // matches this repo's existing tx.$queryRaw usage (tickets.service.ts).
      await tx.$queryRaw`SELECT id FROM "work_sessions" WHERE id = ${sessionId} FOR UPDATE`;

      const session = await tx.workSession.findUnique({
        where: { id: sessionId },
        include: { breakLogs: true },
      });
      if (!session) throw new NotFoundException('Work session not found');

      const wasAlreadyTerminal = this.isClosedSession(session);
      const hasOpenBreaks = session.breakLogs.some((b) => !b.endAt);
      const activeTicketLogCount = await tx.ticketTimeLog.count({
        where: { userId: session.userId, endedAt: null },
      });

      if (wasAlreadyTerminal && !hasOpenBreaks && activeTicketLogCount === 0) {
        return {
          session,
          totalWorkMinutes: session.totalWorkMinutes,
          totalBreakMinutes: session.totalBreakMinutes,
          didClose: false,
          userId: session.userId,
        };
      }

      // An already-terminal session's own recorded logoutAt is authoritative
      // and must never move during a reconciliation pass — only a still-open
      // session gets this call's cutoff (clamped to never precede startWorkAt).
      let effectiveEndAt = session.logoutAt ?? options.effectiveEndAt;
      if (!session.logoutAt && session.startWorkAt && effectiveEndAt.getTime() < session.startWorkAt.getTime()) {
        effectiveEndAt = session.startWorkAt;
      }

      let totalBreakMinutes = 0;
      for (const b of session.breakLogs) {
        if (b.endAt) {
          if (b.breakType !== 'MEETING') totalBreakMinutes += b.durationMinutes ?? 0;
          continue; // never touch an already-closed break
        }
        const clampedEnd = b.startAt.getTime() > effectiveEndAt.getTime() ? b.startAt : effectiveEndAt;
        const durationMinutes = Math.max(0, Math.floor((clampedEnd.getTime() - b.startAt.getTime()) / 60000));
        await tx.breakLog.update({
          where: { id: b.id },
          data: { endAt: clampedEnd, durationMinutes },
        });
        if (b.breakType !== 'MEETING') totalBreakMinutes += durationMinutes;
      }

      let totalWorkMinutes = 0;
      if (session.startWorkAt) {
        const elapsed = Math.floor((effectiveEndAt.getTime() - session.startWorkAt.getTime()) / 60000);
        totalWorkMinutes = Math.max(0, elapsed - totalBreakMinutes);
      }

      // Preserve-if-present: a session closed by a different (possibly
      // racing) path already recorded its own valid status/reason — don't
      // let a reconciliation pass overwrite facts about *how* it closed,
      // only fix what's structurally missing (e.g. path D's historical
      // null closureReason).
      const resolvedStatus = wasAlreadyTerminal ? session.status : options.terminalStatus;
      const resolvedClosureReason = session.closureReason ?? options.closureReason;

      const updateData: {
        status: string;
        logoutAt: Date;
        closureReason: string;
        totalWorkMinutes: number;
        totalBreakMinutes: number;
        autoClosed?: boolean;
        autoClosedAt?: Date;
      } = {
        status: resolvedStatus,
        logoutAt: effectiveEndAt,
        closureReason: resolvedClosureReason,
        totalWorkMinutes,
        totalBreakMinutes,
      };
      if (resolvedStatus === 'AUTO_CLOSED' && !session.autoClosed) {
        updateData.autoClosed = true;
        updateData.autoClosedAt = options.autoClosedAt ?? effectiveEndAt;
      }

      const updated = await this.attendanceAuthority.updateWorkSession(sessionId, updateData, tx);

      await this.ticketLedger.pauseActiveLogsForUser(
        {
          userId: session.userId,
          pauseReason: options.ticketPauseReason,
          endedAt: effectiveEndAt,
        },
        tx,
      );

      return {
        session: updated,
        totalWorkMinutes,
        totalBreakMinutes,
        didClose: !wasAlreadyTerminal,
        userId: session.userId,
      };
    });

    if (txResult.didClose) {
      await this.prisma.attendanceEvent.create({
        data: {
          userId: options.actorUserId ?? txResult.userId,
          workSessionId: txResult.session.id,
          eventType: options.attendanceEventType,
          source: options.eventSource,
          metadata: options.eventMetadata,
        },
      }).catch(() => {});

      this.eventLogger.log({
        actorId: options.actorUserId ?? txResult.userId,
        entityType: 'WorkdaySession',
        entityId: txResult.session.id,
        action: OperationalAction.WORKDAY_ENDED,
        metadata: { closureReason: txResult.session.closureReason, source: options.eventSource },
      }).catch(() => {});
    }

    return {
      session: txResult.session,
      totalWorkMinutes: txResult.totalWorkMinutes,
      totalBreakMinutes: txResult.totalBreakMinutes,
    };
  }

  async startBreak(userId: string, dto: { breakType: string; estimatedMinutes?: number }) {
    const today = this.getTodayDate();
    const now = this.tva.now();

    const session = await this.prisma.workSession.findFirst({
      where: { userId, date: today },
      orderBy: { createdAt: 'desc' },
      include: {
        breakLogs: {
          where: { endAt: null },
          orderBy: { startAt: 'asc' },
        },
      },
    });
    if (!session || !this.isOpenSession(session) || session.status !== 'WORKING') {
      throw new Error('No active working session');
    }

    const openBreaks = session.breakLogs ?? [];
    if (openBreaks.length > 0) {
      throw new Error('Break already in progress');
    }

    const breakLog = await this.prisma.breakLog.create({
      data: {
        userId,
        workSessionId: session.id,
        breakType: dto.breakType,
        estimatedMinutes: dto.estimatedMinutes,
        startAt: now,
        reason: dto.breakType,
        source: 'MANUAL_BREAK',
      },
    });

    await this.attendanceAuthority.updateWorkSession(session.id, {
      status: 'ON_BREAK',
    });

    await this.prisma.attendanceEvent.create({
      data: {
        userId,
        workSessionId: session.id,
        eventType: 'BREAK_START',
        metadata: { breakType: dto.breakType },
      },
    });

    await this.attendanceAuthority.setUserStatus(userId, 'ON_BREAK');

    await this.ticketLedger.pauseActiveLogsForUser({
      userId,
      pauseReason: 'BREAK',
      breakLogId: breakLog.id,
      endedAt: now,
    });

    this.eventLogger.log({
      actorId: userId,
      entityType: 'WorkdaySession',
      entityId: session.id,
      action: OperationalAction.BREAK_STARTED,
      metadata: { breakType: dto.breakType, estimatedMinutes: dto.estimatedMinutes },
    }).catch(() => {});

    return { breakLog };
  }

  async endBreak(userId: string) {
    const today = this.getTodayDate();
    const now = this.tva.now();

    const session = await this.prisma.workSession.findFirst({
      where: { userId, date: today },
      orderBy: { createdAt: 'desc' },
      include: {
        breakLogs: {
          where: { endAt: null },
          orderBy: { startAt: 'asc' },
        },
      },
    });
    if (!session || !this.isOpenSession(session) || session.status !== 'ON_BREAK') {
      throw new Error('No active break session');
    }

    const openBreaks = session.breakLogs ?? [];
    if (openBreaks.length === 0) throw new Error('No open break found');
    if (openBreaks.length > 1) throw new Error('Multiple open breaks found');
    const openBreak = openBreaks[0];

    const durationMinutes = Math.max(0, Math.floor(
      (now.getTime() - openBreak.startAt.getTime()) / 60000,
    ));

    const updated = await this.prisma.breakLog.update({
      where: { id: openBreak.id },
      data: { endAt: now, durationMinutes },
    });

    // Note: To increment totalBreakMinutes safely without direct Prisma, we can read current and add,
    // or we can just fetch session.totalBreakMinutes and add durationMinutes.
    // Let's assume AttendanceAuthority requires raw values.
    await this.attendanceAuthority.updateWorkSession(session.id, {
      status: 'WORKING',
      totalBreakMinutes: (session.totalBreakMinutes ?? 0) + (openBreak.breakType !== 'MEETING' ? durationMinutes : 0),
    });

    await this.prisma.attendanceEvent.create({
      data: { userId, workSessionId: session.id, eventType: 'BREAK_END' },
    });

    await this.attendanceAuthority.setUserStatus(userId, 'WORKING', now);

    await this.ticketLedger.resumeLogsForBreak(openBreak.id, userId);

    this.eventLogger.log({
      actorId: userId,
      entityType: 'WorkdaySession',
      entityId: session.id,
      action: OperationalAction.BREAK_ENDED,
      metadata: { durationMinutes },
    }).catch(() => {});

    return { breakLog: updated, durationMinutes };
  }

  async reportIdle(userId: string, idleDuration: number) {
    const today = this.getTodayDate();
    const now = this.tva.now();

    if (idleDuration >= 20) {
      await this.attendanceAuthority.updateManyWorkSessions(
        { userId, date: today, status: 'WORKING' },
        { status: 'IDLE' }
      );
      await this.attendanceAuthority.setUserStatus(userId, 'IDLE');
    }

    await this.prisma.attendanceEvent.create({
      data: {
        userId,
        eventType: 'IDLE_DETECTED',
        source: 'system',
        metadata: { idleDuration },
      },
    });

    return { status: 'ok' };
  }

  async resumeWork(userId: string) {
    const today = this.getTodayDate();
    const now = this.tva.now();

    const session = await this.attendanceAuthority.updateManyWorkSessions(
      { userId, date: today, status: { in: ['IDLE', 'ON_BREAK', 'LOGGED_IN'] } },
      { status: 'WORKING' }
    );

    await this.prisma.attendanceEvent.create({
      data: { userId, eventType: 'RESUME_WORK', source: 'manual' },
    });

    await this.attendanceAuthority.setUserStatus(userId, 'WORKING', now);

    return { message: 'Resumed', updated: session.count };
  }

  async resumeAutoClosedWork(userId: string) {
    const today = this.getTodayDate();
    const now = this.tva.now();

    const oldSession = await this.prisma.workSession.findFirst({
      where: { userId, date: today, autoClosed: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!oldSession) {
      throw new Error('No auto-closed session found for today');
    }

    const newSession = await this.attendanceAuthority.createWorkSession({
      userId,
      date: today,
      loginAt: now,
      startWorkAt: now,
      status: 'WORKING',
      continuationOfSessionId: oldSession.id,
    });

    await this.prisma.attendanceEvent.create({
      data: {
        userId,
        workSessionId: newSession.id,
        eventType: 'START_WORK',
        source: 'USER_RESUMED_AFTER_AUTO_CLOSE',
      },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { currentStatus: 'WORKING', lastActiveAt: now },
    });

    this.eventLogger.log({
      actorId: userId,
      entityType: 'WorkdaySession',
      entityId: newSession.id,
      action: OperationalAction.WORKDAY_STARTED,
    }).catch(() => {});

    return { session: newSession, message: 'Workday resumed after auto-close' };
  }

  // Called when the user picks "Continue Working" on the auto-close consent
  // prompt. Does not touch session status (a user on a break stays on break) —
  // it only refreshes the activity signal shouldPolicyAutoStop checks, so the
  // backend's own grace-period safety net doesn't treat them as abandoned, and
  // records a distinct, clearly-labeled event for the audit trail.
  async continueWorking(userId: string) {
    const today = this.getTodayDate();
    const now = this.tva.now();

    const session = await this.prisma.workSession.findFirst({
      where: { userId, date: today },
      orderBy: { createdAt: 'desc' },
    });

    if (!session || !['WORKING', 'ON_BREAK'].includes(session.status)) {
      throw new Error('No active session to continue');
    }

    await this.attendanceAuthority.setUserStatus(userId, session.status, now);

    await this.prisma.attendanceEvent.create({
      data: {
        userId,
        workSessionId: session.id,
        eventType: 'WORKDAY_CONTINUED',
        source: 'manual',
      },
    });

    this.eventLogger.log({
      actorId: userId,
      entityType: 'WorkdaySession',
      entityId: session.id,
      action: OperationalAction.WORKDAY_CONTINUED,
    }).catch(() => {});

    return { message: 'Continuing workday' };
  }

  async getToday(userId: string) {
    const today = this.getTodayDate();
    const now = this.tva.now();

    // Fetch all sessions for today to aggregate
    const sessions = await this.prisma.workSession.findMany({
      where: { userId, date: today },
      orderBy: { createdAt: 'asc' },
      include: {
        breakLogs: { orderBy: { startAt: 'asc' } },
        attendanceEvents: { orderBy: { timestamp: 'asc' } },
      },
    });

    const session = sessions.length > 0 ? sessions[sessions.length - 1] : null;

    const onLeave = await this.prisma.leaveRequest.findFirst({
      where: {
        userId,
        status: 'APPROVED',
        startDate: { lte: today },
        endDate: { gte: today },
      },
    });

    const sessionsForRuntime = sessions.map((s) => ({
      ...s,
      breakLogs: s.breakLogs.filter((b: any) => b.breakType !== 'MEETING'),
    }));
    const rt = calculateWorkdayRuntime(sessionsForRuntime as any, now);

    const remainingBreakMinutes = Math.max(0, DAILY_BREAK_ALLOWANCE_MINUTES - rt.totalBreakMinutes);
    const exceededBreakMinutes = Math.max(0, rt.totalBreakMinutes - DAILY_BREAK_ALLOWANCE_MINUTES);

    // Tells the frontend when to show the auto-close consent prompt. This is
    // deliberately independent of the backend's own grace-period safety net in
    // shouldPolicyAutoStop: the prompt should appear promptly right at cutoff
    // for anyone still WORKING/ON_BREAK, while the backend only force-closes
    // later, once there's genuinely no activity signal for the grace window.
    let needsAutoCloseConsent = false;
    let autoCloseTime: string | null = null;
    if (session && ['WORKING', 'ON_BREAK'].includes(session.status)) {
      const policySetting = await this.prisma.appSetting.findUnique({ where: { key: 'workday_policy' } });
      const policy = (policySetting?.value as any) ?? null;
      if (policy?.autoClose === true) {
        const timezone = policy.timezone || DEFAULT_COMPANY_TIMEZONE;
        const currentCompanyDateStr = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
        autoCloseTime = policy.autoCloseTime || '23:59';
        const cutoffUtc = buildCompanyDateTimeUtc(currentCompanyDateStr, autoCloseTime, timezone);
        needsAutoCloseConsent = now.getTime() >= cutoffUtc.getTime();
      }
    }

    return {
      session,
      allSessions: sessions,
      elapsedWorkMinutes: rt.elapsedWorkMinutes,
      totalBreakMinutes: rt.totalBreakMinutes,
      firstStartTime: rt.firstStartTime,
      currentEndTime: rt.currentEndTime,
      autoClosedCount: rt.autoClosedCount,
      isResumed: rt.isResumed,
      sessionCount: rt.sessionCount,
      onLeaveToday: !!onLeave,
      leaveInfo: onLeave,
      allowedBreakMinutes: DAILY_BREAK_ALLOWANCE_MINUTES,
      usedBreakMinutes: rt.totalBreakMinutes,
      remainingBreakMinutes,
      exceededBreakMinutes,
      needsAutoCloseConsent,
      autoCloseTime,
    };
  }

  async getTeam(requestingUser: any) {
    const today = this.getTodayDate();
    const roleNameRaw = requestingUser.role?.name ?? requestingUser.role ?? '';
    const roleName = typeof roleNameRaw === 'string' ? roleNameRaw : '';
    const isHR = (requestingUser as any).isHR;
    const isAdminLevel = ['SUPER_ADMIN', 'ADMIN'].includes(roleName);

    let userFilter: any = { isActive: true, id: { not: requestingUser.id } };

    if (!isHR && !isAdminLevel) {
      if (['EMPLOYEE', 'INTERN'].includes(roleName)) {
        return [];
      }
      const access = await this.prisma.managerDeptAccess.findMany({
        where: { managerId: requestingUser.id },
      });
      const deptIds = access.map((a) => a.departmentId);
      if (requestingUser.departmentId) deptIds.push(requestingUser.departmentId);
      if (deptIds.length === 0) return [];
      userFilter.departmentId = { in: [...new Set(deptIds)] };
    }

    const globalPolicySetting = await this.prisma.appSetting.findUnique({ where: { key: 'workday_policy' } });
    const globalPolicy = (globalPolicySetting?.value as any) ?? {
      timezone: DEFAULT_COMPANY_TIMEZONE,
      employee: { startTime: '09:30', endTime: '18:30', flexible: false },
      teamLead: { entryWindowStart: '09:30', entryWindowEnd: '10:30', flexible: false },
    };

    const members = await this.prisma.user.findMany({
      where: userFilter,
      include: {
        role: true,
        department: true,
        workSessions: {
          where: { date: today },
          orderBy: { createdAt: 'asc' },
          include: { breakLogs: true },
        },
        leaveRequests: {
          where: {
            status: 'APPROVED',
            startDate: { lte: today },
            endDate: { gte: today },
          },
        },
        workdayPolicyOverride: true,
      },
      orderBy: [{ department: { name: 'asc' } }, { name: 'asc' }],
    });

    const now = this.tva.now();
    return members.map((m) => {
      // Latest session of the day, not the first — a user can have multiple
      // sessions per day, and the most recent one is what reflects current status.
      const session = m.workSessions.length > 0 ? m.workSessions[m.workSessions.length - 1] : null;
      const leave = m.leaveRequests[0] ?? null;
      
      const workSessionsForRuntime = m.workSessions.map((s: any) => ({
        ...s,
        breakLogs: s.breakLogs.filter((b: any) => b.breakType !== 'MEETING'),
      }));
      const rt = calculateWorkdayRuntime(workSessionsForRuntime as any, now);
      const firstStartTime = rt.firstStartTime;
      const totalWorkMins = rt.elapsedWorkMinutes;
      const totalBreakMins = rt.totalBreakMinutes;

      let isLate = false;
      let policySource = 'ROLE_POLICY';
      const userRole = m.role?.name?.toLowerCase() ?? '';
      
      let tz = globalPolicy.timezone ?? DEFAULT_COMPANY_TIMEZONE;
      let expectedStart = globalPolicy.employee?.startTime ?? '09:30';
      let isFlexible = false;

      if (m.workdayPolicyOverride) {
        policySource = 'USER_OVERRIDE';
        tz = m.workdayPolicyOverride.timezone ?? tz;
        expectedStart = m.workdayPolicyOverride.startTime ?? expectedStart;
        isFlexible = m.workdayPolicyOverride.flexible;
      } else if (userRole === 'team_lead') {
        expectedStart = globalPolicy.teamLead?.entryWindowEnd ?? '10:30';
        isFlexible = globalPolicy.teamLead?.flexible ?? false;
      } else if (['manager', 'admin', 'super_admin'].includes(userRole)) {
        isFlexible = true;
      }

      if (firstStartTime && !isFlexible) {
        isLate = TimezoneUtil.isLate(firstStartTime, expectedStart, tz);
      }

      const breakCount = m.workSessions.reduce((sum, s: any) => sum + s.breakLogs.length, 0);
      const exceededBreakMinutes = Math.max(0, totalBreakMins - DAILY_BREAK_ALLOWANCE_MINUTES);

      return {
        id: m.id,
        name: m.name,
        avatar: m.avatar,
        photoUrl: (m as any).photoUrl,
        role: m.role,
        department: m.department,
        workStatus: m.currentStatus,
        todaySession: session,
        // Authoritative workday end timestamp — sourced directly from the
        // WorkSession record (set by endWork() and the auto-close scheduler).
        // The frontend MUST display this; it must never compute End Time itself.
        startTime: rt.firstStartTime,
        endTime: session?.logoutAt ?? null,
        hasOpenSession: !!session && !session.logoutAt,
        onLeaveToday: !!leave,
        leaveType: leave?.type ?? null,
        workMinutesToday: totalWorkMins,
        breakMinutesToday: totalBreakMins,
        breakCount,
        allowedBreakMinutes: DAILY_BREAK_ALLOWANCE_MINUTES,
        exceededBreakMinutes,
        lastActiveAt: m.lastActiveAt,
        isLate,
        isFlexible,
        policySource,
        autoClosed: session?.autoClosed ?? false,
      };
    });
  }
}

