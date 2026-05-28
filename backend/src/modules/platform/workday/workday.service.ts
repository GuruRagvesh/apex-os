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

    return this.prisma.workSession.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
      take: 30,
      include: {
        breakLogs: { orderBy: { startAt: 'asc' } },
      },
    });
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

    const totalBreakMinutes = session.breakLogs
      .filter((b) => b.durationMinutes)
      .reduce((sum, b) => sum + (b.durationMinutes ?? 0), 0);

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

    const session = await this.prisma.workSession.findUnique({
      where: { userId_date: { userId, date: today } },
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

    let elapsedWorkMinutes = 0;
    if (session?.startWorkAt && !session.logoutAt) {
      const elapsed = Math.floor(
        (now.getTime() - session.startWorkAt.getTime()) / 60000,
      );
      elapsedWorkMinutes = Math.max(0, elapsed - (session.totalBreakMinutes ?? 0));
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
