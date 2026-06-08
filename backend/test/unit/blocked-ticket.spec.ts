import { TVAService } from '../../src/common/services/tva.service';
/**
 * Unit tests — Blocked Ticket Workflow
 *
 * Covers:
 *  - blockTicket()  — allowed / unauthorized / already-blocked / closed-ticket
 *  - unblockTicket() — allowed / not-blocked
 *  - TicketTimingService.getTimingState() — isBlocked=true suppresses overdue
 *  - getSlaRiskCategories() — blocked excluded from overdue, counted separately
 *  - getStats() — blocked count returned
 *  - findAll() — blocked=true filter applied
 *  - Event logging for TICKET_BLOCKED / TICKET_UNBLOCKED
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { TicketStatus } from '@prisma/client';
import { TicketsService } from '../../src/modules/operations/tickets/tickets.service';
import { TicketTimingService } from '../../src/common/services/ticket-timing.service';
import { TicketAccessService } from '../../src/common/services/ticket-access.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { TicketLedgerService } from '../../src/modules/operations/tickets/ticket-ledger.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NotificationEventService } from '../../src/modules/operations/notifications/notification-event.service';
import { EventsGateway } from '../../src/modules/platform/gateway/events.gateway';
import { EmailService } from '../../src/modules/platform/email/email.service';
import { EventLoggerService, OperationalAction } from '../../src/common/services/event-logger.service';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

// ── Mock Prisma ───────────────────────────────────────────────────────────────
const mockPrisma = {
  ticket: {
    findFirst:  jest.fn(),
    findUnique: jest.fn(),
    findMany:   jest.fn(),
    update:     jest.fn(),
    count:      jest.fn(),
    create:     jest.fn(),
    groupBy:    jest.fn(),
  },
  ticketHistory:  { create: jest.fn(), createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  ticketAssignee: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn(), create: jest.fn(), createMany: jest.fn() },
  notification:   { create: jest.fn() },
  activityLog:    { create: jest.fn() },
  appSetting:     { findUnique: jest.fn().mockResolvedValue(null) },
  comment:        { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
  department:     { findFirst: jest.fn().mockResolvedValue(null) },
  managerDeptAccess: { findMany: jest.fn().mockResolvedValue([]) },
  user:           { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn() },
};

const mockNotif    = { sendNotification: jest.fn().mockResolvedValue(undefined) };
const mockGateway  = { emitTicketCreated: jest.fn(), emitTicketStatusChanged: jest.fn(), emitNotificationToUser: jest.fn() };
const mockEmail    = { sendTicketAssigned: jest.fn(), sendTicketResolved: jest.fn() };
const mockLogger   = { log: jest.fn().mockResolvedValue(undefined) };
const mockConfig   = { get: jest.fn().mockReturnValue('http://localhost:3000') };
const mockEmitter  = { emit: jest.fn(), emitAsync: jest.fn() };

// ── Ticket fixture helpers ────────────────────────────────────────────────────
function makeActiveTicket(overrides: any = {}) {
  return {
    id: 'tkt1',
    ticketId: 'TKT-001',
    title: 'Test Ticket',
    status: TicketStatus.IN_PROGRESS,
    priority: 'MEDIUM',
    assignedToId: 'emp1',
    createdById:  'emp2',
    departmentId: 'dept1',
    projectId:    null,
    isBlocked:    false,
    blockedAt:    null,
    blockedReason: null,
    blockedById:  null,
    estimatedMinutes: null,
    actualStartAt:    null,
    executionDueAt:   null,
    submittedAt:      null,
    reviewStartedAt:  null,
    reviewDueAt:      null,
    assignees: [],
    assignedTo: { id: 'emp1', name: 'Alice', email: 'alice@test.com' },
    ...overrides,
  };
}

const SLA_CONFIG = {
  execution: { URGENT: 4, HIGH: 8, MEDIUM: 24, LOW: 72 },
  review:    { URGENT: 2, HIGH: 4, MEDIUM: 24, LOW: 48 },
};

// ─────────────────────────────────────────────────────────────────────────────
describe('Blocked Ticket — TicketTimingService', () => {
  let timing: TicketTimingService;
  beforeEach(() => {
    timing = new TicketTimingService(mockPrisma as any, { now: () => new Date(), companyTimezone: () => 'Asia/Kolkata', companyDayStart: () => new Date(), companyDayEnd: () => new Date(), elapsedSeconds: () => 0 } as any);
  });

  it('returns timerType=blocked and isOverdue=false when isBlocked=true', () => {
    const ticket = makeActiveTicket({
      isBlocked: true,
      blockedAt: new Date(Date.now() - 3_600_000), // blocked 1h ago
      executionDueAt: new Date(Date.now() - 7_200_000), // was overdue 2h ago
    });
    const state = timing.getTimingState(ticket, SLA_CONFIG);
    expect(state.timerType).toBe('blocked');
    expect(state.isOverdue).toBe(false);
    expect(state.displayColor).toBe('amber');
    expect(state.responsibleRole).toBeNull();
  });

  it('resumes normal execution timer when isBlocked=false', () => {
    const ticket = makeActiveTicket({
      status: TicketStatus.IN_PROGRESS,
      isBlocked: false,
      actualStartAt: new Date(Date.now() - 1_800_000),
      executionDueAt: new Date(Date.now() + 1_800_000), // due in 30 min
    });
    const state = timing.getTimingState(ticket, SLA_CONFIG);
    expect(state.timerType).toBe('execution');
    expect(state.isOverdue).toBe(false);
  });

  it('counts DONE ticket as completed regardless of isBlocked', () => {
    const ticket = makeActiveTicket({ status: TicketStatus.DONE, isBlocked: true });
    const state = timing.getTimingState(ticket, SLA_CONFIG);
    expect(state.timerType).toBe('completed');
    expect(state.isOverdue).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Blocked Ticket — TicketsService', () => {
  let service: TicketsService;
  let ticketAccess: TicketAccessService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default: ticket lookup succeeds
    mockPrisma.ticket.findFirst.mockResolvedValue(makeActiveTicket());
    mockPrisma.ticket.findUnique.mockResolvedValue(makeActiveTicket());
    mockPrisma.ticket.count.mockResolvedValue(1); // scope check passes
    mockPrisma.ticket.update.mockImplementation(async ({ data }) => ({
      ...makeActiveTicket(), ...data,
    }));
    mockPrisma.ticketHistory.create.mockResolvedValue({});
    mockPrisma.activityLog.create.mockResolvedValue({});
    mockPrisma.ticket.groupBy.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: TVAService, useValue: { now: () => new Date(), companyTimezone: () => 'Asia/Kolkata', companyNow: () => new Date(), companyDayStart: () => new Date(), formatZoned: () => 'mock', companyDayEnd: () => new Date(), elapsedSeconds: () => 0 } },
        TicketsService,
        AccessPolicyService,
        TicketAccessService,
        TicketTimingService,
        { provide: PrismaService,            useValue: mockPrisma   },
        { provide: NotificationEventService, useValue: mockNotif    },
        { provide: EventsGateway,            useValue: mockGateway  },
        { provide: EmailService,             useValue: mockEmail    },
        { provide: EventLoggerService,       useValue: mockLogger   },
        { provide: ConfigService,            useValue: mockConfig   },
        { provide: EventEmitter2,            useValue: mockEmitter  },
        { provide: TicketLedgerService,      useValue: { startReviewCycle: jest.fn(), endReviewCycle: jest.fn(), getTicketTimers: jest.fn() } },
      ],
    }).compile();

    service = module.get<TicketsService>(TicketsService);
    ticketAccess = module.get<TicketAccessService>(TicketAccessService);
  });

  // ── blockTicket ─────────────────────────────────────────────────────────────

  it('blocks an active ticket when called by assignee', async () => {
    const ticket = makeActiveTicket({ assignedToId: 'emp1', createdById: 'emp2' });
    mockPrisma.ticket.findFirst.mockResolvedValue(ticket);
    mockPrisma.ticket.update.mockResolvedValue({ ...ticket, isBlocked: true, blockedReason: 'waiting for API keys' });

    const user = { id: 'emp1', role: { name: 'EMPLOYEE' } };
    const result = await service.blockTicket('tkt1', 'waiting for API keys', 'emp1', user);

    expect(result.isBlocked).toBe(true);
    expect(mockPrisma.ticket.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isBlocked: true, blockedReason: 'waiting for API keys' }),
    }));
    expect(mockPrisma.activityLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'TICKET_BLOCKED' }),
    }));
    expect(mockLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      action: OperationalAction.TICKET_BLOCKED,
    }));
  });

  it('blocks a ticket when called by a scoped MANAGER', async () => {
    const ticket = makeActiveTicket({ departmentId: 'dept1' });
    mockPrisma.ticket.findFirst.mockResolvedValue(ticket);
    mockPrisma.ticket.count.mockResolvedValue(1); // scope check
    mockPrisma.ticket.update.mockResolvedValue({ ...ticket, isBlocked: true });

    const user = { id: 'mgr1', role: { name: 'MANAGER' }, departmentId: 'dept1' };
    const result = await service.blockTicket('tkt1', 'dependency on external team', 'mgr1', user);
    expect(result.isBlocked).toBe(true);
  });

  it('rejects blocking by INTERN', async () => {
    const user = { id: 'int1', role: { name: 'INTERN' } };
    const ticket = makeActiveTicket({ assignedToId: 'int1', createdById: 'int1' });
    mockPrisma.ticket.findFirst.mockResolvedValue(ticket);

    await expect(
      service.blockTicket('tkt1', 'some reason', 'int1', user),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects blocking by unrelated EMPLOYEE', async () => {
    const ticket = makeActiveTicket({ assignedToId: 'emp1', createdById: 'emp2' });
    mockPrisma.ticket.findFirst.mockResolvedValue(ticket);
    // count = 1 for scope, but participant check fails for emp99
    mockPrisma.ticket.count.mockResolvedValue(1);

    const user = { id: 'emp99', role: { name: 'EMPLOYEE' } };
    await expect(
      service.blockTicket('tkt1', 'some reason', 'emp99', user),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects blocking a DONE ticket', async () => {
    const ticket = makeActiveTicket({ status: TicketStatus.DONE });
    mockPrisma.ticket.findFirst.mockResolvedValue(ticket);
    jest.spyOn(ticketAccess, 'findAccessibleTicket').mockResolvedValueOnce(ticket as any);
    const user = { id: 'emp1', role: { name: 'EMPLOYEE' } };

    await expect(
      service.blockTicket('tkt1', 'reason', 'emp1', user),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects blocking a CLOSED ticket', async () => {
    const ticket = makeActiveTicket({ status: TicketStatus.CLOSED });
    mockPrisma.ticket.findFirst.mockResolvedValue(ticket);
    jest.spyOn(ticketAccess, 'findAccessibleTicket').mockResolvedValueOnce(ticket as any);
    const user = { id: 'emp1', role: { name: 'EMPLOYEE' } };

    await expect(
      service.blockTicket('tkt1', 'reason', 'emp1', user),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects blocking an already-blocked ticket', async () => {
    const ticket = makeActiveTicket({
      isBlocked: true,
      blockedAt: new Date(),
      blockedReason: 'waiting on client',
      blockedById: 'emp1'
    });
    mockPrisma.ticket.findFirst.mockResolvedValue(ticket);
    jest.spyOn(ticketAccess, 'findAccessibleTicket').mockResolvedValueOnce(ticket as any);
    const user = { id: 'emp1', role: { name: 'EMPLOYEE' } };

    await expect(
      service.blockTicket('tkt1', 'reason', 'emp1', user),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects blocking with empty reason', async () => {
    const ticket = makeActiveTicket();
    mockPrisma.ticket.findFirst.mockResolvedValue(ticket);
    const user = { id: 'emp1', role: { name: 'EMPLOYEE' } };

    await expect(
      service.blockTicket('tkt1', '', 'emp1', user),
    ).rejects.toThrow(BadRequestException);
  });

  it('emits gateway event when ticket is blocked', async () => {
    const ticket = makeActiveTicket({ assignedToId: 'emp1', createdById: 'emp1' });
    mockPrisma.ticket.findFirst.mockResolvedValue(ticket);
    mockPrisma.ticket.update.mockResolvedValue({ ...ticket, isBlocked: true });

    const user = { id: 'emp1', role: { name: 'EMPLOYEE' } };
    await service.blockTicket('tkt1', 'waiting for design', 'emp1', user);

    expect(mockGateway.emitTicketStatusChanged).toHaveBeenCalledWith('tkt1', 'BLOCKED', 'emp1');
  });

  // ── unblockTicket ───────────────────────────────────────────────────────────

  it('unblocks a blocked ticket when called by assignee', async () => {
    const ticket = makeActiveTicket({
      isBlocked: true,
      blockedAt: new Date(),
      blockedReason: 'waiting on client',
      blockedById: 'emp1',
      assignedToId: 'emp1',
      createdById: 'emp1'
    });
    mockPrisma.ticket.findFirst.mockResolvedValue(ticket);
    jest.spyOn(ticketAccess, 'findAccessibleTicket').mockResolvedValueOnce(ticket as any);
    mockPrisma.ticket.update.mockResolvedValue({ ...ticket, isBlocked: false, blockedReason: null, blockedAt: null });

    const user = { id: 'emp1', role: { name: 'EMPLOYEE' } };
    const result = await service.unblockTicket('tkt1', 'emp1', user);

    expect(result.isBlocked).toBe(false);
    expect(mockPrisma.activityLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'TICKET_UNBLOCKED' }),
    }));
    expect(mockLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      action: OperationalAction.TICKET_UNBLOCKED,
      fromState: 'BLOCKED',
    }));
  });

  it('rejects unblocking a non-blocked ticket', async () => {
    const ticket = makeActiveTicket({ isBlocked: false });
    mockPrisma.ticket.findFirst.mockResolvedValue(ticket);
    const user = { id: 'emp1', role: { name: 'EMPLOYEE' } };

    await expect(
      service.unblockTicket('tkt1', 'emp1', user),
    ).rejects.toThrow(BadRequestException);
  });

  it('emits gateway event when ticket is unblocked', async () => {
    const ticket = makeActiveTicket({
      isBlocked: true,
      blockedAt: new Date(),
      blockedReason: 'waiting on client',
      blockedById: 'emp1',
      assignedToId: 'emp1',
      createdById: 'emp1',
      status: TicketStatus.IN_PROGRESS
    });
    mockPrisma.ticket.findFirst.mockResolvedValue(ticket);
    jest.spyOn(ticketAccess, 'findAccessibleTicket').mockResolvedValueOnce(ticket as any);
    mockPrisma.ticket.update.mockResolvedValue({ ...ticket, isBlocked: false });

    const user = { id: 'emp1', role: { name: 'EMPLOYEE' } };
    await service.unblockTicket('tkt1', 'emp1', user);

    expect(mockGateway.emitTicketStatusChanged).toHaveBeenCalledWith('tkt1', TicketStatus.IN_PROGRESS, 'emp1');
  });

  // ── getSlaRiskCategories ────────────────────────────────────────────────────

  it('getSlaRiskCategories excludes blocked tickets from overdue count', async () => {
    const past = new Date(Date.now() - 99_999_999);
    const future = new Date(Date.now() + 99_999_999);

    mockPrisma.ticket.findMany.mockResolvedValue([
      // overdue (not blocked)
      makeActiveTicket({ id: 't1', isBlocked: false, actualStartAt: past, executionDueAt: past }),
      // blocked (should NOT count as overdue)
      makeActiveTicket({ id: 't2', isBlocked: true, blockedAt: past, actualStartAt: past, executionDueAt: past }),
      // normal (not overdue)
      makeActiveTicket({ id: 't3', isBlocked: false, actualStartAt: past, executionDueAt: future }),
    ]);
    mockPrisma.ticket.count.mockResolvedValue(0); // unassigned = 0

    const result = await service.getSlaRiskCategories();
    expect(result.overdue).toBe(1);  // only t1
    expect(result.blocked).toBe(1);  // t2
    expect(result.total).toBe(3);
  });

  // ── getStats ────────────────────────────────────────────────────────────────

  it('getStats includes blocked count', async () => {
    mockPrisma.ticket.count
      .mockResolvedValueOnce(10)   // total
      .mockResolvedValueOnce(0)    // unassigned
      .mockResolvedValueOnce(2);   // blocked
    mockPrisma.ticket.groupBy.mockResolvedValue([]);
    mockPrisma.ticket.findMany.mockResolvedValue([]);

    const result = await service.getStats();
    expect(result).toHaveProperty('blocked', 2);
  });

  // ── findAll with blocked filter ─────────────────────────────────────────────

  it('findAll with blocked=true applies isBlocked:true to where clause', async () => {
    mockPrisma.ticket.findMany.mockResolvedValue([]);
    mockPrisma.ticket.count.mockResolvedValue(0);

    await service.findAll({ blocked: 'true' });

    const call = mockPrisma.ticket.findMany.mock.calls[0]?.[0];
    expect(call?.where?.isBlocked).toBe(true);
  });
});
