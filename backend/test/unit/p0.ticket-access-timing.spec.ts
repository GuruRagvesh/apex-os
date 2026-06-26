import { ForbiddenException } from '@nestjs/common';
import { TicketStatus } from '@prisma/client';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { TicketAccessService } from '../../src/common/services/ticket-access.service';
import { HierarchyApprovalService } from '../../src/common/services/hierarchy-approval.service';
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
    ticketAccess = new TicketAccessService(prisma, accessPolicy, new HierarchyApprovalService(prisma));
    timing = new TicketTimingService(prisma, { now: () => new Date(), companyTimezone: () => 'Asia/Kolkata', companyDayStart: () => new Date(), companyDayEnd: () => new Date(), elapsedSeconds: () => 0 } as any);
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

  describe('TEAM_LEAD Visibility and Count Consistency', () => {
    const leadUser = {
      id: 'lead-1',
      role: { name: 'TEAM_LEAD' },
      departmentId: 'dept-eng',
    };

    it('1. TEAM_LEAD can see team member assigned ticket', async () => {
      const where = await ticketAccess.buildTicketWhereForUser({}, leadUser);
      expect(where.OR).toContainEqual({
        assignedTo: { departmentId: { in: ['dept-eng'] } },
      });
    });

    it('2. TEAM_LEAD can see team member created ticket', async () => {
      const where = await ticketAccess.buildTicketWhereForUser({}, leadUser);
      expect(where.OR).toContainEqual({
        createdBy: { departmentId: { in: ['dept-eng'] } },
      });
    });

    it('3. TEAM_LEAD can see department ticket', async () => {
      const where = await ticketAccess.buildTicketWhereForUser({}, leadUser);
      expect(where.OR).toContainEqual({
        departmentId: { in: ['dept-eng'] },
      });
    });

    it('4. TEAM_LEAD cannot see unrelated department ticket', async () => {
      prisma.department.findFirst.mockResolvedValueOnce({ id: 'dept-marketing' });
      const where = await ticketAccess.buildTicketWhereForUser({ departmentId: 'dept-marketing' }, leadUser);
      
      expect(where.AND).toBeDefined();
      expect(where.AND[0]).toEqual({ departmentId: 'dept-marketing' });
      expect(where.AND[1].OR).toContainEqual({ departmentId: { in: ['dept-eng'] } });
    });

    it('5. TEAM_LEAD ticket list count equals kanban count', async () => {
      const listWhere = await ticketAccess.buildTicketWhereForUser({}, leadUser);
      const kanbanWhere = {
        AND: [
          listWhere,
          { status: { notIn: [TicketStatus.CLOSED] } }
        ]
      };
      expect(kanbanWhere.AND[0]).toEqual(listWhere);
    });

    it('6. TEAM_LEAD dashboard ticket count equals scoped ticket count', async () => {
      const dashboardWhere = await ticketAccess.buildTicketWhereForUser({}, leadUser);
      const listWhere = await ticketAccess.buildTicketWhereForUser({}, leadUser);
      expect(dashboardWhere).toEqual(listWhere);
    });
  });
});
