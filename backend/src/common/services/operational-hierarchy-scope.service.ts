import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const LEADER_ROLES = ['TEAM_LEAD', 'MANAGER'] as const;
const COMPANY_TARGET_ROLES = ['MANAGER', 'TEAM_LEAD', 'EMPLOYEE', 'INTERN'];
const MANAGER_TARGET_ROLES = ['TEAM_LEAD', 'EMPLOYEE', 'INTERN'];
// Team Leads see downstream Team Leads in departments that report to them.
const TEAM_LEAD_TARGET_ROLES = ['TEAM_LEAD', 'EMPLOYEE', 'INTERN'];
// A home department alone only exposes its members. Other Team Leads there
// are peers or seniors unless they report to the viewer.
const HOME_DEPARTMENT_TARGET_ROLES = ['EMPLOYEE', 'INTERN'];

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
 * Team Leads receive the employees and interns of their current home
 * department. Additional visibility is accumulated from explicit grants,
 * formal teams and the organization reporting tree. Managers remain
 * explicit-scope only.
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
    const memberDepartmentIds = new Set<string>();
    const sources = new Set<string>();
    const visitedSupervisors = new Set<string>();
    let frontier = [viewer.id];
    let hierarchyCompanyWide = false;

    const homeDepartmentId = role === 'TEAM_LEAD' ? viewer.departmentId ?? null : null;
    if (homeDepartmentId) {
      memberDepartmentIds.add(homeDepartmentId);
      sources.add('HOME_DEPARTMENT');
    }
    // A report leading the viewer's own department must not widen it to every
    // Team Lead there; leads below the viewer arrive through their own lines.
    const addLedDepartment = (departmentId: string | null | undefined) => {
      if (departmentId && departmentId !== homeDepartmentId) departmentIds.add(departmentId);
    };

    // Follow access assignments, formal teams and the organization chart to
    // include direct reports plus the complete downstream chain.
    while (frontier.length && !hierarchyCompanyWide) {
      const batch = frontier.filter((id) => !visitedSupervisors.has(id));
      if (!batch.length) break;
      batch.forEach((id) => visitedSupervisors.add(id));

      const [assignments, teams, reportingLines] = await Promise.all([
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
        this.prisma.organizationReportingLine.findMany({
          where: {
            supervisorId: { in: batch },
            subject: { isActive: true, isSystemAccount: false },
          },
          select: {
            subjectUserId: true,
            departmentId: true,
            subject: {
              select: {
                departmentId: true,
                role: { select: { name: true } },
                departmentMemberships: {
                  where: { isDepartmentLead: true },
                  select: { departmentId: true },
                },
              },
            },
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
      for (const line of reportingLines) {
        sources.add('REPORTING_LINE');
        if (line.subjectUserId !== viewer.id) {
          if (!visibleIds.has(line.subjectUserId)) next.push(line.subjectUserId);
          visibleIds.add(line.subjectUserId);
        }

        // When a downstream person leads a department, that whole department
        // is below the viewer even if some employees do not yet have individual
        // reporting rows. This represents nested departments without a second
        // parent/child department model.
        const leadsDepartment = ['TEAM_LEAD', 'MANAGER'].includes(line.subject.role.name)
          || line.subject.departmentMemberships.length > 0;
        if (leadsDepartment) {
          addLedDepartment(line.departmentId ?? line.subject.departmentId);
          line.subject.departmentMemberships.forEach((membership) => addLedDepartment(membership.departmentId));
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
        // An explicit grant on the home department already covers all roles.
        memberDepartmentIds: [...memberDepartmentIds].filter((id) => !departmentIds.has(id)),
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
    scope?: { subjectIds: string[]; departmentIds: string[]; memberDepartmentIds?: string[] },
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
      if (scope.memberDepartmentIds?.length) {
        clauses.push({
          departmentId: { in: [...new Set(scope.memberDepartmentIds)] },
          role: { name: { in: HOME_DEPARTMENT_TARGET_ROLES } },
        });
      }
      if (!clauses.length) return [];
      where.AND = [{ OR: clauses }];
    }
    const users = await this.prisma.user.findMany({ where, select: { id: true } });
    return users.map((user) => user.id);
  }
}
