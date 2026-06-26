/**
 * Unit tests — Self-assigned hierarchy approval (Phase 1, no schema change).
 *
 * Three layers:
 *  1) HierarchyApprovalService — reporting-chain resolution + self-worker guards.
 *  2) TicketAccessService.assertCanTransitionTicket — the universal status gate
 *     (covers approve/reject AND any direct PATCH /status API bypass).
 *  3) TicketsService.approve — ratings are suppressed (comment-only) for
 *     self-assigned tickets and never stored as self-ratings.
 */

import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { TicketStatus } from '@prisma/client';
import { HierarchyApprovalService } from '../../src/common/services/hierarchy-approval.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { TicketAccessService } from '../../src/common/services/ticket-access.service';
import { TicketsService } from '../../src/modules/operations/tickets/tickets.service';

// In-memory user directory. teamLeadName / reportingManager hold an *employeeId*
// (mirrors the real ChangeRequestsService chain), resolved via User.employeeId.
function directory() {
  return [
    { id: 'emp1', name: 'Emp One', employeeId: 'E1', teamLeadName: 'TL1', reportingManager: 'M1', isActive: true, departmentId: 'd1', role: { name: 'EMPLOYEE' } },
    { id: 'tl1', name: 'Lead One', employeeId: 'TL1', reportingManager: 'M1', isActive: true, departmentId: 'd1', role: { name: 'TEAM_LEAD' } },
    { id: 'tlX', name: 'Lead Other', employeeId: 'TLX', isActive: true, departmentId: 'd1', role: { name: 'TEAM_LEAD' } }, // same dept, NOT emp1's TL
    { id: 'mgr1', name: 'Mgr One', employeeId: 'M1', isActive: true, departmentId: 'd1', role: { name: 'MANAGER' } },
    { id: 'admin1', name: 'Admin One', employeeId: 'A1', isActive: true, role: { name: 'ADMIN' } },
    { id: 'super1', name: 'Super One', employeeId: 'S1', isActive: true, role: { name: 'SUPER_ADMIN' } },
  ];
}

function hierPrisma(users: any[]) {
  return {
    user: {
      findUnique: jest.fn(async ({ where }: any) => users.find((u) => u.id === where.id) ?? null),
      findFirst: jest.fn(async ({ where }: any) => users.find((u) => u.employeeId === where.employeeId) ?? null),
      findMany: jest.fn(async ({ where }: any) => {
        const names = where.role?.name?.in ?? (where.role?.name ? [where.role.name] : []);
        return users.filter((u) => u.isActive && names.includes(u.role.name));
      }),
    },
  } as any;
}

describe('HierarchyApprovalService — chain resolution', () => {
  const ids = (chain: any[]) => chain.map((c) => c.id);

  it('resolves EMPLOYEE → [TeamLead, Manager, Admin, SuperAdmin]', async () => {
    const svc = new HierarchyApprovalService(hierPrisma(directory()));
    expect(ids(await svc.resolveApproverChainFor('emp1'))).toEqual(['tl1', 'mgr1', 'admin1', 'super1']);
  });

  it('resolves TEAM_LEAD → [Manager, Admin, SuperAdmin]', async () => {
    const svc = new HierarchyApprovalService(hierPrisma(directory()));
    expect(ids(await svc.resolveApproverChainFor('tl1'))).toEqual(['mgr1', 'admin1', 'super1']);
  });

  it('resolves MANAGER → [Admin, SuperAdmin]', async () => {
    const svc = new HierarchyApprovalService(hierPrisma(directory()));
    expect(ids(await svc.resolveApproverChainFor('mgr1'))).toEqual(['admin1', 'super1']);
  });

  it('resolves ADMIN → other admins/superadmins (never self)', async () => {
    const svc = new HierarchyApprovalService(hierPrisma(directory()));
    const chain = ids(await svc.resolveApproverChainFor('admin1'));
    expect(chain).toContain('super1');
    expect(chain).not.toContain('admin1');
  });

  it('returns an empty chain when the only admin self-assigns (no escape hatch)', async () => {
    const onlyAdmin = [{ id: 'admin1', name: 'Solo', employeeId: 'A1', isActive: true, role: { name: 'ADMIN' } }];
    const svc = new HierarchyApprovalService(hierPrisma(onlyAdmin));
    expect(await svc.resolveApproverChainFor('admin1')).toEqual([]);
  });

  it('detects self-assignment by primary OR secondary assignee', () => {
    const svc = new HierarchyApprovalService(hierPrisma(directory()));
    expect(svc.isSelfAssigned({ createdById: 'emp1', assignedToId: 'emp1' })).toBe(true);
    expect(svc.isSelfAssigned({ createdById: 'emp1', assignedToId: 'x', assignees: [{ userId: 'emp1' }] })).toBe(true);
    expect(svc.isSelfAssigned({ createdById: 'emp1', assignedToId: 'x', assignees: [{ userId: 'y' }] })).toBe(false);
  });
});

