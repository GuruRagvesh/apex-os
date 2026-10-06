import { Injectable, NotFoundException, ForbiddenException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../prisma/prisma.service';
import { Prisma, TicketStatus, NotificationType } from '@prisma/client';
import { EventsGateway } from '../../platform/gateway/events.gateway';
import { NotificationEventService } from '../notifications/notification-event.service';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';
import { TicketAccessService } from '../../../common/services/ticket-access.service';
import { HierarchyApprovalService } from '../../../common/services/hierarchy-approval.service';
import { TicketTimingService } from '../../../common/services/ticket-timing.service';
import { ActiveWorkdayPolicyService } from '../../../common/services/active-workday-policy.service';
import { TVAService } from '../../../common/services/tva.service';
import { TicketLedgerService, LEDGER_PAUSE_REASONS, LEDGER_STAGES, LEDGER_OWNER_TYPES, LEDGER_SOURCES } from './ticket-ledger.service';
import { TicketImportService } from './ticket-import.service';

function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// SLA hours are read from DB via TicketTimingService.getSlaConfig() — no local constants needed.

/**
 * Side effects of a ticket change that must never run for a change that did
 * not commit: notifications, websocket events, the in-process event bus and
 * the operational event log. Queued while the transaction runs, executed after.
 */
type AfterCommit = Array<() => unknown>;

/**
 * A business change plus its employee-timer change, in one transaction. The
 * per-worker advisory lock and the one-active-timer index are taken inside it.
 */
const TIMER_TRANSACTION = { maxWait: 10_000, timeout: 20_000 };

export const PRIMARY_ASSIGNEE_REQUIRED = 'PRIMARY_ASSIGNEE_REQUIRED';

/** Safe review refusals: stable codes, user-facing messages, no internals. */
export const REVIEW_ERRORS = {
  NOT_IN_REVIEW: {
    statusCode: 409, code: 'TICKET_NOT_IN_REVIEW',
    message: 'This ticket is no longer in review. Refresh to see its latest state.',
  },
  ALREADY_DECIDED: {
    statusCode: 409, code: 'REVIEW_ALREADY_DECIDED',
    message: 'This review was already decided. Refresh to see the latest state.',
  },
  NOT_AUTHORIZED: {
    statusCode: 403, code: 'REVIEWER_NOT_AUTHORIZED',
    message: 'Only a reviewer for this ticket can start or pause its review.',
  },
  WITHDRAW_NOT_ALLOWED: {
    statusCode: 403, code: 'WITHDRAW_NOT_ALLOWED',
    message: "Only the ticket's assignee can withdraw this submission.",
  },
  CLAIMED: {
    statusCode: 409, code: 'REVIEW_CLAIMED',
    message: 'Another reviewer is already reviewing this ticket.',
  },
  DECISION_REQUIRED: {
    statusCode: 409, code: 'REVIEW_DECISION_REQUIRED',
    message: 'Use Approve to complete a ticket that is in review.',
  },
  NOT_STARTED: {
    statusCode: 409, code: 'REVIEW_NOT_STARTED',
    message: 'Start Review before approving or sending this ticket back.',
  },
  ALREADY_IN_REVIEW: {
    statusCode: 409, code: 'TICKET_ALREADY_IN_REVIEW',
    message: 'This ticket is already in review.',
  },
} as const;
export const PUNCH_IN_TO_REVIEW_MESSAGE = 'Punch In before starting a review.';

/** A change prepared before another request closed the ticket. */
export const TICKET_ALREADY_CLOSED = {
  statusCode: 409, code: 'TICKET_ALREADY_CLOSED',
  message: 'This ticket has already been closed. Refresh to see its latest state.',
} as const;

/** A status or owner change prepared against a state another request has since changed. */
export const TICKET_CHANGED = {
  statusCode: 409, code: 'TICKET_CHANGED',
  message: 'This ticket changed while you were updating it. Refresh and try again.',
} as const;

/** TASK / QUERY / HELP decide the workflow; a ticket keeps the type it was created with. */
export const TICKET_TYPE_LOCKED = {
  statusCode: 409, code: 'TICKET_TYPE_LOCKED',
  message: "A ticket's type cannot be changed after it is created.",
} as const;

/**
 * Ticket lists show the most recently changed ticket first. updatedAt moves
 * only when the ticket row itself is written (a real change); timers, review
 * clocks, reads and decoration write other tables and never reorder a list.
 */
export const TICKET_LIST_ORDER: Prisma.TicketOrderByWithRelationInput[] = [
  { updatedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' },
];

/** The title prefix of the "ticket entered review" notification. */
export const REVIEW_NEEDED_TITLE_PREFIX = 'Review needed:';

/**
 * One CSV cell: always quoted with quotes doubled and line breaks flattened.
 * A value a spreadsheet would evaluate (= + - @ first, optionally after
 * leading spaces, tabs or line breaks, or a leading tab/CR) is neutralised
 * with an apostrophe first, so it is shown as text. The check runs on the raw
 * value, before line breaks are normalised.
 */
export function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[\s]*[=+\-@]/.test(s) || /^[\t\r]/.test(s)) s = `'${s}`;
  s = s.replace(/\r\n|\r|\n/g, ' ');
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Review decisions on the ticket types a reviewer hierarchy decides (every
 * type except QUERY and HELP, whose decisions belong to the requester or the
 * HELP assignee) need the decider's own running review timer.
 */
export function reviewTimerRequired(ticket: { type?: string | null } | null | undefined): boolean {
  return ticket?.type !== 'QUERY' && ticket?.type !== 'HELP';
}

/** Safe attachment refusals: stable codes, user-facing messages, no internals. */
export const ATTACHMENT_ERRORS = {
  NOT_OWNER: {
    statusCode: 403, code: 'ATTACHMENT_NOT_OWNER',
    message: 'Only the person who uploaded this attachment can delete it.',
  },
  LEGACY_PROTECTED: {
    statusCode: 403, code: 'ATTACHMENT_LEGACY_PROTECTED',
    message: 'This attachment was uploaded before uploaders were recorded, so it cannot be deleted.',
  },
  LOCKED: {
    statusCode: 409, code: 'ATTACHMENT_LOCKED',
    message: 'This attachment is locked as review evidence and cannot be deleted.',
  },
  POC_NOT_ALLOWED: {
    statusCode: 403, code: 'POC_NOT_ALLOWED',
    message: "Only the ticket's assignees can add proof of completion while it is in progress or in review.",
  },
  FEEDBACK_NOT_ALLOWED: {
    statusCode: 403, code: 'REVIEW_FEEDBACK_NOT_ALLOWED',
    message: 'Only a reviewer of this ticket can add review feedback while it is in review.',
  },
  INVALID_PURPOSE: {
    statusCode: 400, code: 'ATTACHMENT_PURPOSE_INVALID',
    message: 'Unknown attachment purpose.',
  },
} as const;

export const ATTACHMENT_LOCK_REASONS = {
  SUBMITTED_FOR_REVIEW: 'SUBMITTED_FOR_REVIEW',
} as const;

const ATTACHMENT_PURPOSES = ['REFERENCE', 'GENERAL', 'POC', 'REVIEW_FEEDBACK'] as const;
type AttachmentPurposeValue = typeof ATTACHMENT_PURPOSES[number];

/** What every attachment response is built from (never the stored url). */
const ATTACHMENT_INCLUDE = {
  uploadedBy: { select: { id: true, name: true } },
  reviewCycle: { select: { id: true, cycleNo: true, decision: true } },
};

/**
 * What a Kanban card is built from. Kanban returns every open ticket at once
 * and its cards never show photos; profile photos are stored inline as base64
 * data URLs (megabytes each), so repeating photoUrl on every ticket overflows
 * Prisma's result string. No user select here may include photoUrl.
 */
export const KANBAN_TICKET_INCLUDE = {
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
    select: { content: true, createdAt: true, author: { select: { id: true, name: true } } },
  },
  _count: { select: { comments: true } },
};

/** A received file; stored only once the change it belongs to is allowed. */
export interface IncomingAttachmentFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** File storage, owned by the caller. `discard` undoes a `store` whose database write failed. */
export interface AttachmentStorage {
  store(ticketId: string, file: IncomingAttachmentFile): Promise<string>;
  discard(url: string): Promise<void>;
}

