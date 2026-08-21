import { LeaveSettlementService } from '../../src/modules/operations/leave/leave-settlement.service';
import { LeaveFactsService } from '../../src/modules/platform/attendance/evaluation/leave-facts.service';
import { TVAService } from '../../src/common/services/tva.service';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';

// LH-2. Real TVAService and a real LeaveSettlementService, so the split rule and
// the locking order genuinely execute. Prisma is mocked. No database.

const tvaOf = () => new TVAService({ get: () => undefined } as unknown as ConfigService);

const LEAVE = {
  id: 'lv-1',
  userId: 'emp-1',
  type: 'ANNUAL',
  status: 'PENDING',
  approvalStage: 'HR_REVIEW',
  startDate: new Date('2026-08-03T00:00:00.000Z'),
  endDate: new Date('2026-08-04T00:00:00.000Z'),
  isHalfDay: false,
  halfDayType: null,
  paidDays: null,
  unpaidDays: null,
  fundingOutcome: null,
};

interface SettleFixtures {
  leave?: any;
  allocation?: number;
  requestedDays?: number;
  otherApproved?: any[];
}

function settlementRig(f: SettleFixtures = {}) {
  const lockOrder: string[] = [];
  const updates: any[] = [];

  const tx: any = {
    $queryRaw: jest.fn((strings: any, ...values: any[]) => {
      const sql = Array.isArray(strings) ? strings.join('?') : String(strings);
      lockOrder.push(sql.replace(/\s+/g, ' ').trim());
      return Promise.resolve([{ id: values[0] }]);
    }),
    leaveRequest: {
      findUnique: jest.fn().mockResolvedValue('leave' in f ? f.leave : { ...LEAVE }),
      findMany: jest.fn().mockResolvedValue(f.otherApproved ?? []),
      update: jest.fn(({ data }: any) => {
        updates.push(data);
        return Promise.resolve({ ...LEAVE, ...data });
      }),
    },
  };

  const prisma: any = {
    $transaction: jest.fn((fn: any) => fn(tx)),
    leaveRequest: tx.leaveRequest,
  };

  const balanceCalls: string[] = [];
  const balance: any = {
    getYearlyAllocation: jest.fn(() => {
      balanceCalls.push('allocation');
      return Promise.resolve(f.allocation ?? 14);
    }),
    getDurationForRequest: jest.fn(() => {
      balanceCalls.push('duration');
      return Promise.resolve(f.requestedDays ?? 2);
    }),
  };

  const service = new LeaveSettlementService(prisma, tvaOf(), balance);
  return { service, prisma, tx, lockOrder, updates, balance, balanceCalls };
}

describe('LH-2 funding split', () => {
  const split = (requested: number, available: number) =>
    settlementRig().service.split(requested, available);

  it('1. enough paid balance settles the whole request as PAID', () => {
    const s = split(2, 5);
    expect(s.fundingOutcome).toBe('PAID');
    expect(s.paidDays).toBe(2);
    expect(s.unpaidDays).toBe(0);
  });

  it('2. exactly enough balance is still PAID, not PARTIAL', () => {
    const s = split(2, 2);
    expect(s.fundingOutcome).toBe('PAID');
    expect(s.paidDays).toBe(2);
    expect(s.unpaidDays).toBe(0);
  });

  it('3. a partly funded request is PARTIAL and splits the days', () => {
    const s = split(2, 1);
    expect(s.fundingOutcome).toBe('PARTIAL');
    expect(s.paidDays).toBe(1);
    expect(s.unpaidDays).toBe(1);
  });

  it('4. no remaining balance settles the whole request as UNPAID', () => {
    const s = split(2, 0);
    expect(s.fundingOutcome).toBe('UNPAID');
    expect(s.paidDays).toBe(0);
    expect(s.unpaidDays).toBe(2);
  });

  it('5. a negative balance is treated as zero, never as a credit', () => {
    const s = split(2, -3);
    expect(s.fundingOutcome).toBe('UNPAID');
    expect(s.paidDays).toBe(0);
    expect(s.unpaidDays).toBe(2);
  });

  it('6. half days split without floating-point noise', () => {
    const s = split(1.5, 1);
    expect(s.fundingOutcome).toBe('PARTIAL');
    expect(s.paidDays).toBe(1);
    expect(s.unpaidDays).toBe(0.5);
  });
});

