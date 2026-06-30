import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLES } from '../../shared/constants/roles';

export type ApproverTier = 'TEAM_LEAD' | 'MANAGER' | 'ADMIN';
export interface ApproverCandidate {
  id: string;
  name: string;
  tier: ApproverTier;
}

/**
 * Resolves who may approve a *self-assigned* ticket, and enforces that the
 * self-assigned worker can never approve/reject/rate their own work.
 *
 * The reporting chain mirrors ChangeRequestsService exactly (the existing,
 * production approval flow): the worker's Team Lead and Manager are looked up
 * from the free-text User.teamLeadName / User.reportingManager fields, which
 * hold an *employeeId*, resolved via User.employeeId — then escalated to
 * Admin/SuperAdmin. This service is intentionally tickets-only; it does not
 * touch or refactor ChangeRequestsService.
 *
 * Phase 1 scope: review/completion/rating control only. It does NOT implement
 * creation-time pending approval (no schema change).
 */
@Injectable()
export class HierarchyApprovalService {
  constructor(private prisma: PrismaService) {}

  /**
   * A ticket is "self-assigned" when its creator is also one of its workers —
   * the primary assignee OR any secondary assignee row. Per policy this holds
   * for every role (manager/admin self-assignment counts the same as an
   * employee's). Requires `assignees` to be loaded for the secondary-assignee
   * case; falls back to the primary assignee when it isn't.
   */
  isSelfAssigned(ticket: any): boolean {
    if (!ticket?.createdById) return false;
    if (ticket.assignedToId && ticket.assignedToId === ticket.createdById) return true;
    return Boolean(
      ticket.assignees?.some?.((a: any) => (a?.userId ?? a?.user?.id) === ticket.createdById),
    );
  }

  /** True when `actorId` is the self-assigned worker (the creator who is also an assignee). */
  isSelfWorker(actorId: string | undefined, ticket: any): boolean {
    return Boolean(actorId && ticket?.createdById === actorId && this.isSelfAssigned(ticket));
  }

  /**
   * Ordered list of users allowed to approve this worker's self-assigned work,
   * using the same cascade as ChangeRequestsService and escalating upward. The
   * worker themselves is always excluded. An empty array means no valid approver
   * exists (caller must fail clearly — there is no self-approval escape hatch).
   */
  async resolveApproverChainFor(workerId: string): Promise<ApproverCandidate[]> {
    const worker = await this.prisma.user.findUnique({
      where: { id: workerId },
      include: { role: true },
    });
    if (!worker) return [];

    const roleName = (worker.role as any)?.name ?? '';
    const chain: ApproverCandidate[] = [];
    const seen = new Set<string>([workerId]); // never include the worker

    const push = (u: any, tier: ApproverTier) => {
      if (u && u.isActive && !seen.has(u.id)) {
        seen.add(u.id);
        chain.push({ id: u.id, name: u.name, tier });
      }
    };
    const byEmployeeId = async (employeeId?: string | null) =>
      employeeId ? this.prisma.user.findFirst({ where: { employeeId } }) : null;
    const adminsAndSupers = async () =>
      this.prisma.user.findMany({
        where: { isActive: true, role: { name: { in: [ROLES.ADMIN, ROLES.SUPER_ADMIN] } } },
      });
    const supersOnly = async () =>
      this.prisma.user.findMany({ where: { isActive: true, role: { name: ROLES.SUPER_ADMIN } } });

    if (roleName === ROLES.EMPLOYEE || roleName === ROLES.INTERN) {
      push(await byEmployeeId(worker.teamLeadName), 'TEAM_LEAD');
      push(await byEmployeeId(worker.reportingManager), 'MANAGER');
      for (const a of await adminsAndSupers()) push(a, 'ADMIN');
    } else if (roleName === ROLES.TEAM_LEAD) {
      push(await byEmployeeId(worker.reportingManager), 'MANAGER');
      for (const a of await adminsAndSupers()) push(a, 'ADMIN');
    } else if (roleName === ROLES.MANAGER) {
      for (const a of await adminsAndSupers()) push(a, 'ADMIN');
    } else if (roleName === ROLES.ADMIN) {
      // An admin's self-assigned work is approved by a SuperAdmin, or another admin.
      for (const a of await adminsAndSupers()) push(a, 'ADMIN');
    } else if (roleName === ROLES.SUPER_ADMIN) {
      for (const a of await supersOnly()) push(a, 'ADMIN');
      for (const a of await adminsAndSupers()) push(a, 'ADMIN');
    }

    return chain;
  }

