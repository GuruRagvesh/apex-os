import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TicketStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLES } from '../../shared/constants/roles';
import { AccessPolicyService } from './access-policy.service';
import { HierarchyApprovalService } from './hierarchy-approval.service';

function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str ?? '');
}

@Injectable()
export class TicketAccessService {
  constructor(
    private prisma: PrismaService,
    private access: AccessPolicyService,
    private hierarchy: HierarchyApprovalService,
  ) {}

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
    if (this.hierarchy.isSelfAssigned(ticket)) {
      if (user.id === ticket.createdById) return false; // self-worker never approves
      return this.hierarchy.isApproverFor(user.id, ticket.createdById);
    }
    const roleName = this.access.roleName(user);
    if (this.access.isAdmin(user)) return true;
    if ([ROLES.MANAGER, ROLES.TEAM_LEAD].includes(roleName as any)) {
      return this.isTicketInUserScope(user, ticket);
    }
    return false;
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
    await this.assertCanUpdateTicket(user, ticket, updates);
    const fromStatus = ticket.status as TicketStatus;
    if (fromStatus === toStatus) return;

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
      return;
    }

    // Rework and Reject logic (non-self-assigned — self-assigned handled above)
    if (fromStatus === TicketStatus.REVIEW && (toStatus === TicketStatus.IN_PROGRESS || toStatus === TicketStatus.OPEN)) {
      if (!isScopedReviewer) {
        throw new ForbiddenException('Only scoped reviewers, managers, or admins can reject or send tickets back for rework');
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
    if (filters.status && filters.status !== 'ALL') where.status = filters.status;
    if (filters.category) where.category = filters.category;
    if (filters.priority) where.priority = filters.priority;
    const deptId = await this.resolveDeptFilter(filters.departmentId || filters.department);
    if (deptId) where.departmentId = deptId;
    if (filters.projectId) where.projectId = filters.projectId;
    if (filters.assignedToId) where.assignedToId = filters.assignedToId;
    if (filters.createdById) where.createdById = filters.createdById;
    if (filters.reporterId) where.createdById = filters.reporterId;
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo);
    }
    if (filters.dueBefore || filters.dueAfter) {
      where.dueDate = {};
      if (filters.dueBefore) where.dueDate.lte = new Date(filters.dueBefore);
      if (filters.dueAfter) where.dueDate.gte = new Date(filters.dueAfter);
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
