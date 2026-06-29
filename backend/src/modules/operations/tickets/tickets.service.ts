import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../prisma/prisma.service';
import { TicketStatus, NotificationType } from '@prisma/client';
import { EventsGateway } from '../../platform/gateway/events.gateway';
import { NotificationEventService } from '../notifications/notification-event.service';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';
import { TicketAccessService } from '../../../common/services/ticket-access.service';
import { TicketTimingService } from '../../../common/services/ticket-timing.service';
import { TicketLedgerService, LEDGER_PAUSE_REASONS } from './ticket-ledger.service';
import { TicketImportService } from './ticket-import.service';

function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// SLA hours are read from DB via TicketTimingService.getSlaConfig() — no local constants needed.

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private prisma: PrismaService,
    private gateway: EventsGateway,
    private notificationEventService: NotificationEventService,
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
    private eventLogger: EventLoggerService,
    private ticketAccess: TicketAccessService,
    private ticketTiming: TicketTimingService,
    private ticketLedger: TicketLedgerService,
    private ticketImport: TicketImportService,
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
    assignedTo: { select: { id: true, name: true, email: true, avatar: true, photoUrl: true } },
    createdBy: { select: { id: true, name: true, email: true, avatar: true, photoUrl: true } },
    department: true,
    project: { select: { id: true, projectId: true, name: true } },
    assignees: { include: { user: { select: { id: true, name: true, avatar: true, photoUrl: true } } } },
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

  // Apex OS is a single-timezone product (IST, UTC+5:30, no DST). Spreadsheet cells
  // carry no timezone, and the server's own clock can't tell us the uploader's zone,
  // so a wall-clock date+time parsed out of Excel is interpreted as IST and converted
  // to UTC with the fixed +5:30 offset. (The browser create form instead uses the
  // user's real local zone via localDateTimeInputToIso() — this path is import-only.)
  // Returns a full UTC ISO string, 'INVALID' for a malformed time, or undefined when
  // no date is given. Time may come from a separate column ("18:00") or be embedded in
  // the date string ("2026-06-26T18:00"); absent time means midnight IST.
  private readonly IST_OFFSET_MINUTES = 5 * 60 + 30;
  private istWallClockToUtcIso(dateStr?: string, timeStr?: string): string | undefined {
    const d = (dateStr ?? '').trim();
    if (!d) return undefined;
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
    if (!dateMatch) return 'INVALID';
    const [, y, mo, day] = dateMatch;

    const embedded = /T(\d{1,2}):(\d{2})/.exec(d);
    const timeSource = (timeStr ?? '').trim() || (embedded ? `${embedded[1]}:${embedded[2]}` : '');
    let hh = 0;
    let mm = 0;
    if (timeSource) {
      const tMatch = /^(\d{1,2}):(\d{2})/.exec(timeSource);
      if (!tMatch) return 'INVALID';
      hh = Number(tMatch[1]);
      mm = Number(tMatch[2]);
      if (hh > 23 || mm > 59) return 'INVALID';
    }
    const utcMs =
      Date.UTC(Number(y), Number(mo) - 1, Number(day), hh, mm) - this.IST_OFFSET_MINUTES * 60_000;
    const date = new Date(utcMs);
    if (Number.isNaN(date.getTime())) return 'INVALID';
    return date.toISOString();
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

    const needsTimingFilter = query.overdue === true || query.overdue === 'true' || query.risk === 'overdue' || query.filter === 'overdue';

    if (needsTimingFilter) {
      const candidates = await this.prisma.ticket.findMany({
        where: this.andWhere(where, { status: { notIn: [TicketStatus.PENDING_APPROVAL, TicketStatus.DONE, TicketStatus.CLOSED] } }),
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
      reviewCycles: { orderBy: { cycleNo: 'asc' } },
    };
    const ticket = user
      ? await this.ticketAccess.findAccessibleTicket(id, user, include)
      : await this.prisma.ticket.findFirst({ where: { OR: [{ id }, { ticketId: id }] }, include });
    if (!ticket) throw new NotFoundException('Ticket not found');
    const decorated = await this.addSla(ticket);
    // Computed (not stored) flags so the detail UI mirrors the backend policy exactly:
    // self-assigned tickets are review-gated to the worker's reporting hierarchy, and
    // only a resolved approver (never the self-worker) sees approve/reject controls.
    const selfAssigned = this.ticketAccess.isSelfAssigned(ticket);
    const viewerCanApprove = user ? await this.ticketAccess.viewerCanApprove(user, ticket) : false;
    return { ...decorated, selfAssigned, viewerCanApprove };
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

  // Shared by create() and createBulk()/import-preview validation — every
  // normalization step a single ticket's create payload goes through before
  // insert. Extracted verbatim from create() (no behavior change) so bulk rows
  // get identical department/assignee resolution, date normalization, and
  // executionDueAt computation instead of a second, drifting copy of this logic.
  private async normalizeTicketCreateData(data: any, userId: string, user?: any): Promise<{ data: any; assigneeIds: string[] }> {
    // Extract assigneeIds before passing data to Prisma (not a real Ticket column)
    let assigneeIds: string[] = Array.isArray(data.assigneeIds) ? data.assigneeIds : [];
    delete data.assigneeIds;

    // Enforce self-assign for EMPLOYEE / INTERN
    const creatorRole: string = user?.role?.name ?? user?.role ?? '';
    if (['EMPLOYEE', 'INTERN'].includes(creatorRole)) {
      data.assignedToId = userId;
      assigneeIds = [userId];
    }

    // Resolve departmentId: accept UUID, CUID, or display name (schema uses cuid())
    if (data.departmentId && !isUUID(data.departmentId)) {
      const dept = await this.prisma.department.findFirst({
        where: { OR: [{ id: data.departmentId }, { name: { equals: data.departmentId, mode: 'insensitive' } }] },
        select: { id: true },
      });
      data.departmentId = dept?.id ?? undefined;
    }
    // Resolve assignedToId: accept display name or ID (schema uses cuid(), not UUID —
    // isUUID() returns false for a real cuid, so the lookup must also match by id,
    // mirroring the departmentId resolution above. Without the id branch, a valid
    // assignedToId sent from the client was silently nulled out here.)
    if (data.assignedToId && !isUUID(data.assignedToId)) {
      const assignee = await this.prisma.user.findFirst({
        where: { OR: [{ id: data.assignedToId }, { name: { equals: data.assignedToId, mode: 'insensitive' } }] },
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
    // category is a required DB enum with no default. The single-ticket form always
    // sends 'OPERATIONS' (it's hidden from the UI); bulk/import rows don't carry a
    // category column, so default it here too — keeps both paths inserting a valid
    // enum without changing what single-create already does (it always passes one).
    if (!data.category) data.category = 'OPERATIONS';

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

    return { data, assigneeIds };
  }

  // Shared by create() and createBulk() — assignee notifications + audit trail
  // for a ticket that has already been inserted. Extracted verbatim from
  // create() (no behavior change).
  private async fireTicketCreatedSideEffects(ticket: any, assigneeIds: string[], userId: string) {
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

    try {
      await this.prisma.activityLog.create({
        data: {
          userId,
          action: 'TICKET_CREATED',
          entityType: 'TICKET',
          entityId: ticket.id,
          details: { ticketId: ticket.ticketId, title: ticket.title, category: ticket.category, priority: ticket.priority },
        },
      });
    } catch (err: any) {
      this.logger.error(`Failed to write activity log for created ticket ${ticket.ticketId}: ${err?.message}`);
    }

    this.eventLogger.log({ actorId: userId, entityType: 'Ticket', entityId: ticket.id, action: OperationalAction.TICKET_CREATED, toState: 'OPEN', metadata: { ticketId: ticket.ticketId, title: ticket.title } }).catch(() => {});
    this.gateway.emitTicketCreated(ticket);
    this.eventEmitter.emit('ticket.created', { ticket, userId });

    if (ticket.assignedTo) {
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
    }
  }

  async create(data: any, userId: string, user?: any) {
    const normalized = await this.normalizeTicketCreateData(data, userId, user);
    data = normalized.data;
    const assigneeIds = normalized.assigneeIds;

    // Generate a collision-safe, deletion-safe ticket ID.
    //
    // Display IDs are TKT-<n>. The next <n> is derived from the MAX existing
    // numeric suffix (high-water mark) — NOT from row count. Count-based IDs
    // break after deletions: count() drops below the highest suffix still in
    // use, so count+1 lands on an ID that already exists and every collision
    // re-derives the same doomed base. The high-water mark is unaffected by
    // deletions, and we still retry on unique-constraint (P2002) violations to
    // stay correct when concurrent inserts race for the same number.
    let ticket: any;
    const maxAttempts = 25;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Re-read the high-water mark each attempt so concurrent inserts already
      // committed by other requests are taken into account. The regex guard
      // ignores any malformed/legacy IDs so the CAST never errors, and the
      // numeric CAST keeps ordering correct beyond TKT-999 (lexical sort would
      // place "TKT-1000" before "TKT-999").
      const rows = await this.prisma.$queryRaw<Array<{ max: number }>>`
        SELECT COALESCE(MAX(CAST(SUBSTRING("ticketId" FROM 5) AS INTEGER)), 0)::int AS max
        FROM "tickets"
        WHERE "ticketId" ~ '^TKT-[0-9]+$'
      `;
      const highWaterMark = Number(rows?.[0]?.max ?? 0);
      // Deterministic forward step guarantees progress; jitter after the first
      // attempt spreads simultaneous creators apart to avoid thundering-herd
      // collisions under heavy concurrency.
      const jitter = attempt === 0 ? 0 : Math.floor(Math.random() * (attempt + 1));
      const nextNumber = highWaterMark + 1 + attempt + jitter;
      const ticketId = `TKT-${String(nextNumber).padStart(3, '0')}`;
      try {
        ticket = await this.prisma.ticket.create({
          data: { ...data, ticketId, createdById: userId },
          include: this.includeOptions,
        });
        break;
      } catch (err: any) {
        // P2002 = unique constraint violation — ID was taken by a concurrent insert, retry
        if (err?.code === 'P2002' && err?.meta?.target?.includes('ticketId')) {
          // Log the collision (ID + attempt only — no ticket payload/secrets).
          this.logger.warn(
            `Ticket ID collision on ${ticketId} (attempt ${attempt + 1}/${maxAttempts}); retrying`,
          );
          continue;
        }
        console.error('TICKET CREATE ERROR:', { message: err?.message, code: err?.code, meta: err?.meta });
        throw new BadRequestException(err?.message ?? 'Failed to create ticket');
      }
    }
    if (!ticket) {
      this.logger.error(
        `Failed to generate a unique ticket ID after ${maxAttempts} attempts (createdById=${userId})`,
      );
      throw new BadRequestException('Failed to generate a unique ticket ID — please try again');
    }

    await this.fireTicketCreatedSideEffects(ticket, assigneeIds, userId);

    return this.addSla(ticket);
  }

  // Validates and normalizes one bulk/import row. Returns either a ready-to-insert
  // { data, assigneeIds } or a row-level error string — never throws for ordinary
  // validation problems, so createBulk()/previewImport() can check every row and
  // report all of them at once instead of stopping at the first failure.
  private async validateBulkRow(row: any, userId: string, user?: any): Promise<{ data?: any; assigneeIds?: string[]; error?: string }> {
    const errors: string[] = [];
    const raw = { ...row };

    if (!raw.title || !String(raw.title).trim()) errors.push('Title is required');

    const REQUEST_TYPES = ['TASK', 'QUERY', 'HELP'];
    if (raw.type && !REQUEST_TYPES.includes(String(raw.type).toUpperCase())) {
      errors.push(`Request Type must be one of ${REQUEST_TYPES.join('/')}`);
    }
    raw.type = REQUEST_TYPES.includes(String(raw.type).toUpperCase()) ? String(raw.type).toUpperCase() : 'TASK';

    const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
    if (raw.priority && !PRIORITIES.includes(String(raw.priority).toUpperCase())) {
      errors.push(`Priority must be one of ${PRIORITIES.join('/')}`);
    }
    raw.priority = PRIORITIES.includes(String(raw.priority).toUpperCase()) ? String(raw.priority).toUpperCase() : 'MEDIUM';

    if (!raw.departmentId || !String(raw.departmentId).trim()) errors.push('Department is required');
    if (!raw.dueDate) errors.push('Due Date is required');
    // Task Type is intentionally NOT backend-required here: the DB column is nullable
    // and single-ticket create() also accepts a null task type (the "required" rule
    // lives only in the create form's client-side validation). The manual bulk UI
    // enforces it per-row the same way; Excel import treats it as "validate if
    // provided" per spec. Keeping this optional makes import preview and bulk-create
    // agree on the same rule instead of preview passing a row that create() rejects.

    // estimatedMinutes: 0h0m is treated as "not provided", not an error — a picker
    // left untouched at 0/0 shouldn't read as an explicit zero-length estimate.
    if (raw.estimatedMinutes !== undefined && raw.estimatedMinutes !== null && raw.estimatedMinutes !== '') {
      const mins = Number(raw.estimatedMinutes);
      if (Number.isNaN(mins) || mins < 0) errors.push('Estimated Time is invalid');
      else if (mins === 0) raw.estimatedMinutes = undefined;
    }

    if (raw.scheduledStartAt && raw.scheduledEndAt) {
      const startMs = new Date(raw.scheduledStartAt).getTime();
      const endMs = new Date(raw.scheduledEndAt).getTime();
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) errors.push('Scheduled Start/End is not a valid date');
      else if (endMs <= startMs) errors.push('Scheduled End must be after Scheduled Start');
    }

    if (errors.length > 0) return { error: errors.join('; ') };

    const normalized = await this.normalizeTicketCreateData(raw, userId, user);
    const data = normalized.data;
    const assigneeIds = normalized.assigneeIds;

    if (!data.departmentId) errors.push('Department not found');
    if (errors.length === 0 && user) {
      try {
        await this.ticketAccess.assertCanCreateInDepartment(user, data.departmentId);
      } catch (err: any) {
        errors.push(err?.message ?? 'You do not have permission to create tickets in this department');
      }
    }
    if (errors.length === 0 && assigneeIds.length === 0) {
      errors.push('Assigned To is required');
    }
    if (errors.length === 0 && data.taskTypeId) {
      const taskType = await this.prisma.taskType.findFirst({
        where: { id: data.taskTypeId, OR: [{ departmentId: data.departmentId }, { isGlobal: true }] },
      });
      if (!taskType) errors.push('Task Type is not valid for the selected Department');
      else if (data.taskSubtypeId) {
        const subtype = await this.prisma.taskSubtype.findFirst({
          where: { id: data.taskSubtypeId, taskTypeId: data.taskTypeId },
        });
        if (!subtype) errors.push('Subtype is not valid for the selected Task Type');
      }
    }

    if (errors.length > 0) return { error: errors.join('; ') };
    return { data, assigneeIds };
  }

  // All-or-nothing bulk creation. Every row is validated first with zero DB
  // writes; if any row fails, zero tickets are created. Only once every row
  // passes does a single transaction insert them all, so a failure partway
  // through (e.g. a rare concurrent ticketId collision) rolls back everything
  // instead of leaving a partial batch behind. Side effects (notifications,
  // activity log, audit log) intentionally run after the transaction commits —
  // they must never be the reason a successful creation gets rolled back, and
  // by the time they run the tickets are already real and visible regardless.
  async createBulk(rows: any[], userId: string, user?: any): Promise<any[]> {
    const MAX_ROWS = 100;
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestException('At least one ticket row is required');
    }
    if (rows.length > MAX_ROWS) {
      throw new BadRequestException(`Cannot create more than ${MAX_ROWS} tickets in a single batch`);
    }

    const rowErrors: { row: number; error: string }[] = [];
    const validatedRows: { data: any; assigneeIds: string[] }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const result = await this.validateBulkRow(rows[i], userId, user);
      if (result.error) rowErrors.push({ row: i + 1, error: result.error });
      else validatedRows.push({ data: result.data, assigneeIds: result.assigneeIds! });
    }

    if (rowErrors.length > 0) {
      throw new BadRequestException({
        message: 'One or more ticket rows are invalid — no tickets were created',
        errors: rowErrors,
      });
    }

    let createdTickets: any[];
    try {
      createdTickets = await this.prisma.$transaction(async (tx) => {
        const created: any[] = [];
        for (const row of validatedRows) {
          const hwm = await tx.$queryRaw<Array<{ max: number }>>`
            SELECT COALESCE(MAX(CAST(SUBSTRING("ticketId" FROM 5) AS INTEGER)), 0)::int AS max
            FROM "tickets"
            WHERE "ticketId" ~ '^TKT-[0-9]+$'
          `;
          const nextNumber = Number(hwm?.[0]?.max ?? 0) + 1;
          const ticketId = `TKT-${String(nextNumber).padStart(3, '0')}`;
          const ticket = await tx.ticket.create({
            data: { ...row.data, ticketId, createdById: userId },
            include: this.includeOptions,
          });
          if (row.assigneeIds.length > 0) {
            await tx.ticketAssignee.createMany({
              data: row.assigneeIds.map((uid) => ({ ticketId: ticket.id, userId: uid })),
              skipDuplicates: true,
            });
          }
          created.push(ticket);
        }
        return created;
      });
    } catch (err: any) {
      this.logger.error(`Bulk ticket creation failed, transaction rolled back: ${err?.message}`);
      throw new BadRequestException('Could not create tickets — no tickets were created. Please try again.');
    }

    for (let i = 0; i < createdTickets.length; i++) {
      await this.fireTicketCreatedSideEffects(createdTickets[i], validatedRows[i].assigneeIds, userId);
    }

    return Promise.all(createdTickets.map((t) => this.addSla(t)));
  }

  /** Generates the downloadable .xlsx import template (delegates to TicketImportService). */
  async generateImportTemplate(): Promise<Buffer> {
    return this.ticketImport.generateTemplate();
  }

  // Maps one raw spreadsheet row (all text, human-entered names/emails) into the same
  // create-row shape the bulk endpoint consumes: department/task-type/subtype/project
  // names → ids, assignee EMAIL → active user id, Due Date + Due Time and Schedule
  // Start/End → UTC ISO (IST wall-clock), Est Hours+Minutes → total minutes. Anything
  // that was supplied but didn't resolve becomes a precise, field-tagged error so the
  // preview can show "Department \"Foo\" not found" instead of a generic message.
  private async mapImportRow(
    raw: Record<string, string>,
    _userId: string,
    _user?: any,
  ): Promise<{ payload: any; display: Record<string, string>; fieldErrors: Record<string, string> }> {
    const fieldErrors: Record<string, string> = {};
    const text = (v?: string) => (v ?? '').toString().trim();

    const typeRaw = text(raw.type).toUpperCase();
    const priorityRaw = text(raw.priority).toUpperCase();

    // Department (name → id). Resolved here because task-type lookup is dept-scoped.
    let departmentId = '';
    let departmentName = text(raw.department);
    if (departmentName) {
      const dept = await this.prisma.department.findFirst({
        where: { name: { equals: departmentName, mode: 'insensitive' } },
        select: { id: true, name: true },
      });
      if (dept) {
        departmentId = dept.id;
        departmentName = dept.name;
      } else {
        fieldErrors.department = `Department "${departmentName}" not found`;
      }
    }

    // Task Type (name → id), scoped to the resolved department or a global type.
    let taskTypeId = '';
    let taskTypeName = text(raw.taskType);
    if (taskTypeName && departmentId) {
      const tt = await this.prisma.taskType.findFirst({
        where: {
          name: { equals: taskTypeName, mode: 'insensitive' },
          OR: [{ departmentId }, { isGlobal: true }],
        },
        select: { id: true, name: true },
      });
      if (tt) {
        taskTypeId = tt.id;
        taskTypeName = tt.name;
      } else {
        fieldErrors.taskType = `Task Type "${taskTypeName}" not found in ${departmentName || 'the selected department'}`;
      }
    }

    // Subtype (name → id) within the resolved task type.
    let taskSubtypeId = '';
    let subtypeName = text(raw.subtype);
    if (subtypeName && taskTypeId) {
      const st = await this.prisma.taskSubtype.findFirst({
        where: { name: { equals: subtypeName, mode: 'insensitive' }, taskTypeId },
        select: { id: true, name: true },
      });
      if (st) {
        taskSubtypeId = st.id;
        subtypeName = st.name;
      } else {
        fieldErrors.subtype = `Subtype "${subtypeName}" not found for task type ${taskTypeName}`.trim();
      }
    }

    // Assignee by EMAIL (names can repeat — email is the stable key) → active user id.
    let assignedToId = '';
    const assigneeEmail = text(raw.assigneeEmail);
    let assigneeDisplay = assigneeEmail;
    if (assigneeEmail) {
      const u = await this.prisma.user.findFirst({
        where: { email: { equals: assigneeEmail, mode: 'insensitive' }, isActive: true },
        select: { id: true, name: true, email: true },
      });
      if (u) {
        assignedToId = u.id;
        assigneeDisplay = `${u.name} (${u.email})`;
      } else {
        fieldErrors.assignee = `No active user with email "${assigneeEmail}"`;
      }
    }

    // Project (project code or name → id).
    let projectId = '';
    let projectName = text(raw.project);
    if (projectName) {
      const p = await this.prisma.project.findFirst({
        where: {
          OR: [
            { name: { equals: projectName, mode: 'insensitive' } },
            { projectId: { equals: projectName, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, projectId: true },
      });
      if (p) {
        projectId = p.id;
        projectName = `${p.projectId} — ${p.name}`;
      } else {
        fieldErrors.project = `Project "${projectName}" not found`;
      }
    }

    // Due Date (+ optional Due Time) → UTC ISO. Date-only is passed through as a
    // date string so normalizeTicketCreateData applies the same 18:30 IST (13:00 UTC)
    // convention the single-ticket form uses; with a time it's combined as IST wall-clock.
    let dueDate: string | undefined;
    const dueDateText = text(raw.dueDate);
    const dueTimeText = text(raw.dueTime);
    if (dueDateText) {
      if (dueTimeText || /T\d/.test(dueDateText)) {
        const iso = this.istWallClockToUtcIso(dueDateText, dueTimeText);
        if (!iso || iso === 'INVALID') {
          fieldErrors.dueDate = `Due Date/Time "${dueDateText}${dueTimeText ? ' ' + dueTimeText : ''}" is not valid`;
        } else {
          dueDate = iso;
        }
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(dueDateText)) {
        dueDate = dueDateText;
      } else {
        fieldErrors.dueDate = `Due Date "${dueDateText}" is not valid (use YYYY-MM-DD)`;
      }
    }

    // Schedule Start / End → UTC ISO (IST wall-clock).
    const scheduleStartText = text(raw.scheduleStart);
    const scheduleEndText = text(raw.scheduleEnd);
    let scheduledStartAt: string | undefined;
    let scheduledEndAt: string | undefined;
    if (scheduleStartText) {
      const iso = this.istWallClockToUtcIso(scheduleStartText);
      if (!iso || iso === 'INVALID') fieldErrors.scheduleStart = `Schedule Start "${scheduleStartText}" is not valid`;
      else scheduledStartAt = iso;
    }
    if (scheduleEndText) {
      const iso = this.istWallClockToUtcIso(scheduleEndText);
      if (!iso || iso === 'INVALID') fieldErrors.scheduleEnd = `Schedule End "${scheduleEndText}" is not valid`;
      else scheduledEndAt = iso;
    }

    // Estimated time: Hours + Minutes columns → total minutes (backend stores minutes).
    const estHoursText = text(raw.estHours);
    const estMinutesText = text(raw.estMinutes);
    let estimatedMinutes: number | undefined;
    if (estHoursText || estMinutesText) {
      const h = Number(estHoursText || '0');
      const m = Number(estMinutesText || '0');
      if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || m < 0) {
        fieldErrors.estimated = 'Estimated Time (Hours/Minutes) is invalid';
      } else {
        const total = h * 60 + m;
        if (total > 0) estimatedMinutes = total;
      }
    }

    const payload: any = {
      type: typeRaw || undefined,
      title: text(raw.title),
      description: text(raw.description) || undefined,
      departmentId: departmentId || undefined,
      taskTypeId: taskTypeId || undefined,
      taskSubtypeId: taskSubtypeId || undefined,
      assignedToId: assignedToId || undefined,
      assigneeIds: assignedToId ? [assignedToId] : [],
      priority: priorityRaw || undefined,
      dueDate,
      estimatedMinutes,
      projectId: projectId || undefined,
      scheduledStartAt,
      scheduledEndAt,
      // No dedicated "notes" column exists on Ticket; the row's Notes is persisted to
      // the existing free-text scheduledNote field (a dedicated column would need a
      // schema migration, which is out of scope for this task).
      scheduledNote: text(raw.notes) || undefined,
    };

    const display: Record<string, string> = {
      type: typeRaw || 'TASK',
      title: text(raw.title),
      department: departmentName,
      taskType: taskTypeName,
      subtype: subtypeName,
      assignee: assigneeDisplay,
      priority: priorityRaw || 'MEDIUM',
      dueDate: dueTimeText ? `${dueDateText} ${dueTimeText}` : dueDateText,
      estimated: estimatedMinutes != null ? `${Math.floor(estimatedMinutes / 60)}h ${estimatedMinutes % 60}m` : '',
      project: projectName,
      scheduleStart: scheduleStartText,
      scheduleEnd: scheduleEndText,
      notes: text(raw.notes),
    };

    return { payload, display, fieldErrors };
  }

  // Parses an uploaded .xlsx and returns a per-row preview WITHOUT creating anything.
  // Each row is mapped (names/emails/dates resolved) and then run through the exact
  // same validateBulkRow() the /tickets/bulk endpoint uses, so a row marked valid here
  // is guaranteed to be accepted at create time (and vice-versa). The frontend shows
  // this preview, the user reviews/fixes, then submits the valid rows' payloads to
  // /tickets/bulk. Precise field-level resolution errors take precedence over the
  // generic structural ones for the same field to avoid duplicate messages.
  async previewImport(
    buffer: Buffer,
    userId: string,
    user?: any,
  ): Promise<{
    totalRows: number;
    validCount: number;
    errorCount: number;
    rows: Array<{ row: number; display: Record<string, string>; payload: any; valid: boolean; error: string | null }>;
  }> {
    const rawRows = await this.ticketImport.parseRows(buffer);
    const MAX_ROWS = 100;
    if (rawRows.length === 0) {
      throw new BadRequestException('No ticket rows found in the uploaded file');
    }
    if (rawRows.length > MAX_ROWS) {
      throw new BadRequestException(`File has ${rawRows.length} rows; the maximum is ${MAX_ROWS} per import`);
    }

    const rows: Array<{ row: number; display: Record<string, string>; payload: any; valid: boolean; error: string | null }> = [];
    for (const { row, raw } of rawRows) {
      const { payload, display, fieldErrors } = await this.mapImportRow(raw, userId, user);
      const structural = await this.validateBulkRow(payload, userId, user);

      const errs: string[] = Object.values(fieldErrors);
      if (structural.error) {
        for (const seg of structural.error.split('; ')) {
          // Suppress the generic structural message when a precise field error already covers it.
          if (fieldErrors.department && /department/i.test(seg)) continue;
          if (fieldErrors.assignee && /assigned to/i.test(seg)) continue;
          if (fieldErrors.taskType && /task type/i.test(seg)) continue;
          if (fieldErrors.subtype && /subtype/i.test(seg)) continue;
          if ((fieldErrors.dueDate) && /due date/i.test(seg)) continue;
          if ((fieldErrors.scheduleStart || fieldErrors.scheduleEnd) && /scheduled (start|end)/i.test(seg)) continue;
          errs.push(seg);
        }
      }
      const unique = [...new Set(errs)];
      const error = unique.length ? unique.join('; ') : null;
      rows.push({ row, display, payload, valid: !error, error });
    }

    return {
      totalRows: rows.length,
      validCount: rows.filter((r) => r.valid).length,
      errorCount: rows.filter((r) => !r.valid).length,
      rows,
    };
  }

  async update(id: string, data: any, userId: string, user?: any, opts?: { suppressCompletionNotification?: boolean }) {
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

    const existing = user
      ? await this.ticketAccess.findAccessibleTicket(id, user, { assignees: true })
      : await this.prisma.ticket.findFirst({ where: { OR: [{ id }, { ticketId: id }] }, include: { assignees: true } });
    if (!existing) throw new NotFoundException('Ticket not found');
    const ticketDbId = existing.id;

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
        await this.ticketAccess.assertCanTransitionTicket(user, existing, data.status);
      } else {
        await this.ticketAccess.assertCanUpdateTicket(user, existing);
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

    // ── DONE/CLOSED → OPEN/IN_PROGRESS (reopen): clear stale completion and review stamps ──
    if (['DONE', 'CLOSED'].includes(existing.status) && ['OPEN', 'IN_PROGRESS'].includes(data.status)) {
      data.actualCompletedAt = null;
      data.closedAt = null;
      data.resolvedAt = null;
      data.submittedAt = null;
      data.reviewStartedAt = null;
      data.reviewDueAt = null;
      if (data.status === TicketStatus.IN_PROGRESS && existing.estimatedMinutes) {
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
      this.eventEmitter.emit('ticket.status_changed', {
        ticket,
        oldStatus: existing.status,
        newStatus: data.status,
        userId,
      });
      this.gateway.emitTicketStatusChanged(ticket.id, data.status, userId);

      if (data.status === TicketStatus.DONE || data.status === TicketStatus.CLOSED) {
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
      try {
        await this.notificationEventService.sendNotification(
          ticket.assignedTo.id,
          'assignedTicket',
          {
            title: `Ticket assigned to you: ${ticket.ticketId}`,
            message: ticket.title,
            type: NotificationType.INFO,
            link: `/tickets/${ticket.id}`,
            entityId: ticket.id,
            entityType: 'TICKET',
          }
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

  // Unassigns the ticket's primary (accountable) assignee. Bypasses the generic
  // update() so the IN_PROGRESS/REVIEW/DONE/CLOSED safety rules below are always
  // enforced regardless of caller — update() itself has no concept of "unassign"
  // and would otherwise let assignedToId go to null on any open status with no
  // safety net (and would silently leave the ticket IN_PROGRESS with nobody
  // working it). REVIEW/DONE/CLOSED are blocked outright; IN_PROGRESS falls back
  // to OPEN rather than leaving an orphaned in-flight ticket, since that's the
  // option that reuses an already-allowed transition (IN_PROGRESS → OPEN is in
  // TicketAccessService's transition matrix) instead of inventing a new
  // "pick a replacement first" flow with no existing UI to support it.
  async unassignPrimary(id: string, userId: string, user?: any) {
    const ticket = user
      ? await this.ticketAccess.findAccessibleTicket(id, user, { assignees: true })
      : await this.prisma.ticket.findFirst({ where: { OR: [{ id }, { ticketId: id }] }, include: { assignees: true } });
    if (!ticket) throw new NotFoundException('Ticket not found');

    if (user) await this.ticketAccess.assertCanAssignTicket(user, ticket, null);

    if ([TicketStatus.DONE, TicketStatus.CLOSED].includes(ticket.status)) {
      throw new BadRequestException('Cannot unassign a completed or closed ticket');
    }
    if (ticket.status === TicketStatus.REVIEW) {
      throw new BadRequestException('Move ticket back to In Progress/Open before unassigning.');
    }
    if (!ticket.assignedToId) {
      throw new BadRequestException('Ticket has no primary assignee to unassign');
    }

    const previousAssigneeId = ticket.assignedToId;
    const wasInProgress = ticket.status === TicketStatus.IN_PROGRESS;
    const data: any = { assignedToId: null };
    if (wasInProgress) data.status = TicketStatus.OPEN;

    const updated = await this.prisma.ticket.update({
      where: { id: ticket.id },
      data,
      include: this.includeOptions,
    });

    await this.prisma.ticketHistory.createMany({
      data: [
        { ticketId: ticket.id, field: 'assignedToId', oldValue: previousAssigneeId, newValue: null, changedById: userId },
        ...(wasInProgress
          ? [{ ticketId: ticket.id, field: 'status', oldValue: ticket.status, newValue: TicketStatus.OPEN, changedById: userId }]
          : []),
      ],
    });
    await this.prisma.activityLog.create({
      data: {
        userId,
        action: 'TICKET_UNASSIGNED',
        entityType: 'TICKET',
        entityId: ticket.id,
        details: { ticketId: ticket.ticketId, removedAssigneeId: previousAssigneeId, movedBackToOpen: wasInProgress },
      },
    });
    this.eventLogger.log({
      actorId: userId,
      entityType: 'Ticket',
      entityId: ticket.id,
      action: OperationalAction.TICKET_UNASSIGNED,
      fromState: ticket.status,
      toState: updated.status,
      metadata: { ticketId: ticket.ticketId, removedAssigneeId: previousAssigneeId },
    }).catch(() => {});
    this.gateway.emitTicketStatusChanged(ticket.id, updated.status, userId);

    // Best-effort: stop the removed assignee's active work clock on this ticket so it
    // doesn't keep running against someone no longer responsible for it. Never blocks
    // the unassign itself — the ticket's own record (above) is already the source of
    // truth, and a clock left open here is a harmless, separately-correctable gap,
    // not silent data loss.
    try {
      await this.ticketLedger.endActiveLog({
        ticketId: ticket.id,
        userId: previousAssigneeId,
        pauseReason: LEDGER_PAUSE_REASONS.UNASSIGNED,
      });
    } catch (err: any) {
      this.logger.error(`Failed to pause ticket timer after unassign for ${ticket.ticketId}: ${err?.message}`);
    }

    if (previousAssigneeId !== userId) {
      try {
        await this.notificationEventService.sendNotification(
          previousAssigneeId,
          'statusChanged',
          {
            title: `Removed from ticket: ${ticket.ticketId}`,
            message: wasInProgress
              ? `${ticket.title} was unassigned and moved back to Open.`
              : `You were removed from ${ticket.title}.`,
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

  // Removes one secondary/collaborator assignee. Never touches status or the primary
  // assignee — per product requirement, removing a collaborator is always status-neutral.
  async removeSecondaryAssignee(id: string, targetUserId: string, userId: string, user?: any) {
    const ticket = user
      ? await this.ticketAccess.findAccessibleTicket(id, user, { assignees: { include: { user: { select: { id: true, name: true } } } } })
      : await this.prisma.ticket.findFirst({
          where: { OR: [{ id }, { ticketId: id }] },
          include: { assignees: { include: { user: { select: { id: true, name: true } } } } },
        });
    if (!ticket) throw new NotFoundException('Ticket not found');

    if (user) await this.ticketAccess.assertCanAssignTicket(user, ticket, null);

    if ([TicketStatus.DONE, TicketStatus.CLOSED].includes(ticket.status)) {
      throw new BadRequestException('Cannot unassign a completed or closed ticket');
    }
    if (ticket.status === TicketStatus.REVIEW) {
      throw new BadRequestException('Move ticket back to In Progress/Open before unassigning.');
    }
    if (targetUserId === ticket.assignedToId) {
      throw new BadRequestException('This user is the primary assignee — use the primary unassign action instead');
    }

    const row = (ticket.assignees ?? []).find((a: any) => a.userId === targetUserId);
    if (!row) throw new NotFoundException('This user is not assigned to this ticket');

    await this.prisma.ticketAssignee.delete({ where: { id: row.id } });

    await this.prisma.ticketHistory.create({
      data: { ticketId: ticket.id, field: 'secondaryAssignee', oldValue: targetUserId, newValue: null, changedById: userId },
    });
    await this.prisma.activityLog.create({
      data: {
        userId,
        action: 'TICKET_ASSIGNEE_REMOVED',
        entityType: 'TICKET',
        entityId: ticket.id,
        details: { ticketId: ticket.ticketId, removedUserId: targetUserId },
      },
    });
    this.eventLogger.log({
      actorId: userId,
      entityType: 'Ticket',
      entityId: ticket.id,
      action: OperationalAction.TICKET_ASSIGNEE_REMOVED,
      metadata: { ticketId: ticket.ticketId, removedUserId: targetUserId },
    }).catch(() => {});
    this.gateway.emitTicketStatusChanged(ticket.id, ticket.status, userId);

    if (targetUserId !== userId) {
      try {
        await this.notificationEventService.sendNotification(
          targetUserId,
          'statusChanged',
          {
            title: `Removed from ticket: ${ticket.ticketId}`,
            message: `You were removed as a collaborator on ${ticket.title}.`,
            type: NotificationType.WARNING,
            link: `/tickets/${ticket.id}`,
            entityId: ticket.id,
            entityType: 'TICKET',
          },
        );
      } catch (_e) { /* never crash main op */ }
    }

    const updated = await this.prisma.ticket.findUnique({ where: { id: ticket.id }, include: this.includeOptions });
    return this.addSla(updated);
  }

  // The rating applies to the ticket's primary worker. assignedToId (legacy single-assignee
  // field) wins when present; multi-assignee tickets fall back to the first row in
  // `assignees` so a rating still lands on someone rather than being silently dropped.
  // This intentionally does not attempt per-assignee ratings for multi-assignee tickets.
  private primaryAssigneeId(ticket: any): string | undefined {
    return ticket.assignedToId ?? ticket.assignees?.[0]?.userId ?? undefined;
  }

  // Closes the ticket's current ReviewCycleLog with a decision + ratings/feedback.
  // If no cycle was ever opened for this ticket (true for every ticket today, since
  // nothing currently calls startReviewCycle when a ticket enters REVIEW), one is
  // started retroactively using the ticket's own reviewStartedAt column, then closed
  // immediately — so tickets already sitting in REVIEW before this fix shipped are
  // still handled correctly.
  private async persistReviewDecision(
    ticket: any,
    decision: 'APPROVED' | 'REWORK',
    reviewerId: string,
    ratings?: {
      taskEfficiencyRating?: number | null;
      employeePerformanceRating?: number | null;
      employeeAttitudeRating?: number | null;
      ratingComment?: string | null;
      feedback?: string | null;
    },
  ) {
    const closeArgs = {
      ticketId: ticket.id,
      decision,
      reviewerId,
      feedback: ratings?.feedback ?? undefined,
      taskEfficiencyRating: ratings?.taskEfficiencyRating ?? null,
      employeePerformanceRating: ratings?.employeePerformanceRating ?? null,
      employeeAttitudeRating: ratings?.employeeAttitudeRating ?? null,
      ratingComment: ratings?.ratingComment ?? null,
    };

    const actionLabel = decision === 'APPROVED' ? 'approved' : 'sent back for rework';
    let cycle: any;
    try {
      cycle = await this.ticketLedger.endReviewCycle(closeArgs);
      if (!cycle) {
        await this.ticketLedger.startReviewCycle({
          ticketId: ticket.id,
          assigneeId: this.primaryAssigneeId(ticket),
          reviewerId,
          reviewStartedAt: ticket.reviewStartedAt ?? ticket.submittedAt ?? new Date(),
        });
        cycle = await this.ticketLedger.endReviewCycle(closeArgs);
      }
    } catch (err: any) {
      this.logger.error(`Review cycle persistence failed for ticket ${ticket.ticketId}: ${err?.message}`);
      throw new BadRequestException(
        `Could not save the review decision for ${ticket.ticketId} — the ticket was not ${actionLabel}. Please try again.`,
      );
    }

    // Defensive: endReviewCycle/startReviewCycle should always resolve to a row or throw.
    // If it ever resolves to something falsy instead, treat that as failure too — the
    // caller must never proceed to transition status believing the decision was saved.
    if (!cycle) {
      this.logger.error(`Review cycle persistence produced no row for ticket ${ticket.ticketId}`);
      throw new BadRequestException(
        `Could not save the review decision for ${ticket.ticketId} — the ticket was not ${actionLabel}. Please try again.`,
      );
    }

    return cycle;
  }

  async approve(id: string, userId: string, user?: any, ratings?: {
    taskEfficiencyRating?: number;
    employeePerformanceRating?: number;
    employeeAttitudeRating?: number;
    ratingComment?: string;
  }) {
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
    if (user) await this.ticketAccess.assertCanTransitionTicket(user, ticket, TicketStatus.DONE);

    // No self-rating, ever: self-assigned tickets (Task/Query/Help) are comment-only —
    // the worker's hierarchy approves with an optional comment but no star ratings.
    // Defensive second guard: even if a payload arrives, never persist a rating authored
    // by one of the ticket's own assignees. The comment is kept; the numeric stars are not.
    const selfAssigned = this.ticketAccess.isSelfAssigned(ticket);
    const reviewerIsAssignee =
      userId === this.primaryAssigneeId(ticket) ||
      Boolean(ticket.assignees?.some?.((a: any) => (a?.userId ?? a?.user?.id) === userId));
    const effectiveRatings = (selfAssigned || reviewerIsAssignee)
      ? { ratingComment: ratings?.ratingComment ?? null }
      : ratings;

    // Persist the review decision BEFORE transitioning status. If this throws, the ticket
    // must stay in REVIEW — it must never silently reach DONE with no record of the decision.
    await this.persistReviewDecision(ticket, 'APPROVED', userId, effectiveRatings);

    // suppressCompletionNotification=true: update() skips its generic "Ticket resolved"
    // notification so we can send a more specific "Ticket approved" message here instead.
    const updated = await this.update(ticket.id, { status: TicketStatus.DONE }, userId, user, { suppressCompletionNotification: true });

    // Single targeted notification to reporter — "Ticket approved" (not generic "resolved")
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
    if (user) await this.ticketAccess.assertCanTransitionTicket(user, ticket, TicketStatus.IN_PROGRESS);

    // Persist the rework decision/feedback BEFORE transitioning status — same ordering
    // guarantee as approve(). If this throws, the ticket must stay in REVIEW rather than
    // silently reopening with no record of why it was sent back.
    await this.persistReviewDecision(ticket, 'REWORK', userId, { feedback: comment });

    const [updated] = await Promise.all([
      this.update(ticket.id, { status: TicketStatus.IN_PROGRESS }, userId, user),
      this.prisma.comment.create({
        data: {
          ticketId: ticket.id,
          authorId: userId,
          content: `[REJECTED] ${comment}`,
        },
      }),
    ]);

    try {
      if (ticket.assignedToId && ticket.assignedToId !== userId) {
        await this.notificationEventService.sendNotification(
          ticket.assignedToId,
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
      }
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
    const activeScope = this.andWhere(scope, { status: { notIn: [TicketStatus.PENDING_APPROVAL, TicketStatus.DONE, TicketStatus.CLOSED] } });
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
      status: { notIn: [TicketStatus.PENDING_APPROVAL, TicketStatus.DONE, TicketStatus.CLOSED] },
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
