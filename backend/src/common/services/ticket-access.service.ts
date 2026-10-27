import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Priority, TicketCategory, TicketStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLES } from '../../shared/constants/roles';
import { AccessPolicyService } from './access-policy.service';
import { HierarchyApprovalService } from './hierarchy-approval.service';
import { fromZonedTime } from 'date-fns-tz';
import { COMPANY_CRON_TIMEZONE } from '../constants/company-time.constants';

function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str ?? '');
}

/** A pending task-creation request is decided by its approver, never by a status change. */
export const APPROVAL_DECISION_REQUIRED = {
  statusCode: 409, code: 'APPROVAL_DECISION_REQUIRED',
  message: 'This ticket is waiting for approval. Its approver must approve or reject it.',
} as const;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
// yyyy-MM-dd, optionally followed by THH:mm[:ss[.SSS]] and Z or ±HH:mm.
const ISO_DATE_OR_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-](\d{2}):?(\d{2}))?)?$/;

/**
 * A filter date in ISO form, or undefined. `new Date()` alone accepts
 * impossible dates and rolls them over (2026-02-31 becomes 2026-03-03) and
 * guesses at other formats, so the calendar parts are checked first.
 */
export function parseFilterDate(value: string): Date | undefined {
  const m = ISO_DATE_OR_TIMESTAMP.exec(value);
  if (!m) return undefined;
  const [, y, mo, d, h = '0', mi = '0', s = '0', , tzH = '0', tzM = '0'] = m;
  const day = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (day.getUTCFullYear() !== Number(y) || day.getUTCMonth() !== Number(mo) - 1 || day.getUTCDate() !== Number(d)) {
    return undefined;
  }
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 59 || Number(tzH) > 14 || Number(tzM) > 59) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * One end of the "Created from / to" filter. A date-only value is a whole
 * company-timezone day, inclusive at both ends (from 00:00:00.000 to
 * 23:59:59.999 company time); a full timestamp is used as given. A value that
 * is not a real date is ignored rather than reaching the database.
 */
export function createdFilterBound(value: unknown, edge: 'start' | 'end'): Date | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const v = value.trim();
  if (!parseFilterDate(v)) return undefined;
  return DATE_ONLY.test(v)
    ? fromZonedTime(`${v}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}`, COMPANY_CRON_TIMEZONE)
    : parseFilterDate(v);
}

/**
 * One enum filter from the query string. Empty or 'ALL' means no filter. Any
 * other value must be a member of the enum (case-insensitive). An unknown
 * value, or the parameter given twice, is the caller's mistake and answers
 * 400 instead of reaching Prisma, which throws and answers 500.
 */
export function ticketEnumFilter<T extends string>(
  name: string,
  value: unknown,
  allowed: Record<string, T>,
): T | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new BadRequestException(`Invalid ${name} filter: give a single value.`);
  const v = value.trim().toUpperCase();
  if (!v || v === 'ALL') return undefined;
  const members = Object.values(allowed);
  if (!members.includes(v as T)) {
    throw new BadRequestException(`Invalid ${name} filter "${value}". Use one of: ${members.join(', ')}.`);
  }
  return v as T;
}

/**
 * A due-date bound from the query string, parsed as before (yyyy-MM-dd is
 * UTC midnight). A value that is not a real ISO date or timestamp, such as
 * 2026-02-31 or "tomorrow", answers 400.
 */
export function ticketDueBound(name: string, value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const date = typeof value === 'string' ? parseFilterDate(value.trim()) : undefined;
  if (!date) {
    throw new BadRequestException(`Invalid ${name} filter: expected a real date (yyyy-MM-dd) or ISO timestamp.`);
  }
  return date;
}

@Injectable()
export class TicketAccessService {
  constructor(
    private prisma: PrismaService,
    private access: AccessPolicyService,
    private hierarchy: HierarchyApprovalService,
  ) {}

