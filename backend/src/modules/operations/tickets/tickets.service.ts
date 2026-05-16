import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../prisma/prisma.service';
import { TicketStatus, NotificationType } from '@prisma/client';
import { EventsGateway } from '../../platform/gateway/events.gateway';
import { EmailService } from '../../platform/email/email.service';
import { NotificationsService } from '../notifications/notifications.service';

function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

const SLA_HOURS: Record<string, number> = {
  URGENT: 4,
  HIGH: 8,
  MEDIUM: 24,
  LOW: 72,
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
  ) {}

  private get frontendUrl() {
    return this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
  }

  private includeOptions = {
    assignedTo: { select: { id: true, name: true, email: true, avatar: true } },
    createdBy: { select: { id: true, name: true, email: true, avatar: true } },
    department: true,
    project: { select: { id: true, projectId: true, name: true } },
    _count: { select: { comments: true } },
  };

  private addSla(ticket: any) {
    const slaHours = SLA_HOURS[ticket.priority] ?? 24;
    const elapsed = (Date.now() - new Date(ticket.createdAt).getTime()) / 3600000;
    const slaPercent = Math.min(Math.round((elapsed / slaHours) * 100), 100);
    const isOverdue =
      elapsed > slaHours && !['DONE', 'CLOSED'].includes(ticket.status);
    return {
      ...ticket,
      slaHours,
      elapsedHours: Math.round(elapsed * 10) / 10,
      slaPercent,
      isOverdue,
    };
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
    // Manager / TeamLead → scope to their department
    if (['MANAGER', 'TEAM_LEAD'].includes(roleName)) {
      if (user.departmentId) {
        // TL also sees tickets they created themselves, even outside dept
        if (roleName === 'TEAM_LEAD') {
          where.OR = [
            { departmentId: user.departmentId },
            { createdById: user.id },
            { assignedToId: user.id },
          ];
        } else {
          where.departmentId = user.departmentId;
        }
      }
      return where;
    }
    // Employee / Intern → only their own tickets
    where.OR = [{ assignedToId: user.id }, { createdById: user.id }];
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
        attachments: true,
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return this.addSla(ticket);
  }

  async create(data: any, userId: string) {
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
    // Null out empty projectId so Prisma doesn't try to connect to ''
    if (!data.projectId) data.projectId = undefined;

    const count = await this.prisma.ticket.count();
    const ticketId = `TKT-${String(count + 1).padStart(3, '0')}`;

    let ticket: any;
    try {
      ticket = await this.prisma.ticket.create({
        data: { ...data, ticketId, createdById: userId },
        include: this.includeOptions,
      });
    } catch (err: any) {
      throw new BadRequestException(err?.message ?? 'Failed to create ticket');
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

    if (data.status === TicketStatus.DONE || data.status === TicketStatus.CLOSED) {
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

  async remove(id: string) {
    return this.prisma.ticket.delete({ where: { id } });
  }

  async getStats() {
    const [total, byStatus, byCategory, byPriority, overdue, unassigned] = await Promise.all([
      this.prisma.ticket.count(),
      this.prisma.ticket.groupBy({ by: ['status'], _count: true }),
      this.prisma.ticket.groupBy({ by: ['category'], _count: true }),
      this.prisma.ticket.groupBy({ by: ['priority'], _count: true }),
      this.prisma.ticket.count({
        where: { dueDate: { lt: new Date() }, status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] } },
      }),
      this.prisma.ticket.count({ where: { assignedToId: null } }),
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
