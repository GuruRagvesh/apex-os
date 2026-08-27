import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AttendanceAuthorityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Authority update for User's current presence status.
   */
  async setUserStatus(
    userId: string,
    status: string,
    lastActiveAt?: Date,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    return client.user.update({
      where: { id: userId },
      data: { 
        currentStatus: status,
        ...(lastActiveAt && { lastActiveAt })
      },
    });
  }

  /**
   * Authority update for multiple Users' presence status.
   */
  async updateManyUserStatus(userIdsNotIn: string[], status: string) {
    return this.prisma.user.updateMany({
      where: {
        isActive: true,
        id: { notIn: userIdsNotIn },
      },
      data: { currentStatus: status },
    });
  }

  /**
   * Authority creation for new WorkSessions.
   */
  async createWorkSession(data: {
    userId: string;
    date: Date;
    loginAt?: Date;
    startWorkAt?: Date;
    status: string;
    leaveId?: string;
    continuationOfSessionId?: string;
  }, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    return client.workSession.create({
      data,
    });
  }

  /**
   * Authority update for WorkSessions. Optional `tx` lets callers (e.g.
   * WorkdayService.finalizeWorkSession) run this inside their own Prisma
   * transaction; omitted, it behaves exactly as before.
   */
  async updateWorkSession(
    sessionId: string,
    data: {
      status?: string;
      loginAt?: Date;
      startWorkAt?: Date;
      logoutAt?: Date;
      autoClosed?: boolean;
      autoClosedAt?: Date;
      closureReason?: string;
      totalWorkMinutes?: number;
      totalBreakMinutes?: number;
      leaveId?: string;
      continuationOfSessionId?: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    return client.workSession.update({
      where: { id: sessionId },
      data,
    });
  }

  /**
   * Authority update for multiple WorkSessions.
   */
  async updateManyWorkSessions(
    where: {
      userId: string;
      date: Date;
      status: string | { in: string[] };
    },
    data: {
      status?: string;
      logoutAt?: Date;
    }
  ) {
    return this.prisma.workSession.updateMany({
      where,
      data,
    });
  }
}
