import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../prisma/prisma.service';
import { TicketStatus, NotificationType } from '@prisma/client';
import { EventsGateway } from '../../platform/gateway/events.gateway';
import { EmailService } from '../../platform/email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';

function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

const SLA_HOURS: Record<string, number> = {
  URGENT: 4,
  HIGH: 8,
  MEDIUM: 24,
  LOW: 72,
};

const REVIEW_SLA_HOURS: Record<string, number> = {
  URGENT: 2,
  HIGH: 4,
  MEDIUM: 24,
  LOW: 48,
};

@Injectable()
export class TicketsService {
  constructor(
    private prisma: PrismaService,
    private gateway: EventsGateway,
    private emailService: EmailService,
    private notificationsService: NotificationsService,
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
    private eventLogger: EventLoggerService,
  ) {}

  private get frontendUrl() {
    return this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
  }

  private includeOptions = {
    assignedTo: { select: { id: true, name: true, email: true, avatar: true } },
    createdBy: { select: { id: true, name: true, email: true, avatar: true } },
    department: true,
    project: { select: { id: true, projectId: true, name: true } },
    assignees: { include: { user: { select: { id: true, name: true, avatar: true } } } },
    taskType: true,
    taskSubtype: true,
    _count: { select: { comments: true } },
  };

  // ── Timer helpers ────────────────────────────────────────────────────────

  /** Normalize a date string: date-only "YYYY-MM-DD" → 18:30 IST (13:00 UTC) */
  private normalizeDateInput(value: string | Date | null | undefined): Date | undefined {
    if (!value) return undefined;
    if (value instanceof Date) return value;
    if (typeof value === 'string' && !value.includes('T')) {
      return new Date(`${value}T13:00:00.000Z`);
    }
    return new Date(value);
  }

  /** Compute executionDueAt = base + estimatedMinutes. Returns null if inputs missing. */
  private calcExecutionDueAt(
    scheduledStartAt: Date | null | undefined,
    actualStartAt: Date | null | undefined,
    estimatedMinutes: number | null | undefined,
  ): Date | null {
    if (!estimatedMinutes) return null;
    const base = scheduledStartAt || actualStartAt;
    if (!base) return null;
    return new Date(new Date(base).getTime() + estimatedMinutes * 60_000);
  }

  /** Query review SLA from AppSetting, fall back to hardcoded defaults. */
  private async getReviewSlaHoursForPriority(priority: string): Promise<number> {
    try {
      const row = await this.prisma.appSetting.findUnique({ where: { key: 'review_sla' } });
      if (row?.value) {
        const stored = row.value as Record<string, number>;
        if (stored[priority] != null) return stored[priority];
      }
    } catch { /* ignore */ }
    return REVIEW_SLA_HOURS[priority] ?? 24;
  }

  private formatOverdueDuration(diffMinutes: number): { display: string; severity: string } {
    if (diffMinutes < 60) {
      return { display: `${diffMinutes}m overdue`, severity: 'orange' };
    } else if (diffMinutes < 240) {
      const h = Math.floor(diffMinutes / 60);
      const m = diffMinutes % 60;
      return { display: m > 0 ? `${h}h ${m}m overdue` : `${h}h overdue`, severity: 'deep-orange' };
    } else {
      const h = Math.floor(diffMinutes / 60);
      const d = Math.floor(h / 24);
      const rh = h % 24;
      const display = d > 0 ? (rh > 0 ? `${d}d ${rh}h overdue` : `${d}d overdue`) : `${h}h overdue`;
      return { display, severity: 'red' };
    }
  }

  private addSla(ticket: any) {
    const slaHours = SLA_HOURS[ticket.priority] ?? 24;
    const elapsed = (Date.now() - new Date(ticket.createdAt).getTime()) / 3600000;
    const slaPercent = Math.min(Math.round((elapsed / slaHours) * 100), 100);
    const slaOverdue =
      elapsed > slaHours && !['DONE', 'CLOSED'].includes(ticket.status);
    return this.computeOverdue({
      ...ticket,
      slaHours,
      elapsedHours: Math.round(elapsed * 10) / 10,
      slaPercent,
      isOverdue: slaOverdue,
    });
  }

