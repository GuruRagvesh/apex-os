import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { TicketsService } from '../../src/modules/operations/tickets/tickets.service';
import { TicketAccessService } from '../../src/common/services/ticket-access.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { TicketStatus } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('TicketsService — FP-13.2 Permissions', () => {
  let service: TicketsService;
  let access: TicketAccessService;
  let policy: AccessPolicyService;
  
  const mockPrisma = {
    ticket: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    managerDeptAccess: {
      findMany: jest.fn(),
    },
    activityLog: {
      create: jest.fn(),
      createMany: jest.fn(),
    },
    ticketHistory: {
      create: jest.fn(),
      createMany: jest.fn(),
    },
  };

  const mockEmail = { sendTicketResolved: jest.fn(), sendTicketAssigned: jest.fn() };
  const mockNotifications = { sendNotification: jest.fn() };
  const mockEventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;
  const mockGateway = { emitTicketStatusChanged: jest.fn() };
  const mockLogger = { log: jest.fn().mockResolvedValue(null) };
  const mockTiming = { handleTicketUpdate: jest.fn(), decorateTicket: jest.fn().mockImplementation((t) => t) };
  const mockUploads = {};

  beforeEach(() => {
    jest.clearAllMocks();
    policy = new AccessPolicyService(mockPrisma as any);
    access = new TicketAccessService(mockPrisma as any, policy);
    const mockConfig = { get: jest.fn().mockReturnValue('http://localhost') };
    
    service = new TicketsService(
      mockPrisma as any,
      mockGateway as any,
      mockEmail as any,
      mockNotifications as any,
      mockConfig as any,
      mockEventEmitter,
      mockLogger as any,
      access,
      mockTiming as any,
      { now: () => new Date(), companyTimezone: () => 'Asia/Kolkata', companyDayStart: () => new Date(), companyDayEnd: () => new Date(), elapsedSeconds: () => 0 } as any, { startReviewCycle: jest.fn(), endReviewCycle: jest.fn(), getTicketTimers: jest.fn() } as any,
    );
  });

  const makeUser = (role: string, id: string, deptId: string) => ({
    id, role: { name: role }, departmentId: deptId,
  });

  const emp1 = makeUser('EMPLOYEE', 'emp1', 'dept1');
  const tl1 = makeUser('TEAM_LEAD', 'tl1', 'dept1');
  const mgr1 = makeUser('MANAGER', 'mgr1', 'dept1');
  const admin1 = makeUser('ADMIN', 'admin1', 'dept1');

  const makeTicket = (overrides = {}) => ({
    id: 'tkt1',
    ticketId: 'TKT-1',
    status: TicketStatus.OPEN,
    departmentId: 'dept1',
    assignedToId: 'emp1',
    createdById: 'emp1',
    priority: 'MEDIUM',
    sla: 'P2',
    ...overrides,
  });

  describe('Employee Restrictions', () => {
    it('1. Employee cannot assign tickets', async () => {
      const t = makeTicket();
      mockPrisma.ticket.findFirst.mockResolvedValue(t);
      mockPrisma.ticket.findUnique.mockResolvedValue(t);
      mockPrisma.ticket.count.mockResolvedValue(1); // in scope
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'emp2', departmentId: 'dept1', isActive: true });

      await expect(service.assign('tkt1', 'emp2', 'emp1', emp1)).rejects.toThrow(ForbiddenException);
    });

    it('2. Employee cannot edit protected fields (priority, sla, departmentId)', async () => {
      const t = makeTicket();
      mockPrisma.ticket.findFirst.mockResolvedValue(t);
      mockPrisma.ticket.findUnique.mockResolvedValue(t);
      mockPrisma.ticket.count.mockResolvedValue(1);

      await expect(service.update('tkt1', { priority: 'HIGH' }, 'emp1', emp1)).rejects.toThrow(ForbiddenException);
      await expect(service.update('tkt1', { sla: 'P1' }, 'emp1', emp1)).rejects.toThrow(ForbiddenException);
      await expect(service.update('tkt1', { departmentId: 'dept2' }, 'emp1', emp1)).rejects.toThrow(ForbiddenException);
    });

    it('3. Employee cannot move unrelated tickets', async () => {
      const t = makeTicket({ assignedToId: 'emp2', createdById: 'emp2' });
      mockPrisma.ticket.findFirst.mockResolvedValue(t);
      mockPrisma.ticket.findUnique.mockResolvedValue(t);
      mockPrisma.ticket.count.mockResolvedValue(0); // OUT of scope

      await expect(service.updateStatus('tkt1', TicketStatus.IN_PROGRESS, 'emp1', emp1)).rejects.toThrow(ForbiddenException);
    });

    it('4. Employee cannot reopen DONE', async () => {
      const t = makeTicket({ status: TicketStatus.DONE });
      mockPrisma.ticket.findFirst.mockResolvedValue(t);
      mockPrisma.ticket.findUnique.mockResolvedValue(t);
      mockPrisma.ticket.count.mockResolvedValue(1);

      await expect(service.updateStatus('tkt1', TicketStatus.IN_PROGRESS, 'emp1', emp1)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Team Lead Restrictions', () => {
    it('5. TL can assign inside team (own department)', async () => {
      const t = makeTicket();
      mockPrisma.ticket.findFirst.mockResolvedValue(t);
      mockPrisma.ticket.findUnique.mockResolvedValue(t); // ADDED THIS
      mockPrisma.ticket.count.mockResolvedValue(1);
      // Assigning to emp2 in dept1 (same as TL)
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'emp2', departmentId: 'dept1', isActive: true });
      mockPrisma.ticket.update.mockResolvedValue({ ...t, assignedToId: 'emp2' });

      await expect(service.assign('tkt1', 'emp2', 'tl1', tl1)).resolves.toBeDefined();
    });

    it('6. TL cannot assign outside team (other department)', async () => {
      const t = makeTicket();
      mockPrisma.ticket.findFirst.mockResolvedValue(t);
      mockPrisma.ticket.findUnique.mockResolvedValue(t);
      mockPrisma.ticket.count.mockResolvedValue(1);
      // Assigning to emp3 in dept2
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'emp3', departmentId: 'dept2', isActive: true });

      await expect(service.assign('tkt1', 'emp3', 'tl1', tl1)).rejects.toThrow(ForbiddenException);
    });

    it('7. TL cannot override SLA or priority', async () => {
      const t = makeTicket();
      mockPrisma.ticket.findFirst.mockResolvedValue(t);
      mockPrisma.ticket.findUnique.mockResolvedValue(t);
      mockPrisma.ticket.count.mockResolvedValue(1);

      await expect(service.update('tkt1', { sla: 'P1' }, 'tl1', tl1)).rejects.toThrow(ForbiddenException);
      await expect(service.update('tkt1', { priority: 'HIGH' }, 'tl1', tl1)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Manager Restrictions', () => {
    it('8. Manager can assign inside department', async () => {
      const t = makeTicket();
      mockPrisma.ticket.findFirst.mockResolvedValue(t);
      mockPrisma.ticket.findUnique.mockResolvedValue(t); // ADDED THIS
      mockPrisma.ticket.count.mockResolvedValue(1);
      mockPrisma.managerDeptAccess.findMany.mockResolvedValue([{ departmentId: 'dept1' }]);
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'emp2', departmentId: 'dept1', isActive: true });
      mockPrisma.ticket.update.mockResolvedValue({ ...t, assignedToId: 'emp2' });

      await expect(service.assign('tkt1', 'emp2', 'mgr1', mgr1)).resolves.toBeDefined();
    });

    it('9. Manager cannot assign outside department', async () => {
      const t = makeTicket();
      mockPrisma.ticket.findFirst.mockResolvedValue(t);
      mockPrisma.ticket.findUnique.mockResolvedValue(t);
      mockPrisma.ticket.count.mockResolvedValue(1);
      mockPrisma.managerDeptAccess.findMany.mockResolvedValue([{ departmentId: 'dept1' }]);
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'emp3', departmentId: 'dept2', isActive: true });

      await expect(service.assign('tkt1', 'emp3', 'mgr1', mgr1)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Admin Access', () => {
    it('10. Admin can assign anywhere', async () => {
      const t = makeTicket();
      mockPrisma.ticket.findFirst.mockResolvedValue(t);
      mockPrisma.ticket.findUnique.mockResolvedValue(t); // ADDED THIS
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'emp3', departmentId: 'dept2', isActive: true });
      mockPrisma.ticket.update.mockResolvedValue({ ...t, assignedToId: 'emp3' });

      await expect(service.assign('tkt1', 'emp3', 'admin1', admin1)).resolves.toBeDefined();
    });
  });

  describe('Immutability & Terminal States', () => {
    it('11. Closed tickets remain immutable for everyone except admin maybe? No, closed is fully immutable here', async () => {
      const t = makeTicket({ status: TicketStatus.CLOSED });
      mockPrisma.ticket.findFirst.mockResolvedValue(t);
      mockPrisma.ticket.findUnique.mockResolvedValue(t); // ADDED THIS
      mockPrisma.ticket.count.mockResolvedValue(1);

      await expect(service.update('tkt1', { priority: 'HIGH' }, 'mgr1', mgr1)).rejects.toThrow(BadRequestException);
    });
  });
});
