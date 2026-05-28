import { TicketStatus } from '@prisma/client';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { DashboardService } from '../../src/modules/platform/dashboard/dashboard.service';

const overdueCandidate = {
  id: 'ticket1',
  ticketId: 'TKT-001',
  title: 'Overdue work',
  status: TicketStatus.IN_PROGRESS,
  priority: 'HIGH',
  dueDate: new Date('2026-05-26T10:00:00.000Z'),
  createdAt: new Date('2026-05-25T10:00:00.000Z'),
  updatedAt: new Date('2026-05-25T10:00:00.000Z'),
  scheduledStartAt: null,
  actualStartAt: new Date('2026-05-25T10:00:00.000Z'),
  estimatedMinutes: 60,
  executionDueAt: new Date('2026-05-25T11:00:00.000Z'),
  submittedAt: null,
  reviewStartedAt: null,
  reviewDueAt: null,
  closedAt: null,
  cancelledAt: null,
};

const prisma: any = {
  ticket: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  leaveRequest: {
    count: jest.fn(),
    findMany: jest.fn(),
  },
  user: { count: jest.fn() },
  project: { count: jest.fn(), findMany: jest.fn() },
  workSession: { findUnique: jest.fn() },
  managerDeptAccess: { findMany: jest.fn() },
};

describe('P1-D dashboard count convergence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.ticket.findMany.mockResolvedValue([overdueCandidate]);
    prisma.ticket.count.mockResolvedValue(0);
    prisma.leaveRequest.count.mockResolvedValue(0);
    prisma.leaveRequest.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);
    prisma.project.count.mockResolvedValue(0);
    prisma.project.findMany.mockResolvedValue([]);
    prisma.workSession.findUnique.mockResolvedValue(null);
    prisma.managerDeptAccess.findMany.mockResolvedValue([{ departmentId: 'dept1' }]);
  });

  it('uses TicketTimingService instead of dueDate-only counts for dashboard overdue metrics', async () => {
    const ticketAccess: any = {
      buildTicketWhereForUser: jest.fn().mockResolvedValue({ departmentId: 'dept1' }),
      visibleUserIdsForWorkload: jest.fn().mockResolvedValue(['manager1', 'employee1']),
    };
    const ticketTiming: any = {
      getSlaConfig: jest.fn().mockResolvedValue({
        execution: { URGENT: 4, HIGH: 8, MEDIUM: 24, LOW: 72 },
        review: { URGENT: 2, HIGH: 4, MEDIUM: 24, LOW: 48 },
      }),
      getTimingState: jest.fn().mockReturnValue({ isOverdue: true }),
    };
    const leaveAccess: any = {
      buildLeaveWhereForUser: jest.fn().mockResolvedValue({ departmentId: 'dept1' }),
    };
    const service = new DashboardService(
      prisma,
      ticketAccess,
      ticketTiming,
      leaveAccess,
      new AccessPolicyService(prisma),
    );

    const summary = await service.getSummary({
      id: 'manager1',
      role: { name: 'MANAGER' },
      departmentId: 'dept1',
    });

    expect(summary.metrics.overdue).toBe(1);
    expect(ticketTiming.getTimingState).toHaveBeenCalled();
    const ticketCountCalls = prisma.ticket.count.mock.calls.map((call: any[]) => JSON.stringify(call[0]));
    expect(ticketCountCalls.some((call: string) => call.includes('dueDate'))).toBe(false);
  });
});
