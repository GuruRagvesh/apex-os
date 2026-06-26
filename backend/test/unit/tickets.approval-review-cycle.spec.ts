import { BadRequestException } from '@nestjs/common';
import { TicketsController } from '../../src/modules/operations/tickets/tickets.controller';
import { TicketsService } from '../../src/modules/operations/tickets/tickets.service';
import { TicketLedgerService } from '../../src/modules/operations/tickets/ticket-ledger.service';
import { TicketStatus } from '@prisma/client';

// Regression coverage for the approval-rating pipeline audit finding: the frontend's
// mandatory 3-star rating UI sent taskEfficiencyRating/employeePerformanceRating/
// employeeAttitudeRating/ratingComment on PATCH /tickets/:id/approve, the controller's
// @Body() was typed correctly, but the handler never forwarded `body` to the service —
// and TicketsService.approve() never wrote anything to ReviewCycleLog even if it had.
// These tests cover both halves of the fix.

describe('TicketsController.approve — forwards ratings body to the service', () => {
  it('passes id, user.id, user, and the full ratings body through to ticketsService.approve', () => {
    const ticketsService = { approve: jest.fn() } as any;
    const controller = new TicketsController(ticketsService, {} as any, {} as any);

    const user = { id: 'reviewer-1', role: { name: 'TEAM_LEAD' } };
    const body = {
      taskEfficiencyRating: 5,
      employeePerformanceRating: 4,
      employeeAttitudeRating: 5,
      ratingComment: 'Great work, shipped early.',
    };

    controller.approve('ticket-1', body, user);

    expect(ticketsService.approve).toHaveBeenCalledWith('ticket-1', 'reviewer-1', user, body);
  });
});

