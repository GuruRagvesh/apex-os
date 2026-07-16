import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLES } from '../../shared/constants/roles';
import { AccessPolicyService } from './access-policy.service';

@Injectable()
export class SalesAccessService {
  constructor(
    private prisma: PrismaService,
    private access: AccessPolicyService,
  ) {}

  async buildLeadWhereForUser(filters: any = {}, user?: any): Promise<any> {
    const filterWhere = this.buildFilterWhere(filters);
    const scopeWhere = await this.buildScope(user);
    return this.andWhere(filterWhere, scopeWhere);
  }

  async findAccessibleLead(id: string, user: any, include?: any): Promise<any> {
    const existing = await this.prisma.lead.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('Lead not found');
    const where = await this.buildLeadWhereForUser({}, user);
    const allowed = await this.prisma.lead.count({ where: this.andWhere({ id }, where) });
    if (!allowed) throw new ForbiddenException('You do not have permission to view this lead');
    return this.prisma.lead.findUnique({ where: { id }, include });
  }

  async assertCanEditLead(user: any, lead: any): Promise<void> {
    if (this.access.isAdmin(user)) return;
    if (lead.ownerId === user?.id) return;
    throw new ForbiddenException('You do not have permission to edit this lead');
  }

  // Manager is bulk-manage; Team Lead is deliberately excluded here — matches
  // the frontend's existing canBulkManage, which never granted TEAM_LEAD this tier.
  async assertCanBulkManageLeads(user: any): Promise<void> {
    const roleName = this.access.roleName(user);
    if ([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.MANAGER].includes(roleName as any)) return;
    throw new ForbiddenException('You do not have permission to perform bulk actions on leads');
  }

  async assertCanChangeLeadOwner(user: any, lead: any): Promise<void> {
    if (this.access.isAdmin(user)) return;
    const roleName = this.access.roleName(user);
    if (roleName === ROLES.MANAGER && (await this.isLeadInUserScope(user, lead))) return;
    if (lead.ownerId === user?.id) return;
    throw new ForbiddenException('You do not have permission to reassign this lead');
  }

  async assertCanDeleteLead(user: any): Promise<void> {
    if (!this.access.isAdmin(user)) {
      throw new ForbiddenException('Only admins can delete leads');
    }
  }

  private buildFilterWhere(filters: any): any {
    const where: any = {};
    if (filters.search) {
      where.OR = [
        { company: { contains: filters.search, mode: 'insensitive' } },
        { poc: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
        { phone: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    if (filters.leadStage) where.leadStage = filters.leadStage;
    if (filters.leadSource) where.leadSource = filters.leadSource;
    if (filters.priority) where.priority = filters.priority;
    if (filters.ownerId) where.ownerId = filters.ownerId;
    if (filters.departmentId) where.departmentId = filters.departmentId;
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo);
    }
    return where;
  }

  private async buildScope(user?: any): Promise<any> {
    if (!user) return {};
    const roleName = this.access.roleName(user);
    if (this.access.isAdmin(user)) return {};
    if ([ROLES.MANAGER, ROLES.TEAM_LEAD].includes(roleName as any)) {
      const deptIds = await this.access.managedDepartmentIds(user);
      const scopedOr: any[] = [{ ownerId: user.id }];
      if (deptIds.length > 0) scopedOr.push({ departmentId: { in: deptIds } });
      return { OR: scopedOr };
    }
    return { ownerId: user.id };
  }

  private async isLeadInUserScope(user: any, lead: any): Promise<boolean> {
    if (this.access.isAdmin(user)) return true;
    const where = await this.buildLeadWhereForUser({}, user);
    const count = await this.prisma.lead.count({ where: this.andWhere({ id: lead.id }, where) });
    return count > 0;
  }

  private andWhere(...clauses: any[]): any {
    const parts = clauses.filter((clause) => clause && Object.keys(clause).length > 0);
    if (parts.length === 0) return {};
    if (parts.length === 1) return parts[0];
    return { AND: parts };
  }
}
