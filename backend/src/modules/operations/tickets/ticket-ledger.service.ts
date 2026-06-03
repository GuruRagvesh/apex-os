import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export const LEDGER_STAGES = {
  WORK: 'WORK',
  REVIEW: 'REVIEW',
  REWORK: 'REWORK',
  MEETING: 'MEETING',
  BLOCKED: 'BLOCKED',
};

export const LEDGER_OWNER_TYPES = {
  ASSIGNEE: 'ASSIGNEE',
  REVIEWER: 'REVIEWER',
  MANAGER: 'MANAGER',
  TEAM_LEAD: 'TEAM_LEAD',
  SYSTEM: 'SYSTEM',
};

export const LEDGER_SOURCES = {
  SYSTEM: 'SYSTEM',
  WORKDAY: 'WORKDAY',
  TICKET_STATUS: 'TICKET_STATUS',
  MANUAL: 'MANUAL',
};

export const LEDGER_PAUSE_REASONS = {
  BREAK: 'BREAK',
  LOGOUT: 'LOGOUT',
  BLOCKED: 'BLOCKED',
  CLOSED: 'CLOSED',
  SYSTEM: 'SYSTEM',
};

@Injectable()
export class TicketLedgerService {
  constructor(private prisma: PrismaService) {}

  async getActiveLogForUser(userId: string) {
    return this.prisma.ticketTimeLog.findFirst({
      where: { userId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
  }

  async getTicketTimers(ticket: any) {
    const totalTicketSeconds = ticket.createdAt 
      ? Math.floor(((ticket.resolvedAt || ticket.closedAt || ticket.cancelledAt || new Date()).getTime() - ticket.createdAt.getTime()) / 1000)
      : 0;

    const [assigneeLogs, reviewerLogs, activeLogs] = await Promise.all([
      this.prisma.ticketTimeLog.aggregate({
        where: { ticketId: ticket.id, ownerType: LEDGER_OWNER_TYPES.ASSIGNEE },
        _sum: { durationSeconds: true },
      }),
      this.prisma.ticketTimeLog.aggregate({
        where: { ticketId: ticket.id, ownerType: LEDGER_OWNER_TYPES.REVIEWER },
        _sum: { durationSeconds: true },
      }),
      this.prisma.ticketTimeLog.findMany({
        where: { ticketId: ticket.id, endedAt: null },
      })
    ]);

    let employeeWorkSeconds = assigneeLogs._sum.durationSeconds ?? 0;
    let reviewerApprovalSeconds = reviewerLogs._sum.durationSeconds ?? 0;
    let activeClock = 'NONE';

    for (const log of activeLogs) {
      const liveSeconds = Math.floor((new Date().getTime() - log.startedAt.getTime()) / 1000);
      if (log.ownerType === LEDGER_OWNER_TYPES.ASSIGNEE) {
        employeeWorkSeconds += liveSeconds;
        activeClock = 'EMPLOYEE_WORK';
      } else if (log.ownerType === LEDGER_OWNER_TYPES.REVIEWER) {
        reviewerApprovalSeconds += liveSeconds;
        activeClock = 'REVIEWER_APPROVAL';
      }
    }

    return {
      totalTicketSeconds,
      employeeWorkSeconds,
      reviewerApprovalSeconds,
      activeClock
    };
  }

  async getActiveLogForTicket(ticketId: string) {
    return this.prisma.ticketTimeLog.findFirst({
      where: { ticketId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
  }

  async startWorkLog(input: {
    ticketId: string;
    userId: string;
    stage: string;
    ownerType: string;
    source: string;
    workSessionId?: string;
    countsAsWork?: boolean;
  }) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: input.ticketId } });
    if (!ticket) throw new BadRequestException('Ticket not found');
    if (ticket.status === 'CLOSED') throw new BadRequestException('Cannot start timer for a CLOSED ticket');

    const existing = await this.prisma.ticketTimeLog.findFirst({
      where: { ticketId: input.ticketId, userId: input.userId, stage: input.stage, endedAt: null },
    });

    if (existing) return existing;

    return this.prisma.ticketTimeLog.create({
      data: {
        ticketId: input.ticketId,
        userId: input.userId,
        stage: input.stage,
        ownerType: input.ownerType,
        source: input.source,
        workSessionId: input.workSessionId,
        countsAsWork: input.countsAsWork ?? true,
        startedAt: new Date(),
      },
    });
  }

  async endActiveLog(input: {
    logId?: string;
    ticketId?: string;
    userId?: string;
    pauseReason?: string;
    breakLogId?: string;
    endedAt?: Date;
  }) {
    let log;
    if (input.logId) {
      log = await this.prisma.ticketTimeLog.findUnique({ where: { id: input.logId } });
    } else if (input.ticketId && input.userId) {
      log = await this.prisma.ticketTimeLog.findFirst({
        where: { ticketId: input.ticketId, userId: input.userId, endedAt: null },
        orderBy: { startedAt: 'desc' },
      });
    }

    if (!log || log.endedAt) return log;

    const endedAt = input.endedAt ?? new Date();
    const durationSeconds = Math.max(0, Math.floor((endedAt.getTime() - log.startedAt.getTime()) / 1000));

    return this.prisma.ticketTimeLog.update({
      where: { id: log.id },
      data: {
        endedAt,
        durationSeconds,
        pauseReason: input.pauseReason,
        breakLogId: input.breakLogId,
      },
    });
  }

  async pauseActiveLogsForUser(input: {
    userId: string;
    pauseReason: string;
    breakLogId?: string;
    endedAt?: Date;
  }) {
    const activeLogs = await this.prisma.ticketTimeLog.findMany({
      where: { userId: input.userId, endedAt: null },
    });

    if (activeLogs.length === 0) return { count: 0, logIds: [] };

    const endedAt = input.endedAt ?? new Date();
    const logIds = [];

    for (const log of activeLogs) {
      const durationSeconds = Math.max(0, Math.floor((endedAt.getTime() - log.startedAt.getTime()) / 1000));
      await this.prisma.ticketTimeLog.update({
        where: { id: log.id },
        data: {
          endedAt,
          durationSeconds,
          pauseReason: input.pauseReason,
          breakLogId: input.breakLogId,
        },
      });
      logIds.push(log.id);
    }

    return { count: logIds.length, logIds };
  }

  async resumeLogsForBreak(breakLogId: string, userId: string) {
    const pausedLogs = await this.prisma.ticketTimeLog.findMany({
      where: { userId, breakLogId, pauseReason: 'BREAK' },
      include: { ticket: true },
    });

    const resumedLogs = [];
    for (const log of pausedLogs) {
      if (
        log.ticket &&
        log.ticket.status === 'IN_PROGRESS' &&
        log.ticket.isBlocked === false &&
        log.ticket.assignedToId === userId
      ) {
        const newLog = await this.startWorkLog({
          ticketId: log.ticketId,
          userId: log.userId,
          stage: log.stage,
          ownerType: log.ownerType,
          source: log.source,
          workSessionId: log.workSessionId ?? undefined,
          countsAsWork: log.countsAsWork,
        });
        resumedLogs.push(newLog);
      }
    }
    return resumedLogs;
  }

  async resumeWorkLog(input: {
    ticketId: string;
    userId: string;
    stage: string;
    ownerType: string;
    source: string;
    workSessionId?: string;
    countsAsWork?: boolean;
  }) {
    return this.startWorkLog(input);
  }

  async startReviewCycle(input: {
    ticketId: string;
    assigneeId?: string;
    reviewerId?: string;
    reviewStartedAt?: Date;
  }) {
    const existing = await this.prisma.reviewCycleLog.findFirst({
      where: { ticketId: input.ticketId },
      orderBy: { cycleNo: 'desc' },
    });

    const cycleNo = existing ? existing.cycleNo + 1 : 1;

    return this.prisma.reviewCycleLog.create({
      data: {
        ticketId: input.ticketId,
        cycleNo,
        assigneeId: input.assigneeId,
        reviewerId: input.reviewerId,
        reviewStartedAt: input.reviewStartedAt,
      },
    });
  }

  async endReviewCycle(input: {
    ticketId: string;
    cycleNo?: number;
    decision: string;
    feedback?: string;
    reviewEndedAt?: Date;
    reworkStartedAt?: Date;
    assigneeWorkSeconds?: number;
    reviewerWorkSeconds?: number;
    taskEfficiencyRating?: number;
    employeePerformanceRating?: number;
    employeeAttitudeRating?: number;
    ratingComment?: string;
  }) {
    let cycle;
    if (input.cycleNo) {
      cycle = await this.prisma.reviewCycleLog.findUnique({
        where: { ticketId_cycleNo: { ticketId: input.ticketId, cycleNo: input.cycleNo } },
      });
    } else {
      cycle = await this.prisma.reviewCycleLog.findFirst({
        where: { ticketId: input.ticketId, decision: null },
        orderBy: { cycleNo: 'desc' },
      });
    }

    if (!cycle) return null;

    const reviewEndedAt = input.reviewEndedAt ?? new Date();
    let assigneeStartBound = new Date(0);

    if (cycle.cycleNo > 1) {
      const prevCycle = await this.prisma.reviewCycleLog.findUnique({
        where: { ticketId_cycleNo: { ticketId: input.ticketId, cycleNo: cycle.cycleNo - 1 } },
      });
      if (prevCycle?.reworkStartedAt) {
        assigneeStartBound = prevCycle.reworkStartedAt;
      }
    }

    const assigneeLogs = await this.prisma.ticketTimeLog.aggregate({
      where: {
        ticketId: input.ticketId,
        ownerType: 'ASSIGNEE',
        startedAt: { gte: assigneeStartBound, lte: cycle.reviewStartedAt || new Date() },
      },
      _sum: { durationSeconds: true },
    });

    const reviewerLogs = await this.prisma.ticketTimeLog.aggregate({
      where: {
        ticketId: input.ticketId,
        ownerType: 'REVIEWER',
        startedAt: { gte: cycle.reviewStartedAt || new Date(0), lte: reviewEndedAt },
      },
      _sum: { durationSeconds: true },
    });

    const assigneeWorkSeconds = input.assigneeWorkSeconds ?? assigneeLogs._sum.durationSeconds ?? 0;
    const reviewerWorkSeconds = input.reviewerWorkSeconds ?? reviewerLogs._sum.durationSeconds ?? 0;

    return this.prisma.reviewCycleLog.update({
      where: { id: cycle.id },
      data: {
        decision: input.decision,
        feedback: input.feedback,
        reviewEndedAt,
        reworkStartedAt: input.reworkStartedAt,
        assigneeWorkSeconds,
        reviewerWorkSeconds,
        taskEfficiencyRating: input.taskEfficiencyRating,
        employeePerformanceRating: input.employeePerformanceRating,
        employeeAttitudeRating: input.employeeAttitudeRating,
        ratingComment: input.ratingComment,
      },
    });
  }

  async assertNoOpenLogsForClosedTicket(ticketId: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (ticket?.status === 'CLOSED') {
      const activeLogs = await this.prisma.ticketTimeLog.findMany({
        where: { ticketId, endedAt: null },
      });
      if (activeLogs.length > 0) {
        throw new BadRequestException('Closed ticket cannot have active time logs');
      }
    }
  }
}