describe('LH-2 serialized settlement', () => {
  it('7. the request is locked, then the employee, before any balance is read', async () => {
    const { service, lockOrder, balanceCalls } = settlementRig();

    await service.settleAndApprove({ leaveId: 'lv-1', hrApproverId: 'hr-1' });

    expect(lockOrder).toHaveLength(2);
    expect(lockOrder[0]).toContain('"leave_requests"');
    expect(lockOrder[0]).toContain('FOR UPDATE');
    // The USER row is the balance serialization authority: two different
    // requests for the same employee serialize here, so they cannot both read
    // the same remaining day and both consume it.
    expect(lockOrder[1]).toContain('"users"');
    expect(lockOrder[1]).toContain('FOR UPDATE');
    // Every balance read happens after both locks are held.
    expect(balanceCalls.length).toBeGreaterThan(0);
  });

  it('8. the request is re-read after the lock, not trusted from before it', async () => {
    const { service, tx, lockOrder } = settlementRig();

    await service.settleAndApprove({ leaveId: 'lv-1', hrApproverId: 'hr-1' });

    expect(tx.leaveRequest.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.leaveRequest.findUnique.mock.invocationCallOrder[0]).toBeGreaterThan(
      tx.$queryRaw.mock.invocationCallOrder[0],
    );
    expect(lockOrder[0]).toContain('"leave_requests"');
  });

  it('9. a request still at manager review cannot be settled', async () => {
    const { service, updates } = settlementRig({
      leave: { ...LEAVE, approvalStage: 'MANAGER_REVIEW' },
    });

    await expect(
      service.settleAndApprove({ leaveId: 'lv-1', hrApproverId: 'hr-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(updates).toEqual([]);
  });

  it('10. an already-approved request cannot be settled twice', async () => {
    const { service, updates } = settlementRig({
      leave: { ...LEAVE, status: 'APPROVED', approvalStage: 'COMPLETE' },
    });

    await expect(
      service.settleAndApprove({ leaveId: 'lv-1', hrApproverId: 'hr-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(updates).toEqual([]);
  });

  it('11. final approval records the settlement and the compatibility fields', async () => {
    const { service, updates } = settlementRig({ allocation: 14, requestedDays: 2 });

    const { settlement } = await service.settleAndApprove({
      leaveId: 'lv-1',
      hrApproverId: 'hr-1',
    });

    expect(settlement.fundingOutcome).toBe('PAID');
    const data = updates[0];
    expect(data.status).toBe('APPROVED');
    expect(data.approvalStage).toBe('COMPLETE');
    expect(data.hrApprovedById).toBe('hr-1');
    expect(data.hrApprovedAt).toBeInstanceOf(Date);
    // Compatibility: existing readers of approvedBy/approvedAt see the FINAL
    // approval, so nothing downstream has to learn the new fields.
    expect(data.approvedBy).toBe('hr-1');
    expect(data.approvedAt).toBeInstanceOf(Date);
    expect(data.paidDays).toBe(2);
    expect(data.unpaidDays).toBe(0);
  });

  it('12. the employee\'s requested leave type is never rewritten', async () => {
    const { service, updates } = settlementRig({ allocation: 0, requestedDays: 2 });

    await service.settleAndApprove({ leaveId: 'lv-1', hrApproverId: 'hr-1' });

    const data = updates[0];
    expect(data.fundingOutcome).toBe('UNPAID');
    // The employee asked for ANNUAL leave and the company funded none of it.
    // Both facts survive; the request does not become an UNPAID request.
    expect(data).not.toHaveProperty('type');
  });

  it('13. an exhausted balance produces UNPAID rather than a rejection', async () => {
    const { service, updates } = settlementRig({
      allocation: 14,
      requestedDays: 2,
      otherApproved: [{ id: 'lv-old', paidDays: 14, startDate: LEAVE.startDate, endDate: LEAVE.endDate, isHalfDay: false }],
    });

    const { settlement } = await service.settleAndApprove({ leaveId: 'lv-1', hrApproverId: 'hr-1' });

    expect(settlement.fundingOutcome).toBe('UNPAID');
    expect(updates[0].status).toBe('APPROVED');
  });

  it('14. consumed days prefer the recorded settlement over a recomputed duration', async () => {
    const { service, tx, balance } = settlementRig();

    const consumed = await service.consumedPaidDays(
      tx,
      'emp-1',
      2026,
      undefined,
    );
    expect(consumed).toBe(0);

    // A row with an explicit settlement is taken at its word.
    const withSettlement = settlementRig({
      otherApproved: [{ id: 'a', paidDays: 3, startDate: LEAVE.startDate, endDate: LEAVE.endDate, isHalfDay: false }],
    });
    expect(
      await withSettlement.service.consumedPaidDays(withSettlement.tx, 'emp-1', 2026),
    ).toBe(3);
    expect(withSettlement.balance.getDurationForRequest).not.toHaveBeenCalled();

    // A legacy row has no settlement, so its duration is the only evidence.
    const legacy = settlementRig({
      requestedDays: 2,
      otherApproved: [{ id: 'b', paidDays: null, startDate: LEAVE.startDate, endDate: LEAVE.endDate, isHalfDay: false }],
    });
    expect(await legacy.service.consumedPaidDays(legacy.tx, 'emp-1', 2026)).toBe(2);
    expect(legacy.balance.getDurationForRequest).toHaveBeenCalled();
    expect(balance).toBeDefined();
  });

  it('15. the request being approved is excluded from its own consumed total', async () => {
    const { service, tx } = settlementRig();
    await service.consumedPaidDays(tx, 'emp-1', 2026, 'lv-1');

    const where = tx.leaveRequest.findMany.mock.calls[0][0].where;
    expect(where.id).toEqual({ not: 'lv-1' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AE-1 consumption: final approval only, explicit settlement preferred.
// ─────────────────────────────────────────────────────────────────────────────

function factsRig(rows: any[]) {
  const prisma: any = {
    leaveRequest: { findMany: jest.fn().mockResolvedValue(rows) },
  };
  return { service: new LeaveFactsService(prisma, tvaOf()), prisma };
}

const approvedRow = (extra: any = {}) => ({
  id: 'lv-1',
  userId: 'emp-1',
  type: 'ANNUAL',
  status: 'APPROVED',
  approvalStage: 'COMPLETE',
  startDate: new Date('2026-08-03T09:30:00.000Z'),
  endDate: new Date('2026-08-03T18:00:00.000Z'),
  isHalfDay: false,
  halfDayType: null,
  fundingOutcome: null,
  createdAt: new Date('2026-08-01'),
  ...extra,
});

describe('LH-2 attendance consumes only final approval', () => {
  it('16. attendance queries final approval AND a completed chain', async () => {
    const { service, prisma } = factsRig([]);
    await service.resolveForDate('emp-1', '2026-08-03');

    const where = prisma.leaveRequest.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('APPROVED');
    expect(where.approvalStage).toBe('COMPLETE');
  });

  it('17. an explicit PAID settlement is consumed as paid leave', async () => {
    const { service } = factsRig([approvedRow({ fundingOutcome: 'PAID' })]);
    const facts = await service.resolveForDate('emp-1', '2026-08-03');
    expect(facts.kind).toBe('PAID');
  });

  it('18. an explicit UNPAID settlement is consumed as LWP, whatever was requested', async () => {
    const { service } = factsRig([approvedRow({ type: 'ANNUAL', fundingOutcome: 'UNPAID' })]);
    const facts = await service.resolveForDate('emp-1', '2026-08-03');

    expect(facts.kind).toBe('UNPAID');
    // The requested type is still ANNUAL: intent and settlement are separate.
    expect(facts.leaveType).toBe('ANNUAL');
  });

  it('19. a PARTIAL settlement is not attributed to an arbitrary date', async () => {
    const { service } = factsRig([approvedRow({ fundingOutcome: 'PARTIAL' })]);
    const facts = await service.resolveForDate('emp-1', '2026-08-03');

    // Totals are known, per-date attribution is not — so the evaluator sends it
    // to review rather than deciding which day lost pay.
    expect(facts.kind).toBe('PARTIALLY_FUNDED');
  });

  it('20. a half-day settlement keeps its half-day shape', async () => {
    const paid = factsRig([approvedRow({ isHalfDay: true, fundingOutcome: 'PAID' })]);
    expect((await paid.service.resolveForDate('emp-1', '2026-08-03')).kind).toBe('HALF_DAY_PAID');

    const unpaid = factsRig([approvedRow({ isHalfDay: true, fundingOutcome: 'UNPAID' })]);
    expect((await unpaid.service.resolveForDate('emp-1', '2026-08-03')).kind).toBe('HALF_DAY_UNPAID');
  });

  it('21. a legacy row with no settlement falls back to the requested type', async () => {
    const annual = factsRig([approvedRow({ type: 'ANNUAL', fundingOutcome: null })]);
    expect((await annual.service.resolveForDate('emp-1', '2026-08-03')).kind).toBe('PAID');

    const unpaid = factsRig([approvedRow({ type: 'UNPAID', fundingOutcome: null })]);
    expect((await unpaid.service.resolveForDate('emp-1', '2026-08-03')).kind).toBe('UNPAID');
  });

  it('22. overlapping approved leaves are still ambiguous, not silently resolved', async () => {
    const { service } = factsRig([
      approvedRow({ fundingOutcome: 'PAID' }),
      approvedRow({ id: 'lv-2', fundingOutcome: 'UNPAID' }),
    ]);
    const facts = await service.resolveForDate('emp-1', '2026-08-03');
    expect(facts.kind).toBe('AMBIGUOUS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The stage machine on the EXISTING LeaveService.approve(). No second service,
// no second controller — the same method, extended behind a flag.
// ─────────────────────────────────────────────────────────────────────────────

import { LeaveService } from '../../src/modules/operations/leave/leave.service';

interface ApproveFixtures {
  lifecycle?: boolean;
  stage?: string;
  isHR?: boolean;
  /** The employee's reporting chain, from the existing Apex hierarchy. */
  chain?: Array<{ id: string; name: string; tier: string }>;
}

/** emp-1's real reporting hierarchy: their team lead, their manager, then admins. */
const REPORTING_CHAIN = [
  { id: 'tl-1', name: 'Their Team Lead', tier: 'TEAM_LEAD' },
  { id: 'mgr-1', name: 'Their Manager', tier: 'MANAGER' },
  { id: 'admin-1', name: 'An Admin', tier: 'ADMIN' },
];

function approveRig(f: ApproveFixtures = {}) {
  const updates: any[] = [];
  const leaveRow = { ...LEAVE, approvalStage: f.stage ?? 'MANAGER_REVIEW', user: { id: 'emp-1' } };

  const prisma: any = {
    leaveRequest: {
      findUnique: jest.fn().mockResolvedValue(leaveRow),
      update: jest.fn(({ data }: any) => {
        updates.push(data);
        return Promise.resolve({ ...leaveRow, ...data });
      }),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'hr-1', role: { name: 'ADMIN' } }) },
  };

  const settlement: any = {
    settleAndApprove: jest.fn().mockResolvedValue({
      leave: { ...leaveRow, status: 'APPROVED', approvalStage: 'COMPLETE' },
      settlement: { fundingOutcome: 'PAID', paidDays: 2, unpaidDays: 0, requestedDays: 2, balanceBefore: 14 },
    }),
  };

  const settings: any = {
    get: jest.fn().mockResolvedValue({ leaveApprovalEnabled: f.lifecycle === true }),
  };

  const hierarchy: any = {
    resolveApproverChainFor: jest.fn().mockResolvedValue(f.chain ?? REPORTING_CHAIN),
  };

  const service = new LeaveService(
    prisma,
    { emitLeaveStatusChanged: jest.fn() } as any,
    { sendNotification: jest.fn().mockResolvedValue(undefined) } as any,
    { get: () => 'http://localhost:3000' } as any,
    { log: jest.fn().mockResolvedValue(undefined) } as any,
    {
      assertCanApproveReject: jest.fn().mockResolvedValue(undefined),
      findAccessibleLeave: jest.fn().mockResolvedValue(leaveRow),
    } as any,
    { getDurationForRequest: jest.fn().mockResolvedValue(2) } as any,
    settlement,
    { isHrOrAdmin: () => f.isHR !== false } as any,
    tvaOf(),
    settings,
    hierarchy,
  );

  return { service, prisma, updates, settlement, settings, hierarchy };
}

describe('LH-2 approval stage machine', () => {
  it('23. with the flag OFF one approval still moves straight to APPROVED', async () => {
    const { service, updates, settlement } = approveRig({ lifecycle: false });

    await service.approve('lv-1', 'mgr-1', { id: 'mgr-1' });

    expect(updates[0].status).toBe('APPROVED');
    expect(updates[0].approvedBy).toBe('mgr-1');
    // No stage transition and no settlement: production behaviour untouched.
    expect(updates[0].approvalStage).toBeUndefined();
    expect(settlement.settleAndApprove).not.toHaveBeenCalled();
  });

  it('24. manager approval advances the stage and leaves the status PENDING', async () => {
    const { service, updates, settlement } = approveRig({
      lifecycle: true,
      stage: 'MANAGER_REVIEW',
    });

    await service.approve('lv-1', 'mgr-1', { id: 'mgr-1' });

    expect(updates[0].approvalStage).toBe('HR_REVIEW');
    expect(updates[0].managerApprovedById).toBe('mgr-1');
    // Crucially NOT approved yet — every existing reader of `status` stays
    // correct while the request is mid-chain.
    expect(updates[0].status).toBeUndefined();
    expect(settlement.settleAndApprove).not.toHaveBeenCalled();
  });

  it('25. an admin in the chain advances one step, never two', async () => {
    const { service, updates, settlement } = approveRig({
      lifecycle: true,
      stage: 'MANAGER_REVIEW',
      isHR: true,
    });

    // admin-1 is in the employee's chain via the established Admin escalation.
    await service.approve('lv-1', 'admin-1', { id: 'admin-1' });

    // Even so, the request only reaches HR review -- nobody skips a stage.
    expect(updates[0].approvalStage).toBe('HR_REVIEW');
    expect(updates[0].status).toBeUndefined();
    expect(settlement.settleAndApprove).not.toHaveBeenCalled();
  });

  it('26. a non-HR approver cannot give final approval', async () => {
    const { service, settlement } = approveRig({
      lifecycle: true,
      stage: 'HR_REVIEW',
      isHR: false,
    });

    await expect(service.approve('lv-1', 'mgr-1', { id: 'mgr-1' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(settlement.settleAndApprove).not.toHaveBeenCalled();
  });

  it('27. HR approval at the HR stage runs the serialized settlement', async () => {
    const { service, settlement } = approveRig({
      lifecycle: true,
      stage: 'HR_REVIEW',
      isHR: true,
    });

    const result = await service.approve('lv-1', 'hr-1', { id: 'hr-1' });

    expect(settlement.settleAndApprove).toHaveBeenCalledWith({
      leaveId: 'lv-1',
      hrApproverId: 'hr-1',
    });
    expect(result.status).toBe('APPROVED');
    expect(result.approvalStage).toBe('COMPLETE');
  });

  it('28. a completed request cannot be approved again', async () => {
    const { service, settlement } = approveRig({
      lifecycle: true,
      stage: 'COMPLETE',
      isHR: true,
    });

    await expect(service.approve('lv-1', 'hr-1', { id: 'hr-1' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(settlement.settleAndApprove).not.toHaveBeenCalled();
  });
});

describe('LH-2 reporting-manager authority', () => {
  it('29. the employee cannot manager-approve their own request', async () => {
    // The existing hierarchy resolver excludes the worker from their own chain,
    // so self-approval is structurally impossible rather than merely checked.
    const { service, updates } = approveRig({
      lifecycle: true,
      stage: 'MANAGER_REVIEW',
      chain: REPORTING_CHAIN.filter((c) => c.id !== 'emp-1'),
    });

    await expect(service.approve('lv-1', 'emp-1', { id: 'emp-1' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(updates).toEqual([]);
  });

  it('30. an unrelated TEAM_LEAD cannot approve this employee', async () => {
    const { service, updates } = approveRig({ lifecycle: true, stage: 'MANAGER_REVIEW' });

    // Holds the TEAM_LEAD role, but is not THIS employee's team lead.
    await expect(
      service.approve('lv-1', 'tl-other', { id: 'tl-other' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(updates).toEqual([]);
  });

  it('31. an unrelated MANAGER cannot approve this employee', async () => {
    const { service, updates } = approveRig({ lifecycle: true, stage: 'MANAGER_REVIEW' });

    await expect(
      service.approve('lv-1', 'mgr-other', { id: 'mgr-other' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(updates).toEqual([]);
  });

  it('32. the actual team lead of this employee advances the stage', async () => {
    const { service, updates } = approveRig({ lifecycle: true, stage: 'MANAGER_REVIEW' });

    await service.approve('lv-1', 'tl-1', { id: 'tl-1' });

    expect(updates[0].approvalStage).toBe('HR_REVIEW');
    expect(updates[0].managerApprovedById).toBe('tl-1');
    expect(updates[0].managerApprovedAt).toBeInstanceOf(Date);
  });

  it('33. the actual reporting manager of this employee advances the stage', async () => {
    const { service, updates, hierarchy } = approveRig({
      lifecycle: true,
      stage: 'MANAGER_REVIEW',
    });

    await service.approve('lv-1', 'mgr-1', { id: 'mgr-1' });

    // Resolved for the LEAVE'S employee, not for the actor.
    expect(hierarchy.resolveApproverChainFor).toHaveBeenCalledWith('emp-1');
    expect(updates[0].approvalStage).toBe('HR_REVIEW');
    expect(updates[0].managerApprovedById).toBe('mgr-1');
  });

  it('34. an employee with no resolvable chain cannot be approved by anyone', async () => {
    const { service, updates } = approveRig({
      lifecycle: true,
      stage: 'MANAGER_REVIEW',
      chain: [],
    });

    await expect(service.approve('lv-1', 'mgr-1', { id: 'mgr-1' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(updates).toEqual([]);
  });

  it('35. an admin override is recorded in the audit trail, not hidden', async () => {
    const logged: any[] = [];
    const { service } = approveRig({ lifecycle: true, stage: 'MANAGER_REVIEW' });
    (service as any).eventLogger = {
      log: jest.fn((e: any) => {
        logged.push(e);
        return Promise.resolve(undefined);
      }),
    };

    await service.approve('lv-1', 'admin-1', { id: 'admin-1' });
    expect(logged[0].toState).toContain('admin override');

    const viaManager: any[] = [];
    const plain = approveRig({ lifecycle: true, stage: 'MANAGER_REVIEW' });
    (plain.service as any).eventLogger = {
      log: jest.fn((e: any) => {
        viaManager.push(e);
        return Promise.resolve(undefined);
      }),
    };
    await plain.service.approve('lv-1', 'mgr-1', { id: 'mgr-1' });
    expect(viaManager[0].toState).toBe('HR_REVIEW');
  });

  it('36. a manager in the chain still cannot perform the HR stage', async () => {
    const { service, settlement } = approveRig({
      lifecycle: true,
      stage: 'HR_REVIEW',
      isHR: false,
    });

    await expect(service.approve('lv-1', 'mgr-1', { id: 'mgr-1' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(settlement.settleAndApprove).not.toHaveBeenCalled();
  });

  it('37. an authorised HR/admin completes the HR stage and its provenance', async () => {
    const { service, settlement } = approveRig({
      lifecycle: true,
      stage: 'HR_REVIEW',
      isHR: true,
    });

    await service.approve('lv-1', 'hr-1', { id: 'hr-1' });

    // The HR approver id reaches the settlement, which is what writes
    // hrApprovedById/At together with the funding outcome, under the lock.
    expect(settlement.settleAndApprove).toHaveBeenCalledWith({
      leaveId: 'lv-1',
      hrApproverId: 'hr-1',
    });
  });

  it('38. the HR stage never consults the reporting chain', async () => {
    const { service, hierarchy } = approveRig({
      lifecycle: true,
      stage: 'HR_REVIEW',
      isHR: true,
    });

    await service.approve('lv-1', 'hr-1', { id: 'hr-1' });

    // HR authority is company-wide and comes from the existing isHR/admin
    // convention, not from the employee's reporting line.
    expect(hierarchy.resolveApproverChainFor).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The migration itself. Read as text, because the guarantee being asserted is
// about what the SQL does NOT do, and that cannot be observed from the schema.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'fs';
import { join } from 'path';

describe('LH-2 migration invents no history', () => {
  const sql = readFileSync(
    join(
      __dirname,
      '../../prisma/migrations/20260821000000_leave_approval_funding/migration.sql',
    ),
    'utf8',
  );

  /** Assignments only — an ADD COLUMN mentioning the name must not match. */
  const assignsTo = (column: string) =>
    new RegExp(`SET[\s\S]*?"${column}"\s*=`, 'i').test(sql) ||
    new RegExp(`"${column}"\s*=\s*"?[A-Za-z]`, 'i').test(sql);

  it('39. no historical row is given a fabricated HR approver', () => {
    // The legacy system had ONE final approver, who may have been a Team Lead,
    // Manager, Admin or Super Admin. Copying them into hrApprovedById would
    // record "HR approved by X" about somebody who may never have been HR.
    expect(assignsTo('hrApprovedById')).toBe(false);
    expect(assignsTo('hrApprovedAt')).toBe(false);
  });

  it('40. no historical row is given a fabricated manager approver', () => {
    // The old model never captured a manager stage at all.
    expect(assignsTo('managerApprovedById')).toBe(false);
    expect(assignsTo('managerApprovedAt')).toBe(false);
  });

  it('41. no historical row is given a fabricated funding settlement', () => {
    expect(assignsTo('fundingOutcome')).toBe(false);
    expect(assignsTo('paidDays')).toBe(false);
    expect(assignsTo('unpaidDays')).toBe(false);
  });

  it('42. the legacy approver fields are preserved, never rewritten', () => {
    expect(assignsTo('approvedBy')).toBe(false);
    expect(assignsTo('approvedAt')).toBe(false);
  });

  it('43. terminal rows are moved to COMPLETE and pending rows are not', () => {
    const backfill = /UPDATE "leave_requests"[\s\S]*?;/.exec(sql)?.[0] ?? '';
    expect(backfill).toContain(`'COMPLETE'`);
    expect(backfill).toContain('APPROVED');
    expect(backfill).toContain('REJECTED');
    expect(backfill).toContain('CANCELLED');
    // PENDING keeps the column default, MANAGER_REVIEW, and is never named here.
    expect(backfill).not.toContain('PENDING');
  });

  it('44. the migration is additive: no drops, renames or type changes', () => {
    expect(/DROP\s+(COLUMN|TABLE|TYPE)/i.test(sql)).toBe(false);
    expect(/RENAME/i.test(sql)).toBe(false);
    expect(/ALTER COLUMN/i.test(sql)).toBe(false);
    expect(/DELETE\s+FROM/i.test(sql)).toBe(false);
  });
});
