import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../prisma/prisma.service';
import { TicketStatus, NotificationType } from '@prisma/client';
import { EventsGateway } from '../../platform/gateway/events.gateway';
import { EmailService } from '../../platform/email/email.service';
import { NotificationsService } from '../notifications/notifications.service';

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

  async findAll(query: {
    search?: string;
    status?: string;
    category?: string;
    priority?: string;
    departmentId?: string;
    projectId?: string;
    assignedToId?: string;
    createdById?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const where: any = {};
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
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.projectId) where.projectId = query.projectId;
    if (query.assignedToId) where.assignedToId = query.assignedToId;
    if (query.createdById) where.createdById = query.createdById;

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
    const count = await this.prisma.ticket.count();
    const ticketId = `TKT-${String(count + 1).padStart(3, '0')}`;

    const ticket = await this.prisma.ticket.create({
      data: { ...data, ticketId, createdById: userId },
      include: this.includeOptions,
    });

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

  async update(id: string, data: any, userId: string) {
    const existing = await this.prisma.ticket.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Ticket not found');

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

  async updateStatus(id: string, status: TicketStatus, userId: string) {
    return this.update(id, { status }, userId);
  }

  async assign(id: string, assignedToId: string, userId: string) {
    return this.update(id, { assignedToId }, userId);
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

  async exportCsv(query: any) {
    const { tickets } = await this.findAll({ ...query, limit: 10000, page: 1 });

    const headers = [
      'Ticket ID', 'Title', 'Category', 'Type', 'Priority', 'Status',
      'Assigned To', 'Reporter', 'Department', 'Project',
      'Due Date', 'Estimated Hours', 'Elapsed Hours', 'SLA %', 'Overdue',
      'Created At', 'Updated At',
    ];

    const rows = tickets.map((t: any) => [
      t.ticketId,
      `"${(t.title ?? '').replace(/"/g, '""')}"`,
      t.category,
      t.type,
      t.priority,
      t.status,
      t.assignedTo?.name ?? '',
      t.createdBy?.name ?? '',
      t.department?.name ?? '',
      t.project?.name ?? '',
      t.dueDate ? new Date(t.dueDate).toISOString().split('T')[0] : '',
      t.estimatedTime ?? '',
      t.elapsedHours,
      t.slaPercent,
      t.isOverdue ? 'Yes' : 'No',
      new Date(t.createdAt).toISOString().split('T')[0],
      new Date(t.updatedAt).toISOString().split('T')[0],
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

  async getKanban(filters: { departmentId?: string; projectId?: string; assignedToId?: string }) {
    const where: any = { status: { notIn: [TicketStatus.CLOSED] } };
    if (filters.departmentId) where.departmentId = filters.departmentId;
    if (filters.projectId) where.projectId = filters.projectId;
    if (filters.assignedToId) where.assignedToId = filters.assignedToId;

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
