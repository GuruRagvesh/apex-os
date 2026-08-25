import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export enum OperationalAction {
  // ── Tickets ──────────────────────────────────────────────────────────────
  TICKET_CREATED = 'TICKET_CREATED',
  TICKET_ASSIGNED = 'TICKET_ASSIGNED',
  TICKET_UNASSIGNED = 'TICKET_UNASSIGNED',
  TICKET_ASSIGNEE_REMOVED = 'TICKET_ASSIGNEE_REMOVED',
  TICKET_UPDATED = 'TICKET_UPDATED',
  TICKET_STARTED = 'TICKET_STARTED',
  TICKET_SUBMITTED_FOR_REVIEW = 'TICKET_SUBMITTED_FOR_REVIEW',
  TICKET_REVIEWED = 'TICKET_REVIEWED',
  TICKET_DONE = 'TICKET_DONE',
  TICKET_CLOSED = 'TICKET_CLOSED',
  TICKET_REOPENED = 'TICKET_REOPENED',
  TICKET_OVERDUE = 'TICKET_OVERDUE',
  TICKET_BLOCKED = 'TICKET_BLOCKED',
  TICKET_UNBLOCKED = 'TICKET_UNBLOCKED',
  TICKET_CANCELLED = 'TICKET_CANCELLED',   // legacy alias kept for backward compat
  TICKET_DELETED = 'TICKET_DELETED',
  TICKET_APPROVED = 'TICKET_APPROVED',
  TICKET_REJECTED = 'TICKET_REJECTED',
  COMMENT_ADDED = 'COMMENT_ADDED',
  ATTACHMENT_UPLOADED = 'ATTACHMENT_UPLOADED',
  ATTACHMENT_DELETED = 'ATTACHMENT_DELETED',
  DOCUMENT_UPLOADED = 'DOCUMENT_UPLOADED',
  DOCUMENT_DELETED = 'DOCUMENT_DELETED',
  PHOTO_UPLOADED = 'PHOTO_UPLOADED',
  PHOTO_REMOVED = 'PHOTO_REMOVED',

  // ── Projects ─────────────────────────────────────────────────────────────
  PROJECT_CREATED = 'PROJECT_CREATED',
  PROJECT_UPDATED = 'PROJECT_UPDATED',
  PROJECT_MEMBER_ADDED = 'PROJECT_MEMBER_ADDED',
  PROJECT_MEMBER_REMOVED = 'PROJECT_MEMBER_REMOVED',
  PROJECT_DELETED = 'PROJECT_DELETED',

  // ── Workday ──────────────────────────────────────────────────────────────
  WORKDAY_STARTED = 'WORKDAY_STARTED',
  BREAK_STARTED = 'BREAK_STARTED',
  BREAK_ENDED = 'BREAK_ENDED',
  IDLE_DETECTED = 'IDLE_DETECTED',
  IDLE_CLASSIFIED = 'IDLE_CLASSIFIED',
  WORKDAY_CONTINUED = 'WORKDAY_CONTINUED',
  WORKDAY_ENDED = 'WORKDAY_ENDED',

  // ── Attendance (PE-1) ─────────────────────────────────────────────────────
  ATTENDANCE_PUNCH_RECORDED = 'ATTENDANCE_PUNCH_RECORDED',

  // ── Attendance regularization (AR-1) ──────────────────────────────────────
  REGULARIZATION_REQUESTED = 'REGULARIZATION_REQUESTED',
  REGULARIZATION_MANAGER_APPROVED = 'REGULARIZATION_MANAGER_APPROVED',
  REGULARIZATION_HR_APPROVED = 'REGULARIZATION_HR_APPROVED',
  REGULARIZATION_REJECTED = 'REGULARIZATION_REJECTED',
  ATTENDANCE_OFFICIAL_REVISED = 'ATTENDANCE_OFFICIAL_REVISED',
  ATTENDANCE_FINALIZED = 'ATTENDANCE_FINALIZED',
  ATTENDANCE_EVALUATION_RUN = 'ATTENDANCE_EVALUATION_RUN',
  ATTENDANCE_SHADOW_RUN = 'ATTENDANCE_SHADOW_RUN',
  ATTENDANCE_CONFIGURATION_ERROR = 'ATTENDANCE_CONFIGURATION_ERROR',

  // ── Comp off ──────────────────────────────────────────────────────────────
  COMP_OFF_GRANTED = 'COMP_OFF_GRANTED',
  COMP_OFF_CONSUMED = 'COMP_OFF_CONSUMED',

  // ── Leave ─────────────────────────────────────────────────────────────────
  LEAVE_REQUESTED = 'LEAVE_REQUESTED',
  LEAVE_APPROVED = 'LEAVE_APPROVED',
  LEAVE_REJECTED = 'LEAVE_REJECTED',
  LEAVE_CANCELLED = 'LEAVE_CANCELLED',

  // ── Users / Auth ──────────────────────────────────────────────────────────
  USER_LOGIN = 'USER_LOGIN',
  USER_LOGOUT = 'USER_LOGOUT',
  USER_AUTO_LOGOUT = 'USER_AUTO_LOGOUT',
  USER_CREATED = 'USER_CREATED',
  USER_UPDATED = 'USER_UPDATED',
  USER_DEACTIVATED = 'USER_DEACTIVATED',
  USER_REACTIVATED = 'USER_REACTIVATED',
  USER_ROLE_CHANGED = 'USER_ROLE_CHANGED',
  ADMIN_USER_EMAIL_CORRECTED = 'ADMIN_USER_EMAIL_CORRECTED',
  PROFILE_UPDATED = 'PROFILE_UPDATED',
  SENSITIVE_DATA_VIEWED = 'SENSITIVE_DATA_VIEWED',
  SENSITIVE_DATA_EDITED = 'SENSITIVE_DATA_EDITED',

  // ── Settings ──────────────────────────────────────────────────────────────
  SETTINGS_UPDATED = 'SETTINGS_UPDATED',

  // ── Exports ───────────────────────────────────────────────────────────────
  EXPORT_PERFORMED = 'EXPORT_PERFORMED',

  // ── Sales CRM — Leads ────────────────────────────────────────────────────
  LEAD_CREATED = 'LEAD_CREATED',
  LEAD_UPDATED = 'LEAD_UPDATED',
  LEAD_OWNER_CHANGED = 'LEAD_OWNER_CHANGED',
  LEAD_STAGE_CHANGED = 'LEAD_STAGE_CHANGED',
  LEAD_DELETED = 'LEAD_DELETED',
  LEAD_ACTIVITY_ADDED = 'LEAD_ACTIVITY_ADDED',
  LEAD_FOLLOWUP_ADDED = 'LEAD_FOLLOWUP_ADDED',
  LEAD_REQUIREMENT_ADDED = 'LEAD_REQUIREMENT_ADDED',
  LEAD_DEAL_ADDED = 'LEAD_DEAL_ADDED',
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
    // Present on OperationalEvent since before AR-1, but never exposed here.
    // A correction has to record what the official fact was and what it became.
    beforeValue?: Record<string, any> | null;
    afterValue?: Record<string, any> | null;
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