  private computeOverdue(ticket: any): any {
    const status: string = ticket.status;

    // Terminal states — never overdue
    if (['DONE', 'CLOSED'].includes(status)) {
      return { ...ticket, isOverdue: false, overdueMinutes: 0, overdueDisplay: null, overdueSeverity: null };
    }

    let dueAt: Date | null = null;

    if (status === 'REVIEW') {
      // Review timer: use reviewDueAt set when the ticket moved into REVIEW
      dueAt = ticket.reviewDueAt ? new Date(ticket.reviewDueAt) : null;
    } else {
      // Execution timer: use executionDueAt, but ONLY while ticket hasn't been submitted yet
      // (submittedAt is set when moving to REVIEW — once submitted, execution timer stops)
      if (!ticket.submittedAt && ticket.executionDueAt) {
        dueAt = new Date(ticket.executionDueAt);
      }
    }

    if (!dueAt) {
      return { ...ticket, isOverdue: ticket.isOverdue ?? false, overdueMinutes: 0, overdueDisplay: null, overdueSeverity: null };
    }

    const diffMs = Date.now() - dueAt.getTime();
    const diffMinutes = Math.floor(diffMs / 60_000);

    if (diffMinutes <= 0) {
      return { ...ticket, isOverdue: false, overdueMinutes: 0, overdueDisplay: null, overdueSeverity: null };
    }

    const { display: overdueDisplay, severity: overdueSeverity } = this.formatOverdueDuration(diffMinutes);
    return { ...ticket, isOverdue: true, overdueMinutes: diffMinutes, overdueDisplay, overdueSeverity };
  }

  // Resolve a department filter that may be passed as either an ID or a name
  private async resolveDeptFilter(value?: string): Promise<string | undefined> {
    if (!value) return undefined;
    if (isUUID(value)) return value;
    const dept = await this.prisma.department.findFirst({
      where: { name: { equals: value, mode: 'insensitive' } },
    });
    return dept?.id;
  }

  // Apply role-based scoping to a Prisma `where` clause
  private async applyRoleScope(where: any, user?: { id: string; role?: any; departmentId?: string | null }) {
    if (!user) return where;
    const roleName: string = user.role?.name ?? user.role ?? '';
    // Admin / Super Admin → see everything
    if (['ADMIN', 'SUPER_ADMIN'].includes(roleName)) return where;
    // Manager → scope to all departments they manage (via ManagerDeptAccess + home dept)
    if (roleName === 'MANAGER') {
      const access = await this.prisma.managerDeptAccess.findMany({ where: { managerId: user.id } });
      const deptIds: string[] = access.map((a: any) => a.departmentId as string);
      if (user.departmentId) deptIds.push(user.departmentId);
      const uniqueDeptIds: string[] = [...new Set(deptIds)];
      if (uniqueDeptIds.length > 0) where.departmentId = { in: uniqueDeptIds };
      return where;
    }
    // TeamLead → scope to their department, but also see their own created/assigned tickets
    if (roleName === 'TEAM_LEAD') {
      if (user.departmentId) {
        where.OR = [
          { departmentId: user.departmentId },
          { createdById: user.id },
          { assignedToId: user.id },
        ];
      }
      return where;
    }
    // Employee / Intern → only tickets they created, are assigned to (primary or multi-assignee)
    where.OR = [
      { assignedToId: user.id },
      { createdById: user.id },
      { assignees: { some: { userId: user.id } } },
    ];
    return where;
  }

  async findAll(query: {
    search?: string;
    status?: string;
    category?: string;
    priority?: string;
    departmentId?: string;
    department?: string;
    projectId?: string;
    assignedToId?: string;
    createdById?: string;
    page?: number;
    limit?: number;
  }, user?: any) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    let where: any = {};
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { ticketId: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.status) where.status = query.status;
    if (query.category) where.category = query.category;
    if (query.priority) where.priority = query.priority;
    const deptId = await this.resolveDeptFilter(query.departmentId || query.department);
    if (deptId) where.departmentId = deptId;
    if (query.projectId) where.projectId = query.projectId;
    if (query.assignedToId) where.assignedToId = query.assignedToId;
    if (query.createdById) where.createdById = query.createdById;

    where = await this.applyRoleScope(where, user);

