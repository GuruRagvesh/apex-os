import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AccessPolicyService } from '../../../../common/services/access-policy.service';
import { ROLES } from '../../../../shared/constants/roles';

/**
 * Who may see and decide an attendance correction (Phase 3).
 *
 * Any ONE of these may decide finally:
 *   1. the employee's valid Team Lead      (EMPLOYEE_TL)
 *   2. the employee's valid reporting Manager (REPORTING_MANAGER)
 *   3. an active HR-authorized user        (HR)
 *   4. Admin                                (ADMIN)
 *   5. Super Admin                          (SUPER_ADMIN)
 *
 * Only the subject is ever excluded: nobody decides their own request, and a
 * Super Admin's request can be decided by HR, Admin or another Super Admin.
 *
 * "Valid" TL/Manager: active, outranks the employee (role level), and linked by
 * a primary HierarchyAssignment for the employee, else the legacy per-employee
 * employee-ID link (teamLeadName / reportingManager), else -- for TLs only --
 * the department's single active Team Lead when the employee has no explicit
 * TL. Unrelated TLs and Managers have no access at all.
 */

export type CorrectionVia = 'EMPLOYEE_TL' | 'REPORTING_MANAGER' | 'HR' | 'ADMIN' | 'SUPER_ADMIN';

export interface CorrectionEligibility {
  via: CorrectionVia;
  /** Role snapshot recorded with the decision. */
  role: string;
  /** Whether this came from the hierarchy (team scope) or company authority. */
  scope: 'team' | 'company';
}

type Actor = { id: string; employeeId?: string | null; departmentId?: string | null; isHR?: boolean; role?: { name: string; level: number } | null; isActive?: boolean };

