import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LeaveStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLES } from '../../shared/constants/roles';
import { AccessPolicyService } from './access-policy.service';

@Injectable()
export class LeaveAccessService {
  constructor(
    private prisma: PrismaService,
    private access: AccessPolicyService,
  ) {}

  async buildLeaveWhereForUser(query: any = {}, user?: any): Promise<any> {
    const filters: any = {};
    if (query.userId) filters.userId = query.userId;
    if (query.status) filters.status = query.status;
    if (query.departmentId) filters.user = { departmentId: query.departmentId };
    if (query.dateFrom || query.dateTo) {
      filters.startDate = {};
      if (query.dateFrom) filters.startDate.gte = new Date(query.dateFrom);
      if (query.dateTo) filters.startDate.lte = new Date(query.dateTo);
    }
    const scope = user ? await this.buildScope(user) : {};
    return this.andWhere(filters, scope);
  }

  async findAccessibleLeave(id: string, user: any, include?: any): Promise<any> {
    const existing = await this.prisma.leaveRequest.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Leave request not found');
    const where = await this.buildLeaveWhereForUser({}, user);
    const allowed = await this.prisma.leaveRequest.count({
      where: this.andWhere({ id }, where),
    });
    if (!allowed) throw new ForbiddenException('You do not have permission to view this leave request');
    return this.prisma.leaveRequest.findUnique({ where: { id }, include });
  }

  async assertCanApproveReject(user: any, leave: any, action: 'approve' | 'reject'): Promise<void> {
    if (!user?.id) throw new ForbiddenException('Not authorized');
    if (leave.userId === user.id) {
      throw new ForbiddenException(`You cannot ${action} your own leave request`);
    }
    if (leave.status !== LeaveStatus.PENDING) {
      throw new ForbiddenException('Only pending leave requests can be processed');
    }

    const approver = await this.access.hydrateUser(user);
    const targetUser = leave.user ?? await this.prisma.user.findUnique({
      where: { id: leave.userId },
      include: { role: true, department: true },
    });
    if (!approver || !targetUser) throw new ForbiddenException('Not authorized');

    const roleName = this.access.roleName(approver);
    if (![ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.MANAGER, ROLES.TEAM_LEAD].includes(roleName as any) && !approver.isHR) {
      throw new ForbiddenException(`You do not have permission to ${action} leave`);
    }

    if (targetUser.role && approver.role && approver.role.level >= targetUser.role.level) {
      throw new ForbiddenException(`A ${approver.role.name} cannot ${action} a ${targetUser.role.name}'s leave`);
    }

    if (this.access.isHrOrAdmin(approver)) return;

    const deptIds = await this.access.managedDepartmentIds(approver);
    if (!targetUser.departmentId || !deptIds.includes(targetUser.departmentId)) {
      throw new ForbiddenException(`You do not have permission to ${action} leave outside your scope`);
    }
  }

  private async buildScope(user: any): Promise<any> {
    const roleName = this.access.roleName(user);
    if (this.access.isHrOrAdmin(user)) return {};
    if ([ROLES.EMPLOYEE, ROLES.INTERN].includes(roleName as any)) return { userId: user.id };
    if ([ROLES.MANAGER, ROLES.TEAM_LEAD].includes(roleName as any)) {
      const deptIds = await this.access.managedDepartmentIds(user);
      if (deptIds.length === 0) return { userId: user.id };
      return { user: { departmentId: { in: deptIds } } };
    }
    return { userId: user.id };
  }

  private andWhere(...clauses: any[]): any {
    const parts = clauses.filter((clause) => clause && Object.keys(clause).length > 0);
    if (parts.length === 0) return {};
    if (parts.length === 1) return parts[0];
    return { AND: parts };
  }
}
