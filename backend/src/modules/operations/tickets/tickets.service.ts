import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../prisma/prisma.service';
import { TicketStatus, NotificationType } from '@prisma/client';
import { EventsGateway } from '../../platform/gateway/events.gateway';
import { EmailService } from '../../platform/email/email.service';
import { NotificationEventService } from '../notifications/notification-event.service';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';
import { TicketAccessService } from '../../../common/services/ticket-access.service';
import { TicketTimingService } from '../../../common/services/ticket-timing.service';
import { TicketLedgerService } from './ticket-ledger.service';

function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// SLA hours are read from DB via TicketTimingService.getSlaConfig() — no local constants needed.

@Injectable()
export class TicketsService {
  constructor(
    private prisma: PrismaService,
    private gateway: EventsGateway,
    private emailService: EmailService,
    private notificationEventService: NotificationEventService,
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
    private eventLogger: EventLoggerService,
    private ticketAccess: TicketAccessService,
    private ticketTiming: TicketTimingService,
    private ticketLedger: TicketLedgerService,
  ) {}

  private get frontendUrl() {
    return this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
  }

  private andWhere(...clauses: any[]) {
    const parts = clauses.filter((clause) => clause && Object.keys(clause).length > 0);
    if (parts.length === 0) return {};
    if (parts.length === 1) return parts[0];
    return { AND: parts };
  }