describe('TicketsService.approve/reject — ReviewCycleLog persistence', () => {
  // Minimal in-memory fake for reviewCycleLog so TicketLedgerService's real
  // find-then-create/update sequencing is exercised, not just "was it called".
  function makeReviewCycleLogTable() {
    const rows: any[] = [];
    let counter = 0;
    return {
      findFirst: jest.fn(async ({ where, orderBy }: any) => {
        let matches = rows.filter(
          (r) => r.ticketId === where.ticketId && (where.decision === undefined || r.decision === where.decision),
        );
        if (orderBy?.cycleNo === 'desc') matches = [...matches].sort((a, b) => b.cycleNo - a.cycleNo);
        return matches[0] ?? null;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.ticketId_cycleNo) {
          const { ticketId, cycleNo } = where.ticketId_cycleNo;
          return rows.find((r) => r.ticketId === ticketId && r.cycleNo === cycleNo) ?? null;
        }
        return rows.find((r) => r.id === where.id) ?? null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `cycle-${++counter}`, decision: null, ...data };
        rows.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      }),
      rows,
    };
  }

  let prisma: any;
  let reviewCycleLogTable: ReturnType<typeof makeReviewCycleLogTable>;
  let ticketAccess: any;
  let service: TicketsService;

  function makeTicketFixture(overrides: any = {}) {
    return {
      id: 'ticket-db-1',
      ticketId: 'TKT-001',
      status: TicketStatus.REVIEW,
      priority: 'HIGH',
      createdById: 'creator-1',
      assignedToId: 'assignee-1',
      assignees: [],
      submittedAt: new Date('2026-06-20T10:00:00Z'),
      reviewStartedAt: new Date('2026-06-20T10:00:00Z'),
      estimatedMinutes: 60,
      ...overrides,
    };
  }

  beforeEach(() => {
    reviewCycleLogTable = makeReviewCycleLogTable();
    prisma = {
      ticket: {
        update: jest.fn(async ({ data }: any) => ({ ...makeTicketFixture(), ...data })),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ currentStatus: 'ACTIVE' }),
      },
      ticketHistory: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
      comment: { create: jest.fn().mockResolvedValue({}) },
      reviewCycleLog: reviewCycleLogTable,
      ticketTimeLog: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { durationSeconds: 0 } }),
      },
    };

    ticketAccess = {
      findAccessibleTicket: jest.fn(async (_id: string, _user: any, _include: any) => makeTicketFixture()),
      assertCanTransitionTicket: jest.fn().mockResolvedValue(undefined),
      assertCanAssignTicket: jest.fn().mockResolvedValue(undefined),
      assertCanUpdateTicket: jest.fn().mockResolvedValue(undefined),
      // These fixtures are hierarchy-reviewed (reviewer ≠ assignee), so not self-assigned.
      isSelfAssigned: jest.fn().mockReturnValue(false),
    };

    const ticketLedger = new TicketLedgerService(
      prisma,
      { now: () => new Date('2026-06-20T12:00:00Z'), elapsedSeconds: () => 0 } as any,
    );

    service = new TicketsService(
      prisma,
      { emitTicketStatusChanged: jest.fn(), emitTicketCreated: jest.fn() } as any, // gateway
      { sendNotification: jest.fn().mockResolvedValue(null) } as any, // notificationEventService
      { get: jest.fn() } as any, // configService
      { emit: jest.fn() } as any, // eventEmitter
      { log: jest.fn().mockReturnValue({ catch: jest.fn() }) } as any, // eventLogger
      ticketAccess,
      { getSlaConfig: jest.fn().mockResolvedValue({ review: { HIGH: 24 } }), decorateTicket: jest.fn((t: any) => Promise.resolve(t)) } as any, // ticketTiming
      ticketLedger,
      {} as any, // ticketImport (not used by approve/reject)
    );
  });

  const user = { id: 'reviewer-1', role: { name: 'TEAM_LEAD' } };

  it('approve() persists decision, reviewerId, assigneeId, ratings, and comment', async () => {
    await service.approve('ticket-db-1', 'reviewer-1', user, {
      taskEfficiencyRating: 5,
      employeePerformanceRating: 4,
      employeeAttitudeRating: 3,
      ratingComment: 'Solid execution, minor polish needed.',
    });

    expect(reviewCycleLogTable.rows).toHaveLength(1);
    const cycle = reviewCycleLogTable.rows[0];
    expect(cycle.decision).toBe('APPROVED');
    expect(cycle.reviewerId).toBe('reviewer-1');
    expect(cycle.assigneeId).toBe('assignee-1');
    expect(cycle.taskEfficiencyRating).toBe(5);
    expect(cycle.employeePerformanceRating).toBe(4);
    expect(cycle.employeeAttitudeRating).toBe(3);
    expect(cycle.ratingComment).toBe('Solid execution, minor polish needed.');
    expect(cycle.cycleNo).toBe(1);
  });

  it('reject() persists decision=REWORK with the rejection comment as feedback, no ratings', async () => {
    await service.reject('ticket-db-1', 'Please add error handling', 'reviewer-1', user);

    expect(reviewCycleLogTable.rows).toHaveLength(1);
    const cycle = reviewCycleLogTable.rows[0];
    expect(cycle.decision).toBe('REWORK');
    expect(cycle.reviewerId).toBe('reviewer-1');
    expect(cycle.assigneeId).toBe('assignee-1');
    expect(cycle.feedback).toBe('Please add error handling');
    expect(cycle.taskEfficiencyRating).toBeNull();
  });

  it('falls back to the first multi-assignee when assignedToId is missing', async () => {
    const ticketWithMultiAssignee = makeTicketFixture({
      assignedToId: null,
      assignees: [{ userId: 'assignee-9' }, { userId: 'assignee-8' }],
    });
    ticketAccess.findAccessibleTicket.mockImplementation(async () => ticketWithMultiAssignee);
    prisma.ticket.update.mockImplementation(async ({ data }: any) => ({ ...ticketWithMultiAssignee, ...data }));

    await service.approve('ticket-db-1', 'reviewer-1', user, {
      taskEfficiencyRating: 4,
      employeePerformanceRating: 4,
      employeeAttitudeRating: 4,
    });

    expect(reviewCycleLogTable.rows).toHaveLength(1);
    expect(reviewCycleLogTable.rows[0].assigneeId).toBe('assignee-9');
  });

  it('approving a ticket already in REVIEW before this fix shipped still persists a cycle (no pre-existing open cycle)', async () => {
    // Simulates a ticket that entered REVIEW before this session's fix — no ReviewCycleLog
    // row exists yet for it at all, not even an open one. persistReviewDecision must still
    // retroactively start + close a cycle rather than silently doing nothing.
    expect(reviewCycleLogTable.rows).toHaveLength(0);

    await service.approve('ticket-db-1', 'reviewer-1', user, {
      taskEfficiencyRating: 5,
      employeePerformanceRating: 5,
      employeeAttitudeRating: 5,
    });

    expect(reviewCycleLogTable.rows).toHaveLength(1);
    expect(reviewCycleLogTable.rows[0].decision).toBe('APPROVED');
    expect(reviewCycleLogTable.rows[0].reviewStartedAt).toEqual(new Date('2026-06-20T10:00:00Z'));
  });

  it('a rework cycle followed by re-approval creates a second, separate review cycle', async () => {
    await service.reject('ticket-db-1', 'Needs more tests', 'reviewer-1', user);
    expect(reviewCycleLogTable.rows).toHaveLength(1);
    expect(reviewCycleLogTable.rows[0].cycleNo).toBe(1);

    await service.approve('ticket-db-1', 'reviewer-1', user, {
      taskEfficiencyRating: 4,
      employeePerformanceRating: 4,
      employeeAttitudeRating: 4,
    });

    expect(reviewCycleLogTable.rows).toHaveLength(2);
    expect(reviewCycleLogTable.rows[1].cycleNo).toBe(2);
    expect(reviewCycleLogTable.rows[1].decision).toBe('APPROVED');
  });

  it('approve() fails clearly and never transitions status if ReviewCycleLog persistence fails', async () => {
    reviewCycleLogTable.create.mockRejectedValue(new Error('db write failed'));

    await expect(
      service.approve('ticket-db-1', 'reviewer-1', user, {
        taskEfficiencyRating: 5,
        employeePerformanceRating: 5,
        employeeAttitudeRating: 5,
      }),
    ).rejects.toThrow(BadRequestException);

    // The ticket must stay in REVIEW — the status-transition write must never have happened.
    expect(prisma.ticket.update).not.toHaveBeenCalled();
    // And no half-written cycle should be left behind looking like a real decision.
    expect(reviewCycleLogTable.rows.some((r: any) => r.decision === 'APPROVED')).toBe(false);
  });

  it('reject() fails clearly and never transitions status if ReviewCycleLog persistence fails', async () => {
    reviewCycleLogTable.create.mockRejectedValue(new Error('db write failed'));

    await expect(
      service.reject('ticket-db-1', 'Needs more tests', 'reviewer-1', user),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.ticket.update).not.toHaveBeenCalled();
    expect(prisma.comment.create).not.toHaveBeenCalled();
    expect(reviewCycleLogTable.rows.some((r: any) => r.decision === 'REWORK')).toBe(false);
  });

  it('approve() still succeeds and transitions to DONE when ReviewCycleLog persistence succeeds', async () => {
    const result = await service.approve('ticket-db-1', 'reviewer-1', user, {
      taskEfficiencyRating: 5,
      employeePerformanceRating: 5,
      employeeAttitudeRating: 5,
    });

    expect(result.status).toBe(TicketStatus.DONE);
    expect(reviewCycleLogTable.rows[0].decision).toBe('APPROVED');
  });

  it('reject() still succeeds and transitions to IN_PROGRESS when ReviewCycleLog persistence succeeds', async () => {
    const result = await service.reject('ticket-db-1', 'Needs more tests', 'reviewer-1', user);

    expect(result.status).toBe(TicketStatus.IN_PROGRESS);
    expect(reviewCycleLogTable.rows[0].decision).toBe('REWORK');
  });
});
