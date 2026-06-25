/**
 * Unit tests — Ticket Unassign (primary + secondary)
 *
 * Covers:
 *  - unassignPrimary()         — OPEN (stays open) / IN_PROGRESS (falls back to OPEN +
 *                                 pauses ledger timer) / REVIEW & DONE & CLOSED (blocked)
 *  - removeSecondaryAssignee() — happy path / DONE/CLOSED/REVIEW blocked / not-found /
 *                                 primary-via-secondary-route blocked
 *  - Permission checks for both (admin / scoped manager / unrelated creator)
 *  - TicketHistory + ActivityLog + OperationalEvent entries
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
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
import { TVAService } from '../../src/common/services/tva.service';

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
  ticketHistory:  { create: jest.fn().mockResolvedValue({}), createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  ticketAssignee: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn(), delete: jest.fn(), create: jest.fn(), createMany: jest.fn() },
  notification:   { create: jest.fn() },
  activityLog:    { create: jest.fn().mockResolvedValue({}) },
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
const mockLedger   = { startReviewCycle: jest.fn(), endReviewCycle: jest.fn(), endActiveLog: jest.fn().mockResolvedValue({}) };

function makeTicket(overrides: any = {}) {
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
    assignees: [],
    assignedTo: { id: 'emp1', name: 'Alice', email: 'alice@test.com' },
    ...overrides,
  };
}

describe('TicketsService — unassignPrimary / removeSecondaryAssignee', () => {
  let service: TicketsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPrisma.ticket.findFirst.mockResolvedValue({ id: 'tkt1' });
    mockPrisma.ticket.count.mockResolvedValue(1); // scope checks pass by default
    mockPrisma.ticket.findUnique.mockImplementation(async () => makeTicket());
    mockPrisma.ticket.update.mockImplementation(async ({ data }: any) => ({ ...makeTicket(), ...data }));
    mockLedger.endActiveLog.mockResolvedValue({});

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
        { provide: TicketLedgerService,      useValue: mockLedger   },
      ],
    }).compile();

    service = module.get<TicketsService>(TicketsService);
  });

  // ── unassignPrimary ───────────────────────────────────────────────────────

  describe('unassignPrimary', () => {
    it('unassigns and keeps OPEN tickets OPEN', async () => {
      const ticket = makeTicket({ status: TicketStatus.OPEN });
      mockPrisma.ticket.findUnique.mockResolvedValue(ticket);
      mockPrisma.ticket.update.mockResolvedValue({ ...ticket, assignedToId: null });

      const user = { id: 'admin1', role: { name: 'ADMIN' } };
      const result = await service.unassignPrimary('tkt1', 'admin1', user);

      expect(result.assignedToId).toBeNull();
      expect(mockPrisma.ticket.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { assignedToId: null },
      }));
      expect(mockPrisma.ticketHistory.createMany).toHaveBeenCalledWith({
        data: [{ ticketId: 'tkt1', field: 'assignedToId', oldValue: 'emp1', newValue: null, changedById: 'admin1' }],
      });
      expect(mockLogger.log).toHaveBeenCalledWith(expect.objectContaining({
        action: OperationalAction.TICKET_UNASSIGNED,
      }));
    });

    it('moves IN_PROGRESS ticket back to OPEN and pauses the assignee timer', async () => {
      const ticket = makeTicket({ status: TicketStatus.IN_PROGRESS, assignedToId: 'emp1' });
      mockPrisma.ticket.findUnique.mockResolvedValue(ticket);
      mockPrisma.ticket.update.mockResolvedValue({ ...ticket, assignedToId: null, status: TicketStatus.OPEN });

      const user = { id: 'admin1', role: { name: 'ADMIN' } };
      const result = await service.unassignPrimary('tkt1', 'admin1', user);

      expect(result.assignedToId).toBeNull();
      expect(result.status).toBe(TicketStatus.OPEN);
      expect(mockPrisma.ticket.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { assignedToId: null, status: TicketStatus.OPEN },
      }));
      expect(mockPrisma.ticketHistory.createMany).toHaveBeenCalledWith({
        data: [
          { ticketId: 'tkt1', field: 'assignedToId', oldValue: 'emp1', newValue: null, changedById: 'admin1' },
          { ticketId: 'tkt1', field: 'status', oldValue: TicketStatus.IN_PROGRESS, newValue: TicketStatus.OPEN, changedById: 'admin1' },
        ],
      });
      expect(mockLedger.endActiveLog).toHaveBeenCalledWith({
        ticketId: 'tkt1', userId: 'emp1', pauseReason: 'UNASSIGNED',
      });
    });

    it('never calls ticket.update if status is REVIEW — blocks with the required message', async () => {
      const ticket = makeTicket({ status: TicketStatus.REVIEW });
      mockPrisma.ticket.findUnique.mockResolvedValue(ticket);
      const user = { id: 'admin1', role: { name: 'ADMIN' } };

      await expect(service.unassignPrimary('tkt1', 'admin1', user))
        .rejects.toThrow('Move ticket back to In Progress/Open before unassigning.');
      expect(mockPrisma.ticket.update).not.toHaveBeenCalled();
    });

    it.each([TicketStatus.DONE, TicketStatus.CLOSED])('blocks unassign when ticket is %s', async (status) => {
      const ticket = makeTicket({ status });
      mockPrisma.ticket.findUnique.mockResolvedValue(ticket);
      const user = { id: 'admin1', role: { name: 'ADMIN' } };

      await expect(service.unassignPrimary('tkt1', 'admin1', user)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.ticket.update).not.toHaveBeenCalled();
    });

    it('throws if the ticket already has no primary assignee', async () => {
      const ticket = makeTicket({ assignedToId: null, assignedTo: null });
      mockPrisma.ticket.findUnique.mockResolvedValue(ticket);
      const user = { id: 'admin1', role: { name: 'ADMIN' } };

      await expect(service.unassignPrimary('tkt1', 'admin1', user)).rejects.toThrow(BadRequestException);
    });

    it('allows a scoped MANAGER to unassign', async () => {
      const ticket = makeTicket({ status: TicketStatus.OPEN, departmentId: 'dept1' });
      mockPrisma.ticket.findUnique.mockResolvedValue(ticket);
      mockPrisma.ticket.update.mockResolvedValue({ ...ticket, assignedToId: null });
      mockPrisma.ticket.count.mockResolvedValue(1);

      const user = { id: 'mgr1', role: { name: 'MANAGER' }, departmentId: 'dept1' };
      const result = await service.unassignPrimary('tkt1', 'mgr1', user);
      expect(result.assignedToId).toBeNull();
    });

    it('blocks an out-of-scope MANAGER', async () => {
      const ticket = makeTicket({ status: TicketStatus.OPEN, departmentId: 'dept-other' });
      mockPrisma.ticket.findUnique.mockResolvedValue(ticket);
      mockPrisma.ticket.count.mockResolvedValue(0);

      const user = { id: 'mgr1', role: { name: 'MANAGER' }, departmentId: 'dept1' };
      await expect(service.unassignPrimary('tkt1', 'mgr1', user)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.ticket.update).not.toHaveBeenCalled();
    });

    it('blocks the ticket creator (current rules do not grant creators assign rights)', async () => {
      const ticket = makeTicket({ status: TicketStatus.OPEN, createdById: 'creator1', assignedToId: 'emp1' });
      mockPrisma.ticket.findUnique.mockResolvedValue(ticket);
      mockPrisma.ticket.count.mockResolvedValue(1); // creator CAN view the ticket

      const user = { id: 'creator1', role: { name: 'EMPLOYEE' } };
      await expect(service.unassignPrimary('tkt1', 'creator1', user))
        .rejects.toThrow('You do not have permission to assign this ticket');
      expect(mockPrisma.ticket.update).not.toHaveBeenCalled();
    });

    it('blocks an unrelated employee outright', async () => {
      const ticket = makeTicket({ status: TicketStatus.OPEN, assignedToId: 'emp1', createdById: 'emp2', departmentId: 'dept1' });
      mockPrisma.ticket.findUnique.mockResolvedValue(ticket);
      mockPrisma.ticket.count.mockResolvedValue(0); // not even in view-scope

      const user = { id: 'emp99', role: { name: 'EMPLOYEE' }, departmentId: 'dept-other' };
      await expect(service.unassignPrimary('tkt1', 'emp99', user)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.ticket.update).not.toHaveBeenCalled();
    });
  });

  // ── removeSecondaryAssignee ───────────────────────────────────────────────

  describe('removeSecondaryAssignee', () => {
    function ticketWithAssignees(overrides: any = {}) {
      return makeTicket({
        assignees: [
          { id: 'ta1', ticketId: 'tkt1', userId: 'emp1', user: { id: 'emp1', name: 'Alice' } },
          { id: 'ta2', ticketId: 'tkt1', userId: 'emp3', user: { id: 'emp3', name: 'Shubendu' } },
        ],
        ...overrides,
      });
    }

    it('removes a secondary assignee without touching status', async () => {
      const ticket = ticketWithAssignees({ status: TicketStatus.IN_PROGRESS });
      mockPrisma.ticket.findUnique.mockResolvedValue(ticket);

      const user = { id: 'admin1', role: { name: 'ADMIN' } };
      const result = await service.removeSecondaryAssignee('tkt1', 'emp3', 'admin1', user);

      expect(mockPrisma.ticketAssignee.delete).toHaveBeenCalledWith({ where: { id: 'ta2' } });
      expect(mockPrisma.ticket.update).not.toHaveBeenCalled();
      expect(mockPrisma.ticketHistory.create).toHaveBeenCalledWith({
        data: { ticketId: 'tkt1', field: 'secondaryAssignee', oldValue: 'emp3', newValue: null, changedById: 'admin1' },
      });
      expect(mockPrisma.activityLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ action: 'TICKET_ASSIGNEE_REMOVED' }),
      }));
      expect(mockLogger.log).toHaveBeenCalledWith(expect.objectContaining({
        action: OperationalAction.TICKET_ASSIGNEE_REMOVED,
      }));
      expect(result.status).toBe(TicketStatus.IN_PROGRESS);
    });

    it.each([TicketStatus.DONE, TicketStatus.CLOSED])('blocks removal when ticket is %s', async (status) => {
      const ticket = ticketWithAssignees({ status });
      mockPrisma.ticket.findUnique.mockResolvedValue(ticket);
      const user = { id: 'admin1', role: { name: 'ADMIN' } };

      await expect(service.removeSecondaryAssignee('tkt1', 'emp3', 'admin1', user)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.ticketAssignee.delete).not.toHaveBeenCalled();
    });

    it('blocks removal during REVIEW with the required message', async () => {
      const ticket = ticketWithAssignees({ status: TicketStatus.REVIEW });
      mockPrisma.ticket.findUnique.mockResolvedValue(ticket);
      const user = { id: 'admin1', role: { name: 'ADMIN' } };

      await expect(service.removeSecondaryAssignee('tkt1', 'emp3', 'admin1', user))
        .rejects.toThrow('Move ticket back to In Progress/Open before unassigning.');
    });

    it('throws NotFoundException if the user is not assigned to the ticket', async () => {
      const ticket = ticketWithAssignees({ status: TicketStatus.OPEN });
      mockPrisma.ticket.findUnique.mockResolvedValue(ticket);
      const user = { id: 'admin1', role: { name: 'ADMIN' } };

      await expect(service.removeSecondaryAssignee('tkt1', 'no-such-user', 'admin1', user)).rejects.toThrow(NotFoundException);
    });

    it('rejects removing the primary assignee through the secondary route', async () => {
      const ticket = ticketWithAssignees({ status: TicketStatus.OPEN, assignedToId: 'emp1' });
      mockPrisma.ticket.findUnique.mockResolvedValue(ticket);
      const user = { id: 'admin1', role: { name: 'ADMIN' } };

      await expect(service.removeSecondaryAssignee('tkt1', 'emp1', 'admin1', user)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.ticketAssignee.delete).not.toHaveBeenCalled();
    });

    it('blocks an unrelated employee from removing a collaborator', async () => {
      const ticket = ticketWithAssignees({ status: TicketStatus.OPEN, assignedToId: 'emp1', createdById: 'emp2', departmentId: 'dept1' });
      mockPrisma.ticket.findUnique.mockResolvedValue(ticket);
      mockPrisma.ticket.count.mockResolvedValue(0);

      const user = { id: 'emp99', role: { name: 'EMPLOYEE' }, departmentId: 'dept-other' };
      await expect(service.removeSecondaryAssignee('tkt1', 'emp3', 'emp99', user)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.ticketAssignee.delete).not.toHaveBeenCalled();
    });
  });
});