    const [tickets, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        include: this.includeOptions,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.ticket.count({ where }),
    ]);

    return {
      tickets: tickets.map((t) => this.addSla(t)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { OR: [{ id }, { ticketId: id }] },
      include: {
        ...this.includeOptions,
        comments: {
          include: { author: { select: { id: true, name: true, avatar: true, role: true } } },
          orderBy: { createdAt: 'asc' },
        },
        attachments: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return this.addSla(ticket);
  }

  async create(data: any, userId: string, user?: any) {
    // Extract assigneeIds before passing data to Prisma (not a real Ticket column)
    let assigneeIds: string[] = Array.isArray(data.assigneeIds) ? data.assigneeIds : [];
    delete data.assigneeIds;

    // Enforce self-assign for EMPLOYEE / INTERN
    const creatorRole: string = user?.role?.name ?? user?.role ?? '';
    if (['EMPLOYEE', 'INTERN'].includes(creatorRole)) {
      data.assignedToId = userId;
      assigneeIds = [userId];
    }

    // Resolve departmentId: accept display name or UUID
    if (data.departmentId && !isUUID(data.departmentId)) {
      const dept = await this.prisma.department.findFirst({
        where: { name: { equals: data.departmentId, mode: 'insensitive' } },
      });
      data.departmentId = dept?.id ?? undefined;
    }
    // Resolve assignedToId: accept display name or UUID
    if (data.assignedToId && !isUUID(data.assignedToId)) {
      const assignee = await this.prisma.user.findFirst({
        where: { name: { equals: data.assignedToId, mode: 'insensitive' } },
      });
      data.assignedToId = assignee?.id ?? undefined;
    }
    // Null out empty string fields so Prisma doesn't try to set '' on non-String columns
    if (!data.projectId) data.projectId = undefined;
    if (!data.departmentId) data.departmentId = undefined;
    if (!data.assignedToId) data.assignedToId = undefined;
    if (!data.taskTypeId) data.taskTypeId = undefined;
    // Handle custom subtype: if taskSubtypeId is '__custom__', clear it and use customSubtypeText
    if (data.taskSubtypeId === '__custom__' || data.taskSubtypeId === 'custom') {
      data.taskSubtypeId = null;
      // customSubtypeText is passed through as-is
    } else {
      if (!data.taskSubtypeId) data.taskSubtypeId = undefined;
      // Clear customSubtypeText when a real subtype is chosen
      if (data.taskSubtypeId) data.customSubtypeText = null;
    }
    // Normalize date inputs — date-only strings → 18:30 IST (13:00 UTC)
    for (const field of ['dueDate', 'scheduledFor', 'scheduleEndDate']) {
      if (data[field]) data[field] = this.normalizeDateInput(data[field])?.toISOString();
    }
    for (const field of ['scheduledStartAt', 'scheduledEndAt', 'actualStartAt', 'actualCompletedAt']) {
      if (data[field]) data[field] = this.normalizeDateInput(data[field]);
    }
    if (data.estimatedMinutes !== undefined && data.estimatedMinutes !== null && data.estimatedMinutes !== '') {
      data.estimatedMinutes = parseInt(data.estimatedMinutes, 10);
    } else if (data.estimatedMinutes === '') {
      data.estimatedMinutes = undefined;
    }

    // Pre-compute executionDueAt if enough info is provided at creation time
    const executionDueAt = this.calcExecutionDueAt(
      data.scheduledStartAt,
      data.actualStartAt,
      data.estimatedMinutes,
    );
    if (executionDueAt) data.executionDueAt = executionDueAt;

    // Generate a collision-safe ticket ID by retrying on unique-constraint violations (P2002)
    let ticket: any;
    let attempts = 0;
    while (attempts < 10) {
      const count = await this.prisma.ticket.count();
      const ticketId = `TKT-${String(count + 1 + attempts).padStart(3, '0')}`;
      try {
        ticket = await this.prisma.ticket.create({
          data: { ...data, ticketId, createdById: userId },
          include: this.includeOptions,
        });
        break;
      } catch (err: any) {
        // P2002 = unique constraint violation — ID was taken by a concurrent insert, retry
        if (err?.code === 'P2002' && err?.meta?.target?.includes('ticketId')) {
          attempts++;
          continue;
        }
        console.error('TICKET CREATE ERROR:', { message: err?.message, code: err?.code, meta: err?.meta });
        throw new BadRequestException(err?.message ?? 'Failed to create ticket');
      }
    }
    if (!ticket) {
      throw new BadRequestException('Failed to generate a unique ticket ID — please try again');
    }

    // Create multiple assignees if provided
    if (assigneeIds.length > 0) {
      await this.prisma.ticketAssignee.createMany({
        data: assigneeIds.map((uid) => ({ ticketId: ticket.id, userId: uid })),
        skipDuplicates: true,
      });
      // Notify each additional assignee
      const creator = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
      for (const uid of assigneeIds) {
        if (uid === ticket.assignedToId) continue; // primary assignee notified below
        try {
          await this.notificationsService.create(
            uid,
            `New ticket assigned: ${ticket.ticketId}`,
            ticket.title,
            NotificationType.INFO,
            `/tickets/${ticket.id}`,
            ticket.id,
            'TICKET',
          );
          this.gateway.emitNotificationToUser(uid, {
            title: `New ticket assigned: ${ticket.ticketId}`,
            message: ticket.title,
          });
        } catch (_e) { /* never crash main op */ }
      }
    }

    await this.prisma.activityLog.create({
      data: {
        userId,
        action: 'TICKET_CREATED',
        entityType: 'TICKET',
        entityId: ticket.id,
        details: { ticketId: ticket.ticketId, title: ticket.title, category: ticket.category, priority: ticket.priority },
      },
    });

    this.eventLogger.log({ actorId: userId, entityType: 'Ticket', entityId: ticket.id, action: OperationalAction.TICKET_CREATED, toState: 'OPEN', metadata: { ticketId: ticket.ticketId, title: ticket.title } }).catch(() => {});
    this.gateway.emitTicketCreated(ticket);
    this.eventEmitter.emit('ticket.created', { ticket, userId });

    if (ticket.assignedTo) {
      const creator = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
      await Promise.all([
        this.notificationsService.create(
          ticket.assignedTo.id,
          `New ticket assigned: ${ticket.ticketId}`,
          `${ticket.title}`,
          NotificationType.INFO,
          `/tickets/${ticket.id}`,
          ticket.id,
          'TICKET',
        ),
        this.emailService.sendTicketAssigned(
          ticket.assignedTo.email,
          ticket.ticketId,
          ticket.title,
          creator?.name ?? 'Someone',
          this.frontendUrl,
        ),
      ]);
      this.gateway.emitNotificationToUser(ticket.assignedTo.id, {
        title: `New ticket assigned: ${ticket.ticketId}`,
        message: ticket.title,
      });
    }

    return this.addSla(ticket);
  }

  async update(id: string, data: any, userId: string, user?: any) {
    // Extract assigneeIds (not a Ticket column)
    const assigneeIds: string[] | undefined = Array.isArray(data.assigneeIds) ? data.assigneeIds : undefined;
    delete data.assigneeIds;

    // Handle custom subtype on update
    if (data.taskSubtypeId === '__custom__' || data.taskSubtypeId === 'custom') {
      data.taskSubtypeId = null;
    } else if (data.taskSubtypeId) {
      data.customSubtypeText = null; // clear custom text when real subtype chosen
    }

    // Normalize date inputs — date-only strings → 18:30 IST (13:00 UTC)
    for (const field of ['dueDate', 'scheduledFor', 'scheduleEndDate']) {
      if (data[field]) data[field] = this.normalizeDateInput(data[field])?.toISOString();
    }
    for (const field of ['scheduledStartAt', 'scheduledEndAt', 'actualStartAt', 'actualCompletedAt']) {
      if (data[field]) data[field] = this.normalizeDateInput(data[field]);
    }
    if (data.estimatedMinutes !== undefined && data.estimatedMinutes !== null && data.estimatedMinutes !== '') {
      data.estimatedMinutes = parseInt(data.estimatedMinutes, 10);
    } else if (data.estimatedMinutes === '') {
      data.estimatedMinutes = undefined;
    }

    const existing = await this.prisma.ticket.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Ticket not found');

    // Permission: only assignee, reporter, or Manager+ can update
    if (user) {
      const roleName: string = user?.role?.name ?? user?.role ?? '';
      const isManagerPlus = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleName);
      const isParticipant = existing.assignedToId === userId || existing.createdById === userId;
      if (!isManagerPlus && !isParticipant) {
        throw new ForbiddenException('Only the assignee, reporter or a manager can update this ticket');
      }
      // INTERN cannot move directly from OPEN to DONE/REVIEW
      if (roleName === 'INTERN' && data.status) {
        const allowed = data.status === 'IN_PROGRESS';
        if (!allowed) {
          throw new ForbiddenException('Interns can only move tickets to IN_PROGRESS');
        }
      }
      // REVIEW → DONE requires Manager+
      if (data.status === 'DONE' && existing.status === 'REVIEW' && !isManagerPlus) {
        throw new ForbiddenException('Only managers can close tickets in review');
      }
    }

    // ── Execution timer: stamp actualStartAt + executionDueAt ────────────────
    if (data.status === TicketStatus.IN_PROGRESS && !existing.actualStartAt && !data.actualStartAt) {
      data.actualStartAt = new Date();
    }
    if (data.status === TicketStatus.IN_PROGRESS && !existing.executionDueAt) {
      const base: Date = existing.scheduledStartAt ?? data.actualStartAt ?? new Date();
      const mins: number | null | undefined = existing.estimatedMinutes;
      const due = this.calcExecutionDueAt(base, null, mins);
      if (due) data.executionDueAt = due;
    }

    // ── Review timer: stamp submittedAt + reviewStartedAt + reviewDueAt ──────
    if (data.status === TicketStatus.REVIEW && !existing.submittedAt) {
      const now = new Date();
      data.submittedAt = now;
      data.reviewStartedAt = now;
      const reviewHours = await this.getReviewSlaHoursForPriority(existing.priority);
      data.reviewDueAt = new Date(now.getTime() + reviewHours * 3_600_000);
    }

    // ── Completion stamps ────────────────────────────────────────────────────
    if (data.status === TicketStatus.DONE) {
      if (!existing.actualCompletedAt && !data.actualCompletedAt) data.actualCompletedAt = new Date();
      if (!existing.closedAt) data.closedAt = new Date();
      data.resolvedAt = new Date();
    }

    if (data.status === TicketStatus.CLOSED) {
      if (!existing.actualCompletedAt && !data.actualCompletedAt) data.actualCompletedAt = new Date();
      if (!existing.closedAt) data.closedAt = new Date();
      if (!existing.cancelledAt) data.cancelledAt = new Date();
      data.resolvedAt = new Date();
    }

    // Track history for changed fields
    const trackedFields = ['status', 'assignedToId', 'priority', 'title'];
    const historyEntries = trackedFields
      .filter((f) => data[f] !== undefined && String(data[f]) !== String(existing[f]))
      .map((f) => ({
        ticketId: id,
        field: f,
        oldValue: existing[f] != null ? String(existing[f]) : null,
        newValue: data[f] != null ? String(data[f]) : null,
        changedById: userId,
      }));

    const ticket = await this.prisma.ticket.update({
      where: { id },
      data,
      include: this.includeOptions,
    });

    if (historyEntries.length > 0) {
      await this.prisma.ticketHistory.createMany({ data: historyEntries });
    }

    const action = data.status ? 'STATUS_CHANGED' : data.assignedToId ? 'TICKET_ASSIGNED' : 'TICKET_UPDATED';

    await this.prisma.activityLog.create({
      data: {
        userId,
        action,
        entityType: 'TICKET',
        entityId: ticket.id,
        details: {
          ticketId: ticket.ticketId,
          ...(data.status && { newStatus: data.status, previousStatus: existing.status }),
          ...(data.assignedToId && { assignedToId: data.assignedToId }),
        },
      },
    });

    if (data.status) {
      const statusActionMap: Record<string, OperationalAction> = {
        IN_PROGRESS: OperationalAction.TICKET_STARTED,
        REVIEW: OperationalAction.TICKET_SUBMITTED_FOR_REVIEW,
        DONE: OperationalAction.TICKET_DONE,
        CLOSED: OperationalAction.TICKET_CANCELLED,
      };
      const mappedAction = statusActionMap[data.status];
      if (mappedAction) {
        this.eventLogger.log({ actorId: userId, entityType: 'Ticket', entityId: ticket.id, action: mappedAction, fromState: existing.status, toState: data.status, metadata: { ticketId: ticket.ticketId } }).catch(() => {});
      }
      this.eventEmitter.emit('ticket.status_changed', {
        ticket,
        oldStatus: existing.status,
        newStatus: data.status,
        userId,
      });
      this.gateway.emitTicketStatusChanged(ticket.id, data.status, userId);

      if (data.status === TicketStatus.DONE || data.status === TicketStatus.CLOSED) {
        // Email resolved assignee
        if (ticket.assignedTo) {
          await this.emailService.sendTicketResolved(
            ticket.assignedTo.email,
            ticket.ticketId,
            ticket.title,
            this.frontendUrl,
          );
        }
        // Notify reporter (createdBy) that their ticket is done
        if (existing.createdById && existing.createdById !== userId) {
          try {
            await this.notificationsService.create(
              existing.createdById,
              `Ticket resolved: ${ticket.ticketId}`,
              `${ticket.title} has been marked ${data.status}`,
              NotificationType.SUCCESS,
              `/tickets/${ticket.id}`,
              ticket.id,
              'TICKET',
            );
            this.gateway.emitNotificationToUser(existing.createdById, {
              title: `Ticket resolved: ${ticket.ticketId}`,
              message: `${ticket.title} has been marked ${data.status}`,
            });
          } catch (_e) { /* never crash main operation */ }
        }
      }
    }

    if (data.assignedToId && data.assignedToId !== existing.assignedToId && ticket.assignedTo) {
      this.eventEmitter.emit('ticket.assigned', {
        ticket,
        assigneeId: data.assignedToId,
        assignedBy: userId,
      });
      const updater = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
      await Promise.all([
        this.notificationsService.create(
          ticket.assignedTo.id,
          `Ticket assigned to you: ${ticket.ticketId}`,
          ticket.title,
          NotificationType.INFO,
          `/tickets/${ticket.id}`,
          ticket.id,
          'TICKET',
        ),
        this.emailService.sendTicketAssigned(
          ticket.assignedTo.email,
          ticket.ticketId,
          ticket.title,
          updater?.name ?? 'Someone',
          this.frontendUrl,
        ),
      ]);
      this.gateway.emitNotificationToUser(ticket.assignedTo.id, {
        title: `Ticket assigned to you: ${ticket.ticketId}`,
        message: ticket.title,
      });
    }

    // Update multiple assignees if provided
    if (assigneeIds !== undefined) {
      await this.prisma.ticketAssignee.deleteMany({ where: { ticketId: id } });
      if (assigneeIds.length > 0) {
        await this.prisma.ticketAssignee.createMany({
          data: assigneeIds.map((uid) => ({ ticketId: id, userId: uid })),
          skipDuplicates: true,
        });
      }
    }

    return this.addSla(ticket);
  }

  async updateStatus(id: string, status: TicketStatus, userId: string, user?: any) {
    return this.update(id, { status }, userId, user);
  }

  async assign(id: string, assignedToId: string, userId: string, user?: any) {
    return this.update(id, { assignedToId }, userId, user);
  }

  async approve(id: string, userId: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status !== TicketStatus.REVIEW) {
      throw new ForbiddenException('Only tickets in REVIEW status can be approved');
    }

    const updated = await this.update(id, { status: TicketStatus.DONE }, userId);

    // Notify reporter
    await this.notificationsService.create(
      ticket.createdById,
      `Ticket approved: ${ticket.ticketId}`,
      ticket.title,
      NotificationType.SUCCESS,
      `/tickets/${ticket.id}`,
      ticket.id,
      'TICKET',
    );
    this.gateway.emitNotificationToUser(ticket.createdById, {
      title: `Ticket approved: ${ticket.ticketId}`,
      message: ticket.title,
    });

    return updated;
  }

  async reject(id: string, comment: string, userId: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status !== TicketStatus.REVIEW) {
      throw new ForbiddenException('Only tickets in REVIEW status can be rejected');
    }

    const [updated] = await Promise.all([
      this.update(id, { status: TicketStatus.IN_PROGRESS }, userId),
      this.prisma.comment.create({
        data: {
          ticketId: id,
          authorId: userId,
          content: `[REJECTED] ${comment}`,
        },
      }),
    ]);

    await this.notificationsService.create(
      ticket.createdById,
      `Ticket rejected: ${ticket.ticketId}`,
      ticket.title,
      NotificationType.WARNING,
      `/tickets/${ticket.id}`,
      ticket.id,
      'TICKET',
    );
    this.gateway.emitNotificationToUser(ticket.createdById, {
      title: `Ticket rejected: ${ticket.ticketId}`,
      message: ticket.title,
    });

    return updated;
  }

  async getHistory(id: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { OR: [{ id }, { ticketId: id }] },
      select: { id: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    return this.prisma.ticketHistory.findMany({
      where: { ticketId: ticket.id },
      include: { changedBy: { select: { id: true, name: true, avatar: true } } },
      orderBy: { changedAt: 'desc' },
    });
  }

  async exportCsv(query: any, user?: any) {
    const { tickets } = await this.findAll({ ...query, limit: 10000, page: 1 }, user);

    const safeStr = (v: any) => {
      const s = v == null ? '' : String(v);
      // Always quote and escape — works for cells containing commas, newlines, quotes
      return `"${s.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
    };

    const headers = [
      'Ticket ID', 'Title', 'Category', 'Type', 'Priority', 'Status',
      'Assigned To', 'Reporter', 'Department', 'Project',
      'Due Date', 'Estimated Hours', 'Elapsed Hours', 'SLA %', 'Overdue',
      'Created At', 'Updated At',
    ];

    const rows = tickets.map((t: any) => [
      safeStr(t.ticketId),
      safeStr(t.title),
      safeStr(t.category),
      safeStr(t.type),
      safeStr(t.priority),
      safeStr(t.status),
      safeStr(t.assignedTo?.name ?? 'Unassigned'),
      safeStr(t.createdBy?.name ?? ''),
      safeStr(t.department?.name ?? ''),
      safeStr(t.project?.name ?? 'No project'),
      safeStr(t.dueDate ? new Date(t.dueDate).toISOString().split('T')[0] : ''),
      safeStr(t.estimatedTime ?? ''),
      safeStr(t.elapsedHours ?? ''),
      safeStr(t.slaPercent ?? ''),
      safeStr(t.isOverdue ? 'Yes' : 'No'),
      safeStr(new Date(t.createdAt).toISOString().split('T')[0]),
      safeStr(new Date(t.updatedAt).toISOString().split('T')[0]),
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  async remove(id: string, userId?: string) {
    if (userId) {
      this.eventLogger.log({ actorId: userId, entityType: 'Ticket', entityId: id, action: OperationalAction.TICKET_DELETED }).catch(() => {});
    }
    return this.prisma.ticket.delete({ where: { id } });
  }

  async getStats(user?: any) {
    const scope = user ? await this.applyRoleScope({}, user) : {};
    const overdueScope = { ...scope, dueDate: { lt: new Date() }, status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] } };
    const unassignedScope = { ...scope, assignedToId: null };

    const [total, byStatus, byCategory, byPriority, overdue, unassigned] = await Promise.all([
      this.prisma.ticket.count({ where: scope }),
      this.prisma.ticket.groupBy({ by: ['status'], where: scope, _count: true }),
      this.prisma.ticket.groupBy({ by: ['category'], where: scope, _count: true }),
      this.prisma.ticket.groupBy({ by: ['priority'], where: scope, _count: true }),
      this.prisma.ticket.count({ where: overdueScope }),
      this.prisma.ticket.count({ where: unassignedScope }),
    ]);

    return { total, byStatus, byCategory, byPriority, overdue, unassigned };
  }

  async getKanban(filters: { departmentId?: string; department?: string; projectId?: string; assignedToId?: string }, user?: any) {
    let where: any = { status: { notIn: [TicketStatus.CLOSED] } };
    const deptId = await this.resolveDeptFilter(filters.departmentId || filters.department);
    if (deptId) where.departmentId = deptId;
    if (filters.projectId) where.projectId = filters.projectId;
    if (filters.assignedToId) where.assignedToId = filters.assignedToId;
    where = await this.applyRoleScope(where, user);

    const tickets = await this.prisma.ticket.findMany({
      where,
      include: this.includeOptions,
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });

    const withSla = tickets.map((t) => this.addSla(t));

    return {
      OPEN: withSla.filter((t) => t.status === TicketStatus.OPEN),
      IN_PROGRESS: withSla.filter((t) => t.status === TicketStatus.IN_PROGRESS),
      REVIEW: withSla.filter((t) => t.status === TicketStatus.REVIEW),
      DONE: withSla.filter((t) => t.status === TicketStatus.DONE),
    };
  }
}
