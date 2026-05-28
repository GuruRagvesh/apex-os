import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TicketStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLES } from '../../shared/constants/roles';
import { AccessPolicyService } from './access-policy.service';

function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str ?? '');
}

@Injectable()
export class TicketAccessService {
  constructor(
    private prisma: PrismaService,
    private access: AccessPolicyService,
  ) {}

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

  async assertCanUpdateTicket(user: any, ticket: any): Promise<void> {
    const roleName = this.access.roleName(user);
    if (this.access.isAdmin(user)) return;
    if (!(await this.isTicketInUserScope(user, ticket))) {
      throw new ForbiddenException('You do not have permission to update this ticket');
    }
    if ([ROLES.MANAGER, ROLES.TEAM_LEAD].includes(roleName as any)) return;
    if (this.isTicketParticipant(user.id, ticket)) return;
    throw new ForbiddenException('Only the assignee, reporter, or scoped lead/manager can update this ticket');
  }

  async assertCanAssignTicket(user: any, ticket: any, assignedToId: string | null | undefined): Promise<void> {
    const roleName = this.access.roleName(user);
    if (!this.access.isAdmin(user) && ![ROLES.MANAGER, ROLES.TEAM_LEAD].includes(roleName as any)) {
      throw new ForbiddenException('You do not have permission to assign this ticket');
    }
    if (!this.access.isAdmin(user) && !(await this.isTicketInUserScope(user, ticket))) {
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
  ): Promise<void> {
    await this.assertCanUpdateTicket(user, ticket);
    const fromStatus = ticket.status as TicketStatus;
    if (fromStatus === toStatus) return;

    const roleName = this.access.roleName(user);
    const isScopedReviewer =
      this.access.isAdmin(user) ||
      ([ROLES.MANAGER, ROLES.TEAM_LEAD].includes(roleName as any) && await this.isTicketInUserScope(user, ticket));
    const isParticipant = this.isTicketParticipant(user.id, ticket);

    const allowed: Record<string, TicketStatus[]> = {
      [TicketStatus.OPEN]: [TicketStatus.IN_PROGRESS, TicketStatus.CLOSED],
      [TicketStatus.IN_PROGRESS]: [TicketStatus.REVIEW, TicketStatus.DONE, TicketStatus.CLOSED],
      [TicketStatus.REVIEW]: [TicketStatus.IN_PROGRESS, TicketStatus.DONE, TicketStatus.CLOSED],
      [TicketStatus.DONE]: [TicketStatus.CLOSED],
      [TicketStatus.CLOSED]: [],
    };

    if (!allowed[fromStatus]?.includes(toStatus)) {
      throw new ForbiddenException(`Illegal ticket transition from ${fromStatus} to ${toStatus}`);
    }

    const isSelfAssignedCreator = ticket.createdById === user.id && ticket.assignedToId === user.id;

    if (roleName === ROLES.INTERN && toStatus !== TicketStatus.IN_PROGRESS) {
      if (!(isSelfAssignedCreator && (toStatus === TicketStatus.DONE || toStatus === TicketStatus.CLOSED))) {
        throw new ForbiddenException('Interns can only move tickets to IN_PROGRESS');
      }
    }

    if (toStatus === TicketStatus.DONE || toStatus === TicketStatus.CLOSED) {
      if (!isScopedReviewer && !isSelfAssignedCreator) {
        throw new ForbiddenException('Only scoped reviewers, managers, or admins can complete or close tickets');
      }
      return;
    }

    if (fromStatus === TicketStatus.REVIEW && toStatus === TicketStatus.IN_PROGRESS) {
      if (!isScopedReviewer && !isSelfAssignedCreator) {
        throw new ForbiddenException('Only scoped reviewers, managers, or admins can send tickets back for rework');
      }
      return;
    }

    const workerStatuses: TicketStatus[] = [TicketStatus.IN_PROGRESS, TicketStatus.REVIEW];
    if (workerStatuses.includes(toStatus)) {
      if (isParticipant || isScopedReviewer || isSelfAssignedCreator) return;
    }

    throw new ForbiddenException('You do not have permission to change this ticket status');
  }

  async assertCanDeleteTicket(user: any, ticket: any): Promise<void> {
    if (!this.access.isAdmin(user)) {
      throw new ForbiddenException('Only admins can delete tickets');
    }
    if (!(await this.isTicketInUserScope(user, ticket))) {
      throw new ForbiddenException('You do not have permission to delete this ticket');
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
    const dept = await this.prisma.department.findFirst({
      where: { name: { equals: value, mode: 'insensitive' } },
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