describe('HierarchyApprovalService.assertIsHierarchyApprover', () => {
  const ticket = { createdById: 'emp1', assignedToId: 'emp1' };

  it('blocks the self-worker from approving their own ticket', async () => {
    const svc = new HierarchyApprovalService(hierPrisma(directory()));
    await expect(svc.assertIsHierarchyApprover({ id: 'emp1' }, ticket)).rejects.toThrow(ForbiddenException);
  });

  it('allows the resolved Team Lead', async () => {
    const svc = new HierarchyApprovalService(hierPrisma(directory()));
    await expect(svc.assertIsHierarchyApprover({ id: 'tl1' }, ticket)).resolves.toBeUndefined();
  });

  it('blocks a same-department reviewer who is NOT in this worker’s chain', async () => {
    const svc = new HierarchyApprovalService(hierPrisma(directory()));
    await expect(svc.assertIsHierarchyApprover({ id: 'tlX' }, ticket)).rejects.toThrow(ForbiddenException);
  });

  it('fails clearly (BadRequest) when a non-worker tries but no approver can be resolved', async () => {
    // emp1 has no TL/manager and there are no admins → empty chain. A different user (emp2)
    // attempting the approval must hit the clear "no valid approver" failure.
    const noApprovers = [
      { id: 'emp1', name: 'Worker', employeeId: 'E1', isActive: true, role: { name: 'EMPLOYEE' } },
      { id: 'emp2', name: 'Peer', employeeId: 'E2', isActive: true, role: { name: 'EMPLOYEE' } },
    ];
    const svc = new HierarchyApprovalService(hierPrisma(noApprovers));
    await expect(svc.assertIsHierarchyApprover({ id: 'emp2' }, { createdById: 'emp1', assignedToId: 'emp1' }))
      .rejects.toThrow(/No valid hierarchy approver/);
  });
});

describe('TicketAccessService.assertCanTransitionTicket — self-assigned gate (API-bypass proof)', () => {
  function makeAccess(users = directory()) {
    const prisma: any = {
      ...hierPrisma(users),
      ticket: { findFirst: jest.fn(async () => ({ id: 't1' })), count: jest.fn(async () => 1) },
      managerDeptAccess: { findMany: jest.fn(async () => []) },
    };
    const policy = new AccessPolicyService(prisma);
    const hierarchy = new HierarchyApprovalService(prisma);
    return new TicketAccessService(prisma, policy, hierarchy);
  }
  const selfTicket = (over: any = {}) => ({ id: 't1', status: TicketStatus.REVIEW, createdById: 'emp1', assignedToId: 'emp1', departmentId: 'd1', assignees: [], ...over });
  const emp = { id: 'emp1', role: { name: 'EMPLOYEE' }, departmentId: 'd1' };
  const tl = { id: 'tl1', role: { name: 'TEAM_LEAD' }, departmentId: 'd1' };
  const tlX = { id: 'tlX', role: { name: 'TEAM_LEAD' }, departmentId: 'd1' };

  it('blocks self-worker REVIEW→DONE (covers PATCH /status bypass)', async () => {
    await expect(makeAccess().assertCanTransitionTicket(emp, selfTicket(), TicketStatus.DONE)).rejects.toThrow(ForbiddenException);
  });

  it('blocks self-worker REVIEW→IN_PROGRESS (worker cannot send back own)', async () => {
    await expect(makeAccess().assertCanTransitionTicket(emp, selfTicket(), TicketStatus.IN_PROGRESS)).rejects.toThrow(ForbiddenException);
  });

  it('allows self-worker OPEN→IN_PROGRESS (work progress)', async () => {
    await expect(makeAccess().assertCanTransitionTicket(emp, selfTicket({ status: TicketStatus.OPEN }), TicketStatus.IN_PROGRESS)).resolves.toBeUndefined();
  });

  it('allows self-worker IN_PROGRESS→REVIEW (submit)', async () => {
    await expect(makeAccess().assertCanTransitionTicket(emp, selfTicket({ status: TicketStatus.IN_PROGRESS }), TicketStatus.REVIEW)).resolves.toBeUndefined();
  });

  it('allows the resolved Team Lead to approve REVIEW→DONE', async () => {
    await expect(makeAccess().assertCanTransitionTicket(tl, selfTicket(), TicketStatus.DONE)).resolves.toBeUndefined();
  });

  it('blocks an in-scope-but-not-in-chain reviewer (random reviewer cannot approve)', async () => {
    await expect(makeAccess().assertCanTransitionTicket(tlX, selfTicket(), TicketStatus.DONE)).rejects.toThrow(ForbiddenException);
  });

  it('blocks a MANAGER from approving their OWN self-assigned ticket (no role exception)', async () => {
    const mgrTicket = selfTicket({ createdById: 'mgr1', assignedToId: 'mgr1' });
    const mgr = { id: 'mgr1', role: { name: 'MANAGER' }, departmentId: 'd1' };
    await expect(makeAccess().assertCanTransitionTicket(mgr, mgrTicket, TicketStatus.DONE)).rejects.toThrow(ForbiddenException);
  });

  it('leaves NON-self tickets on the existing scoped-reviewer path (unchanged)', async () => {
    const nonSelf = selfTicket({ createdById: 'mgr1', assignedToId: 'emp1' }); // creator !== assignee
    await expect(makeAccess().assertCanTransitionTicket(tl, nonSelf, TicketStatus.DONE)).resolves.toBeUndefined();
  });
});