  private includeOptions = {
    assignedTo: { select: { id: true, name: true, email: true, avatar: true } },
    createdBy: { select: { id: true, name: true, email: true, avatar: true } },
    department: true,
    project: { select: { id: true, projectId: true, name: true } },
    assignees: { include: { user: { select: { id: true, name: true, avatar: true } } } },
    taskType: true,
    taskSubtype: true,
    comments: {
      take: 1,
      orderBy: { createdAt: 'desc' } as any,
      select: { content: true, createdAt: true, author: { select: { id: true, name: true } } }
    },
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

  /** Query review SLA from TicketTimingService (DB-backed with fallback to defaults). */
  private async getReviewSlaHoursForPriority(priority: string): Promise<number> {
    const { review } = await this.ticketTiming.getSlaConfig();
    return review[priority] ?? 24;
  }

  private async addSla(ticket: any) {
    return this.ticketTiming.decorateTicket(this.sanitizeTicketForResponse(ticket));
  }

  private async addSlaMany(tickets: any[]) {
    return this.ticketTiming.decorateTickets(tickets.map((ticket) => this.sanitizeTicketForResponse(ticket)));
  }

  sanitizeAttachmentForResponse(ticketId: string, attachment: any) {
    if (!attachment) return attachment;
    const safe = { ...attachment };
    delete safe.url;
    return {
      ...safe,
      previewUrl: `/api/tickets/${ticketId}/attachments/${attachment.id}/download?mode=inline`,
      downloadUrl: `/api/tickets/${ticketId}/attachments/${attachment.id}/download?mode=download`,
    };
  }

  private sanitizeTicketForResponse(ticket: any) {
    if (!ticket?.attachments) return ticket;
    return {
      ...ticket,
      attachments: ticket.attachments.map((attachment: any) =>
        this.sanitizeAttachmentForResponse(ticket.id, attachment),
      ),
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
    overdue?: string | boolean;
    risk?: string;
    filter?: string;
    blocked?: string | boolean;
    isBlocked?: string | boolean;
    projectStageId?: string;
    page?: number;
    limit?: number;
  }, user?: any) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;
    const where = await this.ticketAccess.buildTicketWhereForUser(query, user);

    // isBlocked / blocked filter — show only blocked tickets
    const blockedFilter = query.blocked === true || query.blocked === 'true'
      || query.isBlocked === true || query.isBlocked === 'true';
    if (blockedFilter) {
      (where as any).isBlocked = true;
    }

    // projectStageId filter — show tickets in a specific project stage (FP-14B)
    if (query.projectStageId) {
      (where as any).projectStageId = query.projectStageId === 'null' ? null : query.projectStageId;
    }

    const needsTimingFilter = query.overdue === true || query.overdue === 'true' || query.risk === 'overdue' || query.filter === 'overdue';

    if (needsTimingFilter) {
      const candidates = await this.prisma.ticket.findMany({
        where: this.andWhere(where, { status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] } }),
        include: this.includeOptions,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      });
      const withSla = await this.addSlaMany(candidates);
      const overdueTickets = withSla.filter((ticket: any) => ticket.timing?.isOverdue ?? ticket.isOverdue);
      return {
        tickets: overdueTickets.slice(skip, skip + limit),
        total: overdueTickets.length,
        page,
        limit,
        totalPages: Math.ceil(overdueTickets.length / limit),
      };
    }

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
      tickets: await this.addSlaMany(tickets),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string, user?: any) {
    const include: any = {
      ...this.includeOptions,
      comments: {
        include: { author: { select: { id: true, name: true, avatar: true, role: true } } },
        orderBy: { createdAt: 'asc' },
      },
      attachments: { orderBy: { createdAt: 'desc' } },
      reviewCycles: {
        include: { assignee: { select: { name: true } }, reviewer: { select: { name: true } } },
        orderBy: { cycleNo: 'desc' },
      },
    };
    const ticket = user
      ? await this.ticketAccess.findAccessibleTicket(id, user, include)
      : await this.prisma.ticket.findFirst({ where: { OR: [{ id }, { ticketId: id }] }, include });
    if (!ticket) throw new NotFoundException('Ticket not found');
    const enriched = await this.addSla(ticket);
    const timers = await this.ticketLedger.getTicketTimers(ticket);
    const reworkLabel = enriched.reworkCount > 0 ? `Rework ${enriched.reworkCount}` : null;
    return { ...enriched, timers, reworkLabel };
  }

  async assertCanUploadAttachment(user: any, ticket: any) {
    return this.ticketAccess.assertCanUploadAttachment(user, ticket);
  }

  async getAttachmentForDownload(ticketId: string, attachmentId: string, user: any) {
    const ticket = user
      ? await this.ticketAccess.findAccessibleTicket(ticketId, user, { attachments: true })
      : await this.prisma.ticket.findFirst({
        where: { OR: [{ id: ticketId }, { ticketId }] },
        include: { attachments: true },
      });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const attachment = await this.prisma.attachment.findFirst({
      where: { id: attachmentId, ticketId: ticket.id },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    return attachment;
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
    // Only set executionDueAt if scheduledStartAt is in the future (not past midnight UTC edge cases)
    const scheduledBase = data.scheduledStartAt ? new Date(data.scheduledStartAt) : null;
    const actualBase = data.actualStartAt ? new Date(data.actualStartAt) : null;
    const baseForExec = scheduledBase && scheduledBase.getTime() > Date.now() ? scheduledBase : null;
    const executionDueAt = this.calcExecutionDueAt(
      baseForExec,
      actualBase,
      data.estimatedMinutes,
    );
    // Never store an executionDueAt that is already in the past
    if (executionDueAt && executionDueAt.getTime() > Date.now()) {
      data.executionDueAt = executionDueAt;
    }

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
      for (const uid of assigneeIds) {
        if (uid === ticket.assignedToId) continue; // primary assignee notified below
        try {
          await this.notificationEventService.sendNotification(
            uid,
            'assignedTicket',
            {
              title: `New ticket assigned: ${ticket.ticketId}`,
              message: ticket.title,
              type: NotificationType.INFO,
              link: `/tickets/${ticket.id}`,
              entityId: ticket.id,
              entityType: 'TICKET',
            }
          );
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
      try {
        await this.notificationEventService.sendNotification(
          ticket.assignedTo.id,
          'assignedTicket',
          {
            title: `New ticket assigned: ${ticket.ticketId}`,
            message: ticket.title,
            type: NotificationType.INFO,
            link: `/tickets/${ticket.id}`,
            entityId: ticket.id,
            entityType: 'TICKET',
          }
        );
      } catch (_e) { /* never crash main op */ }
      try {
        await this.emailService.sendTicketAssigned(
          ticket.assignedTo.email,
          ticket.ticketId,
          ticket.title,
          creator?.name ?? 'Someone',
          this.frontendUrl,
        );
      } catch (_e) { /* never crash main op */ }
    }

    return this.addSla(ticket);
  }

  async update(id: string, data: any, userId: string, user?: any, opts?: { suppressCompletionNotification?: boolean }) {
    // Extract assigneeIds (not a Ticket column)
    const assigneeIds: string[] | undefined = Array.isArray(data.assigneeIds) ? data.assigneeIds : undefined;
    delete data.assigneeIds;

    // FP-14B: Validate projectStageId assignment — stage must belong to same project as ticket
    if (data.projectStageId !== undefined && data.projectStageId !== null) {
      const stage = await this.prisma.projectStage.findUnique({ where: { id: data.projectStageId } });
      if (!stage) throw new NotFoundException('Project stage not found');
      // The ticket's projectId is resolved below; we pre-check here if already known
      // Full cross-project check is enforced when we read the existing ticket
    }

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

    const existing = user
      ? await this.ticketAccess.findAccessibleTicket(id, user, { assignees: true })
      : await this.prisma.ticket.findFirst({ where: { OR: [{ id }, { ticketId: id }] }, include: { assignees: true } });
    if (!existing) throw new NotFoundException('Ticket not found');
    const ticketDbId = existing.id;

    // FP-14B: Cross-project stage validation — stage must belong to same project as ticket
    if (data.projectStageId !== undefined && data.projectStageId !== null) {
      const stage = await this.prisma.projectStage.findUnique({ where: { id: data.projectStageId } });
      if (!stage) throw new NotFoundException('Project stage not found');
      if (!existing.projectId) {
        throw new BadRequestException('Cannot assign a stage to a ticket that is not linked to a project');
      }
      if (stage.projectId !== existing.projectId) {
        throw new BadRequestException('Stage does not belong to the same project as this ticket');
      }
    }

    if (existing.status === TicketStatus.CLOSED) {
      throw new BadRequestException('Cannot modify a closed ticket');
    }

    if (existing.status === TicketStatus.DONE && data.assignedToId !== undefined && data.assignedToId !== existing.assignedToId) {
      const isReopening = data.status && ['OPEN', 'IN_PROGRESS'].includes(data.status);
      if (!isReopening) {
        throw new BadRequestException('Cannot reassign a DONE ticket unless it is reopened first');
      }
    }

    if (data.status === TicketStatus.REVIEW || data.status === TicketStatus.DONE) {
      const dbActor = await this.prisma.user.findUnique({ where: { id: userId }, select: { currentStatus: true } });
      if (dbActor && (dbActor.currentStatus === 'ON_BREAK' || dbActor.currentStatus === 'LOGGED_OUT')) {
        throw new BadRequestException('Resume work before submitting or completing a ticket.');
      }
    }

    if (user) {
      if (data.assignedToId !== undefined) {
        await this.ticketAccess.assertCanAssignTicket(user, existing, data.assignedToId);
      }
      if (assigneeIds !== undefined) {
        for (const assigneeId of assigneeIds) {
          await this.ticketAccess.assertCanAssignTicket(user, existing, assigneeId);
        }
      }
      if (data.status) {
        await this.ticketAccess.assertCanTransitionTicket(user, existing, data.status, data);
      } else {
        await this.ticketAccess.assertCanUpdateTicket(user, existing, data);
      }
    }

    // ── REVIEW → IN_PROGRESS (rework): reset review stamps + recalculate executionDueAt ──
    if (data.status === TicketStatus.IN_PROGRESS && existing.status === TicketStatus.REVIEW) {
      data.submittedAt = null;
      data.reviewStartedAt = null;
      data.reviewDueAt = null;
      data.actualStartAt = existing.actualStartAt ?? new Date();
      if (existing.estimatedMinutes) {
        data.executionDueAt = new Date(Date.now() + existing.estimatedMinutes * 60_000);
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

    // ── Recalculate executionDueAt when estimatedMinutes is updated ───────────
    if (data.estimatedMinutes !== undefined && !existing.submittedAt) {
      const baseTime = existing.actualStartAt || existing.scheduledStartAt;
      if (baseTime) {
        const newExecutionDueAt = new Date(
          new Date(baseTime).getTime() + data.estimatedMinutes * 60_000,
        );
        data.executionDueAt = newExecutionDueAt;
      }
    }

    // ── Review timer: stamp submittedAt + reviewStartedAt + reviewDueAt ──────
    if (data.status === TicketStatus.REVIEW && !existing.submittedAt) {
      const now = new Date();
      data.submittedAt = now;
      data.reviewStartedAt = now;
      const reviewHours = await this.getReviewSlaHoursForPriority(existing.priority);
      data.reviewDueAt = new Date(now.getTime() + reviewHours * 3_600_000);
      
      // Start the review cycle in the ledger
      await this.ticketLedger.startReviewCycle({
        ticketId: existing.id,
        assigneeId: existing.assignedToId,
        reviewStartedAt: now,
      });
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
        ticketId: ticketDbId,
        field: f,
        oldValue: existing[f] != null ? String(existing[f]) : null,
        newValue: data[f] != null ? String(data[f]) : null,
        changedById: userId,
      }));

    const ticket = await this.prisma.ticket.update({
      where: { id: ticketDbId },
      data,
      include: this.includeOptions,
    });

    if (historyEntries.length > 0) {
      await this.prisma.ticketHistory.createMany({ data: historyEntries });
    }

    const action = data.status ? 'STATUS_CHANGED' : data.assignedToId ? 'TICKET_ASSIGNED' : 'TICKET_UPDATED';
    // Non-status, non-assign edits → TICKET_UPDATED audit
    if (!data.status && !data.assignedToId) {
      this.eventLogger.log({ actorId: userId, entityType: 'Ticket', entityId: ticketDbId, action: OperationalAction.TICKET_UPDATED, metadata: { ticketId: existing.ticketId, fields: Object.keys(data) } }).catch(() => {});
    }

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
        CLOSED: OperationalAction.TICKET_CLOSED,
      };
      // Detect reopen: DONE/CLOSED → OPEN/IN_PROGRESS
      const isReopening = ['DONE', 'CLOSED'].includes(existing.status) &&
        ['OPEN', 'IN_PROGRESS'].includes(data.status);
      const mappedAction = isReopening
        ? OperationalAction.TICKET_REOPENED
        : (statusActionMap[data.status] ?? null);
      if (mappedAction) {
        this.eventLogger.log({ actorId: userId, entityType: 'Ticket', entityId: ticket.id, action: mappedAction, fromState: existing.status, toState: data.status, metadata: { ticketId: ticket.ticketId } }).catch(() => {});
      }

      // --- TICKET TIMER HOOKS ---
      if (data.status === TicketStatus.IN_PROGRESS && existing.status !== TicketStatus.IN_PROGRESS) {
        await this.ticketLedger.startWorkLog({
          ticketId: ticket.id,
          userId: ticket.assignedToId || userId,
          stage: 'IN_PROGRESS',
          ownerType: 'ASSIGNEE',
          source: 'TICKET_STATUS',
        });
      } else if (data.status === TicketStatus.REVIEW && existing.status === TicketStatus.IN_PROGRESS) {
        if (ticket.assignedToId) {
          await this.ticketLedger.endActiveLog({ ticketId: ticket.id, userId: ticket.assignedToId });
        }
        await this.ticketLedger.startWorkLog({
          ticketId: ticket.id,
          userId: userId,
          stage: 'REVIEW',
          ownerType: 'REVIEWER',
          source: 'TICKET_STATUS',
        });

        // NOTIFY REVIEWER
        try {
          let reviewerId = null;
          const creator = await this.prisma.user.findUnique({ where: { id: existing.createdById } });
          if (creator?.teamLeadName) {
            const tl = await this.prisma.user.findUnique({ where: { employeeId: creator.teamLeadName } });
            if (tl && tl.id !== userId) reviewerId = tl.id;
          }
          if (!reviewerId && creator?.reportingManager) {
            const mgr = await this.prisma.user.findUnique({ where: { employeeId: creator.reportingManager } });
            if (mgr && mgr.id !== userId) reviewerId = mgr.id;
          }
          
          if (reviewerId) {
            await this.notificationEventService.sendNotification(
              reviewerId,
              'statusChanged',
              {
                title: 'Ticket ready for review',
                message: `${ticket.ticketId} - ${ticket.title} has been submitted for your review.`,
                type: NotificationType.INFO,
                link: `/tickets/${ticket.id}`,
                entityId: ticket.id,
                entityType: 'TICKET',
              }
            );
          }
        } catch (_e) { /* ignore */ }
      } else if (data.status === TicketStatus.DONE || data.status === TicketStatus.CLOSED || data.status === TicketStatus.OPEN) {
        const activeLog = await this.ticketLedger.getActiveLogForTicket(ticket.id);
        if (activeLog) {
          await this.ticketLedger.endActiveLog({ logId: activeLog.id, pauseReason: data.status });
        }
      }
      // --------------------------

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
        // Notify reporter (createdBy) that their ticket is done.
        // Suppressed when called from approve() which sends its own targeted notification
        // to prevent duplicate "Ticket resolved" + "Ticket approved" spam to the same user.
        if (!opts?.suppressCompletionNotification && existing.createdById && existing.createdById !== userId) {
          try {
            await this.notificationEventService.sendNotification(
              existing.createdById,
              'ticketResolved',
              {
                title: `Ticket resolved: ${ticket.ticketId}`,
                message: `${ticket.title} has been marked ${data.status}`,
                type: NotificationType.SUCCESS,
                link: `/tickets/${ticket.id}`,
                entityId: ticket.id,
                entityType: 'TICKET',
              }
            );
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
      this.eventLogger.log({
        actorId: userId,
        entityType: 'Ticket',
        entityId: ticket.id,
        action: OperationalAction.TICKET_ASSIGNED,
        metadata: { ticketId: ticket.ticketId, assigneeId: data.assignedToId, assigneeName: ticket.assignedTo.name },
      }).catch(() => {});
      const updater = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
      try {
        if (ticket.assignedTo.id !== userId) {
          await this.notificationEventService.sendNotification(
            ticket.assignedTo.id,
            'assignedTicket',
            {
              title: 'Ticket assigned to you',
              message: `${ticket.ticketId} - ${ticket.title} has been assigned to you.`,
              type: NotificationType.INFO,
              link: `/tickets/${ticket.id}`,
              entityId: ticket.id,
              entityType: 'TICKET',
            }
          );
        }
        if (existing.assignedToId && existing.assignedToId !== ticket.assignedTo.id && existing.assignedToId !== userId) {
          await this.notificationEventService.sendNotification(
            existing.assignedToId,
            'assignedTicket',
            {
              title: 'Ticket reassigned',
              message: `${ticket.ticketId} - ${ticket.title} has been reassigned from you.`,
              type: NotificationType.INFO,
              link: `/tickets/${ticket.id}`,
              entityId: ticket.id,
              entityType: 'TICKET',
            }
          );
        }
      } catch (_e) { /* never crash main op */ }
      try {
        await this.emailService.sendTicketAssigned(
          ticket.assignedTo.email,
          ticket.ticketId,
          ticket.title,
          updater?.name ?? 'Someone',
          this.frontendUrl,
        );
      } catch (_e) { /* never crash main op */ }
    }

    // Update multiple assignees if provided
    if (assigneeIds !== undefined) {
      await this.prisma.ticketAssignee.deleteMany({ where: { ticketId: ticketDbId } });
      if (assigneeIds.length > 0) {
        await this.prisma.ticketAssignee.createMany({
          data: assigneeIds.map((uid) => ({ ticketId: ticketDbId, userId: uid })),
          skipDuplicates: true,
        });
      }
    }

    return this.addSla(ticket);
  }

  async updateStatus(id: string, status: TicketStatus, userId: string, user?: any) {
    return this.update(id, { status }, userId, user);
  }

  async blockTicket(id: string, reason: string, userId: string, user?: any) {
    if (!reason || reason.trim().length < 3) {
      throw new BadRequestException('A blocker reason of at least 3 characters is required');
    }
    const ticket = user
      ? await this.ticketAccess.findAccessibleTicket(id, user, { assignees: true })
      : await this.prisma.ticket.findFirst({ where: { OR: [{ id }, { ticketId: id }] }, include: { assignees: true } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if ([TicketStatus.DONE, TicketStatus.CLOSED].includes(ticket.status)) {
      throw new BadRequestException('Cannot block a completed or closed ticket');
    }
    if (ticket.isBlocked) throw new BadRequestException('Ticket is already blocked');
    if (user) await this.ticketAccess.assertCanBlockTicket(user, ticket);

    const updated = await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: { isBlocked: true, blockedAt: new Date(), blockedReason: reason.trim(), blockedById: userId },
      include: this.includeOptions,
    });

    await this.prisma.ticketHistory.create({
      data: { ticketId: ticket.id, field: 'isBlocked', oldValue: 'false', newValue: 'true', changedById: userId },
    });
    await this.prisma.activityLog.create({
      data: {
        userId,
        action: 'TICKET_BLOCKED',
        entityType: 'TICKET',
        entityId: ticket.id,
        details: { ticketId: ticket.ticketId, reason: reason.trim() },
      },
    });
    this.eventLogger.log({
      actorId: userId,
      entityType: 'Ticket',
      entityId: ticket.id,
      action: OperationalAction.TICKET_BLOCKED,
      fromState: ticket.status,
      metadata: { ticketId: ticket.ticketId, reason: reason.trim() },
    }).catch(() => {});
    this.gateway.emitTicketStatusChanged(ticket.id, 'BLOCKED', userId);

    // Notify assignee (if different from blocker) that their ticket is blocked
    if (ticket.assignedTo && ticket.assignedToId !== userId) {
      try {
        await this.notificationEventService.sendNotification(
          ticket.assignedToId,
          'ticketBlocked',
          {
            title: `Ticket blocked: ${ticket.ticketId}`,
            message: reason.trim(),
            type: NotificationType.WARNING,
            link: `/tickets/${ticket.id}`,
            entityId: ticket.id,
            entityType: 'TICKET',
          },
        );
      } catch (_e) { /* never crash main op */ }
    }
    // Notify creator (if different from blocker and assignee)
    if (ticket.createdById && ticket.createdById !== userId && ticket.createdById !== ticket.assignedToId) {
      try {
        await this.notificationEventService.sendNotification(
          ticket.createdById,
          'ticketBlocked',
          {
            title: `Ticket blocked: ${ticket.ticketId}`,
            message: reason.trim(),
            type: NotificationType.WARNING,
            link: `/tickets/${ticket.id}`,
            entityId: ticket.id,
            entityType: 'TICKET',
          },
        );
      } catch (_e) { /* never crash main op */ }
    }

    return this.addSla(updated);
  }

  async unblockTicket(id: string, userId: string, user?: any) {
    const ticket = user
      ? await this.ticketAccess.findAccessibleTicket(id, user, { assignees: true })
      : await this.prisma.ticket.findFirst({ where: { OR: [{ id }, { ticketId: id }] }, include: { assignees: true } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (!ticket.isBlocked) throw new BadRequestException('Ticket is not currently blocked');
    if (ticket.status === TicketStatus.CLOSED) {
      throw new BadRequestException('Cannot modify a closed ticket');
    }
    if (user) await this.ticketAccess.assertCanBlockTicket(user, ticket);

    const updated = await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: { isBlocked: false, blockedAt: null, blockedReason: null, blockedById: null },
      include: this.includeOptions,
    });

    await this.prisma.ticketHistory.create({
      data: { ticketId: ticket.id, field: 'isBlocked', oldValue: 'true', newValue: 'false', changedById: userId },
    });
    await this.prisma.activityLog.create({
      data: {
        userId,
        action: 'TICKET_UNBLOCKED',
        entityType: 'TICKET',
        entityId: ticket.id,
        details: { ticketId: ticket.ticketId },
      },
    });
    this.eventLogger.log({
      actorId: userId,
      entityType: 'Ticket',
      entityId: ticket.id,
      action: OperationalAction.TICKET_UNBLOCKED,
      fromState: 'BLOCKED',
      toState: ticket.status,
      metadata: { ticketId: ticket.ticketId },
    }).catch(() => {});
    this.gateway.emitTicketStatusChanged(ticket.id, ticket.status, userId);

    // Notify assignee that the blocker has been resolved
    if (ticket.assignedToId && ticket.assignedToId !== userId) {
      try {
        await this.notificationEventService.sendNotification(
          ticket.assignedToId,
          'ticketBlocked',
          {
            title: `Ticket unblocked: ${ticket.ticketId}`,
            message: `${ticket.title} is no longer blocked. Resume work.`,
            type: NotificationType.SUCCESS,
            link: `/tickets/${ticket.id}`,
            entityId: ticket.id,
            entityType: 'TICKET',
          },
        );
      } catch (_e) { /* never crash main op */ }
    }

    return this.addSla(updated);
  }

  async assign(id: string, assignedToId: string, userId: string, user?: any) {
    return this.update(id, { assignedToId }, userId, user);
  }

  async approve(id: string, ratings: { taskEfficiencyRating: number, employeePerformanceRating: number, employeeAttitudeRating: number, ratingComment?: string }, userId: string, user?: any) {
    const ticket = user
      ? await this.ticketAccess.findAccessibleTicket(id, user, { createdBy: { select: { id: true, name: true } }, assignees: true })
      : await this.prisma.ticket.findFirst({
      where: { OR: [{ id }, { ticketId: id }] },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status !== TicketStatus.REVIEW) {
      throw new ForbiddenException('Only tickets in REVIEW status can be approved');
    }
    
    if (!ratings.taskEfficiencyRating || !ratings.employeePerformanceRating || !ratings.employeeAttitudeRating) {
      throw new BadRequestException('All three ratings (Task Efficiency, Employee Performance, Employee Attitude) are required to approve.');
    }
    for (const r of [ratings.taskEfficiencyRating, ratings.employeePerformanceRating, ratings.employeeAttitudeRating]) {
      if (typeof r !== 'number' || r < 1 || r > 5) {
        throw new BadRequestException('Ratings must be integers between 1 and 5.');
      }
    }
    
    if (user) await this.ticketAccess.assertCanTransitionTicket(user, ticket, TicketStatus.DONE);

    const updated = await this.update(ticket.id, { status: TicketStatus.DONE }, userId, user, { suppressCompletionNotification: true });
    
    await this.ticketLedger.endReviewCycle({
      ticketId: ticket.id,
      decision: 'APPROVED',
      taskEfficiencyRating: ratings.taskEfficiencyRating,
      employeePerformanceRating: ratings.employeePerformanceRating,
      employeeAttitudeRating: ratings.employeeAttitudeRating,
      ratingComment: ratings.ratingComment,
    });

    try {
      await this.notificationEventService.sendNotification(
        ticket.createdById,
        'ticketResolved',
        {
          title: `Ticket approved: ${ticket.ticketId}`,
          message: ticket.title,
          type: NotificationType.SUCCESS,
          link: `/tickets/${ticket.id}`,
          entityId: ticket.id,
          entityType: 'TICKET',
        }
      );
    } catch (_e) { /* never crash main op */ }

    return updated;
  }

  async reject(id: string, comment: string, userId: string, user?: any) {
    const ticket = user
      ? await this.ticketAccess.findAccessibleTicket(id, user, { createdBy: { select: { id: true, name: true } }, assignees: true })
      : await this.prisma.ticket.findFirst({
      where: { OR: [{ id }, { ticketId: id }] },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status !== TicketStatus.REVIEW) {
      throw new ForbiddenException('Only tickets in REVIEW status can be rejected');
    }
    if (user) await this.ticketAccess.assertCanTransitionTicket(user, ticket, TicketStatus.OPEN);

    const [updated] = await Promise.all([
      this.update(ticket.id, { status: TicketStatus.OPEN }, userId, user),
      this.prisma.ticket.update({
        where: { id: ticket.id },
        data: { reworkCount: { increment: 1 } },
      }),
      this.prisma.comment.create({
        data: {
          ticketId: ticket.id,
          authorId: userId,
          content: `[REJECTED] ${comment}`,
        },
      }),
      this.ticketLedger.endReviewCycle({
        ticketId: ticket.id,
        decision: 'REWORK',
        feedback: comment,
        reworkStartedAt: new Date(),
      }),
    ]);

    try {
      await this.notificationEventService.sendNotification(
        ticket.createdById,
        'statusChanged',
        {
          title: `Ticket rejected: ${ticket.ticketId}`,
          message: ticket.title,
          type: NotificationType.WARNING,
          link: `/tickets/${ticket.id}`,
          entityId: ticket.id,
          entityType: 'TICKET',
        }
      );
    } catch (_e) { /* never crash main op */ }

    return updated;
  }

  async getHistory(id: string, user?: any) {
    const ticket = user
      ? await this.ticketAccess.findAccessibleTicket(id, user)
      : await this.prisma.ticket.findFirst({
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

  async remove(id: string, userId?: string, user?: any) {
    const ticket = user
      ? await this.ticketAccess.findAccessibleTicket(id, user)
      : await this.prisma.ticket.findFirst({ where: { OR: [{ id }, { ticketId: id }] } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status === TicketStatus.CLOSED) {
      throw new BadRequestException('Cannot delete a closed ticket');
    }
    if (user) await this.ticketAccess.assertCanDeleteTicket(user, ticket);
    if (userId) {
      this.eventLogger.log({ actorId: userId, entityType: 'Ticket', entityId: ticket.id, action: OperationalAction.TICKET_DELETED }).catch(() => {});
    }
    return this.prisma.ticket.delete({ where: { id: ticket.id } });
  }

  async getStats(user?: any) {
    const scope = await this.ticketAccess.buildTicketWhereForUser({}, user);
    const activeScope = this.andWhere(scope, { status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] } });
    const unassignedScope = this.andWhere(scope, { assignedToId: null });
    const blockedScope = this.andWhere(activeScope, { isBlocked: true });

    const [total, byStatus, byCategory, byPriority, overdueCandidates, unassigned, blocked] = await Promise.all([
      this.prisma.ticket.count({ where: scope }),
      this.prisma.ticket.groupBy({ by: ['status'], where: scope, _count: true }),
      this.prisma.ticket.groupBy({ by: ['category'], where: scope, _count: true }),
      this.prisma.ticket.groupBy({ by: ['priority'], where: scope, _count: true }),
      this.prisma.ticket.findMany({
        where: activeScope,
        select: {
          id: true, status: true, priority: true, dueDate: true, createdAt: true, updatedAt: true,
          scheduledStartAt: true, actualStartAt: true, estimatedMinutes: true, executionDueAt: true,
          submittedAt: true, reviewStartedAt: true, reviewDueAt: true, closedAt: true, cancelledAt: true,
          isBlocked: true, blockedAt: true, blockedReason: true,
        },
      }),
      this.prisma.ticket.count({ where: unassignedScope }),
      this.prisma.ticket.count({ where: blockedScope }),
    ]);
    const slaConfig = await this.ticketTiming.getSlaConfig();
    // Blocked tickets are NOT counted as overdue while the flag is set
    const overdue = overdueCandidates.filter((ticket) => this.ticketTiming.getTimingState(ticket, slaConfig).isOverdue).length;

    return { total, byStatus, byCategory, byPriority, overdue, unassigned, blocked };
  }

  async getKanban(filters: { departmentId?: string; department?: string; projectId?: string; assignedToId?: string }, user?: any) {
    const scopedWhere = await this.ticketAccess.buildTicketWhereForUser(filters, user);
    const where = this.andWhere(scopedWhere, { status: { notIn: [TicketStatus.CLOSED] } });

    const tickets = await this.prisma.ticket.findMany({
      where,
      include: this.includeOptions,
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });

    const withSla = await this.addSlaMany(tickets);

    return {
      OPEN: withSla.filter((t) => t.status === TicketStatus.OPEN),
      IN_PROGRESS: withSla.filter((t) => t.status === TicketStatus.IN_PROGRESS),
      REVIEW: withSla.filter((t) => t.status === TicketStatus.REVIEW),
      DONE: withSla.filter((t) => t.status === TicketStatus.DONE),
    };
  }

  /** SLA risk category counts — used by analytics and dashboard risk panels */
  async getSlaRiskCategories(user?: any): Promise<{
    overdue: number;
    dueSoon: number;
    reviewAgeing: number;
    unassigned: number;
    blocked: number;
    total: number;
  }> {
    const scope = await this.ticketAccess.buildTicketWhereForUser({}, user);
    const activeScope = this.andWhere(scope, {
      status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] },
    });

    const candidates = await this.prisma.ticket.findMany({
      where: activeScope,
      select: {
        id: true, status: true, priority: true, dueDate: true, createdAt: true, updatedAt: true,
        scheduledStartAt: true, actualStartAt: true, estimatedMinutes: true, executionDueAt: true,
        submittedAt: true, reviewStartedAt: true, reviewDueAt: true, closedAt: true, cancelledAt: true,
        assignedToId: true,
        isBlocked: true, blockedAt: true, blockedReason: true,
      },
    });

    const slaConfig = await this.ticketTiming.getSlaConfig();
    const DUE_SOON_MS = 4 * 3_600_000; // 4 hours

    let overdue = 0;
    let dueSoon = 0;
    let reviewAgeing = 0;
    let blocked = 0;

    for (const ticket of candidates) {
      if (ticket.isBlocked) {
        blocked++;
        continue; // blocked tickets are NOT counted as overdue or dueSoon
      }
      const timing = this.ticketTiming.getTimingState(ticket, slaConfig);
      if (timing.isOverdue) {
        overdue++;
      } else if (timing.timerType === 'review') {
        if (timing.remainingMs <= 0) reviewAgeing++;
        else if (timing.remainingMs <= DUE_SOON_MS) dueSoon++;
      } else if (timing.timerType === 'execution' && timing.remainingMs > 0 && timing.remainingMs <= DUE_SOON_MS) {
        dueSoon++;
      }
    }

    const unassigned = await this.prisma.ticket.count({
      where: this.andWhere(activeScope, { assignedToId: null }),
    });

    return { overdue, dueSoon, reviewAgeing, unassigned, blocked, total: candidates.length };
  }
}
