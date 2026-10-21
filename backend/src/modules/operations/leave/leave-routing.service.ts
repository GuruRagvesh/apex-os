import { Injectable, Logger, Optional } from '@nestjs/common';
import { LeaveStatus, NotificationType, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { ROLES } from '../../../shared/constants/roles';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';
import { NotificationEventService } from '../notifications/notification-event.service';

/**
 * Leave approval routing (Phase 3).
 *
 * Every new request gets an immutable RoutingSnapshot naming exactly ONE
 * active approver. Normal order:
 *
 *   1. EMPLOYEE_TL     the employee's explicitly assigned primary Team Lead
 *   2. DEPT_TL         the department's primary Team Lead
 *   3. DEPT_MANAGER    the department's primary Manager
 *
 * Fallback, only when none of those is active:
 *
 *   4. COMPANY_MANAGER the configured company fallback Manager (Settings)
 *   5. HR              HR acts ONLY here
 *   6. ADMIN           Admin, then Super Admin
 *
 * Other TLs/Managers, HR, Admin and Accountant-capable users may view; only the
 * snapshot's approver acts. A reroute APPENDS a snapshot that supersedes the
 * previous one -- snapshots are never edited or deleted (database trigger).
 *
 * Department transfer handling stays in Phase 4; this resolves who approves
 * today, from today's hierarchy.
 */

export type LeaveRoutingTier = 'EMPLOYEE_TL' | 'DEPT_TL' | 'DEPT_MANAGER' | 'COMPANY_MANAGER' | 'HR' | 'ADMIN';

export interface LeaveRoute {
  approverId: string | null;
  approverName: string | null;
  tier: LeaveRoutingTier;
  fallbackReason: string | null;
}

const FALLBACK_TIERS: readonly LeaveRoutingTier[] = ['COMPANY_MANAGER', 'HR', 'ADMIN'];

type Candidate = { id: string; name: string; isActive: boolean; role?: { name: string; level: number } | null; isHR?: boolean };

@Injectable()
export class LeaveRoutingService {
  private readonly logger = new Logger(LeaveRoutingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly eventLogger?: EventLoggerService,
    @Optional() private readonly notifications?: NotificationEventService,
  ) {}

  private activeAssignmentWhere(now: Date) {
    return {
      isPrimary: true,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    };
  }

  /**
   * Who approves this employee's leave right now, and why.
   *
   * Pure resolution: nothing is written. Self and inactive users are skipped at
   * every tier, and at the TL/Manager tiers a candidate who does not outrank
   * the employee (role level) is skipped too, so a Team Lead's leave goes to a
   * Manager rather than a peer.
   */
  async resolve(subjectUserId: string, client: any = this.prisma, now = new Date()): Promise<LeaveRoute> {
    const subject = await client.user.findUnique({
      where: { id: subjectUserId },
      select: { id: true, departmentId: true, teamLeadName: true, role: { select: { name: true, level: true } } },
    });
    const subjectLevel = subject?.role?.level ?? Number.MAX_SAFE_INTEGER;
    const skipped: string[] = [];

    const usable = (u: Candidate | null | undefined, needsSeniority: boolean): u is Candidate =>
      !!u && u.isActive && u.id !== subjectUserId && (!needsSeniority || (u.role?.level ?? Number.MAX_SAFE_INTEGER) < subjectLevel);
    const userSelect = { id: true, name: true, isActive: true, isHR: true, role: { select: { name: true, level: true } } };
    const route = (u: Candidate, tier: LeaveRoutingTier): LeaveRoute => ({
      approverId: u.id,
      approverName: u.name,
      tier,
      fallbackReason: FALLBACK_TIERS.includes(tier) || skipped.length > 0 ? this.reason(tier, skipped) : null,
    });

    // 1. Explicit employee Team Lead: a primary assignment, else the legacy
    //    teamLeadName employee-ID link (also an explicit, per-employee choice).
    const empTl = await client.hierarchyAssignment.findFirst({
      where: { scope: 'EMPLOYEE', role: 'TEAM_LEAD', subjectUserId, ...this.activeAssignmentWhere(now) },
      orderBy: { effectiveFrom: 'desc' },
      include: { assigneeUser: { select: userSelect } },
    });
    let tl: Candidate | null = empTl?.assigneeUser ?? null;
    if (!tl && subject?.teamLeadName) {
      tl = await client.user.findFirst({ where: { employeeId: subject.teamLeadName }, select: userSelect });
    }
    if (usable(tl, true)) return route(tl, 'EMPLOYEE_TL');
    if (tl) skipped.push('EMPLOYEE_TL_UNAVAILABLE');

    if (subject?.departmentId) {
      // 2. Department primary Team Lead, else the department's only active TL.
      const deptTl = await this.departmentLead(client, subject.departmentId, 'TEAM_LEAD', userSelect, now);
      if (usable(deptTl, true)) return route(deptTl, 'DEPT_TL');
      // 3. Department primary Manager, else its only manager.
      const deptMgr = await this.departmentLead(client, subject.departmentId, 'MANAGER', userSelect, now);
      if (usable(deptMgr, true)) return route(deptMgr, 'DEPT_MANAGER');
    } else {
      skipped.push('NO_DEPARTMENT');
    }

    // 4. Configured company fallback Manager.
    const company = await client.hierarchyAssignment.findFirst({
      where: { scope: 'COMPANY', role: 'MANAGER', ...this.activeAssignmentWhere(now) },
      orderBy: { effectiveFrom: 'desc' },
      include: { assigneeUser: { select: userSelect } },
    });
    if (usable(company?.assigneeUser, false)) return route(company.assigneeUser, 'COMPANY_MANAGER');
    skipped.push(company ? 'COMPANY_MANAGER_INACTIVE' : 'COMPANY_MANAGER_NOT_CONFIGURED');

    // 5. HR, deterministically the earliest-created active HR user. Only the
    //    subject is excluded, so a Super Admin's leave can reach HR too.
    {
      const hr = await client.user.findFirst({
        where: { isActive: true, isHR: true, isSystemAccount: false, id: { not: subjectUserId } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: userSelect,
      });
      if (usable(hr, false)) return route(hr, 'HR');
    }
    skipped.push('NO_ACTIVE_HR');

    // 6. Admin, then Super Admin.
    for (const roleName of [ROLES.ADMIN, ROLES.SUPER_ADMIN]) {
      const admin = await client.user.findFirst({
        where: { isActive: true, isSystemAccount: false, id: { not: subjectUserId }, role: { name: roleName } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: userSelect,
      });
      if (usable(admin, false)) return route(admin, 'ADMIN');
    }

    return { approverId: null, approverName: null, tier: 'ADMIN', fallbackReason: this.reason('ADMIN', [...skipped, 'NO_ACTIVE_ADMIN']) };
  }

  /** The department's primary assignment for a role, else its only active holder. */
  private async departmentLead(client: any, departmentId: string, role: 'TEAM_LEAD' | 'MANAGER', select: any, now: Date) {
    const assigned = await client.hierarchyAssignment.findFirst({
      where: { scope: 'DEPARTMENT', role, departmentId, ...this.activeAssignmentWhere(now) },
      orderBy: { effectiveFrom: 'desc' },
      include: { assigneeUser: { select } },
    });
    if (assigned?.assigneeUser?.isActive) return assigned.assigneeUser;

    if (role === 'TEAM_LEAD') {
      const leads = await client.user.findMany({
        where: { isActive: true, departmentId, role: { name: ROLES.TEAM_LEAD } },
        select,
        take: 2,
      });
      return leads.length === 1 ? leads[0] : null;
    }
    const managers = await client.managerDeptAccess.findMany({
      where: { departmentId, manager: { isActive: true, role: { name: ROLES.MANAGER } } },
      include: { manager: { select } },
      take: 2,
    });
    if (managers.length === 1) return managers[0].manager;
    const inDept = await client.user.findMany({
      where: { isActive: true, departmentId, role: { name: ROLES.MANAGER } },
      select,
      take: 2,
    });
    return inDept.length === 1 ? inDept[0] : null;
  }

  private reason(tier: LeaveRoutingTier, skipped: string[]): string {
    const why: Record<string, string> = {
      EMPLOYEE_TL_UNAVAILABLE: "the employee's assigned Team Lead is inactive or cannot approve them",
      NO_DEPARTMENT: 'the employee has no department',
      COMPANY_MANAGER_INACTIVE: 'the company fallback Manager is inactive',
      COMPANY_MANAGER_NOT_CONFIGURED: 'no company fallback Manager is configured',
      NO_ACTIVE_HR: 'no active HR user is available',
      NO_ACTIVE_ADMIN: 'no active Admin or Super Admin is available',
    };
    const parts = skipped.map((s) => why[s]).filter(Boolean);
    const lead =
      tier === 'COMPANY_MANAGER' || tier === 'HR' || tier === 'ADMIN'
        ? 'No active Team Lead or Manager could approve this request'
        : 'Routed past the first choice';
    return parts.length > 0 ? `${lead}: ${parts.join('; ')}.` : `${lead}.`;
  }

  /**
   * Writes the first snapshot for a new request and links it. Inside the
   * caller's transaction, so a request never exists without its route.
   */
  async snapshotFor(tx: Prisma.TransactionClient, leave: { id: string; userId: string }, actorId: string, departmentId: string | null) {
    const route = await this.resolve(leave.userId, tx);
    const snapshot = await (tx as any).routingSnapshot.create({
      data: {
        id: randomUUID(),
        workflow: 'LEAVE',
        entityType: 'LeaveRequest',
        entityId: leave.id,
        subjectUserId: leave.userId,
        originalDepartmentId: departmentId,
        resolvedApproverId: route.approverId,
        tier: route.tier,
        fallbackReason: route.fallbackReason,
        createdById: actorId,
      },
    });
    await tx.leaveRequest.update({ where: { id: leave.id }, data: { routingSnapshotId: snapshot.id } });
    return { snapshot, route };
  }

  /** The latest snapshot for a request (the one in force). */
  async current(leaveId: string, client: any = this.prisma) {
    return client.routingSnapshot.findFirst({
      where: { entityType: 'LeaveRequest', entityId: leaveId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  /**
   * Re-resolves a PENDING request whose approver is no longer available and
   * appends a superseding snapshot. Approved/rejected/cancelled requests are
   * never touched. Returns true when a reroute happened.
   */
  async rerouteIfUnavailable(leaveId: string, actorId = 'system'): Promise<boolean> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "leave_requests" WHERE id = ${leaveId} FOR UPDATE`;
      const leave = await tx.leaveRequest.findUnique({
        where: { id: leaveId },
        select: { id: true, userId: true, status: true, routingSnapshotId: true, user: { select: { departmentId: true, name: true } } },
      });
      if (!leave || leave.status !== LeaveStatus.PENDING || !leave.routingSnapshotId) return null;
      const current = await (tx as any).routingSnapshot.findUnique({ where: { id: leave.routingSnapshotId } });
      const approver = current?.resolvedApproverId
        ? await tx.user.findUnique({ where: { id: current.resolvedApproverId }, select: { isActive: true } })
        : null;
      if (approver?.isActive) return null;

      const route = await this.resolve(leave.userId, tx);
      if (route.approverId && route.approverId === current?.resolvedApproverId) return null;
      const next = await (tx as any).routingSnapshot.create({
        data: {
          id: randomUUID(),
          workflow: 'LEAVE',
          entityType: 'LeaveRequest',
          entityId: leave.id,
          subjectUserId: leave.userId,
          originalDepartmentId: current?.originalDepartmentId ?? leave.user?.departmentId ?? null,
          resolvedApproverId: route.approverId,
          tier: route.tier,
          fallbackReason: route.fallbackReason ?? 'The previous approver is no longer available.',
          supersedesId: current?.id ?? null,
          createdById: actorId === 'system' ? null : actorId,
        },
      });
      await tx.leaveRequest.update({ where: { id: leave.id }, data: { routingSnapshotId: next.id } });
      return { leave, previous: current?.resolvedApproverId ?? null, route };
    });
    if (!outcome) return false;

    this.eventLogger?.log({
      actorId,
      entityType: 'LeaveRequest',
      entityId: leaveId,
      action: OperationalAction.LEAVE_REROUTED,
      metadata: { tier: outcome.route.tier, fallback: !!outcome.route.fallbackReason },
    }).catch(() => {});
    await this.notifyReroute(leaveId, outcome.leave.user?.name ?? 'An employee', outcome.previous, outcome.route);
    return true;
  }

  /** New approver, old approver (if any) and Admins hear about a reroute, through their preferences. */
  private async notifyReroute(leaveId: string, employeeName: string, previousId: string | null, route: LeaveRoute) {
    if (!this.notifications) return;
    const send = (userId: string, title: string, message: string) =>
      this.notifications!.sendNotification(userId, 'teamLeaveApply', {
        title, message, type: NotificationType.INFO, link: '/leave', entityId: leaveId, entityType: 'LEAVE',
      }).catch(() => undefined);
    if (route.approverId) {
      await send(route.approverId, `Leave request routed to you: ${employeeName}`, route.fallbackReason ?? 'The previous approver is no longer available.');
    }
    if (previousId) {
      await send(previousId, 'Leave request rerouted', `${employeeName}'s leave request now goes to another approver.`);
    }
    const admins = await this.prisma.user.findMany({
      where: { isActive: true, isSystemAccount: false, role: { name: { in: [ROLES.ADMIN, ROLES.SUPER_ADMIN] } } },
      select: { id: true },
    });
    for (const a of admins) {
      if (a.id === route.approverId) continue;
      await send(a.id, 'Leave request rerouted', `${employeeName}'s leave request was rerouted. ${route.fallbackReason ?? ''}`.trim());
    }
  }

  /** Every pending, routed request whose approver is inactive. Idempotent. */
  async sweep(): Promise<number> {
    const stale = await this.prisma.leaveRequest.findMany({
      where: { status: LeaveStatus.PENDING, routingSnapshotId: { not: null } },
      select: { id: true, routingSnapshotId: true },
    });
    let rerouted = 0;
    for (const row of stale) {
      try {
        if (await this.rerouteIfUnavailable(row.id)) rerouted += 1;
      } catch (error: any) {
        this.logger.warn(`Leave reroute failed for ${row.id}: ${error?.message ?? error}`);
      }
    }
    return rerouted;
  }

  /** Pending requests currently routed to this user (called when they leave). */
  async rerouteForApprover(approverId: string, actorId = 'system'): Promise<number> {
    const routed = await this.prisma.leaveRequest.findMany({
      where: { status: LeaveStatus.PENDING, routingSnapshot: { resolvedApproverId: approverId } },
      select: { id: true },
    });
    let n = 0;
    for (const r of routed) if (await this.rerouteIfUnavailable(r.id, actorId)) n += 1;
    return n;
  }
}