  /** The primary approver to notify/route to (top of the resolved chain), or null. */
  async resolvePrimaryApproverFor(workerId: string): Promise<ApproverCandidate | null> {
    const chain = await this.resolveApproverChainFor(workerId);
    return chain[0] ?? null;
  }

  /** True if `actorId` is anywhere in the worker's resolved approver chain. */
  async isApproverFor(actorId: string | undefined, workerId: string): Promise<boolean> {
    if (!actorId) return false;
    const chain = await this.resolveApproverChainFor(workerId);
    return chain.some((c) => c.id === actorId);
  }

  /**
   * Throws unless `actor` may approve/reject this self-assigned ticket. Only call
   * for self-assigned tickets. Enforces: the worker can never approve; only the
   * resolved reporting hierarchy may; clear failure when no approver exists.
   */
  async assertIsHierarchyApprover(actor: any, ticket: any): Promise<void> {
    const workerId = ticket.createdById; // self-assigned ⇒ creator is the worker
    if (actor?.id === workerId) {
      throw new ForbiddenException(
        'You cannot approve, reject, or complete your own self-assigned ticket. It must be reviewed by your reporting hierarchy.',
      );
    }
    const chain = await this.resolveApproverChainFor(workerId);
    if (chain.length === 0) {
      throw new BadRequestException(
        'No valid hierarchy approver could be found for this self-assigned ticket. Completion is blocked until another authorized approver is assigned.',
      );
    }
    if (!chain.some((c) => c.id === actor?.id)) {
      throw new ForbiddenException(
        "Only this ticket owner's reporting hierarchy can approve or send back their self-assigned work.",
      );
    }
  }

  /**
   * Resolves the active Team Lead who must approve TASK creation by an Employee/Intern.
   * Strictly TEAM_LEAD tier — never escalates to Manager/Admin/SuperAdmin, never the
   * creator themselves. Tries, in order:
   *   1. explicit hierarchy mapping (User.teamLeadName employeeId → active TL),
   *   2. structural team relation (a team the user belongs to whose lead is an active TL),
   *   3. department fallback (the sole active TEAM_LEAD in the user's department).
   * Returns the resolved TL, or null when none exists (caller fails clearly). Throws a
   * clear BadRequestException only for the genuinely ambiguous "multiple department TLs"
   * case, where a specific TL must be assigned to the user.
   */
  async resolveTaskCreationApprover(creatorId: string): Promise<ApproverCandidate | null> {
    // 1) Explicit mapping (User.teamLeadName → employeeId), via the existing chain.
    const chain = await this.resolveApproverChainFor(creatorId);
    const explicitTl = chain.find((c) => c.tier === 'TEAM_LEAD');
    if (explicitTl) return explicitTl;

    // Load the creator for the structural + department fallbacks.
    const creator = await this.prisma.user.findUnique({
      where: { id: creatorId },
      select: {
        departmentId: true,
        teamMemberships: { select: { team: { select: { teamLeadId: true } } } },
      },
    });
    if (!creator) return null;

    // 2) Structural team relation: the lead of a team the creator belongs to,
    //    if that lead is an active Team Lead and not the creator.
    const teamLeadIds = [
      ...new Set(
        (creator.teamMemberships ?? [])
          .map((m: any) => m?.team?.teamLeadId)
          .filter((id: any): id is string => !!id && id !== creatorId),
      ),
    ];
    for (const leadId of teamLeadIds) {
      const lead = await this.prisma.user.findFirst({
        where: { id: leadId, isActive: true, role: { name: ROLES.TEAM_LEAD } },
        select: { id: true, name: true },
      });
      if (lead) return { id: lead.id, name: lead.name, tier: 'TEAM_LEAD' };
    }

    // 3) Department fallback: active TEAM_LEAD(s) in the creator's department.
    if (!creator.departmentId) return null;
    const deptLeads = await this.prisma.user.findMany({
      where: {
        isActive: true,
        departmentId: creator.departmentId,
        role: { name: ROLES.TEAM_LEAD },
        id: { not: creatorId }, // never the creator themselves
      },
      select: { id: true, name: true },
    });
    if (deptLeads.length === 1) {
      return { id: deptLeads[0].id, name: deptLeads[0].name, tier: 'TEAM_LEAD' };
    }
    if (deptLeads.length > 1) {
      throw new BadRequestException(
        'Multiple active Team Leads were found. Please assign a specific Team Lead to this user.',
      );
    }
    return null; // none → caller raises the clear "no active Team Lead" error
  }
}
