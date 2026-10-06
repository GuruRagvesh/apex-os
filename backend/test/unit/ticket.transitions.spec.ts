import { TVAService } from '../../src/common/services/tva.service';
/**
 * Unit tests — Ticket status transition rules
 *
 * Verifies that role-based transition guards (INTERN, non-manager REVIEW→DONE)
 * are enforced by TicketsService.update.  Prisma is mocked.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { TicketsService } from '../../src/modules/operations/tickets/tickets.service';
import { ActiveWorkdayPolicyService } from '../../src/common/services/active-workday-policy.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NotificationEventService } from '../../src/modules/operations/notifications/notification-event.service';
import { EventsGateway } from '../../src/modules/platform/gateway/events.gateway';
import { EmailService } from '../../src/modules/platform/email/email.service';
import { EventLoggerService } from '../../src/common/services/event-logger.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { TicketAccessService } from '../../src/common/services/ticket-access.service';
import { HierarchyApprovalService } from '../../src/common/services/hierarchy-approval.service';
import { TicketTimingService } from '../../src/common/services/ticket-timing.service';
import { TicketLedgerService } from '../../src/modules/operations/tickets/ticket-ledger.service';
import { TicketImportService } from '../../src/modules/operations/tickets/ticket-import.service';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ForbiddenException } from '@nestjs/common';

const mockPrisma: any = {
  // Phase 2D2: a ticket/workday change and its timer change run in one transaction.
  $transaction: jest.fn((fn: any) => fn(mockPrisma)),
  // The ticket row lock in a ticket change re-reads status and owner (Phase 3).
  $queryRaw: jest.fn(async () => [(await mockPrisma.ticket.findUnique?.()) ?? (await mockPrisma.ticket.findFirst?.())].filter(Boolean)),
  ticket: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    groupBy: jest.fn(),
  },
  ticketHistory: {
    create: jest.fn(),
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
  // Entering REVIEW binds pending proof to its cycle; a decision locks the cycle's evidence.
  attachment: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },

  ticketAssignee: {
    findMany: jest.fn().mockResolvedValue([]),
    upsert: jest.fn(),
    deleteMany: jest.fn(),
    create: jest.fn(),
  },
  notification: { create: jest.fn() },
  activityLog: { create: jest.fn() },
  appSetting: { findUnique: jest.fn().mockResolvedValue(null) },
  comment: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({}) },
  department: { findFirst: jest.fn().mockResolvedValue(null) },
  managerDeptAccess: { findMany: jest.fn().mockResolvedValue([]) },
  user: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn() },
};
const mockNotif   = { create: jest.fn().mockResolvedValue(undefined), sendNotification: jest.fn().mockResolvedValue(undefined) };
const mockGateway = {
  emitToUser: jest.fn(),
  emitTicketCreated: jest.fn(),
  emitTicketStatusChanged: jest.fn(),
  emitNotificationToUser: jest.fn(),
};
const mockEmail   = { sendTicketAssigned: jest.fn(), sendTicketResolved: jest.fn() };
const mockLogger  = { log: jest.fn().mockResolvedValue(undefined) };
const mockConfig  = { get: jest.fn().mockReturnValue('http://localhost:3000') };
const mockEventEmitter = { emit: jest.fn(), emitAsync: jest.fn() };

// Open ticket fixture
function makeTicket(overrides: any = {}) {
  return {
    id: 'tkt1',
    ticketId: 'TKT-001',
    title: 'Test Ticket',
    status: 'OPEN',
    priority: 'MEDIUM',
    assignedToId: 'emp1',
    createdById: 'emp1',
    projectId: null,
    departmentId: null,
    estimatedMinutes: null,
    actualStartAt: null,
    executionDueAt: null,
    submittedAt: null,
    reviewStartedAt: null,
    reviewDueAt: null,
    ...overrides,
  };
}

describe('TicketsService — status transitions', () => {
  let service: TicketsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default: ticket update succeeds
    mockPrisma.ticket.findFirst.mockResolvedValue(makeTicket());
    mockPrisma.ticket.findUnique.mockResolvedValue(makeTicket());
    mockPrisma.ticket.count.mockResolvedValue(1);
    mockPrisma.ticket.update.mockImplementation(async ({ data }) => ({
      ...makeTicket(), ...data,
    }));
    mockPrisma.ticketHistory.create.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: TVAService, useValue: { now: () => new Date(), companyTimezone: () => 'Asia/Kolkata', companyNow: () => new Date(), companyDayStart: () => new Date(), formatZoned: () => 'mock', companyDayEnd: () => new Date(), elapsedSeconds: () => 0 } },
        TicketsService,
        { provide: ActiveWorkdayPolicyService, useValue: { assertActiveWorkdayLocked: jest.fn().mockResolvedValue({ sessionId: 'ws-1', status: 'WORKING' }) } },
        AccessPolicyService,
        HierarchyApprovalService,
        TicketAccessService,
        TicketTimingService,
        { provide: PrismaService,         useValue: mockPrisma       },
        { provide: NotificationEventService,  useValue: mockNotif        },
        { provide: EventsGateway,         useValue: mockGateway      },
        { provide: EmailService,          useValue: mockEmail        },
        { provide: EventLoggerService,    useValue: mockLogger       },
        { provide: ConfigService,         useValue: mockConfig       },
        { provide: EventEmitter2,         useValue: mockEventEmitter },
        { provide: TicketLedgerService,   useValue: {
          startReviewCycle: jest.fn().mockResolvedValue({ id: 'cycle-1' }),
          // Phase 4: entering REVIEW opens a cycle unless one is already open.
          findOpenReviewCycle: jest.fn().mockResolvedValue({ id: 'cycle-1', cycleNo: 1 }),
          // A review decision needs the decider's running review (they started it).
          findActiveReviewerLog: jest.fn().mockResolvedValue({ id: 'review-log-1', ownerType: 'REVIEWER' }),
          // approve()/reject() now require persistReviewDecision to resolve to a truthy
          // ReviewCycleLog row or they throw — this suite tests notification/transition
          // behavior, not ledger persistence itself, so the mock just needs to succeed.
          endReviewCycle: jest.fn().mockResolvedValue({ id: 'cycle-1', decision: 'REWORK' }),
          getTicketTimers: jest.fn(), startWorkLog: jest.fn(), endActiveLog: jest.fn(), getActiveLogForTicket: jest.fn(),
          startAssigneeTimer: jest.fn().mockResolvedValue(undefined),
          endActiveLogsForTicket: jest.fn().mockResolvedValue({ count: 0, logIds: [], userIds: [] }),
          resumeNextWaitingTicket: jest.fn().mockResolvedValue(undefined),
          closeReworkSegment: jest.fn().mockResolvedValue(undefined),
        } },
        { provide: TicketImportService, useValue: {} },
      ],
    }).compile();

    service = module.get<TicketsService>(TicketsService);
  });

  it('allows EMPLOYEE to move own ticket OPEN → IN_PROGRESS', async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue(makeTicket({ assignedToId: 'emp1', createdById: 'emp1' }));
    const user = { id: 'emp1', role: { name: 'EMPLOYEE' } };

    await expect(
      service.updateStatus('tkt1', 'IN_PROGRESS' as any, 'emp1', user),
    ).resolves.toBeDefined();
  });

  it('blocks INTERN from moving ticket to DONE when assigned but created by someone else', async () => {
    // createdById !== assignedToId → NOT a self-review ticket → INTERN blocked from DONE
    mockPrisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ assignedToId: 'int1', createdById: 'mgr1', status: 'IN_PROGRESS' }),
    );
    const user = { id: 'int1', role: { name: 'INTERN' } };

    await expect(
      service.updateStatus('tkt1', 'DONE' as any, 'int1', user),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows assigned INTERN to move IN_PROGRESS ticket to REVIEW', async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ assignedToId: 'int1', createdById: 'int1', status: 'IN_PROGRESS' }),
    );
    const user = { id: 'int1', role: { name: 'INTERN' } };

    await expect(
      service.updateStatus('tkt1', 'REVIEW' as any, 'int1', user),
    ).resolves.toBeDefined();
  });

  it('blocks unassigned INTERN from moving IN_PROGRESS ticket to REVIEW', async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ assignedToId: 'emp2', createdById: 'emp2', status: 'IN_PROGRESS' }),
    );
    const user = { id: 'int1', role: { name: 'INTERN' } };

    await expect(
      service.updateStatus('tkt1', 'REVIEW' as any, 'int1', user),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows INTERN to move own ticket to IN_PROGRESS', async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ assignedToId: 'int1', createdById: 'int1', status: 'OPEN' }),
    );
    const user = { id: 'int1', role: { name: 'INTERN' } };

    await expect(
      service.updateStatus('tkt1', 'IN_PROGRESS' as any, 'int1', user),
    ).resolves.toBeDefined();
  });

  it('blocks non-manager from approving REVIEW → DONE', async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ assignedToId: 'emp1', createdById: 'emp2', status: 'REVIEW' }),
    );
    const user = { id: 'emp1', role: { name: 'EMPLOYEE' } };

    await expect(
      service.updateStatus('tkt1', 'DONE' as any, 'emp1', user),
    ).rejects.toThrow(ForbiddenException);
  });

  // Phase 4: a review completes only through approve(), which records the
  // decision; a plain REVIEW → DONE status change would leave the cycle open.
  it('refuses a plain REVIEW → DONE status change, even for a MANAGER (Approve is the way)', async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ assignedToId: 'emp1', createdById: 'emp2', status: 'REVIEW' }),
    );
    mockPrisma.ticket.update.mockResolvedValue(makeTicket({ status: 'DONE' }));
    const user = { id: 'mgr1', role: { name: 'MANAGER' } };

    await expect(
      service.updateStatus('tkt1', 'DONE' as any, 'mgr1', user),
    ).rejects.toMatchObject({ response: { code: 'REVIEW_DECISION_REQUIRED' } });
    expect(mockPrisma.ticket.update).not.toHaveBeenCalled();
  });

  it('blocks unrelated employee from updating another user\'s ticket', async () => {
    // createdById and assignedToId are both 'emp1', requester is 'emp2' (non-manager)
    mockPrisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ assignedToId: 'emp1', createdById: 'emp1', status: 'OPEN' }),
    );
    const user = { id: 'emp2', role: { name: 'EMPLOYEE' } };

    await expect(
      service.updateStatus('tkt1', 'IN_PROGRESS' as any, 'emp2', user),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows assigned employee to submit IN_PROGRESS ticket to REVIEW', async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ assignedToId: 'emp1', status: 'IN_PROGRESS' }),
    );
    const user = { id: 'emp1', role: { name: 'EMPLOYEE' } };

    await expect(
      service.updateStatus('tkt1', 'REVIEW' as any, 'emp1', user),
    ).resolves.toBeDefined();
  });

  it('blocks unauthorized employee from submitting unrelated ticket to REVIEW', async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ assignedToId: 'emp1', createdById: 'emp1', status: 'IN_PROGRESS' }),
    );
    const user = { id: 'emp2', role: { name: 'EMPLOYEE' } };

    await expect(
      service.updateStatus('tkt1', 'REVIEW' as any, 'emp2', user),
    ).rejects.toThrow(ForbiddenException);
  });

  it('submit-to-review from OPEN fails cleanly', async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ assignedToId: 'emp1', status: 'OPEN' }),
    );
    const user = { id: 'emp1', role: { name: 'EMPLOYEE' } };

    await expect(
      service.updateStatus('tkt1', 'REVIEW' as any, 'emp1', user),
    ).rejects.toThrow(ForbiddenException);
  });

  it('submit-to-review from DONE fails cleanly', async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ assignedToId: 'emp1', status: 'DONE' }),
    );
    const user = { id: 'emp1', role: { name: 'EMPLOYEE' } };

    await expect(
      service.updateStatus('tkt1', 'REVIEW' as any, 'emp1', user),
    ).rejects.toThrow(ForbiddenException);
  });

  // ── reject() — notification recipient ──────────────────────────────────────

  describe('reject() notification recipient', () => {
    const reviewTicket = makeTicket({
      status: 'REVIEW',
      assignedToId: 'assignee1',
      createdById: 'creator1',
    });
    const inProgressResult = { ...reviewTicket, status: 'IN_PROGRESS', assignedTo: null };

    beforeEach(() => {
      mockPrisma.ticket.findFirst.mockResolvedValue(reviewTicket);
      mockPrisma.ticket.findUnique.mockResolvedValue(reviewTicket);
      mockPrisma.ticket.update.mockResolvedValue(inProgressResult);
    });

    it('sends rejection notification to assignedToId, not createdById', async () => {
      await service.reject('tkt1', 'Needs rework', 'mgr1');

      const recipients = mockNotif.sendNotification.mock.calls.map(([id]: [string]) => id);
      expect(recipients).toContain('assignee1');
      expect(recipients).not.toContain('creator1');
    });

    it('rejection notification payload contains "rejected" in the title', async () => {
      await service.reject('tkt1', 'Needs rework', 'mgr1');

      expect(mockNotif.sendNotification).toHaveBeenCalledWith(
        'assignee1',
        expect.any(String),
        expect.objectContaining({ title: expect.stringContaining('rejected') }),
      );
    });

    it('refuses to send an ownerless ticket back to IN_PROGRESS, and notifies nobody (Phase 3 owner invariant)', async () => {
      const unassigned = makeTicket({ status: 'REVIEW', assignedToId: null, createdById: 'creator1' });
      mockPrisma.ticket.findFirst.mockResolvedValue(unassigned);
      mockPrisma.ticket.findUnique.mockResolvedValue(unassigned);
      mockPrisma.ticket.update.mockResolvedValue({ ...unassigned, status: 'IN_PROGRESS', assignedTo: null });

      await expect(service.reject('tkt1', 'Needs rework', 'mgr1')).rejects.toMatchObject({
        response: { statusCode: 400, code: 'PRIMARY_ASSIGNEE_REQUIRED' },
      });
      expect(mockPrisma.ticket.update).not.toHaveBeenCalled();
      expect(mockNotif.sendNotification).not.toHaveBeenCalled();
    });

    it('skips self-notification when the rejector is also the assignee', async () => {
      const selfAssigned = makeTicket({ status: 'REVIEW', assignedToId: 'mgr1', createdById: 'creator1' });
      mockPrisma.ticket.findFirst.mockResolvedValue(selfAssigned);
      mockPrisma.ticket.findUnique.mockResolvedValue(selfAssigned);
      mockPrisma.ticket.update.mockResolvedValue({ ...selfAssigned, status: 'IN_PROGRESS', assignedTo: null });

      await expect(service.reject('tkt1', 'Needs rework', 'mgr1')).resolves.toBeDefined();
      expect(mockNotif.sendNotification).not.toHaveBeenCalled();
    });
  });

  // ── reopen — stale completion/review timestamp clearing ───────────────────

  describe('reopen — stale completion/review timestamp clearing', () => {
    function makeDoneTicket(overrides: any = {}) {
      return makeTicket({
        status: 'DONE',
        actualCompletedAt: new Date('2026-06-01T10:00:00.000Z'),
        closedAt: new Date('2026-06-01T10:00:00.000Z'),
        resolvedAt: new Date('2026-06-01T10:00:00.000Z'),
        submittedAt: new Date('2026-06-01T09:00:00.000Z'),
        reviewStartedAt: new Date('2026-06-01T09:30:00.000Z'),
        reviewDueAt: new Date('2026-06-02T09:00:00.000Z'),
        ...overrides,
      });
    }

    it('DONE → IN_PROGRESS clears all 6 stale completion and review timestamps', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue(
        makeDoneTicket({ assignedToId: 'emp1', createdById: 'emp2' }),
      );
      mockPrisma.ticket.update.mockImplementation(async ({ data }) => ({
        ...makeDoneTicket(), ...data,
      }));
      const user = { id: 'mgr1', role: { name: 'MANAGER' } };

      await service.updateStatus('tkt1', 'IN_PROGRESS' as any, 'mgr1', user);

      const written = mockPrisma.ticket.update.mock.calls[0][0].data;
      expect(written.actualCompletedAt).toBeNull();
      expect(written.closedAt).toBeNull();
      expect(written.resolvedAt).toBeNull();
      expect(written.submittedAt).toBeNull();
      expect(written.reviewStartedAt).toBeNull();
      expect(written.reviewDueAt).toBeNull();
    });

    it('DONE → OPEN clears all 6 stale completion and review timestamps', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue(
        makeDoneTicket({ assignedToId: 'emp1', createdById: 'emp2' }),
      );
      mockPrisma.ticket.update.mockImplementation(async ({ data }) => ({
        ...makeDoneTicket(), ...data,
      }));
      const user = { id: 'mgr1', role: { name: 'MANAGER' } };

      await service.updateStatus('tkt1', 'OPEN' as any, 'mgr1', user);

      const written = mockPrisma.ticket.update.mock.calls[0][0].data;
      expect(written.actualCompletedAt).toBeNull();
      expect(written.closedAt).toBeNull();
      expect(written.resolvedAt).toBeNull();
      expect(written.submittedAt).toBeNull();
      expect(written.reviewStartedAt).toBeNull();
      expect(written.reviewDueAt).toBeNull();
    });

    it('normal IN_PROGRESS → DONE sets fresh completion timestamps', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue(
        makeTicket({ status: 'IN_PROGRESS', assignedToId: 'emp1', createdById: 'emp2' }),
      );
      mockPrisma.ticket.update.mockImplementation(async ({ data }) => ({
        ...makeTicket({ status: 'IN_PROGRESS' }), ...data,
      }));
      const user = { id: 'mgr1', role: { name: 'MANAGER' } };

      await service.updateStatus('tkt1', 'DONE' as any, 'mgr1', user);

      const written = mockPrisma.ticket.update.mock.calls[0][0].data;
      expect(written.actualCompletedAt).toBeInstanceOf(Date);
      expect(written.closedAt).toBeInstanceOf(Date);
      expect(written.resolvedAt).toBeInstanceOf(Date);
    });

    it('DONE → IN_PROGRESS recalculates executionDueAt when estimatedMinutes is set', async () => {
      const before = Date.now();
      mockPrisma.ticket.findUnique.mockResolvedValue(
        makeDoneTicket({ assignedToId: 'emp1', createdById: 'emp2', estimatedMinutes: 60 }),
      );
      mockPrisma.ticket.update.mockImplementation(async ({ data }) => ({
        ...makeDoneTicket(), ...data,
      }));
      const user = { id: 'mgr1', role: { name: 'MANAGER' } };

      await service.updateStatus('tkt1', 'IN_PROGRESS' as any, 'mgr1', user);

      const written = mockPrisma.ticket.update.mock.calls[0][0].data;
      expect(written.executionDueAt).toBeInstanceOf(Date);
      expect(written.executionDueAt.getTime()).toBeGreaterThanOrEqual(before + 60 * 60_000);
    });
  });
});
