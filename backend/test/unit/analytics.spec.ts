import { TVAService } from '../../src/common/services/tva.service';
import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from '../../src/modules/platform/analytics/analytics.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TicketAccessService } from '../../src/common/services/ticket-access.service';
import { TicketTimingService } from '../../src/common/services/ticket-timing.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { CompanyDateService } from '../../src/common/services/company-date.service';
import { ForbiddenException } from '@nestjs/common';

const FIXED_NOW = '2026-06-06T12:00:00Z';
const FIXED_DAY_START = '2026-06-06T00:00:00Z';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let prisma: any;
  let ticketAccess: any;
  let ticketTiming: any;
  let accessPolicy: any;

  beforeEach(async () => {
    prisma = {
      ticket: { count: jest.fn(), findMany: jest.fn() },
      reviewCycleLog: { findMany: jest.fn() },
      ticketTimeLog: { findMany: jest.fn() },
      user: { findMany: jest.fn(), findUnique: jest.fn() },
      department: { findMany: jest.fn() },
      leaveRequest: { count: jest.fn() },
    };

    ticketAccess = {
      buildTicketWhereForUser: jest.fn().mockResolvedValue({}),
    };

    ticketTiming = {
      getSlaConfig: jest.fn().mockResolvedValue({
        execution: { MEDIUM: 24, HIGH: 8 },
        review: { MEDIUM: 24, HIGH: 4 },
      }),
      getTimingState: jest.fn().mockReturnValue({ isOverdue: true }),
    };

    accessPolicy = {
      roleName: jest.fn().mockReturnValue('EMPLOYEE'),
      managedDepartmentIds: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        // Pinned clock, matching CompanyDateService below. A live `new Date()`
        // day start lands after fixtures created a millisecond earlier and
        // made "approvals today" flaky.
        { provide: TVAService, useValue: { now: () => new Date(FIXED_NOW), companyTimezone: () => 'Asia/Kolkata', companyNow: () => new Date(FIXED_NOW), companyDayStart: () => new Date(FIXED_DAY_START), formatZoned: () => 'mock', companyDayEnd: () => new Date('2026-06-06T23:59:59.999Z'), elapsedSeconds: () => 0 } },
        AnalyticsService,
        { provide: PrismaService, useValue: prisma },
        { provide: TicketAccessService, useValue: ticketAccess },
        { provide: TicketTimingService, useValue: ticketTiming },
        { provide: AccessPolicyService, useValue: accessPolicy },
        { 
          provide: CompanyDateService, 
          useValue: { 
            getNow: jest.fn().mockReturnValue(new Date('2026-06-06T12:00:00Z')),
            getTodayStart: jest.fn().mockReturnValue(new Date('2026-06-06T00:00:00Z'))
          } 
        },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  describe('getEmployeeMetrics', () => {
    it('calculates employee metrics correctly', async () => {
      prisma.ticket.count.mockResolvedValueOnce(5); // completed
      prisma.ticket.count.mockResolvedValueOnce(2); // under review
      prisma.ticket.count.mockResolvedValueOnce(1); // reworked

      prisma.reviewCycleLog.findMany.mockResolvedValue([
        { decision: 'APPROVED' }, { decision: 'APPROVED' }, { decision: 'REWORK' }
      ]);

      prisma.ticketTimeLog.findMany.mockResolvedValue([
        { durationSeconds: 3600 }, { durationSeconds: 7200 }
      ]); // Total 10800s (3 hours)

      const result = await service.getEmployeeMetrics('user-1', { id: 'user-1' });

      expect(result.ticketsCompleted).toBe(5);
      expect(result.ticketsUnderReview).toBe(2);
      expect(result.ticketsReworked).toBe(1);
      expect(result.productiveHours).toBe(3);
      expect(result.averageCompletionTimeSeconds).toBe(10800 / 5);
      expect(result.reviewAcceptancePercent).toBe(67); // 2/3
      expect(result.reworkPercent).toBe(33); // 1/3
      // Productive time is the assignee's WORK / REWORK ledger segments (the
      // ledger never writes a stage called IN_PROGRESS).
      expect(prisma.ticketTimeLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ ownerType: 'ASSIGNEE', stage: { in: ['WORK', 'REWORK'] } }),
      }));
    });

    it('throws Forbidden if standard user attempts to view another user', async () => {
      await expect(service.getEmployeeMetrics('user-2', { id: 'user-1' }))
        .rejects.toThrow(ForbiddenException);
    });
  });

  describe('getReviewerMetrics', () => {
    // Phase 4: reviewer ACTIVE time (frozen productive REVIEWER seconds) and
    // review TURNAROUND (submission → decision, the SLA clock) are separate.
    it('separates reviewer active time from review turnaround; SLA uses turnaround; WITHDRAWN is excluded', async () => {
      prisma.reviewCycleLog.findMany.mockResolvedValue([
        // 1h of active review; turnaround 2h → within the 24h MEDIUM SLA.
        { decision: 'APPROVED', reviewerWorkSeconds: 3600, ticket: { priority: 'MEDIUM' },
          reviewStartedAt: new Date('2026-06-06T08:00:00Z'), reviewEndedAt: new Date('2026-06-06T10:00:00Z') },
        // Only 30 min of active review, but 25h turnaround → an SLA breach.
        { decision: 'REWORK', reviewerWorkSeconds: 1800, ticket: { priority: 'MEDIUM' },
          reviewStartedAt: new Date('2026-06-05T10:00:00Z'), reviewEndedAt: new Date('2026-06-06T11:00:00Z') },
        // Decided without starting the review clock: counts as a review, not in the active-time average.
        { decision: 'APPROVED', reviewerWorkSeconds: 0, ticket: { priority: 'MEDIUM' },
          reviewStartedAt: new Date('2026-06-06T09:00:00Z'), reviewEndedAt: new Date('2026-06-06T09:30:00Z') },
        // A withdrawal is not a reviewer decision: never an approval, rejection, breach or active time.
        { decision: 'WITHDRAWN', reviewerWorkSeconds: 99999, ticket: { priority: 'MEDIUM' },
          reviewStartedAt: new Date('2026-06-01T00:00:00Z'), reviewEndedAt: new Date('2026-06-06T09:45:00Z') },
      ]);
      prisma.ticket.count.mockResolvedValue(4); // backlog

      const result = await service.getReviewerMetrics('user-1', { id: 'user-1' });

      expect(result.completedApprovalsCount).toBe(3);
      expect(result.withdrawnCount).toBe(1);
      expect(result.approvalPercent).toBe(67);
      expect(result.rejectionPercent).toBe(33);
      expect(result.totalApprovalSeconds).toBe(3600 + 1800);
      expect(result.timedReviewsCount).toBe(2);
      expect(result.averageApprovalSeconds).toBe((3600 + 1800) / 2);
      expect(result.averageTurnaroundSeconds).toBe((7200 + 90000 + 1800) / 3);
      expect(result.approvalSlaBreaches).toBe(1);
      expect(result.approvalSlaBreachRate).toBe(33);
      expect(result.pendingApprovalsCount).toBe(4);
      expect(result.approvalsToday).toBe(3);
      expect(result.approvalsThisWeek).toBe(3);
    });
  });

  describe('getManagerMetrics', () => {
    it('throws if not manager', async () => {
      await expect(service.getManagerMetrics({ id: 'user-1' })).rejects.toThrow(ForbiddenException);
    });

    it('returns manager metrics for MANAGER role', async () => {
      accessPolicy.roleName.mockReturnValue('MANAGER');
      accessPolicy.managedDepartmentIds.mockResolvedValue(['dept-1']);
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      prisma.ticket.count.mockResolvedValueOnce(10); // tickets completed
      prisma.ticket.findMany.mockResolvedValue([
        { executionDueAt: new Date(Date.now() - 10000), isBlocked: false } // 1 overdue
      ]);
      prisma.ticket.count.mockResolvedValueOnce(3); // blocked

      const result = await service.getManagerMetrics({ id: 'mgr-1' });

      expect(result.departmentThroughput).toBe(10);
      expect(result.overdueTickets).toBe(1);
      expect(result.blockedTickets).toBe(3);
    });
  });

  describe('getSlaAnalytics', () => {
    it('calculates onTime vs overdue based on ledger durations', async () => {
      prisma.ticket.findMany.mockResolvedValue([
        { id: 't1', priority: 'MEDIUM', timeLogs: [{ durationSeconds: 36000 }] }, // 10h (on time < 24h)
        { id: 't2', priority: 'HIGH', timeLogs: [{ durationSeconds: 36000 }] } // 10h (breach > 8h)
      ]);

      const result = await service.getSlaAnalytics({ id: 'user-1' });

      expect(result.onTimePercent).toBe(50);
      expect(result.overduePercent).toBe(50);
      expect(result.slaBreaches).toBe(1);
      expect(result.averageDelaySeconds).toBe(36000 - 8 * 3600); // 10h - 8h = 2h = 7200s
      expect(prisma.ticket.findMany).toHaveBeenCalledWith(expect.objectContaining({
        select: expect.objectContaining({
          // Only productive rows: repaired / marker rows (countsAsWork = false) never count.
          timeLogs: expect.objectContaining({ where: { ownerType: 'ASSIGNEE', stage: { in: ['WORK', 'REWORK'] }, countsAsWork: true } }),
        }),
      }));
    });
  });

  describe('getReworkAnalytics', () => {
    it('calculates rework rate correctly', async () => {
      prisma.ticket.findMany.mockResolvedValue([
        { id: 't1', reworkCount: 2 },
        { id: 't2', reworkCount: 1 }
      ]);
      prisma.ticket.count.mockResolvedValue(10); // total tickets

      const result = await service.getReworkAnalytics({ id: 'user-1' });

      expect(result.reworkCount).toBe(3);
      expect(result.reworkRate).toBe(20); // 2 out of 10
    });
  });

  describe('getCommandCenter', () => {
    it('calculates command center overview', async () => {
      prisma.ticket.count.mockResolvedValueOnce(15); // active work
      prisma.ticket.count.mockResolvedValueOnce(5); // active reviews
      prisma.ticket.count.mockResolvedValueOnce(2); // blocked
      prisma.leaveRequest.count.mockResolvedValueOnce(1); // pending approvals

      const result = await service.getCommandCenter({ id: 'user-1' }, 'today');

      expect(result.activeWork).toBe(15);
      expect(result.activeReviews).toBe(5);
      expect(result.blockedTickets).toBe(2);
      expect(result.pendingApprovals).toBe(1);
    });
  });
});
