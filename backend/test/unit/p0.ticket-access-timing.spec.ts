import { ForbiddenException } from '@nestjs/common';
import { TicketStatus } from '@prisma/client';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { TicketAccessService } from '../../src/common/services/ticket-access.service';
import { TicketTimingService } from '../../src/common/services/ticket-timing.service';

const prisma: any = {
  ticket: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
  },
  department: { findFirst: jest.fn() },
  managerDeptAccess: { findMany: jest.fn().mockResolvedValue([]) },
  appSetting: { findUnique: jest.fn() },
};

describe('P0 Ticket access and timing', () => {
  let accessPolicy: AccessPolicyService;
  let ticketAccess: TicketAccessService;
  let timing: TicketTimingService;

  beforeEach(() => {
    jest.clearAllMocks();
    accessPolicy = new AccessPolicyService(prisma);
    ticketAccess = new TicketAccessService(prisma, accessPolicy);
    timing = new TicketTimingService(prisma);
  });

  it('returns 403 when a direct ticket ID exists but is outside user scope', async () => {
    prisma.ticket.findFirst.mockResolvedValue({ id: 'ticket1' });
    prisma.ticket.count.mockResolvedValue(0);

    await expect(
      ticketAccess.findAccessibleTicket('ticket1', { id: 'emp2', role: { name: 'EMPLOYEE' } }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('does not mark a new OPEN ticket overdue when it has no timing basis', () => {
    const state = timing.getTimingState({
      status: TicketStatus.OPEN,
      priority: 'HIGH',
      createdAt: new Date(),
      dueDate: null,
      scheduledStartAt: null,
      estimatedMinutes: null,
    }, { execution: { URGENT: 4, HIGH: 8, MEDIUM: 24, LOW: 72 }, review: { URGENT: 2, HIGH: 4, MEDIUM: 24, LOW: 48 } });

    expect(state.timerType).toBe('none');
    expect(state.isOverdue).toBe(false);
  });

  it('moves responsibility to reviewer while UNDER_REVIEW', () => {
    const now = new Date('2026-05-27T10:00:00.000Z');
    const state = timing.getTimingState({
      status: TicketStatus.REVIEW,
      priority: 'HIGH',
      reviewStartedAt: new Date('2026-05-27T09:00:00.000Z'),
      reviewDueAt: new Date('2026-05-27T13:00:00.000Z'),
    }, { execution: { URGENT: 4, HIGH: 8, MEDIUM: 24, LOW: 72 }, review: { URGENT: 2, HIGH: 4, MEDIUM: 24, LOW: 48 } }, now);

    expect(state.timerType).toBe('review');
    expect(state.responsibleRole).toBe('REVIEWER');
    expect(state.isOverdue).toBe(false);
  });

  it('stops active timers for DONE tickets', () => {
    const state = timing.getTimingState({
      status: TicketStatus.DONE,
      priority: 'URGENT',
      executionDueAt: new Date('2020-01-01T00:00:00.000Z'),
    }, { execution: { URGENT: 4, HIGH: 8, MEDIUM: 24, LOW: 72 }, review: { URGENT: 2, HIGH: 4, MEDIUM: 24, LOW: 48 } });

    expect(state.timerType).toBe('completed');
    expect(state.isOverdue).toBe(false);
  });
});