  /**
   * Phase 4 ticket-bound review snapshot (D4, correction 2). When a worker is
   * transferred while their ticket is in REVIEW, the reviewer resolved from
   * the ORIGINAL department is frozen on an append-only RoutingSnapshot for
   * that one ticket. The grant holds only while all are true:
   *   - the ticket is still in REVIEW and is not a QUERY;
   *   - the snapshot is the latest TICKET_REVIEW snapshot for the ticket;
   *   - it was taken in the current review cycle (createdAt >= submittedAt);
   *   - the user is that snapshot's resolved approver and not a worker on it.
   * Deciding the review moves the ticket out of REVIEW and a resubmission sets
   * a new submittedAt, so the grant ends by itself. No department-wide or
   * permanent authority is created; the general TL ticket-authority model is
   * Phase 4.5.
   */
  async transferReviewGrant(userId: string | undefined, ticket: any): Promise<boolean> {
    if (!userId || !ticket?.id || ticket.status !== TicketStatus.REVIEW || ticket.type === 'QUERY' || !ticket.submittedAt) return false;
    const isWorker =
      userId === ticket.assignedToId || Boolean(ticket.assignees?.some?.((a: any) => (a?.userId ?? a?.user?.id) === userId));
    if (isWorker) return false;
    const snapshots = (this.prisma as any)?.routingSnapshot;
    if (typeof snapshots?.findFirst !== 'function') return false;
    const snap = await snapshots.findFirst({
      where: { workflow: 'TICKET_REVIEW', entityType: 'Ticket', entityId: ticket.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { resolvedApproverId: true, createdAt: true },
    });
    if (!snap || snap.resolvedApproverId !== userId) return false;
    return snap.createdAt.getTime() >= new Date(ticket.submittedAt).getTime();
  }

  /** Exposed so services that already hold TicketAccessService can ask without a new dep. */
  isSelfAssigned(ticket: any): boolean {
    return this.hierarchy.isSelfAssigned(ticket);
  }

  /**
   * Whether `user` may approve/reject `ticket` from REVIEW — used to drive the
   * frontend so it mirrors the backend exactly. Self-assigned tickets require the
   * worker's resolved reporting hierarchy; non-self tickets keep the existing
   * scoped-reviewer rule.
   */
  async viewerCanApprove(user: any, ticket: any): Promise<boolean> {
    if (!user || ticket?.status !== TicketStatus.REVIEW) return false;
    // QUERY: tickets.service.ts's approve()/reject() gate strictly on the
    // creator — no hierarchy or scoped-reviewer path applies, unlike TASK.
    // Checked first, ahead of the self-assigned/generic branches below, so a
    // manager/lead who merely happens to be in scope of the creator's or
    // assignee's department (buildScopeWhere is a visibility rule, not an
    // approval-authority rule) never sees an approve/reject control they
    // cannot actually use.
    if (ticket.type === 'QUERY') {
      return user.id === ticket.createdById;
    }
    if (await this.transferReviewGrant(user.id, ticket)) return true;
    if (this.hierarchy.isSelfAssigned(ticket)) {
      if (user.id === ticket.createdById) {
        const roleName = this.access.roleName(user);
        const isEmployeeOrIntern = roleName === ROLES.EMPLOYEE || roleName === ROLES.INTERN;
        const isTask = ticket.type === 'TASK';
        if (!isEmployeeOrIntern && isTask) return true; // Higher roles can self-complete tasks
        return false;
      }
      if (ticket.approverId && user.id === ticket.approverId) return true;
      return this.hierarchy.isApproverFor(user.id, ticket.createdById);
    }
    const roleName = this.access.roleName(user);
    if (this.access.isAdmin(user)) return true;
    if ([ROLES.MANAGER, ROLES.TEAM_LEAD].includes(roleName as any)) {
      // Worker cannot be the approver on a task they are assigned to (but did not create).
      // Self-assigned path is handled above; this covers senior-assigned tasks.
      const isWorker =
        user.id === ticket.assignedToId ||
        Boolean(ticket.assignees?.some?.((a: any) => (a?.userId ?? a?.user?.id) === user.id));
      if (isWorker) return false;
      return this.isTicketInUserScope(user, ticket);
    }
    return false;
  }

  /**
   * Whether `user` may close `ticket` now: exactly the rule a close request is
   * checked against (assertCanTransitionTicket to CLOSED), so the page never
   * offers a Close the backend would refuse. Never grants anything itself.
   */
  async viewerCanClose(user: any, ticket: any): Promise<boolean> {
    if (!user || !ticket || ticket.status === TicketStatus.CLOSED || ticket.status === TicketStatus.PENDING_APPROVAL) {
      return false;
    }
    try {
      await this.assertCanTransitionTicket(user, ticket, TicketStatus.CLOSED);
      return true;
    } catch {
      return false;
    }
  }

  async buildTicketWhereForUser(filters: any = {}, user?: any): Promise<any> {
    const filterWhere = await this.buildFilterWhere(filters);
    const scopeWhere = await this.buildScopeWhere(user);
    return this.andWhere(filterWhere, scopeWhere);
  }

  async findAccessibleTicket(id: string, user: any, include?: any): Promise<any> {
    const existing = await this.prisma.ticket.findFirst({
      where: { OR: [{ id }, { ticketId: id }] },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Ticket not found');
    const where = await this.buildTicketWhereForUser({}, user);
    const allowed = await this.prisma.ticket.count({
      where: this.andWhere({ id: existing.id }, where),
    });
    if (!allowed) throw new ForbiddenException('You do not have permission to view this ticket');
    return this.prisma.ticket.findUnique({ where: { id: existing.id }, include });
  }

  async canViewTicket(user: any, ticketId: string): Promise<boolean> {
    const where = await this.buildTicketWhereForUser({}, user);
    const count = await this.prisma.ticket.count({
      where: this.andWhere({ OR: [{ id: ticketId }, { ticketId }] }, where),
    });
    return count > 0;
  }

  async assertCanViewTicket(user: any, ticketId: string): Promise<void> {
    if (!(await this.canViewTicket(user, ticketId))) {
      throw new ForbiddenException('You do not have permission to view this ticket');
    }
  }

  async assertCanUpdateTicket(user: any, ticket: any, updates?: any): Promise<void> {
    const roleName = this.access.roleName(user);
    if (this.access.isAdmin(user)) return;

    if (!(await this.isTicketInUserScope(user, ticket))) {
      throw new ForbiddenException('You do not have permission to update this ticket');
    }

    if (ticket.status === TicketStatus.CLOSED) {
      throw new ForbiddenException('Cannot modify a closed ticket');
    }

    const isEmployee = roleName === ROLES.EMPLOYEE || roleName === ROLES.INTERN;
    const isTeamLead = roleName === ROLES.TEAM_LEAD;
    const isManager = roleName === ROLES.MANAGER;

    if (updates) {
      const protectedFields = ['priority', 'sla', 'departmentId'];
      const hasProtected = protectedFields.some((f) => updates[f] !== undefined && updates[f] !== ticket[f]);

      if (isEmployee) {
        if (hasProtected) {
          throw new ForbiddenException('Employees cannot edit priority, SLA, or department');
        }
        if ([TicketStatus.REVIEW, TicketStatus.DONE].includes(ticket.status)) {
          throw new ForbiddenException('Employees cannot edit tickets after submission');
        }
      }

      if (isTeamLead) {
        if (updates.departmentId !== undefined && updates.departmentId !== ticket.departmentId) {
          throw new ForbiddenException('Team Leads cannot change ticket department');
        }
        if (updates.sla !== undefined && updates.sla !== ticket.sla) {
          throw new ForbiddenException('Team Leads cannot override SLA');
        }
        if (updates.priority !== undefined && updates.priority !== ticket.priority) {
          throw new ForbiddenException('Team Leads cannot override priorities');
        }
      }
    }

    if (isManager || isTeamLead) return;
    if (this.isTicketParticipant(user.id, ticket)) return;
    throw new ForbiddenException('Only the assignee, reporter, or scoped lead/manager can update this ticket');
  }

  async assertCanAssignTicket(user: any, ticket: any, assignedToId: string | null | undefined): Promise<void> {
    const roleName = this.access.roleName(user);
    const isSelfAssigning = assignedToId === user.id && !ticket.assignedToId && ticket.status === TicketStatus.OPEN;

    if (!this.access.isAdmin(user) && ![ROLES.MANAGER, ROLES.TEAM_LEAD].includes(roleName as any) && !isSelfAssigning) {
      throw new ForbiddenException('You do not have permission to assign this ticket');
    }
    if (!this.access.isAdmin(user) && !(await this.isTicketInUserScope(user, ticket)) && !isSelfAssigning) {
      throw new ForbiddenException('You do not have permission to assign this ticket');
    }
    if (!assignedToId) return;

    const assignee = await this.prisma.user.findUnique({
      where: { id: assignedToId },
      include: { role: true, department: true },
    });
    if (!assignee || !assignee.isActive) {
      throw new ForbiddenException('Assignee is not available');
    }
    if (this.access.isAdmin(user)) return;

    const deptIds = await this.access.managedDepartmentIds(user);
    if (!assignee.departmentId || !deptIds.includes(assignee.departmentId)) {
      throw new ForbiddenException('Assignee is outside your allowed scope');
    }
  }

  async assertCanTransitionTicket(
    user: any,
    ticket: any,
    toStatus: TicketStatus,
    updates?: any,
  ): Promise<void> {
    // Phase 4 transfer continuity: the reviewer frozen for THIS ticket's
    // current review cycle may decide it (leave REVIEW), and nothing else.
    if (
      !updates &&
      ticket?.status === TicketStatus.REVIEW &&
      toStatus !== TicketStatus.REVIEW &&
      (await this.transferReviewGrant(user?.id, ticket))
    ) {
      return;
    }
    await this.assertCanUpdateTicket(user, ticket, updates);
    const fromStatus = ticket.status as TicketStatus;
    if (fromStatus === toStatus) return;

    // A task-creation request leaves PENDING_APPROVAL only through its
    // approver's Approve or Reject (processApproval), never by a status change:
    // closing it directly would leave approvalState PENDING behind.
    if (fromStatus === TicketStatus.PENDING_APPROVAL) {
      throw new ConflictException(APPROVAL_DECISION_REQUIRED);
    }

    const roleName = this.access.roleName(user);
    const isScopedReviewer =
      this.access.isAdmin(user) ||
      ([ROLES.MANAGER, ROLES.TEAM_LEAD].includes(roleName as any) && await this.isTicketInUserScope(user, ticket));
    const isParticipant = this.isTicketParticipant(user.id, ticket);

    const allowed: Record<string, TicketStatus[]> = {
      [TicketStatus.PENDING_APPROVAL]: [],
      [TicketStatus.OPEN]: [TicketStatus.IN_PROGRESS, TicketStatus.CLOSED],
      [TicketStatus.IN_PROGRESS]: [TicketStatus.OPEN, TicketStatus.REVIEW, TicketStatus.DONE, TicketStatus.CLOSED],
      [TicketStatus.REVIEW]: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.DONE, TicketStatus.CLOSED],
      [TicketStatus.DONE]: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.CLOSED],
      [TicketStatus.CLOSED]: [],
    };

    const workerStatuses: TicketStatus[] = [TicketStatus.IN_PROGRESS, TicketStatus.REVIEW];
    const isIntern = roleName === ROLES.INTERN;

    // Employees and interns may close (cancel) only their own task: a TASK they
    // created, whose primary assignee they are, while it is OPEN or
    // IN_PROGRESS. Never someone else's ticket, never QUERY/HELP, never once
    // it is in REVIEW or DONE. Closing IN_PROGRESS stops its timer in the same
    // transaction (commitUpdate).
    if (
      toStatus === TicketStatus.CLOSED &&
      (roleName === ROLES.EMPLOYEE || isIntern) &&
      ticket.type === 'TASK' &&
      ticket.createdById === user.id &&
      ticket.assignedToId === user.id &&
      (fromStatus === TicketStatus.OPEN || fromStatus === TicketStatus.IN_PROGRESS)
    ) {
      return;
    }

    if (!allowed[fromStatus]?.includes(toStatus)) {
      // Allow managers/admins to bypass standard paths for things like OPEN -> CLOSED
      if (isScopedReviewer && ([TicketStatus.DONE, TicketStatus.CLOSED] as TicketStatus[]).includes(toStatus)) {
         // allow override to terminal state
      } else {
        throw new ForbiddenException(`Illegal ticket transition from ${fromStatus} to ${toStatus}`);
      }
    }

    // ── Self-assigned hierarchy gate ──────────────────────────────────────────
    // A self-assigned ticket (creator is also a worker) may be moved OPEN→IN_PROGRESS
    // →REVIEW by the worker, but once it reaches REVIEW — or whenever it would reach a
    // terminal state — only the worker's RESOLVED reporting hierarchy may act. The
    // worker can never approve/reject/complete their own work, and a random in-scope
    // reviewer is NOT enough; the actor must be in the resolved approver chain. This
    // is the single gate for approve(), reject(), and any direct status PATCH, so the
    // API cannot be used to bypass the rule.
    const selfAssigned = this.hierarchy.isSelfAssigned(ticket);
    const exitingReview = fromStatus === TicketStatus.REVIEW && toStatus !== TicketStatus.REVIEW;
    const reachingTerminal = toStatus === TicketStatus.DONE || toStatus === TicketStatus.CLOSED;
    if (selfAssigned && (exitingReview || reachingTerminal)) {
      const isEmployeeOrIntern = roleName === ROLES.EMPLOYEE || roleName === ROLES.INTERN;
      const isSelfWorker = user.id === ticket.createdById;
      const isTask = ticket.type === 'TASK';

      // Higher roles (TL, Manager, Admin, Super Admin) are allowed to self-complete their own TASKS.
      // Return early to skip all remaining gates (including the non-self assignee check below).
      if (isSelfWorker && !isEmployeeOrIntern && isTask) {
        return;
      }
      await this.hierarchy.assertIsHierarchyApprover(user, ticket);
      return;
    }

    if (isIntern && toStatus !== TicketStatus.IN_PROGRESS && toStatus !== TicketStatus.REVIEW) {
      throw new ForbiddenException('Interns can only move tickets to IN_PROGRESS or REVIEW');
    }

    // Done -> Reopen logic
    if (fromStatus === TicketStatus.DONE && ([TicketStatus.OPEN, TicketStatus.IN_PROGRESS] as TicketStatus[]).includes(toStatus)) {
      if (!isScopedReviewer) {
        throw new ForbiddenException('Only managers or admins can reopen DONE tickets');
      }
    }

    // Terminal states logic (non-self-assigned — self-assigned handled above)
    if (toStatus === TicketStatus.DONE || toStatus === TicketStatus.CLOSED) {
      if (!isScopedReviewer) {
        throw new ForbiddenException('Only scoped reviewers, managers, or admins can complete or close tickets');
      }
      // The assignee (worker) cannot approve or close their own non-self-assigned work.
      // Their assigner / senior reviewer must act. Covers TL closing Manager-assigned task,
      // Manager closing Admin-assigned task, etc.
      if (user.id === ticket.assignedToId ||
          ticket.assignees?.some?.((a: any) => (a?.userId ?? a?.user?.id) === user.id)) {
        throw new ForbiddenException('The assignee cannot approve or close their own work — it must be reviewed by the assigner or their hierarchy.');
      }
      return;
    }

    // Rework and Reject logic (non-self-assigned — self-assigned handled above)
    if (fromStatus === TicketStatus.REVIEW && (toStatus === TicketStatus.IN_PROGRESS || toStatus === TicketStatus.OPEN)) {
      if (!isScopedReviewer) {
        throw new ForbiddenException('Only scoped reviewers, managers, or admins can reject or send tickets back for rework');
      }
      if (user.id === ticket.assignedToId ||
          ticket.assignees?.some?.((a: any) => (a?.userId ?? a?.user?.id) === user.id)) {
        throw new ForbiddenException('The assignee cannot send back their own work — it must be reviewed by the assigner or their hierarchy.');
      }
      return;
    }

    if (workerStatuses.includes(toStatus) || toStatus === TicketStatus.OPEN) {
      if (isParticipant || isScopedReviewer) return;
    }

    throw new ForbiddenException('You do not have permission to change this ticket status');
  }

  async assertCanBlockTicket(user: any, ticket: any): Promise<void> {
    const roleName = this.access.roleName(user);
    if (roleName === ROLES.INTERN) {
      throw new ForbiddenException('Interns cannot block or unblock tickets');
    }
    if (this.access.isAdmin(user)) return;
    if ([ROLES.MANAGER, ROLES.TEAM_LEAD].includes(roleName as any)) {
      if (!(await this.isTicketInUserScope(user, ticket))) {
        throw new ForbiddenException('Ticket is outside your scope');
      }
      return;
    }
    // EMPLOYEE: must be assignee, creator, or listed in assignees
    if (this.isTicketParticipant(user.id, ticket)) return;
    throw new ForbiddenException('Only participants (assignee/creator) or scoped leads/managers can block this ticket');
  }

  async assertCanDeleteTicket(user: any, ticket: any): Promise<void> {
    if (!this.access.isAdmin(user)) {
      throw new ForbiddenException('Only admins can delete tickets');
    }
    if (!(await this.isTicketInUserScope(user, ticket))) {
      throw new ForbiddenException('You do not have permission to delete this ticket');
    }
  }

  // Bulk/import creation only — single-ticket create() has no department-access
  // check today (pre-existing; left as-is to avoid changing that path's
  // behavior). New rows created in bulk must stay inside the creator's own
  // scope, same rule already enforced for reassignment via assertCanAssignTicket.
  async assertCanCreateInDepartment(user: any, departmentId: string): Promise<void> {
    if (this.access.isAdmin(user)) return;
    const deptIds = await this.access.managedDepartmentIds(user);
    if (!departmentId || !deptIds.includes(departmentId)) {
      throw new ForbiddenException('You do not have permission to create tickets in this department');
    }
  }

  async assertCanCreateComment(user: any, ticketId: string): Promise<void> {
    await this.assertCanViewTicket(user, ticketId);
  }

  async assertCanUploadAttachment(user: any, ticket: any): Promise<void> {
    const roleName = this.access.roleName(user);
    if (this.access.isAdmin(user)) return;
    if ([ROLES.MANAGER, ROLES.TEAM_LEAD].includes(roleName as any) && await this.isTicketInUserScope(user, ticket)) return;
    if (this.isTicketParticipant(user.id, ticket)) return;
    throw new ForbiddenException('You do not have permission to attach files to this ticket');
  }

  async visibleUserIdsForWorkload(user: any): Promise<string[] | null> {
    if (this.access.isAdmin(user)) return null;
    const roleName = this.access.roleName(user);
    if ([ROLES.MANAGER, ROLES.TEAM_LEAD].includes(roleName as any)) {
      const deptIds = await this.access.managedDepartmentIds(user);
      if (deptIds.length === 0) return [user.id];
      const users = await this.prisma.user.findMany({
        where: { isActive: true, departmentId: { in: deptIds } },
        select: { id: true },
      });
      return [...new Set([...users.map((u) => u.id), user.id])];
    }
    return [user.id];
  }

  private async buildFilterWhere(filters: any): Promise<any> {
    const where: any = {};
    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { ticketId: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    const status = ticketEnumFilter('status', filters.status, TicketStatus);
    if (status) where.status = status;
    const category = ticketEnumFilter('category', filters.category, TicketCategory);
    if (category) where.category = category;
    const priority = ticketEnumFilter('priority', filters.priority, Priority);
    if (priority) where.priority = priority;
    const deptId = await this.resolveDeptFilter(filters.departmentId || filters.department);
    if (deptId) where.departmentId = deptId;
    if (filters.projectId) where.projectId = filters.projectId;
    if (filters.assignedToId) where.assignedToId = filters.assignedToId;
    if (filters.createdById) where.createdById = filters.createdById;
    if (filters.reporterId) where.createdById = filters.reporterId;
    const createdFrom = createdFilterBound(filters.dateFrom, 'start');
    const createdTo = createdFilterBound(filters.dateTo, 'end');
    if (createdFrom || createdTo) {
      where.createdAt = {};
      if (createdFrom) where.createdAt.gte = createdFrom;
      if (createdTo) where.createdAt.lte = createdTo;
    }
    const dueBefore = ticketDueBound('dueBefore', filters.dueBefore);
    const dueAfter = ticketDueBound('dueAfter', filters.dueAfter);
    if (dueBefore || dueAfter) {
      where.dueDate = {};
      if (dueBefore) where.dueDate.lte = dueBefore;
      if (dueAfter) where.dueDate.gte = dueAfter;
    }
    return where;
  }

  private async buildScopeWhere(user?: any): Promise<any> {
    if (!user) return {};
    const roleName = this.access.roleName(user);
    if (this.access.isAdmin(user)) return {};

    if (roleName === ROLES.MANAGER || roleName === ROLES.TEAM_LEAD) {
      const deptIds = await this.access.managedDepartmentIds(user);
      const scopedOr: any[] = [
        { assignedToId: user.id },
        { createdById: user.id },
        { assignees: { some: { userId: user.id } } },
      ];
      if (deptIds.length > 0) {
        scopedOr.push(
          { departmentId: { in: deptIds } },
          { assignedTo: { departmentId: { in: deptIds } } },
          { createdBy: { departmentId: { in: deptIds } } },
          { assignees: { some: { user: { departmentId: { in: deptIds } } } } },
        );
      }
      return { OR: scopedOr };
    }

    return {
      OR: [
        { assignedToId: user.id },
        { createdById: user.id },
        { assignees: { some: { userId: user.id } } },
        { assignedToId: null, departmentId: user.departmentId },
      ],
    };
  }

  private async isTicketInUserScope(user: any, ticket: any): Promise<boolean> {
    if (this.access.isAdmin(user)) return true;
    const where = await this.buildTicketWhereForUser({}, user);
    const count = await this.prisma.ticket.count({
      where: this.andWhere({ id: ticket.id }, where),
    });
    return count > 0;
  }

  private isTicketParticipant(userId: string, ticket: any): boolean {
    return Boolean(
      ticket?.assignedToId === userId ||
      ticket?.createdById === userId ||
      ticket?.assignees?.some?.((row: any) => row.userId === userId || row.user?.id === userId),
    );
  }

  private async resolveDeptFilter(value?: string): Promise<string | undefined> {
    if (!value) return undefined;
    if (isUUID(value)) return value;
    // Schema uses cuid() — accept any non-UUID value as either a CUID id or a dept name.
    const dept = await this.prisma.department.findFirst({
      where: { OR: [{ id: value }, { name: { equals: value, mode: 'insensitive' } }] },
      select: { id: true },
    });
    return dept?.id;
  }

  private andWhere(...clauses: any[]): any {
    const parts = clauses.filter((clause) => clause && Object.keys(clause).length > 0);
    if (parts.length === 0) return {};
    if (parts.length === 1) return parts[0];
    return { AND: parts };
  }
}
