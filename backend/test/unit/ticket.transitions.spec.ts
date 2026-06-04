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
  comment: { findMany: jest.fn().mockResolvedValue([]) },
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

  it('blocks INTERN from moving ticket to REVIEW', async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ assignedToId: 'int1', createdById: 'int1', status: 'IN_PROGRESS' }),
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
});
