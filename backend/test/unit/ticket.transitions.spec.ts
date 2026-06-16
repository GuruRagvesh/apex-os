import { TVAService } from '../../src/common/services/tva.service';
/**
 * Unit tests — Ticket status transition rules
 *
 * Verifies that role-based transition guards (INTERN, non-manager REVIEW→DONE)
 * are enforced by TicketsService.update.  Prisma is mocked.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { TicketsService } from '../../src/modules/operations/tickets/tickets.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NotificationEventService } from '../../src/modules/operations/notifications/notification-event.service';
import { EventsGateway } from '../../src/modules/platform/gateway/events.gateway';
import { EmailService } from '../../src/modules/platform/email/email.service';
import { EventLoggerService } from '../../src/common/services/event-logger.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { TicketAccessService } from '../../src/common/services/ticket-access.service';
import { TicketTimingService } from '../../src/common/services/ticket-timing.service';
import { TicketLedgerService } from '../../src/modules/operations/tickets/ticket-ledger.service';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ForbiddenException } from '@nestjs/common';

const mockPrisma = {
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
        AccessPolicyService,
        TicketAccessService,
        TicketTimingService,
        { provide: PrismaService,         useValue: mockPrisma       },
        { provide: NotificationEventService,  useValue: mockNotif        },
        { provide: EventsGateway,         useValue: mockGateway      },
        { provide: EmailService,          useValue: mockEmail        },
        { provide: EventLoggerService,    useValue: mockLogger       },
        { provide: ConfigService,         useValue: mockConfig       },
        { provide: EventEmitter2,         useValue: mockEventEmitter },
        { provide: TicketLedgerService,   useValue: { startReviewCycle: jest.fn(), endReviewCycle: jest.fn(), getTicketTimers: jest.fn(), startWorkLog: jest.fn(), endActiveLog: jest.fn(), getActiveLogForTicket: jest.fn() } },
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

  it('allows MANAGER to approve REVIEW → DONE', async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ assignedToId: 'emp1', createdById: 'emp2', status: 'REVIEW' }),
    );
    mockPrisma.ticket.update.mockResolvedValue(makeTicket({ status: 'DONE' }));
    const user = { id: 'mgr1', role: { name: 'MANAGER' } };

    await expect(
      service.updateStatus('tkt1', 'DONE' as any, 'mgr1', user),
    ).resolves.toBeDefined();
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

    it('does not crash and sends no notification when assignedToId is null', async () => {
      const unassigned = makeTicket({ status: 'REVIEW', assignedToId: null, createdById: 'creator1' });
      mockPrisma.ticket.findFirst.mockResolvedValue(unassigned);
      mockPrisma.ticket.findUnique.mockResolvedValue(unassigned);
      mockPrisma.ticket.update.mockResolvedValue({ ...unassigned, status: 'IN_PROGRESS', assignedTo: null });

      await expect(service.reject('tkt1', 'Needs rework', 'mgr1')).resolves.toBeDefined();
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
