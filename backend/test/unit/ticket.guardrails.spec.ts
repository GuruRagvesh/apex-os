import { TVAService } from '../../src/common/services/tva.service';
import { Test, TestingModule } from '@nestjs/testing';
import { TicketsService } from '../../src/modules/operations/tickets/tickets.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NotificationEventService } from '../../src/modules/operations/notifications/notification-event.service';
import { EventsGateway } from '../../src/modules/platform/gateway/events.gateway';
import { EmailService } from '../../src/modules/platform/email/email.service';
import { EventLoggerService } from '../../src/common/services/event-logger.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { TicketAccessService } from '../../src/common/services/ticket-access.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TicketStatus } from '@prisma/client';
import { TicketLedgerService } from '../../src/modules/operations/tickets/ticket-ledger.service';
import { TicketTimingService } from '../../src/common/services/ticket-timing.service';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

const mockPrisma = {
  ticket: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  ticketHistory: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  activityLog: { create: jest.fn() },
  user: { findUnique: jest.fn().mockResolvedValue({ currentStatus: 'WORKING' }) },
  appSetting: { findUnique: jest.fn().mockResolvedValue(null) },
  managerDeptAccess: { findMany: jest.fn().mockResolvedValue([]) },
  department: { findFirst: jest.fn().mockResolvedValue(null) },
};

const mockNotif = { create: jest.fn(), sendNotification: jest.fn() };
const mockGateway = { emitTicketStatusChanged: jest.fn() };
const mockEmail = { sendTicketAssigned: jest.fn(), sendTicketResolved: jest.fn() };
const mockLogger = { log: jest.fn().mockResolvedValue(undefined) };
const mockConfig = { get: jest.fn() };
const mockEventEmitter = { emit: jest.fn() };

function makeTicket(overrides: any = {}) {
  return {
    id: 'tkt1',
    ticketId: 'TKT-001',
    title: 'Test Ticket',
    status: 'OPEN',
    priority: 'MEDIUM',
    assignedToId: 'emp1',
    createdById: 'emp1',
    ...overrides,
  };
}

