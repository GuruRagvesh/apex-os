import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export enum OperationalAction {
  TICKET_CREATED = 'TICKET_CREATED',
  TICKET_ASSIGNED = 'TICKET_ASSIGNED',
  TICKET_STARTED = 'TICKET_STARTED',
  TICKET_SUBMITTED_FOR_REVIEW = 'TICKET_SUBMITTED_FOR_REVIEW',
  TICKET_REVIEWED = 'TICKET_REVIEWED',
  TICKET_DONE = 'TICKET_DONE',
  TICKET_OVERDUE = 'TICKET_OVERDUE',
  TICKET_BLOCKED = 'TICKET_BLOCKED',
  TICKET_CANCELLED = 'TICKET_CANCELLED',
  TICKET_DELETED = 'TICKET_DELETED',
  WORKDAY_STARTED = 'WORKDAY_STARTED',
  BREAK_STARTED = 'BREAK_STARTED',
  BREAK_ENDED = 'BREAK_ENDED',
  IDLE_DETECTED = 'IDLE_DETECTED',
  IDLE_CLASSIFIED = 'IDLE_CLASSIFIED',
  WORKDAY_ENDED = 'WORKDAY_ENDED',
  LEAVE_REQUESTED = 'LEAVE_REQUESTED',
  LEAVE_APPROVED = 'LEAVE_APPROVED',
  LEAVE_REJECTED = 'LEAVE_REJECTED',
  USER_LOGIN = 'USER_LOGIN',
  USER_LOGOUT = 'USER_LOGOUT',
  USER_AUTO_LOGOUT = 'USER_AUTO_LOGOUT',
  PROFILE_UPDATED = 'PROFILE_UPDATED',
  SENSITIVE_DATA_VIEWED = 'SENSITIVE_DATA_VIEWED',
  SENSITIVE_DATA_EDITED = 'SENSITIVE_DATA_EDITED',
}

@Injectable()
export class EventLoggerService {
  constructor(private prisma: PrismaService) {}

  async log(params: {
    actorId: string;
    entityType: string;
    entityId: string;
    action: OperationalAction | string;
    fromState?: string;
    toState?: string;
    metadata?: Record<string, any>;
    ip?: string;
    device?: string;
  }) {
    try {
      await (this.prisma as any).operationalEvent.create({ data: params });
    } catch (err: any) {
      console.error('[EventLogger] Failed to log event:', err?.message);
    }
  }

  async getTimeline(entityType: string, entityId: string, limit = 200) {
    return (this.prisma as any).operationalEvent.findMany({
      where: { entityType, entityId },
      include: { actor: { select: { id: true, name: true, avatar: true } } },
      orderBy: { timestamp: 'asc' },
      take: limit,
    });
  }

  async getUserActivity(userId: string, limit = 50) {
    return (this.prisma as any).operationalEvent.findMany({
      where: { actorId: userId },
      include: { actor: { select: { id: true, name: true, avatar: true } } },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  async getCompanyActivity(filters: {
    entityType?: string;
    action?: string;
    actorId?: string;
    from?: Date;
    to?: Date;
    limit?: number;
  }) {
    const where: any = {};
    if (filters.entityType) where.entityType = filters.entityType;
    if (filters.action) where.action = filters.action;
    if (filters.actorId) where.actorId = filters.actorId;
    if (filters.from || filters.to) {
      where.timestamp = {};
      if (filters.from) where.timestamp.gte = filters.from;
      if (filters.to) where.timestamp.lte = filters.to;
    }
    return (this.prisma as any).operationalEvent.findMany({
      where,
      include: { actor: { select: { id: true, name: true, avatar: true } } },
      orderBy: { timestamp: 'desc' },
      take: filters.limit || 100,
    });
  }
}
