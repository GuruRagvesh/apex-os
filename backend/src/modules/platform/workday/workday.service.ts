import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';

@Injectable()
export class WorkdayService {
  constructor(
    private prisma: PrismaService,
    private accessPolicy: AccessPolicyService,
    private eventLogger: EventLoggerService,
  ) {}

  async getHistory(userId: string, requester: any) {
    const targetUser = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true, department: true },
    });
    if (!targetUser) throw new NotFoundException('User not found');
    const canView = await this.accessPolicy.canViewUser(requester, targetUser);
    if (!canView) throw new ForbiddenException('You do not have permission to view this user\'s work history');

    // Login-only artifacts (LOGGED_IN, never started, zero work) are not work
    // sessions — exclude them at the query level so they never surface in any
    // history UI. NOT negates the conjunction of all three conditions.
    const rows = await this.prisma.workSession.findMany({
      where: {
        userId,
        NOT: { status: 'LOGGED_IN', startWorkAt: null, totalWorkMinutes: 0 },
      },
      // Stable ordering: newest day first; within a day, latest session first.
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      // Raw sessions, not days — multiple same-day sessions collapse to ≤30
      // day entries below, so fetch enough rows to cover ~30 days.
      take: 90,
      include: {
        breakLogs: { orderBy: { startAt: 'asc' } },
      },
    });

    // Aggregate per calendar day (multiple valid same-day sessions are
    // supported). Rows arrive date desc + createdAt desc, so the first row seen
    // for a day is its LATEST session — it controls id, status and logoutAt.
    // Work-session timing uses startWorkAt only (earliest of the day as
    // firstStartTime); loginAt is never a timing fallback.
    const byDay = new Map<string, any>();
    for (const s of rows) {
      // Defense-in-depth: re-apply the login-only filter in memory.
      if (s.status === 'LOGGED_IN' && !s.startWorkAt && (s.totalWorkMinutes ?? 0) === 0) continue;
      const key = new Date(s.date).toISOString().slice(0, 10);
      const day = byDay.get(key);
      if (!day) {
        byDay.set(key, {
          id: s.id,
          userId: s.userId,
          date: s.date,
          status: s.status,
          loginAt: s.loginAt,
          startWorkAt: s.startWorkAt,
          logoutAt: s.logoutAt,
          totalWorkMinutes: s.totalWorkMinutes ?? 0,
          totalBreakMinutes: s.totalBreakMinutes ?? 0,
          breakLogs: [...(s.breakLogs ?? [])],
          sessionCount: 1,
        });
      } else {
        day.sessionCount += 1;
        day.totalWorkMinutes += s.totalWorkMinutes ?? 0;
        day.totalBreakMinutes += s.totalBreakMinutes ?? 0;
        day.breakLogs.push(...(s.breakLogs ?? []));
        if (s.startWorkAt && (!day.startWorkAt || s.startWorkAt < day.startWorkAt)) {
          day.startWorkAt = s.startWorkAt;
        }
        if (s.loginAt && (!day.loginAt || s.loginAt < day.loginAt)) {
          day.loginAt = s.loginAt;
        }
      }
    }

    const days = [...byDay.values()].slice(0, 30);
    for (const d of days) {
      d.breakLogs.sort((a: any, b: any) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    }
    return days;
  }

  private getTodayDate(): Date {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }

  async startWork(userId: string) {
    const today = this.getTodayDate();
    const now = new Date();

    const session = await this.prisma.workSession.upsert({
      where: { userId_date: { userId, date: today } },
      update: { startWorkAt: now, status: 'WORKING', loginAt: now },
      create: { userId, date: today, loginAt: now, startWorkAt: now, status: 'WORKING' },
    });

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

    const session = await this.prisma.workSession.findUnique({
      where: { userId_date: { userId, date: today } },
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

    const session = await this.prisma.workSession.findUnique({
      where: { userId_date: { userId, date: today } },
    });
    if (!session) throw new Error('No active session');

    const breakLog = await this.prisma.breakLog.create({
      data: {
        userId,
        workSessionId: session.id,
        breakType: dto.breakType,
        estimatedMinutes: dto.estimatedMinutes,
        startAt: now,
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

    const session = await this.prisma.workSession.findUnique({
      where: { userId_date: { userId, date: today } },
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

  async getToday(userId: string) {
    const today = this.getTodayDate();
    const now = new Date();

    // Return today's LATEST session (multiple same-day sessions are supported),
    // or null when none exists. findFirst by (userId, date) — never findUnique on
    // a userId_date key — and never creates a row: getToday is read-only, so a
    // user with no workday yet correctly reads as "no session", and after End Day
    // the most-recent (ended) session is the one that surfaces.
    const session = await this.prisma.workSession.findFirst({
      where: { userId, date: today },
      orderBy: { createdAt: 'desc' },
      include: {
        breakLogs: { orderBy: { startAt: 'asc' } },
        attendanceEvents: { orderBy: { timestamp: 'asc' } },
      },
    });

    const onLeave = await this.prisma.leaveRequest.findFirst({
      where: {
        userId,
        status: 'APPROVED',
        startDate: { lte: today },
        endDate: { gte: today },
      },
    });

    let liveBreakMins = session?.totalBreakMinutes ?? 0;
    if (session) {
      const openBreak = session.breakLogs.find((b) => !b.endAt);
      if (openBreak) {
        liveBreakMins += Math.max(0, Math.floor((now.getTime() - openBreak.startAt.getTime()) / 60000));
      }
    }

    let elapsedWorkMinutes = 0;
    if (session?.startWorkAt && !session.logoutAt) {
      const elapsed = Math.floor(
        (now.getTime() - session.startWorkAt.getTime()) / 60000,
      );
      elapsedWorkMinutes = Math.max(0, elapsed - liveBreakMins);
    }

    return {
      session,
      elapsedWorkMinutes,
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
      },
      orderBy: [{ department: { name: 'asc' } }, { name: 'asc' }],
    });

    const now = new Date();
    return members.map((m) => {
      const session = m.workSessions[0] ?? null;
      const leave = m.leaveRequests[0] ?? null;
      
      const breakMins = session?.breakLogs
        .filter((b) => b.durationMinutes)
        .reduce((s, b) => s + (b.durationMinutes ?? 0), 0) ?? 0;

      let liveBreakMins = breakMins;
      const openBreak = session?.breakLogs.find((b) => !b.endAt);
      if (openBreak) {
        liveBreakMins += Math.max(0, Math.floor((now.getTime() - openBreak.startAt.getTime()) / 60000));
      }

      let workMinutesToday = session?.totalWorkMinutes ?? 0;
      if (session && session.startWorkAt && !session.logoutAt) {
        const elapsed = Math.floor((now.getTime() - session.startWorkAt.getTime()) / 60000);
        workMinutesToday = Math.max(0, elapsed - liveBreakMins);
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
        workMinutesToday,
        breakMinutesToday: liveBreakMins,
        breakCount: session?.breakLogs.length ?? 0,
        lastActiveAt: m.lastActiveAt,
      };
    });
  }
}