type UpdateOptions = {
  suppressCompletionNotification?: boolean;
  reviewDecisionRecorded?: boolean;
  /** withdraw() only: the assignee pulls their own submission back from review. */
  withdrawal?: boolean;
  /** reject() only: the estimate for the rework cycle it opens. */
  reworkEstimatedMinutes?: number | null;
};

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
    private hierarchyApprovalService: HierarchyApprovalService,
    private ticketTiming: TicketTimingService,
    private ticketLedger: TicketLedgerService,
    private ticketImport: TicketImportService,
    private activeWorkdayPolicy: ActiveWorkdayPolicyService,
    private tva: TVAService,
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
    const decorated = await this.ticketTiming.decorateTicket(this.sanitizeTicketForResponse(ticket));
    return this.withWorkBudgets([decorated]).then(([t]) => t);
  }

  // Every ticket response carries both clocks: `timing` (SLA deadline, wall
  // clock) and `workBudget` (estimate minus productive ledger time, what the UI
  // calls "Time left"). A ledger read failure must never hide tickets.
  private async addSlaMany(tickets: any[]) {
    const decorated = await this.ticketTiming.decorateTickets(tickets.map((ticket) => this.sanitizeTicketForResponse(ticket)));
    return this.withWorkBudgets(decorated);
  }

  // After a worker's running ticket stops for a ticket reason (review, done,
  // open, block, unassign, handover), the next ticket they have waiting starts
  // automatically, in the same transaction as the change that stopped it: a
  // failure rolls that change back rather than leaving the worker half-resumed.
  private async resumeNextWaitingFor(
    userIds: string[] | undefined,
    leftTicketId: string,
    tx: Prisma.TransactionClient,
  ) {
    for (const workerId of userIds ?? []) {
      await this.ticketLedger.resumeNextWaitingTicket(workerId, leftTicketId, tx);
    }
  }

  /**
   * Row-locks a ticket for the rest of the caller's transaction and returns the
   * committed status and primary owner. Anything decided from them is decided
   * from this read, never from the read made before the transaction opened.
   * Lock order stays: ticket row first, then worker timer locks.
   *
   * FOR NO KEY UPDATE, the lock an UPDATE of this row takes anyway: it
   * serializes ticket changes against each other, but not against inserts that
   * only reference the ticket (a ticket_time_logs row's foreign key takes FOR
   * KEY SHARE), so a timer resume elsewhere never waits on a ticket edit.
   */
  private async lockTicketRow(tx: Prisma.TransactionClient, ticketId: string) {
    const [row] = await tx.$queryRaw<Array<{ status: TicketStatus; assignedToId: string | null; type: string | null }>>`
      SELECT status, "assignedToId", type::text AS type FROM "tickets" WHERE id = ${ticketId} FOR NO KEY UPDATE
    `;
    if (!row) throw new NotFoundException('Ticket not found');
    return row;
  }

  /** True while the ticket has a rework cycle that started and has not ended. */
  private async hasOpenReworkCycle(client: Prisma.TransactionClient | PrismaService, ticketId: string) {
    return !!(await client.reviewCycleLog.findFirst({
      where: { ticketId, decision: 'REWORK', reworkStartedAt: { not: null }, reworkEndedAt: null },
      select: { id: true },
    }));
  }

  /**
   * Every IN_PROGRESS ticket has a primary owner, whose timer it runs on.
   * Checked for changes that touch the status or the owner, so an edit to an
   * unrelated field never fails on someone else's earlier data.
   */
  private assertPrimaryOwnerForStatus(data: any, status: string, primaryAssigneeId: string | null | undefined) {
    if (data.status === undefined && data.assignedToId === undefined) return;
    if (status === TicketStatus.IN_PROGRESS && !primaryAssigneeId) {
      throw new BadRequestException({
        statusCode: 400,
        code: PRIMARY_ASSIGNEE_REQUIRED,
        message: 'Assign a primary owner before moving this ticket to In Progress.',
      });
    }
  }

  /**
   * Runs the side effects a committed ticket change queued. Each is isolated:
   * a failed notification is logged and never undoes, or blocks, the change.
   */
  private async runAfterCommit(afterCommit: AfterCommit) {
    for (const effect of afterCommit) {
      try {
        await effect();
      } catch (err: any) {
        this.logger.warn(`Post-commit side effect failed: ${err?.message}`);
      }
    }
  }

  private async withWorkBudgets(tickets: any[]) {
    const budgets = await Promise.resolve(this.ticketLedger?.getWorkBudgets?.(tickets))
      .then((m) => m ?? new Map())
      .catch((err: any) => {
        this.logger.error(`Work budget lookup failed: ${err?.message}`);
        return new Map();
      });
    return tickets.map((t: any) => (t?.id && budgets.has(t.id) ? { ...t, workBudget: budgets.get(t.id) } : t));
  }

  /**
   * The only shape an attachment leaves the API in: no stored url, and the
   * capabilities the backend decides. Deletion belongs to the uploader alone,
   * and never to locked evidence or a legacy (uploader unknown) attachment;
   * no role, participant or ticket ownership grants it.
   */
  sanitizeAttachmentForResponse(ticketId: string, attachment: any, viewerId?: string) {
    if (!attachment) return attachment;
    const safe = { ...attachment };
    delete safe.url;
    delete safe.reviewCycle;
    return {
      ...safe,
      purpose: attachment.purpose ?? (attachment.isPoc ? 'POC' : 'GENERAL'),
      uploadedBy: attachment.uploadedBy ? { id: attachment.uploadedBy.id, name: attachment.uploadedBy.name } : null,
      legacyProtected: !attachment.uploadedById,
      locked: Boolean(attachment.lockedAt),
      lockReason: attachment.lockReason ?? null,
      cycleNo: attachment.reviewCycle?.cycleNo ?? null,
      canDelete: Boolean(viewerId) && attachment.uploadedById === viewerId && !attachment.lockedAt,
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

  
  async getPendingApprovals(userId: string) {
    // Only tickets still waiting for sign-off: a ticket closed or otherwise
    // moved on outside processApproval() must leave the approver's queue.
    const tickets = await this.prisma.ticket.findMany({
      where: {
        approverId: userId,
        approvalState: 'PENDING',
        status: TicketStatus.PENDING_APPROVAL,
      },
      include: this.includeOptions,
      orderBy: { approvalRequestedAt: 'desc' },
    });
    return tickets.map(t => this.sanitizeTicketForResponse(t));
  }

  // Selectable recipients for cross-department QUERY/HELP routing. Deliberately
  // separate from the TASK assignee flow (usersApi.getAll() + client-side dept
  // filter) — TASK assignment stays department/team scoped exactly as before.
  // Returns only the minimal identity fields needed to route a request: never
  // the full user record (no payroll/personal fields, no archived/inactive
  // users). Employee/Intern raising a QUERY are funneled to TL/Manager of the
  // target department only; every other case (HELP of any role, or QUERY from
  // TL/Manager/Admin/SuperAdmin) may reach any active user in that department.
  async getRoutingOptions(type: string | undefined, targetDepartmentId: string | undefined, user: any) {
    const normalizedType = String(type ?? '').toUpperCase();
    if (!['QUERY', 'HELP'].includes(normalizedType)) {
      throw new BadRequestException('type must be QUERY or HELP');
    }
    if (!targetDepartmentId) {
      throw new BadRequestException('targetDepartmentId is required');
    }

    const department = await this.prisma.department.findUnique({
      where: { id: targetDepartmentId },
      select: { id: true, name: true },
    });
    if (!department) throw new NotFoundException('Target department not found');

    // QUERY and HELP are anyone-to-anyone: any active user in the target department
    // is a valid recipient, regardless of the requester's or recipient's role. Only
    // TASK assignment is role/department scoped — that flow is untouched and never
    // reaches this method.
    const where: any = { departmentId: targetDepartmentId, isActive: true };

    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: { select: { name: true } },
        department: { select: { id: true, name: true } },
        teamMemberships: { take: 1, select: { team: { select: { name: true } } } },
      },
      orderBy: { name: 'asc' },
    });

    return users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role?.name ?? null,
      departmentId: u.department?.id ?? null,
      departmentName: u.department?.name ?? null,
      teamName: u.teamMemberships?.[0]?.team?.name ?? null,
    }));
  }

  // Selectable target departments for cross-department QUERY/HELP routing. Separate
  // from GET /departments, which is scoped to the caller's own/managed department(s)
  // for every non-admin role (DepartmentsService.findAll -> managedDepartmentIds) —
  // exactly the list a QUERY/HELP requester must NOT be limited to, since the whole
  // point is asking a department they don't belong to. The Department model has no
  // isActive/archived flag today, so every department is "active"; if one is added
  // later, filtering it in here is the only change needed.
  async getRoutingDepartments(type: string | undefined) {
    const normalizedType = String(type ?? '').toUpperCase();
    if (!['QUERY', 'HELP'].includes(normalizedType)) {
      throw new BadRequestException('type must be QUERY or HELP');
    }

    const departments = await this.prisma.department.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    return departments;
  }

  async processApproval(id: string, payload: { action: 'APPROVE' | 'REJECT'; reason?: string }, user: any) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { OR: [{ id }, { ticketId: id }] },
      include: { assignedTo: true, createdBy: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    if (ticket.status !== TicketStatus.PENDING_APPROVAL || ticket.approvalState !== 'PENDING' || ticket.approvalType !== 'TASK_CREATION') {
      throw new BadRequestException('Ticket is not in a valid pending task creation state');
    }

    if (payload.action !== 'APPROVE' && payload.action !== 'REJECT') {
      throw new BadRequestException('Invalid approval action.');
    }

    if (ticket.approverId !== user.id) {
      throw new ForbiddenException('You are not the assigned approver for this ticket');
    }

    if (payload.action === 'REJECT' && !payload.reason) {
      throw new BadRequestException('Rejection reason is required');
    }

    const updated = await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        status: payload.action === 'APPROVE' ? TicketStatus.OPEN : TicketStatus.CLOSED,
        approvalState: payload.action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        approvedAt: payload.action === 'APPROVE' ? new Date() : null,
        rejectedAt: payload.action === 'REJECT' ? new Date() : null,
        approvalReason: payload.action === 'REJECT' ? payload.reason : null,
      },
      include: this.includeOptions,
    });

    try {
      await this.prisma.activityLog.create({
        data: {
          userId: user.id,
          action: payload.action === 'APPROVE' ? 'TICKET_APPROVED' : 'TICKET_REJECTED',
          entityType: 'TICKET',
          entityId: ticket.id,
          details: { ticketId: ticket.ticketId, reason: payload.reason },
        },
      });
    } catch (err) {}

    this.eventLogger.log({
      actorId: user.id,
      entityType: 'Ticket',
      entityId: ticket.id,
      action: payload.action === 'APPROVE' ? OperationalAction.TICKET_APPROVED : OperationalAction.TICKET_REJECTED,
      toState: payload.action === 'APPROVE' ? 'OPEN' : 'CLOSED',
      metadata: { ticketId: ticket.ticketId, reason: payload.reason }
    }).catch(() => {});

    try {
      await this.notificationEventService.sendNotification(
        ticket.createdById,
        'ticketStatusUpdated',
        {
          title: `Task creation ${payload.action === 'APPROVE' ? 'approved' : 'rejected'}: ${ticket.ticketId}`,
          message: ticket.title,
          type: payload.action === 'APPROVE' ? 'SUCCESS' : 'ERROR',
          link: `/tickets/${ticket.id}`,
          entityId: ticket.id,
          entityType: 'TICKET',
        }
      );
    } catch (err) {}

    this.eventEmitter.emit('ticket.updated', { ticket: updated, userId: user.id });

    return this.sanitizeTicketForResponse(updated);
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
    /** Created from / to: 'yyyy-MM-dd' is a whole company day (inclusive). */
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  }, user?: any, opts?: { orderBy?: Prisma.TicketOrderByWithRelationInput[] }) {
    const orderBy = opts?.orderBy ?? TICKET_LIST_ORDER;
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
        orderBy,
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
        orderBy,
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
      attachments: { orderBy: { createdAt: 'desc' }, include: ATTACHMENT_INCLUDE },
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
    // The same transition rule the close request is checked against, so the
    // page offers Close only to someone the backend would let close it.
    const viewerCanClose = user ? await this.ticketAccess.viewerCanClose(user, ticket) : false;
    // Ledger-derived clocks (lifecycle, productive employee time per cycle,
    // review). Read-only; a failure here must never hide the ticket itself.
    const timers = await this.ticketLedger.getTicketTimers(ticket).catch((err: any) => {
      this.logger.error(`Ticket timers failed for ${ticket.ticketId}: ${err?.message}`);
      return null;
    });
    // The cycle whose evidence is "current": the open one while in review.
    // Evidence of earlier cycles is shown as previous evidence.
    const openCycle = ticket.status === TicketStatus.REVIEW
      ? [...((ticket as any).reviewCycles ?? [])].reverse().find((c: any) => !c.decision) ?? null
      : null;
    return {
      ...decorated,
      attachments: ((ticket as any).attachments ?? []).map((a: any) => this.sanitizeAttachmentForResponse(ticket.id, a, user?.id)),
      selfAssigned,
      viewerCanApprove,
      viewerCanClose,
      timers,
      reviewTimerRequired: reviewTimerRequired(ticket),
      currentReviewCycle: openCycle ? { id: openCycle.id, cycleNo: openCycle.cycleNo } : null,
    };
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

  /** The viewer's one running clock (employee work or review), with its ticket. */
  async getActiveTimer(userId: string) {
    return this.ticketLedger.getActiveTimerForUser(userId);
  }

  private isTicketWorker(ticket: any, userId: string) {
    return ticket.assignedToId === userId ||
      Boolean(ticket.assignees?.some?.((a: any) => (a?.userId ?? a?.user?.id) === userId));
  }

  /** What an upload is for. Ownership is always the authenticated uploader. */
  private async resolveUploadPurpose(ticket: any, body: any, user: any): Promise<AttachmentPurposeValue> {
    const raw = typeof body?.purpose === 'string' && body.purpose.trim() ? body.purpose.trim().toUpperCase() : null;
    const legacyPoc = body?.isPoc === 'true' || body?.isPoc === true;
    const purpose = (raw ?? (legacyPoc ? 'POC' : 'GENERAL')) as AttachmentPurposeValue;
    if (!ATTACHMENT_PURPOSES.includes(purpose)) throw new BadRequestException(ATTACHMENT_ERRORS.INVALID_PURPOSE);
    if (purpose === 'POC') {
      const accepting = ticket.status === TicketStatus.IN_PROGRESS || ticket.status === TicketStatus.REVIEW;
      if (!accepting || !this.isTicketWorker(ticket, user.id)) throw new ForbiddenException(ATTACHMENT_ERRORS.POC_NOT_ALLOWED);
    }
    if (purpose === 'REVIEW_FEEDBACK') {
      if (ticket.status !== TicketStatus.REVIEW || !(await this.ticketAccess.viewerCanApprove(user, ticket))) {
        throw new ForbiddenException(ATTACHMENT_ERRORS.FEEDBACK_NOT_ALLOWED);
      }
    }
    return purpose;
  }

  private logAttachmentEvent(action: OperationalAction, actorId: string, ticket: any, attachment: any) {
    Promise.resolve(this.eventLogger.log({
      actorId,
      entityType: 'Ticket',
      entityId: ticket.id,
      action,
      metadata: {
        ticketId: ticket.ticketId,
        attachmentId: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.size,
        purpose: attachment.purpose,
        reviewCycleId: attachment.reviewCycleId ?? null,
      },
    })).catch(() => {});
  }

  /**
   * Upload. Access and purpose are checked first, then the file is stored,
   * then its row is written under the ticket row lock, so it never races a
   * submission binding proof to its cycle. A row that cannot be written gets
   * its stored file discarded.
   */
  async uploadAttachment(id: string, file: IncomingAttachmentFile, body: any, user: any, storage: AttachmentStorage) {
    if (!file) throw new BadRequestException('No file uploaded');
    const ticket = await this.findTicketForReview(id, user);
    await this.assertCanUploadAttachment(user, ticket);
    const purpose = await this.resolveUploadPurpose(ticket, body, user);
    const url = await storage.store(ticket.id, file);
    let created: any;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const locked = await this.lockTicketRow(tx, ticket.id);
        const data: Prisma.AttachmentUncheckedCreateInput = {
          ticketId: ticket.id,
          filename: file.originalname,
          url,
          size: file.size,
          mimeType: file.mimetype,
          uploadedById: user.id,
          purpose,
          isPoc: purpose === 'POC',
          pocFor: purpose === 'POC' ? ticket.id : null,
        };
        // Re-checked under the lock: the ticket may have moved since.
        if (purpose === 'REVIEW_FEEDBACK' && locked.status !== TicketStatus.REVIEW) {
          throw new ConflictException(REVIEW_ERRORS.NOT_IN_REVIEW);
        }
        if (purpose === 'POC' && locked.status !== TicketStatus.IN_PROGRESS && locked.status !== TicketStatus.REVIEW) {
          throw new ForbiddenException(ATTACHMENT_ERRORS.POC_NOT_ALLOWED);
        }
        if ((purpose === 'POC' || purpose === 'REVIEW_FEEDBACK') && locked.status === TicketStatus.REVIEW) {
          const cycle = await this.ticketLedger.findOpenReviewCycle(ticket.id, tx);
          if (cycle) data.reviewCycleId = cycle.id;
          // Proof added while under review is evidence of record at once;
          // reviewer feedback locks when the decision completes.
          if (purpose === 'POC') {
            data.lockedAt = this.tva.now();
            data.lockReason = ATTACHMENT_LOCK_REASONS.SUBMITTED_FOR_REVIEW;
          }
        }
        return tx.attachment.create({ data, include: ATTACHMENT_INCLUDE });
      });
    } catch (err) {
      await storage.discard(url).catch(() => undefined);
      throw err;
    }
    this.logAttachmentEvent(OperationalAction.ATTACHMENT_UPLOADED, user.id, ticket, created);
    return this.sanitizeAttachmentForResponse(ticket.id, created, user.id);
  }

  /**
   * Delete: only the uploader, never locked evidence, never a legacy
   * attachment whose uploader is unknown. Locked evidence answers 409 to every
   * caller. Decided under the ticket row lock against the stored row, so a
   * submission locking this proof at the same moment either wins (409 here)
   * or finds it already gone.
   */
  async deleteAttachment(id: string, attachmentId: string, user: any) {
    const ticket = await this.findTicketForReview(id, user);
    await this.assertCanUploadAttachment(user, ticket);
    const removed = await this.prisma.$transaction(async (tx) => {
      await this.lockTicketRow(tx, ticket.id);
      const attachment = await tx.attachment.findFirst({ where: { id: attachmentId, ticketId: ticket.id } });
      if (!attachment) throw new NotFoundException('Attachment not found');
      if (!attachment.uploadedById) throw new ForbiddenException(ATTACHMENT_ERRORS.LEGACY_PROTECTED);
      if (attachment.lockedAt) throw new ConflictException(ATTACHMENT_ERRORS.LOCKED);
      if (attachment.uploadedById !== user.id) throw new ForbiddenException(ATTACHMENT_ERRORS.NOT_OWNER);
      await tx.attachment.delete({ where: { id: attachment.id } });
      return attachment;
    });
    this.logAttachmentEvent(OperationalAction.ATTACHMENT_DELETED, user.id, ticket, removed);
    return { success: true };
  }

  /**
   * Submit for review with optional proof of completion, as one operation.
   * The submission is validated first (the same rules as any move to
   * REVIEW); only then is the proof stored. The status change, the review
   * cycle and the proof's row (bound to that cycle and locked) commit
   * together; if they do not, the stored file is discarded, so a failed
   * submission leaves no evidence behind. Without a file this is the plain
   * submission ("Skip for now").
   */
  async submitForReview(id: string, user: any, file: IncomingAttachmentFile | undefined, storage: AttachmentStorage) {
    const ticket = await this.findTicketForReview(id, user);
    if (ticket.status === TicketStatus.REVIEW) throw new ConflictException(REVIEW_ERRORS.ALREADY_IN_REVIEW);
    if (file) await this.assertCanUploadAttachment(user, ticket);
    const prepared = await this.prepareUpdate(ticket.id, { status: TicketStatus.REVIEW }, user.id, user);
    const url = file ? await storage.store(ticket.id, file) : null;
    const afterCommit: AfterCommit = [];
    let proof: any = null;
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.commitUpdate(tx, prepared, user.id, undefined, afterCommit);
        if (file && url) {
          const cycle = await this.ticketLedger.findOpenReviewCycle(ticket.id, tx);
          proof = await tx.attachment.create({
            data: {
              ticketId: ticket.id,
              filename: file.originalname,
              url,
              size: file.size,
              mimeType: file.mimetype,
              uploadedById: user.id,
              purpose: 'POC',
              isPoc: true,
              pocFor: ticket.id,
              reviewCycleId: cycle?.id ?? null,
              lockedAt: prepared.now,
              lockReason: ATTACHMENT_LOCK_REASONS.SUBMITTED_FOR_REVIEW,
            },
          });
        }
      }, TIMER_TRANSACTION);
    } catch (err) {
      if (url) await storage.discard(url).catch(() => undefined);
      throw err;
    }
    await this.runAfterCommit(afterCommit);
    if (proof) this.logAttachmentEvent(OperationalAction.ATTACHMENT_UPLOADED, user.id, ticket, proof);
    return this.findOne(ticket.id, user);
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

    // A new ticket starts OPEN (the column default) or PENDING_APPROVAL (set
    // below). Creation never puts a ticket straight into work, so a client
    // cannot create one IN_PROGRESS without its timer.
    delete data.status;

    // Enforce self-assign for EMPLOYEE / INTERN — TASK only. QUERY/HELP are
    // requests directed AT someone else (often in another department), so
    // forcing them back onto the creator would defeat cross-department routing.
    const creatorRole: string = user?.role?.name ?? user?.role ?? '';
    const requestType = String(data.type ?? 'TASK').toUpperCase();
    if (['EMPLOYEE', 'INTERN'].includes(creatorRole) && requestType === 'TASK') {
      data.assignedToId = userId;
      assigneeIds = [userId];
    }

    // Self-assigned Employee/Intern TASK starts OPEN — no creation approval gate.
    // The force-assign above (data.assignedToId = userId) means this branch is never
    // reached today, but it is kept so that if a future change allows assigning to
    // others, creation approval is automatically restored for that path.
    if (['EMPLOYEE', 'INTERN'].includes(creatorRole) && data.type === 'TASK' && data.assignedToId !== userId) {
      const tl = await this.hierarchyApprovalService.resolveTaskCreationApprover(userId);
      if (!tl) {
        throw new BadRequestException('Team Lead approval is required but no active Team Lead could be resolved.');
      }
      data.status = 'PENDING_APPROVAL';
      data.approvalState = 'PENDING';
      data.approvalType = 'TASK_CREATION';
      data.approverId = tl.id;
      data.approvalRequestedAt = this.tva.now().toISOString();
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

    // ── Cross-department routing for QUERY / HELP ────────────────────────────
    // TASK keeps its existing department-scoped assignee flow untouched (no
    // change above this block for TASK). QUERY/HELP may target a person in a
    // different department; the dormant Ticket fields (requesting/target
    // Department/TeamId, isCrossDepartment) capture that routing so visibility
    // (buildScopeWhere's existing assignedTo.departmentId clause) and reporting
    // can distinguish "asked of" from "owned by" without any schema change.
    if (['QUERY', 'HELP'].includes(requestType)) {
      const requestingDepartmentId: string | undefined = data.departmentId;
      let targetDepartmentId: string | undefined = data.targetDepartmentId;
      delete data.targetDepartmentId; // not a direct Ticket column name — reassigned below once resolved

      if (targetDepartmentId && !isUUID(targetDepartmentId)) {
        const dept = await this.prisma.department.findFirst({
          where: { OR: [{ id: targetDepartmentId }, { name: { equals: targetDepartmentId, mode: 'insensitive' } }] },
          select: { id: true },
        });
        targetDepartmentId = dept?.id ?? undefined;
      }

      if (targetDepartmentId) {
        // Defense in depth: the routing-options endpoint already restricts who
        // can be selected, but the client is never the source of truth — re-check
        // that the chosen recipient actually belongs to the target department.
        if (data.assignedToId) {
          const targetUser = await this.prisma.user.findUnique({
            where: { id: data.assignedToId },
            select: { isActive: true, departmentId: true, role: { select: { name: true } } },
          });
          if (!targetUser || !targetUser.isActive || targetUser.departmentId !== targetDepartmentId) {
            throw new BadRequestException('Selected recipient is not an active member of the target department');
          }

          // QUERY-specific hierarchy requirement: employees/interns can only route QUERY to TL/Manager/Admin/SuperAdmin
          if (requestType === 'QUERY' && ['EMPLOYEE', 'INTERN'].includes(creatorRole)) {
            const tlManagerRoles = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'];
            if (!tlManagerRoles.includes(targetUser.role?.name ?? '')) {
              throw new ForbiddenException('Employees can only route Queries to Team Leads, Managers, or Admins');
            }
          }
        }

        data.requestingDepartmentId = requestingDepartmentId;
        data.targetDepartmentId = targetDepartmentId;
        data.isCrossDepartment = Boolean(requestingDepartmentId && requestingDepartmentId !== targetDepartmentId);

        const [requestingTeamMember, targetTeamMember] = await Promise.all([
          requestingDepartmentId
            ? this.prisma.teamMember.findFirst({ where: { userId }, select: { teamId: true } })
            : Promise.resolve(null),
          data.assignedToId
            ? this.prisma.teamMember.findFirst({ where: { userId: data.assignedToId }, select: { teamId: true } })
            : Promise.resolve(null),
        ]);
        if (requestingTeamMember?.teamId) data.requestingTeamId = requestingTeamMember.teamId;
        if (targetTeamMember?.teamId) data.targetTeamId = targetTeamMember.teamId;
      }
    } else {
      // TASK (and any other non-routing type): a raw payload could otherwise smuggle
      // cross-department routing metadata onto a ticket that isn't a QUERY/HELP —
      // these are real Ticket columns, so an unfiltered spread would persist them.
      delete data.targetDepartmentId;
      delete data.requestingDepartmentId;
      delete data.requestingTeamId;
      delete data.targetTeamId;
      delete data.isCrossDepartment;
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
    const nowMs = this.tva.now().getTime();
    const baseForExec = scheduledBase && scheduledBase.getTime() > nowMs ? scheduledBase : null;
    const executionDueAt = this.calcExecutionDueAt(
      baseForExec,
      actualBase,
      data.estimatedMinutes,
    );
    // Never store an executionDueAt that is already in the past
    if (executionDueAt && executionDueAt.getTime() > nowMs) {
      data.executionDueAt = executionDueAt;
    }

    return { data, assigneeIds };
  }

  // "New ticket assigned" is honest for a TASK but misleading for a cross-department
  // QUERY/HELP request — the recipient hasn't been handed ownership of anything,
  // they've been asked something. Keeps the same event key/recipients/notification
  // mechanics; only the display text changes.
  private ticketAssignedTitle(type: any, ticketId: string, reassigned = false): string {
    if (type === 'QUERY') return `New query routed to you: ${ticketId}`;
    if (type === 'HELP') return `New help request routed to you: ${ticketId}`;
    return reassigned ? `Ticket assigned to you: ${ticketId}` : `New ticket assigned: ${ticketId}`;
  }

  // Resolves who should be notified that a ticket just entered REVIEW. Self-assigned
  // tickets have a single resolved approver chain — the exact same one enforced at
  // transition time — so that's reused directly. Regular (including cross-department
  // QUERY/HELP) assignments have no single stored "approver", so candidates are
  // filtered through the existing canViewTicket() scope check: the same rule that
  // already governs who may see/act on the ticket, meaning this can never notify
  // someone who isn't actually allowed to review it. Always excludes the assignee.
  private async resolveReviewNotificationRecipients(ticket: any): Promise<string[]> {
    try {
      if (this.ticketAccess.isSelfAssigned(ticket)) {
        if (ticket.approverId) return [ticket.approverId];
        const primary = await this.hierarchyApprovalService.resolvePrimaryApproverFor(ticket.createdById);
        return primary ? [primary.id] : [];
      }

      const candidates = await this.prisma.user.findMany({
        where: {
          isActive: true,
          id: { not: ticket.assignedToId ?? '' },
          role: { name: { in: ['TEAM_LEAD', 'MANAGER'] } },
        },
        select: { id: true, departmentId: true, role: { select: { name: true } } },
      });

      const recipients: string[] = [];
      for (const candidate of candidates) {
        if (await this.ticketAccess.canViewTicket(candidate, ticket.id)) recipients.push(candidate.id);
      }
      return recipients;
    } catch {
      return [];
    }
  }

  // Shared by create() and createBulk(): the rows a new ticket needs besides
  // itself (its assignees and the activity log entry). Written inside the
  // creating transaction, so they exist exactly when the ticket does.
  private async writeTicketCreationRecords(
    tx: Prisma.TransactionClient,
    ticket: any,
    assigneeIds: string[],
    userId: string,
  ) {
    if (assigneeIds.length > 0) {
      await tx.ticketAssignee.createMany({
        data: assigneeIds.map((uid) => ({ ticketId: ticket.id, userId: uid })),
        skipDuplicates: true,
      });
    }
    await tx.activityLog.create({
      data: {
        userId,
        action: 'TICKET_CREATED',
        entityType: 'TICKET',
        entityId: ticket.id,
        details: { ticketId: ticket.ticketId, title: ticket.title, category: ticket.category, priority: ticket.priority },
      },
    });
  }

  // Shared by create() and createBulk(): notifications, websocket and event-bus
  // events and the operational event log for a ticket whose creation has
  // already committed. Never runs for a creation that rolled back.
  private async fireTicketCreatedSideEffects(ticket: any, assigneeIds: string[], userId: string) {
    // Notify each additional assignee
    for (const uid of assigneeIds) {
      if (uid === ticket.assignedToId) continue; // primary assignee notified below
      try {
        await this.notificationEventService.sendNotification(
          uid,
          'assignedTicket',
          {
            title: this.ticketAssignedTitle(ticket.type, ticket.ticketId),
            message: ticket.title,
            type: NotificationType.INFO,
            link: `/tickets/${ticket.id}`,
            entityId: ticket.id,
            entityType: 'TICKET',
          }
        );
      } catch (_e) { /* never crash main op */ }
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
            title: this.ticketAssignedTitle(ticket.type, ticket.ticketId),
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

  // Human ticket creation (POST /tickets and POST /tickets/bulk, which also
  // carries Excel import) requires the creator to be punched in, for every
  // role. There is no system-owned creation path today: seed scripts write
  // through Prisma directly and the scheduler only sends reminders for
  // existing tickets. A future system path must not call create()/createBulk()
  // and must document why it is exempt.
  //
  // The policy check, the ticket, its assignees and its activity log commit in
  // one transaction that share-locks the creator's open work session, so a
  // concurrent Punch Out or auto-close either finishes first (creation is then
  // refused) or waits until the ticket exists. Creation never starts a timer.
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
    // stay correct when concurrent inserts race for the same number. A P2002
    // aborts the PostgreSQL transaction, so each attempt is its own
    // transaction and re-checks the workday policy.
    let ticket: any;
    const maxAttempts = 25;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Jitter after the first attempt spreads simultaneous creators apart to
      // avoid thundering-herd collisions under heavy concurrency.
      const jitter = attempt === 0 ? 0 : Math.floor(Math.random() * (attempt + 1));
      let ticketId = '';
      try {
        ticket = await this.prisma.$transaction(async (tx) => {
          await this.activeWorkdayPolicy.assertActiveWorkdayLocked(tx, userId);

          // Re-read the high-water mark each attempt so concurrent inserts already
          // committed by other requests are taken into account. The regex guard
          // ignores any malformed/legacy IDs so the CAST never errors, and the
          // numeric CAST keeps ordering correct beyond TKT-999 (lexical sort would
          // place "TKT-1000" before "TKT-999").
          const rows = await tx.$queryRaw<Array<{ max: number }>>`
            SELECT COALESCE(MAX(CAST(SUBSTRING("ticketId" FROM 5) AS INTEGER)), 0)::int AS max
            FROM "tickets"
            WHERE "ticketId" ~ '^TKT-[0-9]+$'
          `;
          const highWaterMark = Number(rows?.[0]?.max ?? 0);
          ticketId = `TKT-${String(highWaterMark + 1 + attempt + jitter).padStart(3, '0')}`;
          const created = await tx.ticket.create({
            data: { ...data, ticketId, createdById: userId },
            include: this.includeOptions,
          });
          await this.writeTicketCreationRecords(tx, created, assigneeIds, userId);
          return created;
        }, TIMER_TRANSACTION);
        break;
      } catch (err: any) {
        if (err instanceof ConflictException) throw err;
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

    // Planning sanity: a scheduled start may not be after the due date/time. Compared on
    // the normalized instants so timezone is respected (applies to bulk + Excel import).
    if (data.scheduledStartAt && data.dueDate) {
      const startMs = new Date(data.scheduledStartAt).getTime();
      const dueMs = new Date(data.dueDate).getTime();
      if (!Number.isNaN(startMs) && !Number.isNaN(dueMs) && startMs > dueMs) {
        errors.push('Start Date/Time cannot be after Due Date/Time');
      }
    }

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
  // instead of leaving a partial batch behind. The same transaction checks the
  // creator is punched in (see create()) and writes each ticket's assignees and
  // activity log. Notifications, websocket events and the operational event log
  // run only after it commits — they must never be the reason a successful
  // creation gets rolled back, and never announce one that rolled back.
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
        await this.activeWorkdayPolicy.assertActiveWorkdayLocked(tx, userId);
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
          await this.writeTicketCreationRecords(tx, ticket, row.assigneeIds, userId);
          created.push(ticket);
        }
        return created;
      }, TIMER_TRANSACTION);
    } catch (err: any) {
      if (err instanceof ConflictException) throw err;
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

  async update(
    id: string,
    data: any,
    userId: string,
    user?: any,
    opts?: UpdateOptions,
  ) {
    const prepared = await this.prepareUpdate(id, data, userId, user, opts);
    const afterCommit: AfterCommit = [];
    const ticket = await this.prisma.$transaction(
      (tx) => this.commitUpdate(tx, prepared, userId, opts, afterCommit),
      TIMER_TRANSACTION,
    );
    await this.runAfterCommit(afterCommit);
    return this.addSla(ticket);
  }

  /**
   * Validation, access checks and field derivation for update(). Reads only:
   * every write happens in commitUpdate(), inside one transaction with the
   * timer change it requires.
   */
  private async prepareUpdate(
    id: string,
    data: any,
    userId: string,
    user?: any,
    opts?: UpdateOptions,
  ) {
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

    // The type decides the workflow (TASK / QUERY / HELP approval and routing
    // rules); it is fixed at creation. Re-sending the current type is a no-op.
    if (data.type !== undefined) {
      if (String(data.type) !== String(existing.type)) throw new ConflictException(TICKET_TYPE_LOCKED);
      delete data.type;
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
        await this.ticketAccess.assertCanUpdateTicket(user, existing, data);
      }
    }

    // Starting work needs a primary owner, whose timer the move starts. Assigning
    // one in the same request is fine; secondary assignees alone never are.
    // Checked only after the permission checks above (403 before this 400), and
    // re-checked against the locked row in commitUpdate().
    this.assertPrimaryOwnerForStatus(
      data,
      data.status ?? existing.status,
      data.assignedToId !== undefined ? data.assignedToId : existing.assignedToId,
    );

    // A ticket in REVIEW completes only through approve(), which records the
    // review decision; a plain status change would leave the cycle undecided.
    if (existing.status === TicketStatus.REVIEW && data.status === TicketStatus.DONE && !opts?.reviewDecisionRecorded) {
      throw new ConflictException(REVIEW_ERRORS.DECISION_REQUIRED);
    }

    // Ticket lifecycle stamps below come from the TVA clock, like the timer ledger.
    const now = this.tva.now();

    // ── REVIEW → IN_PROGRESS (rework): reset review stamps + recalculate executionDueAt ──
    // Every send-back opens a new rework cycle, whichever path it came from.
    // reject() records its own decision (with feedback and the rework
    // estimate); a direct status change (Kanban, stepper) is recorded by
    // commitUpdate(), in the same transaction as the status write.
    // The ticket's own worker pulling a submission back before any reviewer
    // decision is a WITHDRAWAL, not rework: no rework count, cycle, estimate or
    // REWORK timer. Everyone else sending it back is a reviewer's REWORK.
    const isReviewExit = data.status === TicketStatus.IN_PROGRESS && existing.status === TicketStatus.REVIEW;
    const isWithdrawal = isReviewExit && !opts?.reviewDecisionRecorded &&
      (opts?.withdrawal === true || userId === existing.assignedToId);
    const isRework = isReviewExit && !isWithdrawal;
    const recordReworkDecision = isRework && !opts?.reviewDecisionRecorded;
    if (isWithdrawal) {
      // The review clock for this submission ends; the cycle keeps its honest
      // history. executionDueAt is left as it was.
      data.submittedAt = null;
      data.reviewStartedAt = null;
      data.reviewDueAt = null;
    }
    if (isRework) {
      data.reworkCount = { increment: 1 };
      data.submittedAt = null;
      data.reviewStartedAt = null;
      data.reviewDueAt = null;
      data.actualStartAt = existing.actualStartAt ?? now;
      // A rework cycle is due on its own estimate, never the original one; a
      // cycle without an estimate has no due time.
      const reworkEstimatedMinutes = opts?.reworkEstimatedMinutes ?? null;
      data.executionDueAt = reworkEstimatedMinutes
        ? new Date(now.getTime() + reworkEstimatedMinutes * 60_000)
        : null;
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
        data.executionDueAt = new Date(now.getTime() + existing.estimatedMinutes * 60_000);
      }
    }

    // ── Execution timer: stamp actualStartAt + executionDueAt ────────────────
    if (data.status === TicketStatus.IN_PROGRESS && !existing.actualStartAt && !data.actualStartAt) {
      data.actualStartAt = now;
    }
    if (data.status === TicketStatus.IN_PROGRESS && !isReviewExit && !existing.executionDueAt) {
      const base: Date = existing.scheduledStartAt ?? data.actualStartAt ?? now;
      const mins: number | null | undefined = existing.estimatedMinutes;
      const due = this.calcExecutionDueAt(base, null, mins);
      if (due) data.executionDueAt = due;
    }

    // ── Recalculate executionDueAt when estimatedMinutes is updated ───────────
    // estimatedMinutes is the ORIGINAL cycle's estimate. While a rework cycle is
    // open its due date belongs to that cycle's own estimate, so editing the
    // original estimate leaves the rework due date as it is.
    // This read is before the transaction; commitUpdate() re-checks it under
    // the ticket row lock, because a rework can open in between.
    const reworkCycleOpen = isRework || (
      data.estimatedMinutes !== undefined && await this.hasOpenReworkCycle(this.prisma, ticketDbId)
    );
    let dueFromOriginalEstimate = false;
    if (data.estimatedMinutes !== undefined && !existing.submittedAt && !reworkCycleOpen) {
      const baseTime = existing.actualStartAt || existing.scheduledStartAt;
      if (baseTime) {
        const newExecutionDueAt = new Date(
          new Date(baseTime).getTime() + data.estimatedMinutes * 60_000,
        );
        data.executionDueAt = newExecutionDueAt;
        dueFromOriginalEstimate = true;
      }
    }

    // ── Review timer: stamp submittedAt + reviewStartedAt + reviewDueAt ──────
    // Captured before the mutation below so the post-update notification block
    // can tell "freshly entered REVIEW" apart from "already in REVIEW" without
    // re-deriving it from a field this same call is about to change.
    const enteringReview = data.status === TicketStatus.REVIEW && !existing.submittedAt;
    if (enteringReview) {
      data.submittedAt = now;
      data.reviewStartedAt = now;
      const reviewHours = await this.getReviewSlaHoursForPriority(existing.priority);
      data.reviewDueAt = new Date(now.getTime() + reviewHours * 3_600_000);
    }

    // ── Completion stamps ────────────────────────────────────────────────────
    if (data.status === TicketStatus.DONE) {
      if (!existing.actualCompletedAt && !data.actualCompletedAt) data.actualCompletedAt = now;
      if (!existing.closedAt) data.closedAt = now;
      data.resolvedAt = now;
    }

    if (data.status === TicketStatus.CLOSED) {
      if (!existing.actualCompletedAt && !data.actualCompletedAt) data.actualCompletedAt = now;
      if (!existing.closedAt) data.closedAt = now;
      if (!existing.cancelledAt) data.cancelledAt = now;
      data.resolvedAt = now;
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

    return { existing, ticketDbId, data, assigneeIds, historyEntries, enteringReview, recordReworkDecision, isWithdrawal, now, dueFromOriginalEstimate, actor: user };
  }

  /**
   * Every write of an update, in the caller's transaction: the review/rework
   * decision a direct REVIEW → IN_PROGRESS needs, the ticket row, its history
   * and activity rows, the employee timer change the new status/assignee
   * requires, the next-ticket auto-resume, and the secondary assignees. A
   * timer failure throws and rolls all of it back (a one-active-timer conflict
   * surfaces as 409). Notifications, websocket events and the operational
   * event log are queued in `afterCommit` and only run once this has committed.
   */
  private async commitUpdate(
    tx: Prisma.TransactionClient,
    prepared: Awaited<ReturnType<TicketsService['prepareUpdate']>>,
    userId: string,
    opts: UpdateOptions | undefined,
    afterCommit: AfterCommit,
  ) {
    const { existing, ticketDbId, data, assigneeIds, historyEntries, enteringReview, recordReworkDecision, isWithdrawal, now, dueFromOriginalEstimate } = prepared;

    // The owner check in prepareUpdate() read the ticket before this transaction.
    // Re-check the final state against the locked, committed row: a concurrent
    // unassign may have removed the owner since.
    const locked = await this.lockTicketRow(tx, ticketDbId);
    // CLOSED is final. A change prepared before a concurrent close committed
    // (a second close, a status change, an edit) must not write again.
    if (locked.status === TicketStatus.CLOSED) {
      throw new ConflictException(TICKET_ALREADY_CLOSED);
    }
    this.assertPrimaryOwnerForStatus(
      data,
      data.status ?? locked.status,
      data.assignedToId !== undefined ? data.assignedToId : locked.assignedToId,
    );

    // A due date prepared from the original estimate must not land on a rework
    // that opened after prepareUpdate() looked: every rework start takes this
    // same row lock, so under it the open-cycle answer is final.
    if (dueFromOriginalEstimate && await this.hasOpenReworkCycle(tx, ticketDbId)) {
      delete data.executionDueAt;
    }

    // A change prepared against a ticket in REVIEW must still find it in REVIEW:
    // otherwise another decision (approve, reject, withdrawal) committed first.
    if (existing.status === TicketStatus.REVIEW && locked.status !== TicketStatus.REVIEW && data.status !== undefined) {
      throw new ConflictException(REVIEW_ERRORS.ALREADY_DECIDED);
    }

    // Every rule for a status or owner change (transition matrix, role and
    // scope, self-assigned hierarchy, close permission) and every field derived
    // from it (review, rework and completion stamps) was decided from the
    // pre-transaction read. If the locked row's status or primary owner is no
    // longer that state, nothing prepared from it is written: the caller
    // retries, and the retry re-runs every rule against the current row.
    if (
      (data.status !== undefined || data.assignedToId !== undefined) &&
      (locked.status !== existing.status || (locked.assignedToId ?? null) !== (existing.assignedToId ?? null))
    ) {
      throw new ConflictException(TICKET_CHANGED);
    }

    // A reviewer's direct send-back (Kanban, stepper) is a review decision:
    // the same authority, claim and running-review rules as reject().
    if (recordReworkDecision && reviewTimerRequired(locked)) {
      await this.assertReviewAuthorityLocked(tx, ticketDbId, userId, prepared.actor);
      await this.assertReviewTimerRunning(tx, ticketDbId, userId);
    }

    // Leaving REVIEW, or changing the assignee while in it, stops any running
    // reviewer clock first, so the decision below freezes its final seconds.
    // A reviewer clock never resumes by itself.
    const leavingReview = locked.status === TicketStatus.REVIEW && (
      (data.status !== undefined && data.status !== TicketStatus.REVIEW) ||
      (data.assignedToId !== undefined && data.assignedToId !== locked.assignedToId)
    );
    let reviewersStopped: string[] = [];
    // Once the ticket leaves REVIEW (decision, withdrawal, close, reopen), its
    // "Review needed" notifications are no longer actionable: they are marked
    // read in this transaction, so the reviewer's reminders stop exactly when
    // the decision commits, and a rolled-back change leaves them untouched.
    if (locked.status === TicketStatus.REVIEW && data.status !== undefined && data.status !== TicketStatus.REVIEW) {
      await tx.notification.updateMany({
        where: {
          entityType: 'TICKET',
          entityId: ticketDbId,
          isRead: false,
          title: { startsWith: REVIEW_NEEDED_TITLE_PREFIX },
        },
        data: { isRead: true },
      });
    }
    if (leavingReview) {
      const stopped = await this.ticketLedger.endActiveLogsForTicket(
        ticketDbId,
        isWithdrawal ? LEDGER_PAUSE_REASONS.REVIEW_WITHDRAWN
          : recordReworkDecision || opts?.reviewDecisionRecorded ? LEDGER_PAUSE_REASONS.REVIEW_DECISION
          : LEDGER_PAUSE_REASONS.REVIEW_ENDED,
        undefined,
        tx,
      );
      reviewersStopped = stopped.userIds;
    }

    // Leaving REVIEW back to OPEN, or closing (cancelling) it, ends the open
    // cycle as CANCELLED: never a reviewer decision, never left open for the
    // next submission to inherit.
    if (
      locked.status === TicketStatus.REVIEW &&
      (data.status === TicketStatus.OPEN || data.status === TicketStatus.CLOSED)
    ) {
      await this.persistReviewDecision(existing, 'CANCELLED', null, undefined, tx);
    }

    if (isWithdrawal) {
      await this.persistReviewDecision(existing, 'WITHDRAWN', null, undefined, tx);
    }
    if (recordReworkDecision) {
      await this.persistReviewDecision(existing, 'REWORK', userId, { reworkStartedAt: now }, tx);
    }

    const ticket = await tx.ticket.update({
      where: { id: ticketDbId },
      data,
      include: this.includeOptions,
    });

    if (historyEntries.length > 0) {
      await tx.ticketHistory.createMany({ data: historyEntries });
    }

    // Entering REVIEW opens the review cycle now (submission time), so the
    // turnaround clock and any reviewer work belong to a real cycle.
    if (data.status === TicketStatus.REVIEW && locked.status !== TicketStatus.REVIEW) {
      const cycle = (await this.ticketLedger.findOpenReviewCycle(ticket.id, tx)) ??
        await this.ticketLedger.startReviewCycle({
          ticketId: ticket.id,
          assigneeId: this.primaryAssigneeId(ticket),
          reviewStartedAt: ticket.reviewStartedAt ?? now,
        }, tx);
      // Proof uploaded for this submission and not yet bound to any cycle
      // becomes this cycle's evidence of record, locked, in this transaction.
      // Legacy attachments (uploader unknown) are never bound to a cycle.
      await tx.attachment.updateMany({
        where: { ticketId: ticket.id, purpose: 'POC', reviewCycleId: null, lockedAt: null, uploadedById: { not: null } },
        data: { reviewCycleId: cycle.id, lockedAt: now, lockReason: ATTACHMENT_LOCK_REASONS.SUBMITTED_FOR_REVIEW },
      });
    }

    const action = data.status ? 'STATUS_CHANGED' : data.assignedToId ? 'TICKET_ASSIGNED' : 'TICKET_UPDATED';
    // Non-status, non-assign edits → TICKET_UPDATED audit
    if (!data.status && !data.assignedToId) {
      afterCommit.push(() => this.eventLogger.log({ actorId: userId, entityType: 'Ticket', entityId: ticketDbId, action: OperationalAction.TICKET_UPDATED, metadata: { ticketId: existing.ticketId, fields: Object.keys(data) } }));
    }

    await tx.activityLog.create({
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
      // ── Actual worked-time ledger: start on entering IN_PROGRESS, end on leaving it ──
      // This is the real worked-time tracker (TicketTimeLog via TicketLedgerService) —
      // entirely separate from the SLA/due-date countdown (TicketTimingService), which
      // is untouched here and correctly keeps running regardless of break/end-day.
      // The clock always belongs to the ticket's primary assignee; `userId` (the
      // actor) is only the audit actor, so a manager or reviewer moving the ticket
      // never gets a timer. Runs in this transaction: a ledger failure rolls the
      // status transition back instead of leaving it without its timer change.
      if (data.status === TicketStatus.IN_PROGRESS && existing.status !== TicketStatus.IN_PROGRESS) {
        if (ticket.assignedToId) {
          // A withdrawal resumes normal WORK and never displaces another
          // running clock (RESUME): if the worker is not working, or is timing
          // something else, the ticket waits for the normal auto-resume.
          await this.ticketLedger.startAssigneeTimer({
            ticketId: ticket.id,
            workerId: ticket.assignedToId,
            mode: isWithdrawal ? 'RESUME' : 'START',
            source: LEDGER_SOURCES.TICKET_STATUS,
            ...(isWithdrawal ? { stage: LEDGER_STAGES.WORK } : {}),
          }, tx);
        }
      } else if (data.status !== TicketStatus.IN_PROGRESS) {
        // Whoever holds the clock, it stops: nobody times a ticket that is not
        // IN_PROGRESS. Decided from the status just written (this transaction
        // holds the ticket row), not from the pre-transaction read: the worker
        // locks taken here also make a timer start that raced this change
        // either visible (and closed) or wait and find the ticket ineligible.
        const ended = await this.ticketLedger.endActiveLogsForTicket(
          ticket.id, LEDGER_PAUSE_REASONS.STATUS_CHANGE, undefined, tx,
          [existing.assignedToId, ticket.assignedToId],
        );
        if (data.status !== TicketStatus.OPEN && (existing.status === TicketStatus.IN_PROGRESS || ended.count > 0)) {
          await this.ticketLedger.closeReworkSegment(ticket.id, undefined, tx);
        }
        await this.resumeNextWaitingFor(ended.userIds, ticket.id, tx);
      }

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
        afterCommit.push(() => this.eventLogger.log({ actorId: userId, entityType: 'Ticket', entityId: ticket.id, action: mappedAction, fromState: existing.status, toState: data.status, metadata: { ticketId: ticket.ticketId } }));
      }
      afterCommit.push(() => this.eventEmitter.emit('ticket.status_changed', {
        ticket,
        oldStatus: existing.status,
        newStatus: data.status,
        userId,
      }));
      afterCommit.push(() => this.gateway.emitTicketStatusChanged(ticket.id, data.status, userId));

      if (data.status === TicketStatus.DONE || data.status === TicketStatus.CLOSED) {
        // Notify reporter (createdBy) that their ticket is done.
        // Suppressed when called from approve() which sends its own targeted notification
        // to prevent duplicate "Ticket resolved" + "Ticket approved" spam to the same user.
        if (!opts?.suppressCompletionNotification && existing.createdById && existing.createdById !== userId) {
          afterCommit.push(() => this.notificationEventService.sendNotification(
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
          ));
        }
      } else if (data.status === TicketStatus.REVIEW && enteringReview) {
        // Notify whoever is actually responsible for reviewing this ticket — never
        // the submitter. A resolution failure can only skip the notification.
        afterCommit.push(async () => {
          const recipients = await this.resolveReviewNotificationRecipients(ticket);
          for (const recipientId of recipients) {
            if (recipientId === userId) continue;
            await this.notificationEventService.sendNotification(
              recipientId,
              'reviewPending',
              {
                title: `${REVIEW_NEEDED_TITLE_PREFIX} ${ticket.ticketId}`,
                message: `${ticket.title} is awaiting your review`,
                type: NotificationType.WARNING,
                link: `/tickets/${ticket.id}`,
                entityId: ticket.id,
                entityType: 'TICKET',
              }
            );
          }
        });
      }
    }

    // Reassigning a ticket that stays IN_PROGRESS hands the clock over: the old
    // assignee's segment ends, and the new assignee's starts only if they are
    // working and not already timing another ticket (an assignment never
    // silently pauses someone else's current work). Same transaction as the
    // reassignment: a failed handover never leaves two owners or none.
    const reassignedInProgress =
      data.assignedToId !== undefined &&
      data.assignedToId !== existing.assignedToId &&
      existing.status === TicketStatus.IN_PROGRESS &&
      ticket.status === TicketStatus.IN_PROGRESS;
    if (reassignedInProgress) {
      // Both the old and the new primary assignee are locked up front, in one
      // sorted order, before the old clock is closed and the new one started.
      const ended = await this.ticketLedger.endActiveLogsForTicket(
        ticket.id, LEDGER_PAUSE_REASONS.UNASSIGNED, undefined, tx,
        [existing.assignedToId, ticket.assignedToId],
      );
      // The previous assignee moves on to their next waiting ticket.
      await this.resumeNextWaitingFor(ended.userIds, ticket.id, tx);
      if (ticket.assignedToId) {
        await this.ticketLedger.startAssigneeTimer({
          ticketId: ticket.id,
          workerId: ticket.assignedToId,
          mode: 'HANDOVER',
          source: LEDGER_SOURCES.TICKET_STATUS,
        }, tx);
      }
    }

    if (data.assignedToId && data.assignedToId !== existing.assignedToId && ticket.assignedTo) {
      afterCommit.push(() => this.eventEmitter.emit('ticket.assigned', {
        ticket,
        assigneeId: data.assignedToId,
        assignedBy: userId,
      }));
      afterCommit.push(() => this.eventLogger.log({
        actorId: userId,
        entityType: 'Ticket',
        entityId: ticket.id,
        action: OperationalAction.TICKET_ASSIGNED,
        metadata: { ticketId: ticket.ticketId, assigneeId: data.assignedToId, assigneeName: ticket.assignedTo.name },
      }));
      afterCommit.push(() => this.notificationEventService.sendNotification(
        ticket.assignedTo.id,
        'assignedTicket',
        {
          title: this.ticketAssignedTitle(ticket.type, ticket.ticketId, true),
          message: ticket.title,
          type: NotificationType.INFO,
          link: `/tickets/${ticket.id}`,
          entityId: ticket.id,
          entityType: 'TICKET',
        }
      ));
    }

    // Update multiple assignees if provided
    if (assigneeIds !== undefined) {
      await tx.ticketAssignee.deleteMany({ where: { ticketId: ticketDbId } });
      if (assigneeIds.length > 0) {
        await tx.ticketAssignee.createMany({
          data: assigneeIds.map((uid) => ({ ticketId: ticketDbId, userId: uid })),
          skipDuplicates: true,
        });
      }
    }

    // Whoever was reviewing gets their own employee work back (only if working).
    await this.resumeAfterReviewFor(reviewersStopped, tx);

    return ticket;
  }

  private async resumeAfterReviewFor(userIds: string[], tx: Prisma.TransactionClient) {
    for (const userId of [...new Set(userIds)].sort()) {
      await this.ticketLedger.resumeAfterReview(userId, tx);
    }
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

    // The block and the stop of the worker's clock commit together: blocked
    // time is never productive, and a timer failure leaves the ticket unblocked.
    const updated = await this.prisma.$transaction(async (tx) => {
      const blocked = await tx.ticket.update({
        where: { id: ticket.id },
        data: { isBlocked: true, blockedAt: this.tva.now(), blockedReason: reason.trim(), blockedById: userId },
        include: this.includeOptions,
      });
      await tx.ticketHistory.create({
        data: { ticketId: ticket.id, field: 'isBlocked', oldValue: 'false', newValue: 'true', changedById: userId },
      });
      await tx.activityLog.create({
        data: {
          userId,
          action: 'TICKET_BLOCKED',
          entityType: 'TICKET',
          entityId: ticket.id,
          details: { ticketId: ticket.ticketId, reason: reason.trim() },
        },
      });
      const ended = await this.ticketLedger.endActiveLogsForTicket(
        ticket.id, LEDGER_PAUSE_REASONS.BLOCKED, undefined, tx, [blocked.assignedToId],
      );
      await this.resumeNextWaitingFor(ended.userIds, ticket.id, tx);
      return blocked;
    }, TIMER_TRANSACTION);

    const afterCommit: AfterCommit = [
      () => this.eventLogger.log({
        actorId: userId,
        entityType: 'Ticket',
        entityId: ticket.id,
        action: OperationalAction.TICKET_BLOCKED,
        fromState: ticket.status,
        metadata: { ticketId: ticket.ticketId, reason: reason.trim() },
      }),
      () => this.gateway.emitTicketStatusChanged(ticket.id, 'BLOCKED', userId),
    ];
    // Notify assignee (if different from blocker) that their ticket is blocked
    if (ticket.assignedTo && ticket.assignedToId !== userId) {
      afterCommit.push(() => this.notificationEventService.sendNotification(
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
      ));
    }
    // Notify creator (if different from blocker and assignee)
    if (ticket.createdById && ticket.createdById !== userId && ticket.createdById !== ticket.assignedToId) {
      afterCommit.push(() => this.notificationEventService.sendNotification(
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
      ));
    }
    await this.runAfterCommit(afterCommit);

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

    // The unblock and the resume decision commit together.
    const updated = await this.prisma.$transaction(async (tx) => {
      const unblocked = await tx.ticket.update({
        where: { id: ticket.id },
        data: { isBlocked: false, blockedAt: null, blockedReason: null, blockedById: null },
        include: this.includeOptions,
      });
      await tx.ticketHistory.create({
        data: { ticketId: ticket.id, field: 'isBlocked', oldValue: 'true', newValue: 'false', changedById: userId },
      });
      await tx.activityLog.create({
        data: {
          userId,
          action: 'TICKET_UNBLOCKED',
          entityType: 'TICKET',
          entityId: ticket.id,
          details: { ticketId: ticket.ticketId },
        },
      });
      // Resume only when it is safe: still IN_PROGRESS, same primary assignee,
      // worker working, and no other ticket already being timed (UNBLOCK mode
      // never pauses another ticket). All re-checked under the worker's lock.
      if (unblocked.status === TicketStatus.IN_PROGRESS && unblocked.assignedToId) {
        await this.ticketLedger.startAssigneeTimer({
          ticketId: ticket.id,
          workerId: unblocked.assignedToId,
          mode: 'UNBLOCK',
          source: LEDGER_SOURCES.TICKET_STATUS,
        }, tx);
      }
      return unblocked;
    }, TIMER_TRANSACTION);

    const afterCommit: AfterCommit = [
      () => this.eventLogger.log({
        actorId: userId,
        entityType: 'Ticket',
        entityId: ticket.id,
        action: OperationalAction.TICKET_UNBLOCKED,
        fromState: 'BLOCKED',
        toState: ticket.status,
        metadata: { ticketId: ticket.ticketId },
      }),
      () => this.gateway.emitTicketStatusChanged(ticket.id, ticket.status, userId),
    ];
    // Notify assignee that the blocker has been resolved
    if (ticket.assignedToId && ticket.assignedToId !== userId) {
      afterCommit.push(() => this.notificationEventService.sendNotification(
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
      ));
    }
    await this.runAfterCommit(afterCommit);

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

    const assertUnassignable = (state: { status: TicketStatus; assignedToId: string | null }) => {
      if (([TicketStatus.DONE, TicketStatus.CLOSED] as TicketStatus[]).includes(state.status)) {
        throw new BadRequestException('Cannot unassign a completed or closed ticket');
      }
      if (state.status === TicketStatus.REVIEW) {
        throw new BadRequestException('Move ticket back to In Progress/Open before unassigning.');
      }
      if (!state.assignedToId) {
        throw new BadRequestException('Ticket has no primary assignee to unassign');
      }
    };
    assertUnassignable(ticket);

    // Decided inside the transaction from the locked row, not from the read
    // above: a ticket that moved to IN_PROGRESS since must go back to OPEN, or
    // it would be left IN_PROGRESS with no owner.
    let previousAssigneeId: string = ticket.assignedToId!;
    let previousStatus: TicketStatus = ticket.status;
    let wasInProgress = false;

    // The unassign and the stop of the removed assignee's clock commit together,
    // so a clock can never keep running against someone no longer responsible.
    const updated = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockTicketRow(tx, ticket.id);
      assertUnassignable(locked);
      previousAssigneeId = locked.assignedToId!;
      previousStatus = locked.status;
      wasInProgress = locked.status === TicketStatus.IN_PROGRESS;
      const data: any = { assignedToId: null };
      if (wasInProgress) data.status = TicketStatus.OPEN;

      const unassigned = await tx.ticket.update({
        where: { id: ticket.id },
        data,
        include: this.includeOptions,
      });
      await tx.ticketHistory.createMany({
        data: [
          { ticketId: ticket.id, field: 'assignedToId', oldValue: previousAssigneeId, newValue: null, changedById: userId },
          ...(wasInProgress
            ? [{ ticketId: ticket.id, field: 'status', oldValue: previousStatus, newValue: TicketStatus.OPEN, changedById: userId }]
            : []),
        ],
      });
      await tx.activityLog.create({
        data: {
          userId,
          action: 'TICKET_UNASSIGNED',
          entityType: 'TICKET',
          entityId: ticket.id,
          details: { ticketId: ticket.ticketId, removedAssigneeId: previousAssigneeId, movedBackToOpen: wasInProgress },
        },
      });
      const ended = await this.ticketLedger.endActiveLogsForTicket(
        ticket.id, LEDGER_PAUSE_REASONS.UNASSIGNED, undefined, tx, [previousAssigneeId],
      );
      await this.resumeNextWaitingFor(ended.userIds, ticket.id, tx);
      return unassigned;
    }, TIMER_TRANSACTION);

    const afterCommit: AfterCommit = [
      () => this.eventLogger.log({
        actorId: userId,
        entityType: 'Ticket',
        entityId: ticket.id,
        action: OperationalAction.TICKET_UNASSIGNED,
        fromState: previousStatus,
        toState: updated.status,
        metadata: { ticketId: ticket.ticketId, removedAssigneeId: previousAssigneeId },
      }),
      () => this.gateway.emitTicketStatusChanged(ticket.id, updated.status, userId),
    ];
    if (previousAssigneeId !== userId) {
      afterCommit.push(() => this.notificationEventService.sendNotification(
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
      ));
    }
    await this.runAfterCommit(afterCommit);

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

  /**
   * The start of every review decision: lock the ticket row, require it to be
   * still in REVIEW (a decision or withdrawal queued behind another one gets
   * 409, never a second decision), then stop any running reviewer clock so the
   * cycle freezes its final reviewer seconds.
   */
  private async lockReviewForDecision(tx: Prisma.TransactionClient, ticketId: string, userId: string, user?: any) {
    const locked = await this.lockTicketRow(tx, ticketId);
    if (locked.status !== TicketStatus.REVIEW) throw new ConflictException(REVIEW_ERRORS.ALREADY_DECIDED);
    await this.assertReviewAuthorityLocked(tx, ticketId, userId, user);
    // Reviewer-hierarchy decisions need the decider's own running review.
    if (reviewTimerRequired(locked)) await this.assertReviewTimerRunning(tx, ticketId, userId);
    const stopped = await this.ticketLedger.endActiveLogsForTicket(ticketId, LEDGER_PAUSE_REASONS.REVIEW_DECISION, undefined, tx);
    return { locked, reviewersStopped: stopped.userIds };
  }

  /**
   * Under the ticket row lock: the actor is still an authorized reviewer of
   * the ticket as it now stands, and no other reviewer has claimed the open
   * review cycle. The first reviewer to Start Review claims it; a different
   * reviewer cannot start, approve or reject it (409 REVIEW_CLAIMED).
   */
  private async assertReviewAuthorityLocked(tx: Prisma.TransactionClient, ticketId: string, userId: string, user?: any) {
    if (user) {
      const current = await tx.ticket.findUnique({ where: { id: ticketId }, include: { assignees: true } });
      if (!current || !(await this.ticketAccess.viewerCanApprove(user, current))) {
        throw new ForbiddenException(REVIEW_ERRORS.NOT_AUTHORIZED);
      }
    }
    const open = await this.ticketLedger.findOpenReviewCycle(ticketId, tx);
    if (open?.reviewerId && open.reviewerId !== userId) {
      throw new ConflictException(REVIEW_ERRORS.CLAIMED);
    }
    return open;
  }

  /** The decider's own reviewer clock must be running on this ticket. */
  private async assertReviewTimerRunning(tx: Prisma.TransactionClient, ticketId: string, userId: string) {
    if (!(await this.ticketLedger.findActiveReviewerLog(ticketId, userId, tx))) {
      throw new ConflictException(REVIEW_ERRORS.NOT_STARTED);
    }
  }

  private async findTicketForReview(id: string, user?: any) {
    const ticket = user
      ? await this.ticketAccess.findAccessibleTicket(id, user, { assignees: true })
      : await this.prisma.ticket.findFirst({ where: { OR: [{ id }, { ticketId: id }] }, include: { assignees: true } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  /**
   * Start Review: the reviewer's active-work clock, separate from the review
   * turnaround (SLA) clock that started at submission. One transaction, lock
   * order ticket row → reviewer's work session (share) → reviewer's timer lock.
   */
  async startReview(id: string, userId: string, user?: any) {
    const ticket = await this.findTicketForReview(id, user);
    if (ticket.status !== TicketStatus.REVIEW) throw new ConflictException(REVIEW_ERRORS.NOT_IN_REVIEW);
    if (user && !(await this.ticketAccess.viewerCanApprove(user, ticket))) {
      throw new ForbiddenException(REVIEW_ERRORS.NOT_AUTHORIZED);
    }

    const afterCommit: AfterCommit = [];
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockTicketRow(tx, ticket.id);
      if (locked.status !== TicketStatus.REVIEW) throw new ConflictException(REVIEW_ERRORS.NOT_IN_REVIEW);
      // Authority and the claim are re-checked against the locked ticket.
      let cycle = await this.assertReviewAuthorityLocked(tx, ticket.id, userId, user);
      await this.activeWorkdayPolicy.assertActiveWorkdayLocked(tx, userId, PUNCH_IN_TO_REVIEW_MESSAGE);

      // Tickets submitted before review cycles opened at submission get theirs now.
      if (!cycle) {
        cycle = await this.ticketLedger.startReviewCycle({
          ticketId: ticket.id,
          assigneeId: this.primaryAssigneeId(ticket),
          reviewStartedAt: ticket.reviewStartedAt ?? ticket.submittedAt ?? this.tva.now(),
        }, tx);
      }
      if (!cycle.reviewerId) {
        // The first reviewer to start claims the review.
        await tx.reviewCycleLog.update({ where: { id: cycle.id }, data: { reviewerId: userId } });
      }

      const started = await this.ticketLedger.startReviewerTimer({ ticketId: ticket.id, reviewerId: userId }, tx);
      if (started.outcome === 'STARTED') {
        await tx.activityLog.create({
          data: {
            userId, action: 'REVIEW_STARTED', entityType: 'TICKET', entityId: ticket.id,
            details: { ticketId: ticket.ticketId, cycleNo: cycle.cycleNo },
          },
        });
        afterCommit.push(() => this.eventLogger.log({
          actorId: userId, entityType: 'Ticket', entityId: ticket.id,
          action: OperationalAction.TICKET_REVIEW_STARTED, metadata: { ticketId: ticket.ticketId },
        }));
        afterCommit.push(() => this.gateway.emitTicketStatusChanged(ticket.id, TicketStatus.REVIEW, userId));
      }
    }, TIMER_TRANSACTION);
    await this.runAfterCommit(afterCommit);
    return this.findOne(ticket.id, user);
  }

  /** Pause Review: stops the caller's own reviewer clock on this ticket. Idempotent. */
  async pauseReview(id: string, userId: string, user?: any) {
    const ticket = await this.findTicketForReview(id, user);
    const afterCommit: AfterCommit = [];
    await this.prisma.$transaction(async (tx) => {
      await this.lockTicketRow(tx, ticket.id);
      const paused = await this.ticketLedger.pauseReviewerTimer({
        ticketId: ticket.id, reviewerId: userId, pauseReason: LEDGER_PAUSE_REASONS.REVIEW_PAUSED,
      }, tx);
      if (paused.paused) {
        // Pausing review hands the person their own employee work back.
        await this.ticketLedger.resumeAfterReview(userId, tx);
        await tx.activityLog.create({
          data: {
            userId, action: 'REVIEW_PAUSED', entityType: 'TICKET', entityId: ticket.id,
            details: { ticketId: ticket.ticketId, seconds: paused.log?.durationSeconds ?? 0 },
          },
        });
        afterCommit.push(() => this.eventLogger.log({
          actorId: userId, entityType: 'Ticket', entityId: ticket.id,
          action: OperationalAction.TICKET_REVIEW_PAUSED, metadata: { ticketId: ticket.ticketId },
        }));
        afterCommit.push(() => this.gateway.emitTicketStatusChanged(ticket.id, ticket.status, userId));
      }
    }, TIMER_TRANSACTION);
    await this.runAfterCommit(afterCommit);
    return this.findOne(ticket.id, user);
  }

  /**
   * Withdraw Submission: the ticket's own primary assignee pulls it back from
   * REVIEW before any reviewer decision. Recorded as a WITHDRAWN review cycle:
   * no rework count, no rework estimate, no REWORK timer. The reviewer clock
   * stops, the cycle decision, status, history, activity log, comment and the
   * worker's WORK timer (only if they are working with nothing else running)
   * commit together.
   */
  async withdraw(id: string, userId: string, user?: any, reason?: string) {
    const ticket = await this.findTicketForReview(id, user);
    if (ticket.status !== TicketStatus.REVIEW) throw new ConflictException(REVIEW_ERRORS.NOT_IN_REVIEW);
    if (ticket.assignedToId !== userId) throw new ForbiddenException(REVIEW_ERRORS.WITHDRAW_NOT_ALLOWED);

    // The withdrawal rule above replaces the generic transition permission:
    // the generic rule forbids an assignee from sending back their own work,
    // which is exactly what a reviewer's rework is, not a withdrawal.
    const opts: UpdateOptions = { withdrawal: true };
    const prepared = await this.prepareUpdate(ticket.id, { status: TicketStatus.IN_PROGRESS }, userId, undefined, opts);
    const note = (reason ?? '').trim();

    const afterCommit: AfterCommit = [];
    const updated = await this.prisma.$transaction(async (tx) => {
      const reopened = await this.commitUpdate(tx, prepared, userId, opts, afterCommit);
      await tx.comment.create({
        data: {
          ticketId: ticket.id,
          authorId: userId,
          content: `[WITHDRAWN] ${note || 'Submission withdrawn from review by the assignee.'}`,
        },
      });
      await tx.activityLog.create({
        data: {
          userId, action: 'REVIEW_WITHDRAWN', entityType: 'TICKET', entityId: ticket.id,
          details: { ticketId: ticket.ticketId },
        },
      });
      return reopened;
    }, TIMER_TRANSACTION);

    afterCommit.push(() => this.eventLogger.log({
      actorId: userId, entityType: 'Ticket', entityId: ticket.id,
      action: OperationalAction.TICKET_REVIEW_WITHDRAWN, fromState: TicketStatus.REVIEW, toState: TicketStatus.IN_PROGRESS,
      metadata: { ticketId: ticket.ticketId },
    }));
    await this.runAfterCommit(afterCommit);
    return this.addSla(updated);
  }

  // The rating applies to the ticket's primary worker. assignedToId (legacy single-assignee
  // field) wins when present; multi-assignee tickets fall back to the first row in
  // `assignees` so a rating still lands on someone rather than being silently dropped.
  // This intentionally does not attempt per-assignee ratings for multi-assignee tickets.
  private primaryAssigneeId(ticket: any): string | undefined {
    return ticket.assignedToId ?? ticket.assignees?.[0]?.userId ?? undefined;
  }

  // Closes the ticket's current (open) ReviewCycleLog with a decision + ratings/feedback.
  // Since Phase 4 every submission opens its cycle when the ticket enters REVIEW
  // (commitUpdate), so an open cycle normally exists. The retroactive branch below is
  // a fallback only for legacy tickets that were already in REVIEW before that
  // shipped: it opens the cycle from the ticket's own reviewStartedAt and closes it
  // immediately, so those tickets are still decided correctly.
  private async persistReviewDecision(
    ticket: any,
    decision: 'APPROVED' | 'REWORK' | 'WITHDRAWN' | 'CANCELLED',
    reviewerId: string | null,
    ratings?: {
      taskEfficiencyRating?: number | null;
      employeePerformanceRating?: number | null;
      employeeAttitudeRating?: number | null;
      ratingComment?: string | null;
      feedback?: string | null;
      reworkStartedAt?: Date;
      reworkEstimatedMinutes?: number | null;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const closeArgs = {
      ticketId: ticket.id,
      decision,
      // A withdrawal is not a reviewer decision: keep whatever reviewer the
      // cycle already has (undefined leaves the column untouched).
      reviewerId: reviewerId ?? undefined,
      feedback: ratings?.feedback ?? undefined,
      taskEfficiencyRating: ratings?.taskEfficiencyRating ?? null,
      employeePerformanceRating: ratings?.employeePerformanceRating ?? null,
      employeeAttitudeRating: ratings?.employeeAttitudeRating ?? null,
      ratingComment: ratings?.ratingComment ?? null,
      reworkStartedAt: decision === 'REWORK' ? ratings?.reworkStartedAt : undefined,
      reworkEstimatedMinutes: decision === 'REWORK' ? ratings?.reworkEstimatedMinutes ?? null : undefined,
    };

    const actionLabel = decision === 'APPROVED' ? 'approved'
      : decision === 'WITHDRAWN' ? 'withdrawn from review'
      : decision === 'CANCELLED' ? 'moved out of review'
      : 'sent back for rework';
    let cycle: any;
    try {
      cycle = await this.ticketLedger.endReviewCycle(closeArgs, tx);
      if (!cycle) {
        await this.ticketLedger.startReviewCycle({
          ticketId: ticket.id,
          assigneeId: this.primaryAssigneeId(ticket),
          reviewerId: reviewerId ?? undefined,
          reviewStartedAt: ticket.reviewStartedAt ?? ticket.submittedAt ?? this.tva.now(),
        }, tx);
        cycle = await this.ticketLedger.endReviewCycle(closeArgs, tx);
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

    // The cycle's evidence is final once its review ends: reviewer feedback
    // (and any proof still unlocked) can no longer be deleted or replaced.
    await (tx ?? this.prisma).attachment.updateMany({
      where: { reviewCycleId: cycle.id, lockedAt: null },
      data: { lockedAt: this.tva.now(), lockReason: `REVIEW_${decision}` },
    });

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

    // Type-specific approval permission checks
    if (user) {
      if (ticket.type === 'QUERY' && userId !== ticket.createdById) {
        throw new ForbiddenException('Only the Query creator can approve a Query');
      }
      if (ticket.type === 'HELP' && userId !== ticket.createdById) {
        throw new ForbiddenException('Only the Help requester can approve a Help ticket');
      }
      // TASK: keep existing hierarchy-based approval via assertCanTransitionTicket
      if (ticket.type === 'TASK') {
        await this.ticketAccess.assertCanTransitionTicket(user, ticket, TicketStatus.DONE);
      }
    }

    // Type-specific rating logic
    const selfAssigned = this.ticketAccess.isSelfAssigned(ticket);
    const reviewerIsAssignee =
      userId === this.primaryAssigneeId(ticket) ||
      Boolean(ticket.assignees?.some?.((a: any) => (a?.userId ?? a?.user?.id) === userId));

    let effectiveRatings: any;
    if (ticket.type === 'QUERY') {
      // Query creator can submit star ratings
      effectiveRatings = ratings;
    } else if (ticket.type === 'HELP') {
      // Help requester can submit full ratings (no restrictions)
      effectiveRatings = ratings;
    } else {
      // TASK: no self-rating — if self-assigned or reviewer is assignee, comment-only
      effectiveRatings = (selfAssigned || reviewerIsAssignee)
        ? { ratingComment: ratings?.ratingComment ?? null }
        : ratings;
    }

    // suppressCompletionNotification=true: the update skips its generic "Ticket resolved"
    // notification so we can send a more specific "Ticket approved" message here instead.
    const opts: UpdateOptions = { suppressCompletionNotification: true, reviewDecisionRecorded: true };
    const prepared = await this.prepareUpdate(ticket.id, { status: TicketStatus.DONE }, userId, user, opts);

    // The review decision, the move to DONE and the timer stop commit together:
    // the ticket never reaches DONE without its decision, and a recorded
    // decision never survives a transition that failed.
    const afterCommit: AfterCommit = [];
    const updated = await this.prisma.$transaction(async (tx) => {
      const { reviewersStopped } = await this.lockReviewForDecision(tx, ticket.id, userId, user);
      await this.persistReviewDecision(ticket, 'APPROVED', userId, effectiveRatings, tx);
      const done = await this.commitUpdate(tx, prepared, userId, opts, afterCommit);
      await this.resumeAfterReviewFor(reviewersStopped, tx);
      return done;
    }, TIMER_TRANSACTION);

    // Single targeted notification to reporter — "Ticket approved" (not generic "resolved")
    afterCommit.push(() => this.notificationEventService.sendNotification(
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
    ));
    await this.runAfterCommit(afterCommit);

    return this.addSla(updated);
  }

  async reject(id: string, comment: string, userId: string, user?: any, reworkEstimatedMinutes?: number | null) {
    if (reworkEstimatedMinutes !== undefined && reworkEstimatedMinutes !== null) {
      if (!Number.isInteger(reworkEstimatedMinutes) || reworkEstimatedMinutes < 1 || reworkEstimatedMinutes > 10_080) {
        throw new BadRequestException('reworkEstimatedMinutes must be a whole number of minutes between 1 and 10080');
      }
    }
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

    // QUERY workflow: only the creator/assigned-by can request rework, not the assignee
    if (ticket.type === 'QUERY' && userId !== ticket.createdById) {
      throw new ForbiddenException('Only the Query creator can request rework on a Query');
    }

    // HELP workflow: only the assignee can reject/decline the help request
    if (ticket.type === 'HELP' && userId !== ticket.assignedToId) {
      throw new ForbiddenException('Only the Help assignee can decline a Help request');
    }

    if (user) await this.ticketAccess.assertCanTransitionTicket(user, ticket, TicketStatus.IN_PROGRESS);

    const opts: UpdateOptions = { reviewDecisionRecorded: true, reworkEstimatedMinutes: reworkEstimatedMinutes ?? null };
    const prepared = await this.prepareUpdate(ticket.id, { status: TicketStatus.IN_PROGRESS }, userId, user, opts);

    // The rework decision/feedback, the new rework cycle, the move back to
    // IN_PROGRESS with its REWORK timer and the rejection comment commit
    // together. reworkStartedAt is stamped before the timer starts, so the
    // worker's first rework segment always falls inside the cycle.
    const afterCommit: AfterCommit = [];
    const updated = await this.prisma.$transaction(async (tx) => {
      const { reviewersStopped } = await this.lockReviewForDecision(tx, ticket.id, userId, user);
      await this.persistReviewDecision(ticket, 'REWORK', userId, {
        feedback: comment,
        reworkStartedAt: prepared.now,
        reworkEstimatedMinutes: reworkEstimatedMinutes ?? null,
      }, tx);
      const reopened = await this.commitUpdate(tx, prepared, userId, opts, afterCommit);
      await tx.comment.create({
        data: {
          ticketId: ticket.id,
          authorId: userId,
          content: `[REJECTED] ${comment}`,
        },
      });
      await this.resumeAfterReviewFor(reviewersStopped, tx);
      return reopened;
    }, TIMER_TRANSACTION);

    if (ticket.assignedToId && ticket.assignedToId !== userId) {
      afterCommit.push(() => this.notificationEventService.sendNotification(
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
      ));
    }
    await this.runAfterCommit(afterCommit);

    return this.addSla(updated);
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
    // Same filters, search and role/department scope as the list (findAll),
    // every page of it: no silent cap. Pages follow creation order (createdAt
    // never changes, id breaks ties), so a ticket updated during the export
    // cannot move between pages and be skipped; ids are de-duplicated in case a
    // new ticket shifts a page.
    const EXPORT_PAGE_SIZE = 500;
    const exportOrder: Prisma.TicketOrderByWithRelationInput[] = [{ createdAt: 'desc' }, { id: 'desc' }];
    const tickets: any[] = [];
    const seen = new Set<string>();
    for (let page = 1; ; page++) {
      const batch = await this.findAll({ ...query, limit: EXPORT_PAGE_SIZE, page }, user, { orderBy: exportOrder });
      for (const t of batch.tickets) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        tickets.push(t);
      }
      if (batch.tickets.length < EXPORT_PAGE_SIZE || page >= batch.totalPages) break;
    }
    // Productive employee work only, one batched query for the whole export.
    const workSeconds = await this.ticketLedger.getEmployeeWorkSecondsMany(tickets.map((t) => t.id));
    const elapsedHours = (t: any) => {
      const seconds = workSeconds.get(t.id) ?? 0;
      return Math.round((seconds / 3600) * 100) / 100;
    };

    const safeStr = csvCell;
    // Calendar dates in the company timezone, like everything else users see.
    const companyDate = (value: any) => (value ? this.tva.companyBusinessDate(new Date(value)) : '');
    const estimatedHours = (t: any) =>
      t.estimatedMinutes ? Math.round((t.estimatedMinutes / 60) * 100) / 100 : (t.estimatedTime ?? '');

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
      safeStr(companyDate(t.dueDate)),
      safeStr(estimatedHours(t)),
      safeStr(elapsedHours(t)),
      safeStr(t.slaPercent ?? ''),
      safeStr((t.timing?.isOverdue ?? t.isOverdue) ? 'Yes' : 'No'),
      safeStr(companyDate(t.createdAt)),
      safeStr(companyDate(t.updatedAt)),
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

  async getKanban(filters: { search?: string; departmentId?: string; department?: string; projectId?: string; assignedToId?: string }, user?: any) {
    const scopedWhere = await this.ticketAccess.buildTicketWhereForUser(filters, user);
    // Approval requests have their own queue and CLOSED is final. Neither is a
    // Kanban lane, so do not fetch and silently discard them after the query.
    const where = this.andWhere(scopedWhere, {
      status: { notIn: [TicketStatus.PENDING_APPROVAL, TicketStatus.CLOSED] },
    });

    const tickets = await this.prisma.ticket.findMany({
      where,
      include: KANBAN_TICKET_INCLUDE,
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
