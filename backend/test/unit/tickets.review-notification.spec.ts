import { TicketStatus } from '@prisma/client';
import { TicketsService } from '../../src/modules/operations/tickets/tickets.service';
import { TicketLedgerService } from '../../src/modules/operations/tickets/ticket-ledger.service';

// TicketsService.update() — REVIEW-entry notification. Covers the gap the audit
// found: a ticket freshly entering REVIEW never notified anyone that a review was
// waiting on them. The notification must reach only the resolved approver(s), never
// the submitter/assignee, and must never fire twice for the same review submission.
describe('TicketsService.update — REVIEW-entry notification to resolved approver(s)', () => {
  let prisma: any;
  let ticketAccess: any;
  let hierarchyApprovalService: any;
  let notificationEventService: any;
  let service: TicketsService;

  function makeTicketFixture(overrides: any = {}) {
    return {
      id: 'ticket-1',
      ticketId: 'TKT-100',
      status: TicketStatus.IN_PROGRESS,
      type: 'TASK',
      priority: 'HIGH',
      createdById: 'creator-1',
      assignedToId: 'assignee-1',
      assignees: [],
      submittedAt: null,
      estimatedMinutes: 60,
      ...overrides,
    };
  }

  function setup(existingTicket: any) {
    prisma = {
      ticket: {
        update: jest.fn(async ({ data }: any) => ({ ...existingTicket, ...data, assignedTo: { id: existingTicket.assignedToId } })),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ currentStatus: 'ACTIVE' }),
        findMany: jest.fn().mockResolvedValue([]), // overridden per-test
      },
      ticketHistory: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
    };

    ticketAccess = {
      findAccessibleTicket: jest.fn(async () => existingTicket),
      assertCanTransitionTicket: jest.fn().mockResolvedValue(undefined),
      assertCanAssignTicket: jest.fn().mockResolvedValue(undefined),
      assertCanUpdateTicket: jest.fn().mockResolvedValue(undefined),
      isSelfAssigned: jest.fn().mockReturnValue(false),
      canViewTicket: jest.fn().mockResolvedValue(false),
    };

    hierarchyApprovalService = {
      resolvePrimaryApproverFor: jest.fn().mockResolvedValue(null),
    };
    notificationEventService = { sendNotification: jest.fn().mockResolvedValue(null) };

    const ticketLedger = new TicketLedgerService(
      prisma,
      { now: () => new Date('2026-06-20T12:00:00Z'), elapsedSeconds: () => 0 } as any,
    );

    service = new TicketsService(
      prisma,
      { emitTicketStatusChanged: jest.fn(), emitTicketCreated: jest.fn() } as any, // gateway
      notificationEventService,
      { get: jest.fn() } as any, // configService
      { emit: jest.fn() } as any, // eventEmitter
      { log: jest.fn().mockReturnValue({ catch: jest.fn() }) } as any, // eventLogger
      ticketAccess,
      hierarchyApprovalService,
      { getSlaConfig: jest.fn().mockResolvedValue({ review: { HIGH: 24 } }), decorateTicket: jest.fn((t: any) => Promise.resolve(t)) } as any, // ticketTiming
      ticketLedger,
      {} as any, // ticketImport
    );
  }

  const actor = { id: 'assignee-1', role: { name: 'EMPLOYEE' } };

  it('self-assigned ticket entering REVIEW notifies only the resolved primary approver, never the submitter', async () => {
    const existing = makeTicketFixture({ createdById: 'assignee-1', assignedToId: 'assignee-1' });
    setup(existing);
    ticketAccess.isSelfAssigned.mockReturnValue(true);
    hierarchyApprovalService.resolvePrimaryApproverFor.mockResolvedValue({ id: 'tl-1', name: 'Lead', tier: 'TEAM_LEAD' });

    await service.update('ticket-1', { status: TicketStatus.REVIEW }, 'assignee-1', actor);

    expect(notificationEventService.sendNotification).toHaveBeenCalledWith(
      'tl-1',
      'reviewPending',
      expect.objectContaining({ title: expect.stringContaining('Review needed') }),
    );
    expect(notificationEventService.sendNotification).not.toHaveBeenCalledWith(
      'assignee-1',
      'reviewPending',
      expect.anything(),
    );
  });

  it('self-assigned ticket with no resolvable approver sends no reviewPending notification (never crashes the transition)', async () => {
    const existing = makeTicketFixture({ createdById: 'assignee-1', assignedToId: 'assignee-1' });
    setup(existing);
    ticketAccess.isSelfAssigned.mockReturnValue(true);
    hierarchyApprovalService.resolvePrimaryApproverFor.mockResolvedValue(null);

    const result = await service.update('ticket-1', { status: TicketStatus.REVIEW }, 'assignee-1', actor);

    expect(result.status).toBe(TicketStatus.REVIEW);
    expect(notificationEventService.sendNotification).not.toHaveBeenCalledWith(
      expect.anything(), 'reviewPending', expect.anything(),
    );
  });

  it('non-self-assigned ticket notifies only TEAM_LEAD/MANAGER candidates who can actually view it, excluding the assignee', async () => {
    const existing = makeTicketFixture(); // createdById !== assignedToId
    setup(existing);
    ticketAccess.isSelfAssigned.mockReturnValue(false);
    prisma.user.findMany.mockResolvedValue([
      { id: 'tl-scoped', role: { name: 'TEAM_LEAD' } },
      { id: 'tl-unscoped', role: { name: 'TEAM_LEAD' } },
      { id: 'mgr-scoped', role: { name: 'MANAGER' } },
    ]);
    ticketAccess.canViewTicket.mockImplementation(async (candidate: any) =>
      ['tl-scoped', 'mgr-scoped'].includes(candidate.id));

    await service.update('ticket-1', { status: TicketStatus.REVIEW }, 'creator-1', { id: 'creator-1', role: { name: 'MANAGER' } });

    const notifiedIds = notificationEventService.sendNotification.mock.calls
      .filter((c: any) => c[1] === 'reviewPending')
      .map((c: any) => c[0]);
    expect(notifiedIds.sort()).toEqual(['mgr-scoped', 'tl-scoped']);
    expect(notifiedIds).not.toContain('assignee-1');
    expect(notifiedIds).not.toContain('tl-unscoped');
  });

  it('never notifies twice for the same review submission (no duplicate on a second update to an already-REVIEW ticket)', async () => {
    // existing.submittedAt already set ⇒ enteringReview is false on this call.
    const existing = makeTicketFixture({ status: TicketStatus.REVIEW, submittedAt: new Date('2026-06-20T09:00:00Z') });
    setup(existing);
    ticketAccess.isSelfAssigned.mockReturnValue(false);

    await service.update('ticket-1', { status: TicketStatus.REVIEW, priority: 'URGENT' }, 'creator-1', { id: 'creator-1', role: { name: 'MANAGER' } });

    expect(notificationEventService.sendNotification).not.toHaveBeenCalledWith(
      expect.anything(), 'reviewPending', expect.anything(),
    );
  });

  it('a fresh rework-then-resubmit cycle fires a new notification (submittedAt was reset by the rework)', async () => {
    // Ticket went REVIEW -> IN_PROGRESS (rework), clearing submittedAt; now resubmitted.
    const existing = makeTicketFixture({ status: TicketStatus.IN_PROGRESS, submittedAt: null });
    setup(existing);
    ticketAccess.isSelfAssigned.mockReturnValue(false);
    prisma.user.findMany.mockResolvedValue([{ id: 'tl-scoped', role: { name: 'TEAM_LEAD' } }]);
    ticketAccess.canViewTicket.mockResolvedValue(true);

    await service.update('ticket-1', { status: TicketStatus.REVIEW }, 'creator-1', { id: 'creator-1', role: { name: 'MANAGER' } });

    expect(notificationEventService.sendNotification).toHaveBeenCalledWith(
      'tl-scoped', 'reviewPending', expect.anything(),
    );
  });
});
