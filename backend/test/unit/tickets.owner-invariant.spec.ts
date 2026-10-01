import { ForbiddenException } from '@nestjs/common';
import { TicketStatus } from '@prisma/client';
import { TicketsService, PRIMARY_ASSIGNEE_REQUIRED } from '../../src/modules/operations/tickets/tickets.service';

// Phase 3 review corrections: authorization is decided before the
// primary-owner business rule (403 before 400), and the owner rule is checked
// for every transition into IN_PROGRESS, not only from OPEN.
describe('TicketsService — primary-owner invariant ordering', () => {
  const ownerless = (status: TicketStatus) => ({
    id: 't1', ticketId: 'TKT-001', title: 'x', status, priority: 'MEDIUM',
    assignedToId: null, createdById: 'creator', assignees: [{ userId: 'helper' }],
    estimatedMinutes: 60, actualStartAt: null, executionDueAt: null, submittedAt: null,
    scheduledStartAt: null, actualCompletedAt: null, closedAt: null, resolvedAt: null,
  });

  function makeService(ticket: any, canTransition: boolean) {
    const prisma: any = {
      user: { findUnique: jest.fn().mockResolvedValue({ currentStatus: 'WORKING' }) },
      reviewCycleLog: { findFirst: jest.fn().mockResolvedValue(null) },
      ticket: { update: jest.fn() },
      $queryRaw: jest.fn(async () => [{ status: ticket.status, assignedToId: ticket.assignedToId }]),
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    const ticketAccess = {
      findAccessibleTicket: jest.fn().mockResolvedValue(ticket),
      assertCanAssignTicket: jest.fn().mockResolvedValue(undefined),
      assertCanUpdateTicket: jest.fn().mockResolvedValue(undefined),
      assertCanTransitionTicket: jest.fn(async () => {
        if (!canTransition) throw new ForbiddenException('You do not have permission to change this ticket status');
      }),
    };
    const service = new TicketsService(
      prisma, {} as any, {} as any, { get: jest.fn() } as any, { emit: jest.fn() } as any,
      { log: jest.fn() } as any, ticketAccess as any, {} as any,
      { getSlaConfig: async () => ({ review: { MEDIUM: 24 } }) } as any,
      {} as any, {} as any, {} as any, { now: () => new Date() } as any,
    );
    return { service, prisma, ticketAccess };
  }

  const user = { id: 'stranger', role: { name: 'EMPLOYEE' } };

  it('an unauthorized move of an ownerless ticket to IN_PROGRESS is 403, not the business-rule 400', async () => {
    const { service, prisma } = makeService(ownerless(TicketStatus.OPEN), false);
    await expect(service.update('t1', { status: TicketStatus.IN_PROGRESS }, 'stranger', user)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it.each([TicketStatus.OPEN, TicketStatus.REVIEW, TicketStatus.DONE])(
    'authorized: %s → IN_PROGRESS without a primary owner is the 400 PRIMARY_ASSIGNEE_REQUIRED (secondary assignee present)',
    async (from) => {
      const { service, prisma, ticketAccess } = makeService(ownerless(from), true);
      await expect(service.update('t1', { status: TicketStatus.IN_PROGRESS }, 'mgr', user)).rejects.toMatchObject({
        response: { statusCode: 400, code: PRIMARY_ASSIGNEE_REQUIRED },
      });
      expect(ticketAccess.assertCanTransitionTicket).toHaveBeenCalled(); // authorization ran first
      expect(prisma.ticket.update).not.toHaveBeenCalled();
    },
  );

  it('removing the owner of an IN_PROGRESS ticket through a plain update is refused', async () => {
    const ticket = { ...ownerless(TicketStatus.IN_PROGRESS), assignedToId: 'worker' };
    const { service, prisma } = makeService(ticket, true);
    await expect(service.update('t1', { assignedToId: null }, 'mgr', user)).rejects.toMatchObject({
      response: { code: PRIMARY_ASSIGNEE_REQUIRED },
    });
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('an unrelated edit to a legacy ownerless IN_PROGRESS ticket is not blocked by the rule', async () => {
    const ticket = ownerless(TicketStatus.IN_PROGRESS);
    const { service, prisma } = makeService(ticket, true);
    prisma.ticket.update.mockResolvedValue({ ...ticket, title: 'renamed' });
    prisma.ticketHistory = { createMany: jest.fn() };
    prisma.activityLog = { create: jest.fn() };
    (service as any).addSla = async (t: any) => t;
    await expect(service.update('t1', { title: 'renamed' }, 'mgr', user)).resolves.toMatchObject({ title: 'renamed' });
  });
});
