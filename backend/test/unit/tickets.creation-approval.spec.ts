import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TicketStatus } from '@prisma/client';
import { TicketsService } from '../../src/modules/operations/tickets/tickets.service';
import { HierarchyApprovalService } from '../../src/common/services/hierarchy-approval.service';
import { EventLoggerService } from '../../src/common/services/event-logger.service';

describe('B2 Ticket Creation Approval', () => {
  let ticketsService: any;
  let prisma: any;
  let hierarchyApprovalService: any;
  let eventLoggerService: any;
  let notificationEventService: any;

  beforeEach(() => {
    prisma = {
      ticket: {
        create: jest.fn(async (args) => ({ id: 't1', ...args.data, ticketId: 'TKT-123' })),
        update: jest.fn(async (args) => ({ id: 't1', ...args.data, ticketId: 'TKT-123' })),
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ max: 122 }]),
      activityLog: {
        create: jest.fn(),
      },
      ticketAssignee: {
        createMany: jest.fn(),
      },
      department: {
        findFirst: jest.fn().mockResolvedValue({ id: 'd1', name: 'Dept 1' }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'emp1' }),
      },
    };

    hierarchyApprovalService = {
      resolveTaskCreationApprover: jest.fn(),
    };

    eventLoggerService = {
      log: jest.fn().mockReturnValue({ catch: jest.fn() }),
    };

    notificationEventService = {
      sendNotification: jest.fn().mockResolvedValue(null),
    };

    ticketsService = new TicketsService(
      prisma,
      { emitTicketCreated: jest.fn() } as any, // gateway
      notificationEventService,
      { get: jest.fn() } as any, // configService
      { emit: jest.fn() } as any, // eventEmitter
      eventLoggerService,
      { isSelfAssigned: jest.fn().mockReturnValue(true) } as any, // ticketAccess
      hierarchyApprovalService,
      { decorateTicket: jest.fn(t => Promise.resolve(t)) } as any, // ticketTiming
      {} as any, // ticketLedger
      {} as any, // ticketImport
    );
  });

  const empUser = { id: 'emp1', role: { name: 'EMPLOYEE' } };
  const internUser = { id: 'intern1', role: { name: 'INTERN' } };
  const tlUser = { id: 'tl1', role: { name: 'TEAM_LEAD' } };
  const mgrUser = { id: 'mgr1', role: { name: 'MANAGER' } };

  it('Employee creates TASK -> status PENDING_APPROVAL, approvalState PENDING, approvalType TASK_CREATION, approverId active TL', async () => {
    hierarchyApprovalService.resolveTaskCreationApprover.mockResolvedValue({ id: 'tl1', tier: 'TEAM_LEAD' });
    const result = await ticketsService.create({ title: 'Test', type: 'TASK' }, empUser.id, empUser);
    
    expect(result.status).toBe(TicketStatus.PENDING_APPROVAL);
    expect(result.approvalState).toBe('PENDING');
    expect(result.approvalType).toBe('TASK_CREATION');
    expect(result.approverId).toBe('tl1');
  });

  it('Intern creates TASK -> same pending approval behavior', async () => {
    hierarchyApprovalService.resolveTaskCreationApprover.mockResolvedValue({ id: 'tl1', tier: 'TEAM_LEAD' });
    const result = await ticketsService.create({ title: 'Test', type: 'TASK' }, internUser.id, internUser);
    
    expect(result.status).toBe(TicketStatus.PENDING_APPROVAL);
    expect(result.approvalState).toBe('PENDING');
  });

  it('Employee creates TASK with no active TL -> BadRequestException and no ticket created', async () => {
    hierarchyApprovalService.resolveTaskCreationApprover.mockResolvedValue(null);
    await expect(ticketsService.create({ title: 'Test', type: 'TASK' }, empUser.id, empUser))
      .rejects.toThrow(BadRequestException);
    expect(prisma.ticket.create).not.toHaveBeenCalled();
  });

  it('Team Lead creates TASK -> existing OPEN behavior unchanged', async () => {
    // defaults to OPEN as prisma doesn't get status in data
    const result = await ticketsService.create({ title: 'Test', type: 'TASK' }, tlUser.id, tlUser);
    expect(result.status).toBeUndefined(); // undefined means it defaults to OPEN in Prisma
  });

  it('Manager/Admin creates TASK -> existing OPEN behavior unchanged', async () => {
    const result = await ticketsService.create({ title: 'Test', type: 'TASK' }, mgrUser.id, mgrUser);
    expect(result.status).toBeUndefined();
  });

  it('Employee creates QUERY -> existing behavior unchanged', async () => {
    const result = await ticketsService.create({ title: 'Test', type: 'QUERY' }, empUser.id, empUser);
    expect(result.status).toBeUndefined();
  });

  it('Employee creates HELP -> existing behavior unchanged', async () => {
    const result = await ticketsService.create({ title: 'Test', type: 'HELP' }, empUser.id, empUser);
    expect(result.status).toBeUndefined();
  });

  describe('Pending Task Approvals processing', () => {
    beforeEach(() => {
      prisma.ticket.findFirst.mockResolvedValue({
        id: 't1',
        ticketId: 'TKT-123',
        status: TicketStatus.PENDING_APPROVAL,
        approvalState: 'PENDING',
        approvalType: 'TASK_CREATION',
        approverId: 'tl1',
        createdById: 'emp1',
      });
    });

    it('Pending task approver approves -> status OPEN, approvalState APPROVED, approvedAt set', async () => {
      const result = await ticketsService.processApproval('t1', { action: 'APPROVE' }, { id: 'tl1' });
      expect(result.status).toBe(TicketStatus.OPEN);
      expect(result.approvalState).toBe('APPROVED');
      expect(result.approvedAt).toBeDefined();
    });

    it('Pending task approver rejects with reason -> status CLOSED, approvalState REJECTED, rejectedAt set, approvalReason saved', async () => {
      const result = await ticketsService.processApproval('t1', { action: 'REJECT', reason: 'Not needed' }, { id: 'tl1' });
      expect(result.status).toBe(TicketStatus.CLOSED);
      expect(result.approvalState).toBe('REJECTED');
      expect(result.rejectedAt).toBeDefined();
      expect(result.approvalReason).toBe('Not needed');
    });

    it('Reject without reason -> BadRequestException', async () => {
      await expect(ticketsService.processApproval('t1', { action: 'REJECT' }, { id: 'tl1' }))
        .rejects.toThrow(BadRequestException);
    });

    it('Non-approver attempts approval -> ForbiddenException', async () => {
      await expect(ticketsService.processApproval('t1', { action: 'APPROVE' }, { id: 'otherUser' }))
        .rejects.toThrow(ForbiddenException);
    });

    it('Invalid approval action -> BadRequestException', async () => {
      await expect(ticketsService.processApproval('t1', { action: 'INVALID' }, { id: 'tl1' }))
        .rejects.toThrow(BadRequestException);
    });
  });
});
