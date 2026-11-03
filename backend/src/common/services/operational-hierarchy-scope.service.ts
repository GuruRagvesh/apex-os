import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const LEADER_ROLES = ['TEAM_LEAD', 'MANAGER'] as const;
const COMPANY_TARGET_ROLES = ['MANAGER', 'TEAM_LEAD', 'EMPLOYEE', 'INTERN'];
const MANAGER_TARGET_ROLES = ['TEAM_LEAD', 'EMPLOYEE', 'INTERN'];
// Department-level Team Leads must also see Team Leads of teams inside their
// department. Team-only leads remain constrained by explicit membership.
const TEAM_LEAD_TARGET_ROLES = ['TEAM_LEAD', 'EMPLOYEE', 'INTERN'];

type ScopeViewer = {
  id: string;
  role?: { name?: string } | string | null;
  departmentId?: string | null;
  isHR?: boolean;
};

type ScopeOptions = {
  departmentId?: string;
  includeSelf?: boolean;
};

/**
 * Backend authority for "whose data may this viewer see?" in operational
 * people surfaces. Role determines actions; explicit hierarchy, department
 * and team grants determine the people those actions may target.
 *
 * Access is never inferred from User.departmentId. No explicit grant means no
 * subordinate visibility.
 */
@Injectable()
export class OperationalHierarchyScopeService {
  constructor(private readonly prisma: PrismaService) {}

  private roleName(viewer: ScopeViewer): string {
    return typeof viewer.role === 'string' ? viewer.role : viewer.role?.name ?? '';
  }

  private activeAt(now: Date) {
    return {
      isPrimary: true,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    };
  }

  async visibleUserIds(viewer: ScopeViewer, options: ScopeOptions = {}) {
    const role = this.roleName(viewer);
    const companyWide = role === 'ADMIN' || role === 'SUPER_ADMIN' || Boolean(viewer.isHR);
    if (companyWide) {
      return {
        role,
        departmentId: options.departmentId ?? null,
        userIds: await this.findEligibleUsers(COMPANY_TARGET_ROLES, viewer.id, options.departmentId),
        sources: ['COMPANY'],
      };
    }

    if (!LEADER_ROLES.includes(role as any)) {
      return { role, departmentId: options.departmentId ?? null, userIds: [], sources: [] as string[] };
    }

    const now = new Date();
    const visibleIds = new Set<string>();
    const departmentIds = new Set<string>();
    const sources = new Set<string>();
    const visitedSupervisors = new Set<string>();
    let frontier = [viewer.id];
    let hierarchyCompanyWide = false;

    // Follow direct employee reporting lines and explicit team membership to
    // include both direct reports and the complete downstream chain.
    while (frontier.length && !hierarchyCompanyWide) {
      const batch = frontier.filter((id) => !visitedSupervisors.has(id));
      if (!batch.length) break;
      batch.forEach((id) => visitedSupervisors.add(id));

      const [assignments, teams] = await Promise.all([
        this.prisma.hierarchyAssignment.findMany({
          where: { assigneeUserId: { in: batch }, ...this.activeAt(now) },
          select: {
            scope: true,
            subjectUserId: true,
            departmentId: true,
            assigneeUser: { select: { departmentId: true, role: { select: { name: true } } } },
          },
        }),
        this.prisma.team.findMany({
          where: { teamLeadId: { in: batch }, isActive: true },
          select: {
            departmentId: true,
            teamLead: { select: { departmentId: true } },
            members: { select: { userId: true, user: { select: { departmentId: true } } } },
          },
        }),
      ]);

      const next: string[] = [];
      for (const assignment of assignments) {
        sources.add('HIERARCHY');
        if (assignment.scope === 'COMPANY') hierarchyCompanyWide = true;
        if (assignment.scope === 'DEPARTMENT' && assignment.departmentId) {
          // Department Team Leads are department-bound. This also prevents a
          // stale old-department grant from surviving a transfer. Managers may
          // hold deliberately cross-department grants.
          const validDepartmentGrant = assignment.assigneeUser.role.name === 'MANAGER'
            || assignment.assigneeUser.departmentId === assignment.departmentId;
          if (validDepartmentGrant) departmentIds.add(assignment.departmentId);
        }
        if (assignment.scope === 'EMPLOYEE' && assignment.subjectUserId && assignment.subjectUserId !== viewer.id) {
          if (!visibleIds.has(assignment.subjectUserId)) next.push(assignment.subjectUserId);
          visibleIds.add(assignment.subjectUserId);
        }
      }
      for (const team of teams) {
        // A Team Lead and every team member must currently belong to the
        // team's department. Stale memberships after a transfer grant nothing.
        if (team.teamLead?.departmentId !== team.departmentId) continue;
        sources.add('TEAM');
        for (const member of team.members) {
          if (member.userId === viewer.id) continue;
          if (member.user.departmentId !== team.departmentId) continue;
          if (!visibleIds.has(member.userId)) next.push(member.userId);
          visibleIds.add(member.userId);
        }
      }
      frontier = next;
    }

    // ManagerDeptAccess is an explicit manager grant and is combined with the
    // newer hierarchy rows during migration. The home department is not a
    // fallback because it is identity data, not an access grant.
    if (role === 'MANAGER') {
      const managerDepartments = await this.prisma.managerDeptAccess.findMany({
        where: { managerId: viewer.id },
        select: { departmentId: true },
      });
      if (managerDepartments.length) sources.add('MANAGER_DEPARTMENT');
      managerDepartments.forEach((row) => departmentIds.add(row.departmentId));
    }

    const targetRoles = role === 'MANAGER' ? MANAGER_TARGET_ROLES : TEAM_LEAD_TARGET_ROLES;
    let userIds: string[];
    if (hierarchyCompanyWide) {
      userIds = await this.findEligibleUsers(targetRoles, viewer.id, options.departmentId);
    } else {
      userIds = await this.findEligibleUsers(targetRoles, viewer.id, options.departmentId, {
        subjectIds: [...visibleIds],
        departmentIds: [...departmentIds],
      });
    }

    if (options.includeSelf && role === 'TEAM_LEAD') userIds.unshift(viewer.id);
    return {
      role,
      departmentId: options.departmentId ?? null,
      userIds: [...new Set(userIds)],
      sources: [...sources],
    };
  }

  private async findEligibleUsers(
    targetRoles: string[],
    viewerId: string,
    selectedDepartment?: string,
    scope?: { subjectIds: string[]; departmentIds: string[] },
  ): Promise<string[]> {
    const where: any = {
      isActive: true,
      isSystemAccount: false,
      id: { not: viewerId },
      role: { name: { in: targetRoles } },
      ...(selectedDepartment ? { departmentId: selectedDepartment } : {}),
    };
    if (scope) {
      const clauses: any[] = [];
      if (scope.subjectIds.length) clauses.push({ id: { in: [...new Set(scope.subjectIds)] } });
      if (scope.departmentIds.length) clauses.push({ departmentId: { in: [...new Set(scope.departmentIds)] } });
      if (!clauses.length) return [];
      where.AND = [{ OR: clauses }];
    }
    const users = await this.prisma.user.findMany({ where, select: { id: true } });
    return users.map((user) => user.id);
  }
}
