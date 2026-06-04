import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';
import { TimezoneUtil, DEFAULT_COMPANY_TIMEZONE } from '../../../common/utils/timezone.util';
import { calculateWorkdayRuntime } from './workday.calculation';
import { TicketLedgerService } from '../../operations/tickets/ticket-ledger.service';
import { NotificationEventService } from '../../operations/notifications/notification-event.service';
import { NotificationType } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';

@Injectable()
export class WorkdayService {
  constructor(
    private prisma: PrismaService,
    private accessPolicy: AccessPolicyService,
    private eventLogger: EventLoggerService,
    private ticketLedger: TicketLedgerService,
    private notificationEventService: NotificationEventService,
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
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 60,
      include: {
        breakLogs: { orderBy: { startAt: 'asc' } },
      },
    });

    const grouped = new Map<string, any>();
    const currentCompanyDateStr = formatInTimeZone(new Date(), DEFAULT_COMPANY_TIMEZONE, 'yyyy-MM-dd');

    for (const session of sessions) {
      const dateStr = session.date instanceof Date
        ? formatInTimeZone(session.date, 'UTC', 'yyyy-MM-dd')
        : String(session.date).split('T')[0];
      
      if (!grouped.has(dateStr)) {
        grouped.set(dateStr, {
          companyDate: dateStr,
          firstStartTime: session.startWorkAt || session.loginAt,
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
      
      if (!session.logoutAt) summary.hasOpenSession = true;
      
      if ((session.startWorkAt || session.loginAt) < summary.firstStartTime) {
        summary.firstStartTime = session.startWorkAt || session.loginAt;
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
          const openSession = summary.sessions.find((s: any) => !s.logoutAt);
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
    return TimezoneUtil.getCompanyTodayDate();
  }

  async startWork(userId: string) {
    const today = this.getTodayDate();
    const now = new Date();

    let session = await this.prisma.workSession.findFirst({
      where: { userId, date: today },
      orderBy: { createdAt: 'desc' },
    });

    if (session) {
      const wasAutoClosed = session.status === 'AUTO_CLOSED' || session.autoClosed;
      session = await this.prisma.workSession.update({
        where: { id: session.id },
        data: { startWorkAt: now, status: 'WORKING', loginAt: now },
      });

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
    } else {
      session = await this.prisma.workSession.create({
        data: { userId, date: today, loginAt: now, startWorkAt: now, status: 'WORKING' },
      });
    }

    await this.prisma.attendanceEvent.create({
      data: { userId, workSessionId: session.id, eventType: 'START_WORK', source: 'manual' },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { currentStatus: 'WORKING', lastActiveAt: now },
    });

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
    const now = new Date();

    const session = await this.prisma.workSession.findFirst({
      where: { userId, date: today },
      orderBy: { createdAt: 'desc' },
      include: { breakLogs: true },
    });

    if (!session) return { message: 'No session found' };

    let totalBreakMinutes = session.breakLogs
      .filter((b) => b.durationMinutes)
      .reduce((sum, b) => sum + (b.durationMinutes ?? 0), 0);

    // Close any open break
    const openBreak = session.breakLogs.find((b) => !b.endAt);
    if (openBreak) {
      const openDuration = Math.max(0, Math.floor((now.getTime() - openBreak.startAt.getTime()) / 60000));
      await this.prisma.breakLog.update({
        where: { id: openBreak.id },
        data: { endAt: now, durationMinutes: openDuration },
      });
      totalBreakMinutes += openDuration;
    }

    let totalWorkMinutes = 0;
    if (session.startWorkAt) {
      const elapsed = Math.floor((now.getTime() - session.startWorkAt.getTime()) / 60000);
      totalWorkMinutes = Math.max(0, elapsed - totalBreakMinutes);
    }

    const updated = await this.prisma.workSession.update({
      where: { id: session.id },
      data: { logoutAt: now, status: 'LOGGED_OUT', totalBreakMinutes, totalWorkMinutes },
    });

    await this.prisma.attendanceEvent.create({
      data: { userId, workSessionId: session.id, eventType: 'LOGOUT', source: 'manual' },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { currentStatus: 'LOGGED_OUT' },
    });

    await this.ticketLedger.pauseActiveLogsForUser({
      userId,
      pauseReason: 'LOGOUT',
      endedAt: now,
    });

    this.eventLogger.log({
      actorId: userId,
      entityType: 'WorkdaySession',
      entityId: session.id,
      action: OperationalAction.WORKDAY_ENDED,
    }).catch(() => {});

    return {
      session: updated,
      summary: { totalWorkMinutes, totalBreakMinutes },
    };
  }

  async startBreak(userId: string, dto: { breakType: string; estimatedMinutes?: number }) {
    const today = this.getTodayDate();
    const now = new Date();

    const session = await this.prisma.workSession.findFirst({
      where: { userId, date: today },
      orderBy: { createdAt: 'desc' },
    });
    if (!session) throw new Error('No active session');

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

    await this.prisma.workSession.update({
      where: { id: session.id },
      data: { status: 'ON_BREAK' },
    });

    await this.prisma.attendanceEvent.create({
      data: {
        userId,
        workSessionId: session.id,
        eventType: 'BREAK_START',
        metadata: { breakType: dto.breakType },
      },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { currentStatus: 'ON_BREAK' },
    });

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
    const now = new Date();

    const session = await this.prisma.workSession.findFirst({
      where: { userId, date: today },
      orderBy: { createdAt: 'desc' },
    });
    if (!session) throw new Error('No active session');

    const openBreak = await this.prisma.breakLog.findFirst({
      where: { userId, workSessionId: session.id, endAt: null },
      orderBy: { startAt: 'desc' },
    });
    if (!openBreak) throw new Error('No open break found');

    const durationMinutes = Math.floor(
      (now.getTime() - openBreak.startAt.getTime()) / 60000,
    );

    const updated = await this.prisma.breakLog.update({
      where: { id: openBreak.id },
      data: { endAt: now, durationMinutes },
    });

    await this.prisma.workSession.update({
      where: { id: session.id },
      data: {
        status: 'WORKING',
        totalBreakMinutes: { increment: durationMinutes },
      },
    });

    await this.prisma.attendanceEvent.create({
      data: { userId, workSessionId: session.id, eventType: 'BREAK_END' },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { currentStatus: 'WORKING', lastActiveAt: now },
    });

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
    const now = new Date();

    if (idleDuration >= 20) {
      await this.prisma.workSession.updateMany({
        where: { userId, date: today, status: 'WORKING' },
        data: { status: 'IDLE' },
      });
      await this.prisma.user.update({
        where: { id: userId },
        data: { currentStatus: 'IDLE' },
      });
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
    const now = new Date();

    const session = await this.prisma.workSession.updateMany({
      where: { userId, date: today, status: { in: ['IDLE', 'ON_BREAK', 'LOGGED_IN'] } },
      data: { status: 'WORKING' },
    });

    await this.prisma.attendanceEvent.create({
      data: { userId, eventType: 'RESUME_WORK', source: 'manual' },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { currentStatus: 'WORKING', lastActiveAt: now },
    });

    return { message: 'Resumed', updated: session.count };
  }

  async resumeAutoClosedWork(userId: string) {
    const today = this.getTodayDate();
    const now = new Date();

    const oldSession = await this.prisma.workSession.findFirst({
      where: { userId, date: today, autoClosed: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!oldSession) {
      throw new Error('No auto-closed session found for today');
    }

    const newSession = await this.prisma.workSession.create({
      data: {
        userId,
        date: today,
        loginAt: now,
        startWorkAt: now,
        status: 'WORKING',
        continuationOfSessionId: oldSession.id,
      },
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

  async getToday(userId: string) {
    const today = this.getTodayDate();
    const now = new Date();

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

    const rt = calculateWorkdayRuntime(sessions as any, now);

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

    const now = new Date();
    return members.map((m) => {
      const session = m.workSessions[0] ?? null;
      const leave = m.leaveRequests[0] ?? null;
      
      const rt = calculateWorkdayRuntime(m.workSessions as any, now);
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

      return {
        id: m.id,
        name: m.name,
        avatar: m.avatar,
        photoUrl: (m as any).photoUrl,
        role: m.role,
        department: m.department,
        workStatus: m.currentStatus,
        todaySession: session,
        onLeaveToday: !!leave,
        leaveType: leave?.type ?? null,
        workMinutesToday: totalWorkMins,
        breakMinutesToday: totalBreakMins,
        breakCount: session?.breakLogs.length ?? 0,
        lastActiveAt: m.lastActiveAt,
        isLate,
        isFlexible,
        policySource,
        autoClosed: session?.autoClosed ?? false,
      };
    });
  }
}