@Injectable()
export class CorrectionAuthorityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessPolicy: AccessPolicyService,
  ) {}

  /** The actor as stored now -- never trust role or HR flags from a token. */
  async loadActor(actorId: string): Promise<Actor | null> {
    return this.prisma.user.findUnique({
      where: { id: actorId },
      select: { id: true, employeeId: true, departmentId: true, isHR: true, isActive: true, role: { select: { name: true, level: true } } },
    });
  }

  /** HR, Admin or Super Admin: company-wide correction authority. */
  companyVia(actor: Actor | null): CorrectionVia | null {
    if (!actor?.isActive) return null;
    const role = actor.role?.name;
    if (role === ROLES.SUPER_ADMIN) return 'SUPER_ADMIN';
    if (role === ROLES.ADMIN) return 'ADMIN';
    if (actor.isHR) return 'HR';
    return null;
  }

  canViewCompany(actor: Actor | null): boolean {
    return this.companyVia(actor) !== null;
  }

  private activeAssignment(now: Date) {
    return { isPrimary: true, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] };
  }

  /**
   * Employees whose corrections fall in this actor's TEAM scope, resolved as an
   * id set so the queue can filter in PostgreSQL before ordering and paging.
   */
  async teamSubjectIds(actor: Actor | null, now = new Date()): Promise<string[]> {
    if (!actor?.isActive) return [];
    const level = actor.role?.level ?? Number.MAX_SAFE_INTEGER;
    const ids = new Set<string>();

    const assigned = await this.prisma.hierarchyAssignment.findMany({
      where: { scope: 'EMPLOYEE', assigneeUserId: actor.id, role: { in: ['TEAM_LEAD', 'MANAGER'] }, ...this.activeAssignment(now) },
      select: { subjectUserId: true },
    });
    for (const a of assigned) if (a.subjectUserId) ids.add(a.subjectUserId);

    // A department's configured primary TL and Manager are both valid
    // reviewers. This is what keeps requests visible when an employee has no
    // personal assignment or their former reviewer was removed.
    const departmentAssignments = await this.prisma.hierarchyAssignment.findMany({
      where: { scope: 'DEPARTMENT', assigneeUserId: actor.id, role: { in: ['TEAM_LEAD', 'MANAGER'] }, ...this.activeAssignment(now) },
      select: { departmentId: true },
    });
    const departmentIds = departmentAssignments.map((x) => x.departmentId).filter((x): x is string => !!x);
    if (departmentIds.length) {
      const members = await this.prisma.user.findMany({ where: { departmentId: { in: departmentIds }, isActive: true }, select: { id: true } });
      for (const member of members) ids.add(member.id);
    }

    // Preserve the existing ManagerDeptAccess relationship until all legacy
    // departments have been moved to HierarchyAssignment.
    const managerDepartments = await this.prisma.managerDeptAccess.findMany({ where: { managerId: actor.id }, select: { departmentId: true } });
    if (managerDepartments.length) {
      const members = await this.prisma.user.findMany({ where: { departmentId: { in: managerDepartments.map((x) => x.departmentId) }, isActive: true }, select: { id: true } });
      for (const member of members) ids.add(member.id);
    }

    if (actor.employeeId) {
      const linked = await this.prisma.user.findMany({
        where: { OR: [{ teamLeadName: actor.employeeId }, { reportingManager: actor.employeeId }] },
        select: { id: true },
      });
      for (const u of linked) ids.add(u.id);
    }

    // The department's single active Team Lead covers employees with no
    // explicit Team Lead of their own.
    if ((actor.role?.name === ROLES.TEAM_LEAD || actor.role?.name === ROLES.MANAGER) && actor.departmentId) {
      const role = actor.role!.name;
      const holders = await this.prisma.user.count({
          where: { isActive: true, departmentId: actor.departmentId, role: { name: role } },
        });
        if (holders === 1) {
          const members = await this.prisma.user.findMany({
            where: role === ROLES.TEAM_LEAD
              ? { departmentId: actor.departmentId, OR: [{ teamLeadName: null }, { teamLeadName: '' }] }
              : { departmentId: actor.departmentId },
            select: { id: true },
          });
          for (const m of members) ids.add(m.id);
        }
    }

    ids.delete(actor.id);
    if (ids.size === 0) return [];
    // Only people the actor outranks.
    const outranked = await this.prisma.user.findMany({
      where: { id: { in: [...ids] }, role: { level: { gt: level } } },
      select: { id: true },
    });
    return outranked.map((u) => u.id);
  }

  /** How (and whether) this actor may decide this subject's correction. */
  async eligibility(actor: Actor | null, subjectUserId: string, now = new Date()): Promise<CorrectionEligibility | null> {
    if (!actor?.isActive || actor.id === subjectUserId) return null;
    const subject = await this.prisma.user.findUnique({
      where: { id: subjectUserId },
      select: { id: true, teamLeadName: true, reportingManager: true, departmentId: true, role: { select: { level: true } } },
    });
    if (!subject) return null;

    const outranks = (actor.role?.level ?? Number.MAX_SAFE_INTEGER) < (subject.role?.level ?? Number.MAX_SAFE_INTEGER);
    if (outranks) {
      const assignment = await this.prisma.hierarchyAssignment.findFirst({
        where: { scope: 'EMPLOYEE', subjectUserId, assigneeUserId: actor.id, role: { in: ['TEAM_LEAD', 'MANAGER'] }, ...this.activeAssignment(now) },
        select: { role: true },
      });
      if (assignment) {
        return { via: assignment.role === 'TEAM_LEAD' ? 'EMPLOYEE_TL' : 'REPORTING_MANAGER', role: actor.role?.name ?? 'UNKNOWN', scope: 'team' };
      }
      if (subject.departmentId) {
        const departmentAssignment = await this.prisma.hierarchyAssignment.findFirst({
          where: { scope: 'DEPARTMENT', departmentId: subject.departmentId, assigneeUserId: actor.id, role: { in: ['TEAM_LEAD', 'MANAGER'] }, ...this.activeAssignment(now) },
          select: { role: true },
        });
        if (departmentAssignment) {
          return { via: departmentAssignment.role === 'TEAM_LEAD' ? 'EMPLOYEE_TL' : 'REPORTING_MANAGER', role: actor.role?.name ?? 'UNKNOWN', scope: 'team' };
        }
        if (actor.role?.name === ROLES.MANAGER) {
          const managerAccess = await this.prisma.managerDeptAccess.findFirst({ where: { managerId: actor.id, departmentId: subject.departmentId }, select: { id: true } });
          if (managerAccess) return { via: 'REPORTING_MANAGER', role: ROLES.MANAGER, scope: 'team' };
        }
      }
      if (actor.employeeId && subject.teamLeadName === actor.employeeId) {
        return { via: 'EMPLOYEE_TL', role: actor.role?.name ?? 'UNKNOWN', scope: 'team' };
      }
      if (actor.employeeId && subject.reportingManager === actor.employeeId) {
        return { via: 'REPORTING_MANAGER', role: actor.role?.name ?? 'UNKNOWN', scope: 'team' };
      }
      if (actor.role?.name === ROLES.TEAM_LEAD && !subject.teamLeadName && subject.departmentId) {
        const leads = await this.prisma.user.findMany({
          where: { isActive: true, departmentId: subject.departmentId, role: { name: ROLES.TEAM_LEAD } },
          select: { id: true },
          take: 2,
        });
        if (leads.length === 1 && leads[0].id === actor.id) {
          return { via: 'EMPLOYEE_TL', role: ROLES.TEAM_LEAD, scope: 'team' };
        }
      }
      if (actor.role?.name === ROLES.MANAGER && subject.departmentId) {
        const managers = await this.prisma.user.findMany({
          where: { isActive: true, departmentId: subject.departmentId, role: { name: ROLES.MANAGER } },
          select: { id: true }, take: 2,
        });
        if (managers.length === 1 && managers[0].id === actor.id) {
          return { via: 'REPORTING_MANAGER', role: ROLES.MANAGER, scope: 'team' };
        }
      }
    }

    const company = this.companyVia(actor);
    if (company) return { via: company, role: company === 'HR' ? 'HR' : actor.role?.name ?? company, scope: 'company' };
    return null;
  }

  /** Everyone who could decide this subject's request (for notifications). */
  async eligibleReviewerIds(subjectUserId: string, now = new Date()): Promise<{ team: string[]; company: string[] }> {
    const subject = await this.prisma.user.findUnique({
      where: { id: subjectUserId },
      select: { teamLeadName: true, reportingManager: true, departmentId: true, role: { select: { level: true } } },
    });
    if (!subject) return { team: [], company: [] };
    const level = subject.role?.level ?? Number.MAX_SAFE_INTEGER;
    const team = new Set<string>();
    const assigned = await this.prisma.hierarchyAssignment.findMany({
      where: { scope: 'EMPLOYEE', subjectUserId, role: { in: ['TEAM_LEAD', 'MANAGER'] }, ...this.activeAssignment(now) },
      select: { assigneeUserId: true },
    });
    for (const a of assigned) team.add(a.assigneeUserId);
    if (subject.departmentId) {
      const departmentAssigned = await this.prisma.hierarchyAssignment.findMany({
        where: { scope: 'DEPARTMENT', departmentId: subject.departmentId, role: { in: ['TEAM_LEAD', 'MANAGER'] }, ...this.activeAssignment(now) },
        select: { assigneeUserId: true },
      });
      for (const a of departmentAssigned) team.add(a.assigneeUserId);
      const legacyManagers = await this.prisma.managerDeptAccess.findMany({ where: { departmentId: subject.departmentId }, select: { managerId: true } });
      for (const manager of legacyManagers) team.add(manager.managerId);
    }
    const codes = [subject.teamLeadName, subject.reportingManager].filter((c): c is string => !!c);
    if (codes.length) {
      const linked = await this.prisma.user.findMany({ where: { employeeId: { in: codes } }, select: { id: true } });
      for (const u of linked) team.add(u.id);
    }
    if (!subject.teamLeadName && subject.departmentId) {
      const leads = await this.prisma.user.findMany({
        where: { isActive: true, departmentId: subject.departmentId, role: { name: ROLES.TEAM_LEAD } },
        select: { id: true },
        take: 2,
      });
      if (leads.length === 1) team.add(leads[0].id);
    }
    if (subject.departmentId) {
      const managers = await this.prisma.user.findMany({
        where: { isActive: true, departmentId: subject.departmentId, role: { name: ROLES.MANAGER } },
        select: { id: true }, take: 2,
      });
      if (managers.length === 1) team.add(managers[0].id);
    }
    team.delete(subjectUserId);
    const teamActive = team.size
      ? (await this.prisma.user.findMany({
          where: { id: { in: [...team] }, isActive: true, role: { level: { lt: level } } },
          select: { id: true },
        })).map((u) => u.id)
      : [];
    const company = (await this.prisma.user.findMany({
      where: {
        isActive: true,
        isSystemAccount: false,
        id: { not: subjectUserId },
        OR: [{ isHR: true }, { role: { name: { in: [ROLES.ADMIN, ROLES.SUPER_ADMIN] } } }],
      },
      select: { id: true },
    })).map((u) => u.id);
    return { team: teamActive, company };
  }
}