describe('TicketsService.approve — rating suppression for self-assigned', () => {
  function makeService(selfAssigned: boolean) {
    let captured: any = null;
    const prisma: any = {
      comment: { create: jest.fn().mockResolvedValue({}) },
      user: { findUnique: jest.fn().mockResolvedValue({ currentStatus: 'ACTIVE' }) },
    };
    const ticket = { id: 't1', ticketId: 'TKT-001', status: TicketStatus.REVIEW, createdById: 'emp1', assignedToId: 'emp1', assignees: [] };
    const ticketAccess = {
      findAccessibleTicket: jest.fn().mockResolvedValue(ticket),
      assertCanTransitionTicket: jest.fn().mockResolvedValue(undefined),
      isSelfAssigned: jest.fn().mockReturnValue(selfAssigned),
    };
    const ticketLedger = {
      endReviewCycle: jest.fn(async (args: any) => { captured = args; return { id: 'cycle-1', decision: args.decision }; }),
      startReviewCycle: jest.fn().mockResolvedValue({ id: 'cycle-1' }),
    };
    const service = new TicketsService(
      prisma,
      { emitTicketStatusChanged: jest.fn(), emitTicketCreated: jest.fn() } as any,
      { sendNotification: jest.fn().mockResolvedValue(null) } as any,
      { get: jest.fn() } as any,
      { emit: jest.fn() } as any,
      { log: jest.fn().mockReturnValue({ catch: jest.fn() }) } as any,
      ticketAccess as any,
      { decorateTicket: jest.fn((t: any) => Promise.resolve(t)) } as any,
      ticketLedger as any,
      {} as any,
    );
    // Don't run the real status-update machinery — approve() only needs it to resolve.
    jest.spyOn(service as any, 'update').mockResolvedValue({ id: 't1', status: TicketStatus.DONE });
    return { service, getCaptured: () => captured };
  }

  const ratings = { taskEfficiencyRating: 5, employeePerformanceRating: 4, employeeAttitudeRating: 3, ratingComment: 'good' };

  it('stores NO star ratings for a self-assigned ticket (comment kept)', async () => {
    const { service, getCaptured } = makeService(true);
    await service.approve('t1', 'tl1', { id: 'tl1', role: { name: 'TEAM_LEAD' } }, ratings);
    const c = getCaptured();
    expect(c.decision).toBe('APPROVED');
    expect(c.taskEfficiencyRating).toBeNull();
    expect(c.employeePerformanceRating).toBeNull();
    expect(c.employeeAttitudeRating).toBeNull();
    expect(c.ratingComment).toBe('good'); // comment-only approval is preserved
  });

  it('stores full ratings for a NON-self ticket reviewed by hierarchy', async () => {
    const { service, getCaptured } = makeService(false);
    await service.approve('t1', 'tl1', { id: 'tl1', role: { name: 'TEAM_LEAD' } }, ratings);
    const c = getCaptured();
    expect(c.taskEfficiencyRating).toBe(5);
    expect(c.employeePerformanceRating).toBe(4);
    expect(c.employeeAttitudeRating).toBe(3);
  });
});