describe('TicketsService — FP-13.1A Guardrails', () => {
  let service: TicketsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPrisma.ticket.findFirst.mockResolvedValue(makeTicket());
    mockPrisma.ticket.findUnique.mockResolvedValue(makeTicket());
    mockPrisma.ticket.count.mockResolvedValue(1);
    mockPrisma.ticket.update.mockImplementation(async ({ data }) => ({
      ...makeTicket(), ...data,
    }));
    mockPrisma.user.findUnique.mockResolvedValue({ currentStatus: 'WORKING' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: TVAService, useValue: { now: () => new Date(), companyTimezone: () => 'Asia/Kolkata', companyNow: () => new Date(), companyDayStart: () => new Date(), formatZoned: () => 'mock', companyDayEnd: () => new Date(), elapsedSeconds: () => 0 } },
        TicketsService,
        AccessPolicyService,
        TicketAccessService,
        TicketTimingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationEventService, useValue: mockNotif },
        { provide: EventsGateway, useValue: mockGateway },
        { provide: EmailService, useValue: mockEmail },
        { provide: EventLoggerService, useValue: mockLogger },
        { provide: ConfigService, useValue: mockConfig },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: TicketLedgerService, useValue: { startReviewCycle: jest.fn(), endReviewCycle: jest.fn(), getTicketTimers: jest.fn(), startWorkLog: jest.fn(), endActiveLog: jest.fn(), getActiveLogForTicket: jest.fn() } },
      ],
    }).compile();

    service = module.get<TicketsService>(TicketsService);
  });

  const user = { id: 'emp1', role: { name: 'EMPLOYEE' } };
  const manager = { id: 'mgr1', role: { name: 'MANAGER' } };

  // CLOSED guards
  it('1. CLOSED → OPEN rejected', async () => {
    const t = makeTicket({ status: 'CLOSED' });
    mockPrisma.ticket.findFirst.mockResolvedValue(t);
    mockPrisma.ticket.findUnique.mockResolvedValue(t);
    await expect(service.updateStatus('tkt1', 'OPEN' as any, 'emp1', user)).rejects.toThrow(BadRequestException);
  });

  it('2. CLOSED → IN_PROGRESS rejected', async () => {
    const t = makeTicket({ status: 'CLOSED' });
    mockPrisma.ticket.findFirst.mockResolvedValue(t);
    mockPrisma.ticket.findUnique.mockResolvedValue(t);
    await expect(service.updateStatus('tkt1', 'IN_PROGRESS' as any, 'emp1', user)).rejects.toThrow(BadRequestException);
  });

  it('3. CLOSED → REVIEW rejected', async () => {
    const t = makeTicket({ status: 'CLOSED' });
    mockPrisma.ticket.findFirst.mockResolvedValue(t);
    mockPrisma.ticket.findUnique.mockResolvedValue(t);
    await expect(service.updateStatus('tkt1', 'REVIEW' as any, 'emp1', user)).rejects.toThrow(BadRequestException);
  });

  it('4. CLOSED → DONE rejected if already closed', async () => {
    const t = makeTicket({ status: 'CLOSED' });
    mockPrisma.ticket.findFirst.mockResolvedValue(t);
    mockPrisma.ticket.findUnique.mockResolvedValue(t);
    await expect(service.updateStatus('tkt1', 'DONE' as any, 'emp1', user)).rejects.toThrow(BadRequestException);
  });

  it('5. CLOSED ticket field edit rejected', async () => {
    const t = makeTicket({ status: 'CLOSED' });
    mockPrisma.ticket.findFirst.mockResolvedValue(t);
    mockPrisma.ticket.findUnique.mockResolvedValue(t);
    await expect(service.update('tkt1', { title: 'New Title' }, 'emp1', user)).rejects.toThrow(BadRequestException);
  });

  it('6. CLOSED reassignment rejected', async () => {
    const t = makeTicket({ status: 'CLOSED' });
    mockPrisma.ticket.findFirst.mockResolvedValue(t);
    mockPrisma.ticket.findUnique.mockResolvedValue(t);
    await expect(service.assign('tkt1', 'mgr1', 'mgr1', manager)).rejects.toThrow(BadRequestException);
  });

  // DONE guards
  it('7. DONE can still reopen if existing rule supports it (managers/admins)', async () => {
    const t = makeTicket({ status: 'DONE' });
    mockPrisma.ticket.findFirst.mockResolvedValue(t);
    mockPrisma.ticket.findUnique.mockResolvedValue(t);
    await expect(service.updateStatus('tkt1', 'IN_PROGRESS' as any, 'mgr1', manager)).resolves.toBeDefined();
  });

  it('8. DONE cannot be reassigned before reopen', async () => {
    const t = makeTicket({ status: 'DONE', assignedToId: 'emp1' });
    mockPrisma.ticket.findFirst.mockResolvedValue(t);
    mockPrisma.ticket.findUnique.mockResolvedValue(t);
    await expect(service.assign('tkt1', 'mgr1', 'mgr1', manager)).rejects.toThrow(BadRequestException);
  });

  // ON_BREAK guards
  it('9. ON_BREAK user cannot move own ticket to REVIEW', async () => {
    const t = makeTicket({ status: 'IN_PROGRESS' });
    mockPrisma.ticket.findFirst.mockResolvedValue(t);
    mockPrisma.ticket.findUnique.mockResolvedValue(t);
    mockPrisma.user.findUnique.mockResolvedValue({ currentStatus: 'ON_BREAK' });
    await expect(service.updateStatus('tkt1', 'REVIEW' as any, 'emp1', user)).rejects.toThrow('Resume work before submitting or completing a ticket.');
  });

  it('10. ON_BREAK user cannot move own ticket to DONE', async () => {
    const t = makeTicket({ status: 'IN_PROGRESS' });
    mockPrisma.ticket.findFirst.mockResolvedValue(t);
    mockPrisma.ticket.findUnique.mockResolvedValue(t);
    mockPrisma.user.findUnique.mockResolvedValue({ currentStatus: 'ON_BREAK' });
    await expect(service.updateStatus('tkt1', 'DONE' as any, 'emp1', user)).rejects.toThrow('Resume work before submitting or completing a ticket.');
  });

  it('11. WORKING user can still submit if permissions/status allow', async () => {
    mockPrisma.ticket.findFirst.mockResolvedValue(makeTicket({ status: 'IN_PROGRESS' }));
    mockPrisma.ticket.findUnique.mockResolvedValue(makeTicket({ status: 'IN_PROGRESS' }));
    mockPrisma.user.findUnique.mockResolvedValue({ currentStatus: 'WORKING' });
    await expect(service.updateStatus('tkt1', 'REVIEW' as any, 'emp1', user)).resolves.toBeDefined();
  });

  it('12. Manager/reviewer behavior is not broken for valid review actions', async () => {
    const t = makeTicket({ status: 'REVIEW', createdById: 'emp1', assignedToId: 'emp1' });
    mockPrisma.ticket.findFirst.mockResolvedValue(t);
    mockPrisma.ticket.findUnique.mockResolvedValue(t);
    mockPrisma.user.findUnique.mockResolvedValue({ currentStatus: 'WORKING' });
    await expect(service.approve('tkt1', { taskEfficiencyRating: 5, employeePerformanceRating: 4, employeeAttitudeRating: 5 }, 'mgr1', manager)).resolves.toBeDefined();
  });

  it('13. CLOSED ticket deletion rejected', async () => {
    const t = makeTicket({ status: 'CLOSED' });
    mockPrisma.ticket.findFirst.mockResolvedValue(t);
    mockPrisma.ticket.findUnique.mockResolvedValue(t);
    await expect(service.remove('tkt1', 'emp1', manager)).rejects.toThrow(BadRequestException);
  });
});
