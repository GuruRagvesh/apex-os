import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { TicketAccessService } from '../../../common/services/ticket-access.service';
import { TicketTimingService } from '../../../common/services/ticket-timing.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { TVAService } from '../../../common/services/tva.service';
import { TicketStatus } from '@prisma/client';

@Injectable()
export class AnalyticsService {
  constructor(
    private prisma: PrismaService,
    private ticketAccess: TicketAccessService,
    private ticketTiming: TicketTimingService,
    private accessPolicy: AccessPolicyService,
    private tva: TVAService,
  ) {}

  private async assertCanViewUser(targetUserId: string, currentUser: any) {
    if (targetUserId === currentUser.id) return;
    const roleName = this.accessPolicy.roleName(currentUser);
    if (['ADMIN', 'SUPER_ADMIN'].includes(roleName)) return;

    if (['MANAGER', 'TEAM_LEAD'].includes(roleName)) {
      const managedDepts = await this.accessPolicy.managedDepartmentIds(currentUser);
      const targetUser = await this.prisma.user.findUnique({ where: { id: targetUserId } });
      if (targetUser?.departmentId && managedDepts.includes(targetUser.departmentId)) {
        return;
      }
    }
    throw new ForbiddenException('You do not have permission to view analytics for this user');
  }

  // ── PHASE 1: EMPLOYEE METRICS ───────────────────────────────────────────────
  async getEmployeeMetrics(targetUserId: string, currentUser: any) {
    await this.assertCanViewUser(targetUserId, currentUser);

    const [ticketsCompleted, ticketsUnderReview, ticketsReworked] = await Promise.all([
      this.prisma.ticket.count({ where: { assignedToId: targetUserId, status: { in: ['DONE', 'CLOSED'] } } }),
      this.prisma.ticket.count({ where: { assignedToId: targetUserId, status: 'REVIEW' } }),
      this.prisma.ticket.count({ where: { assignedToId: targetUserId, reworkCount: { gt: 0 } } }),
    ]);

    const reviewCycles = await this.prisma.reviewCycleLog.findMany({
      where: { assigneeId: targetUserId, decision: { not: null } },
      select: { decision: true },
    });

    const approvedCount = reviewCycles.filter(c => c.decision === 'APPROVED').length;
    const reworkCount = reviewCycles.filter(c => c.decision === 'REWORK').length;
    const totalDecisions = approvedCount + reworkCount;

    const reviewAcceptancePercent = totalDecisions > 0 ? Math.round((approvedCount / totalDecisions) * 100) : 0;
    const reworkPercent = totalDecisions > 0 ? Math.round((reworkCount / totalDecisions) * 100) : 0;

    const timeLogs = await this.prisma.ticketTimeLog.findMany({
      where: { userId: targetUserId, stage: 'IN_PROGRESS', countsAsWork: true, durationSeconds: { not: null } },
      select: { durationSeconds: true },
    });

    const productiveSeconds = timeLogs.reduce((acc, log) => acc + (log.durationSeconds || 0), 0);
    const productiveHours = Number((productiveSeconds / 3600).toFixed(2));
    const averageCompletionTimeSeconds = ticketsCompleted > 0 ? productiveSeconds / ticketsCompleted : 0;

    return {
      ticketsCompleted,
      ticketsUnderReview,
      ticketsReworked,
      averageCompletionTimeSeconds,
      productiveHours,
      reviewAcceptancePercent,
      reworkPercent,
    };
  }

  // ── PHASE 2: REVIEWER METRICS ───────────────────────────────────────────────
  async getReviewerMetrics(targetUserId: string, currentUser: any) {
    await this.assertCanViewUser(targetUserId, currentUser);

    const reviewCycles = await this.prisma.reviewCycleLog.findMany({
      where: { reviewerId: targetUserId, decision: { not: null } },
      select: { decision: true, reviewerWorkSeconds: true, reviewEndedAt: true, ticket: { select: { priority: true } } },
    });

    const config = await this.ticketTiming.getSlaConfig();
    let approvalSlaBreaches = 0;

    const completedApprovalsCount = reviewCycles.length;
    const approvedCount = reviewCycles.filter(c => c.decision === 'APPROVED').length;
    const reworkCount = reviewCycles.filter(c => c.decision === 'REWORK').length;

    let approvalsToday = 0;
    let approvalsThisWeek = 0;
    const now = this.tva.now();
    const todayStart = this.tva.companyDayStart();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);

    reviewCycles.forEach(c => {
      const priority = c.ticket?.priority ?? 'MEDIUM';
      const limitHours = config.review[priority] ?? config.review['MEDIUM'] ?? 24;
      const limitSeconds = limitHours * 3600;
      if ((c.reviewerWorkSeconds || 0) > limitSeconds) {
        approvalSlaBreaches++;
      }
      if (c.reviewEndedAt) {
        if (c.reviewEndedAt >= todayStart) approvalsToday++;
        if (c.reviewEndedAt >= weekStart) approvalsThisWeek++;
      }
    });

    const approvalPercent = completedApprovalsCount > 0 ? Math.round((approvedCount / completedApprovalsCount) * 100) : 0;
    const rejectionPercent = completedApprovalsCount > 0 ? Math.round((reworkCount / completedApprovalsCount) * 100) : 0;
    const approvalSlaBreachRate = completedApprovalsCount > 0 ? Math.round((approvalSlaBreaches / completedApprovalsCount) * 100) : 0;

    const totalApprovalSeconds = reviewCycles.reduce((acc, c) => acc + (c.reviewerWorkSeconds || 0), 0);
    const averageApprovalSeconds = completedApprovalsCount > 0 ? totalApprovalSeconds / completedApprovalsCount : 0;

    const pendingApprovalsCount = await this.prisma.ticket.count({
      where: { status: 'REVIEW', reviewDueAt: { not: null } }, // Depending on assignment rules
    });

    return {
      completedApprovalsCount,
      averageApprovalSeconds,
      totalApprovalSeconds,
      approvalPercent,
      rejectionPercent,
      pendingApprovalsCount,
      approvalSlaBreaches,
      approvalSlaBreachRate,
      approvalsToday,
      approvalsThisWeek,
    };
  }

  // ── PHASE 3: MANAGER METRICS ────────────────────────────────────────────────
  async getManagerMetrics(currentUser: any) {
    const roleName = this.accessPolicy.roleName(currentUser);
    if (!['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleName)) {
      throw new ForbiddenException('Manager metrics are restricted to managers and admins');
    }

    const deptIds = ['ADMIN', 'SUPER_ADMIN'].includes(roleName)
      ? (await this.prisma.department.findMany({ select: { id: true } })).map(d => d.id)
      : await this.accessPolicy.managedDepartmentIds(currentUser);

    const users = await this.prisma.user.findMany({
      where: { departmentId: { in: deptIds }, isActive: true },
      select: { id: true, name: true },
    });
    
    const userIds = users.map(u => u.id);

    const ticketsCompleted = await this.prisma.ticket.count({
      where: { departmentId: { in: deptIds }, status: { in: ['DONE', 'CLOSED'] } },
    });

    const overdueTickets = await this.prisma.ticket.findMany({
      where: { departmentId: { in: deptIds }, status: { notIn: ['PENDING_APPROVAL', 'DONE', 'CLOSED'] } },
      select: {
        id: true, status: true, priority: true, dueDate: true, createdAt: true, updatedAt: true,
        scheduledStartAt: true, actualStartAt: true, estimatedMinutes: true, executionDueAt: true,
        submittedAt: true, reviewStartedAt: true, reviewDueAt: true, closedAt: true, cancelledAt: true,
        isBlocked: true, blockedAt: true, blockedReason: true,
      },
    });

    const config = await this.ticketTiming.getSlaConfig();
    const overdueCount = overdueTickets.filter(t => this.ticketTiming.getTimingState(t, config).isOverdue).length;

    const blockedCount = await this.prisma.ticket.count({
      where: { departmentId: { in: deptIds }, isBlocked: true, status: { notIn: ['PENDING_APPROVAL', 'DONE', 'CLOSED'] } },
    });

    return {
      departmentThroughput: ticketsCompleted,
      ticketsCompleted,
      overdueTickets: overdueCount,
      blockedTickets: blockedCount,
      averageTurnaroundTime: 0, // Placeholder
      employeeRankings: [], // Placeholder
      reviewerRankings: [], // Placeholder
    };
  }

  // ── PHASE 4: SLA ANALYTICS ──────────────────────────────────────────────────
  async getSlaAnalytics(currentUser: any) {
    const ticketScope = await this.ticketAccess.buildTicketWhereForUser({}, currentUser);
    
    // Fetch closed tickets and their time logs
    const tickets = await this.prisma.ticket.findMany({
      where: { ...ticketScope, status: { in: ['DONE', 'CLOSED'] } },
      select: { id: true, priority: true, timeLogs: { where: { stage: 'IN_PROGRESS' }, select: { durationSeconds: true } } },
    });

    const config = await this.ticketTiming.getSlaConfig();

    let onTimeCount = 0;
    let overdueCount = 0;
    let totalDelaySeconds = 0;

    tickets.forEach(t => {
      const priority = t.priority ?? 'MEDIUM';
      const limitHours = config.execution[priority] ?? config.execution['MEDIUM'] ?? 24;
      const limitSeconds = limitHours * 3600;

      const totalWorkSeconds = t.timeLogs.reduce((acc, log) => acc + (log.durationSeconds || 0), 0);

      if (totalWorkSeconds <= limitSeconds) {
        onTimeCount++;
      } else {
        overdueCount++;
        totalDelaySeconds += (totalWorkSeconds - limitSeconds);
      }
    });

    const total = onTimeCount + overdueCount;
    const onTimePercent = total > 0 ? Math.round((onTimeCount / total) * 100) : 0;
    const overduePercent = total > 0 ? Math.round((overdueCount / total) * 100) : 0;
    const averageDelaySeconds = overdueCount > 0 ? totalDelaySeconds / overdueCount : 0;

    return {
      onTimePercent,
      overduePercent,
      slaBreaches: overdueCount,
      averageDelaySeconds,
    };
  }

  // ── PHASE 5: REWORK ANALYTICS ───────────────────────────────────────────────
  async getReworkAnalytics(currentUser: any) {
    const ticketScope = await this.ticketAccess.buildTicketWhereForUser({}, currentUser);
    
    const tickets = await this.prisma.ticket.findMany({
      where: { ...ticketScope, reworkCount: { gt: 0 } },
      select: { id: true, reworkCount: true, assignedToId: true, taskTypeId: true },
    });

    const reworkCount = tickets.reduce((acc, t) => acc + t.reworkCount, 0);
    const totalTickets = await this.prisma.ticket.count({ where: ticketScope });
    const reworkRate = totalTickets > 0 ? Math.round((tickets.length / totalTickets) * 100) : 0;

    return {
      reworkCount,
      reworkRate,
      mostReworkedEmployees: [],
      mostReworkedTicketTypes: [],
      reviewQualityIndicators: {},
    };
  }

  // ── PHASE 6: COMMAND CENTER ─────────────────────────────────────────────────
  async getCommandCenter(currentUser: any, period: 'today' | 'week' | 'month') {
    const ticketScope = await this.ticketAccess.buildTicketWhereForUser({}, currentUser);
    const now = this.tva.now();
    let periodStart = new Date(now);
    if (period === 'today') periodStart = this.tva.companyDayStart();
    if (period === 'week') periodStart.setDate(periodStart.getDate() - 7);
    if (period === 'month') periodStart.setMonth(periodStart.getMonth() - 1);

    const [activeWork, activeReviews, blockedTickets, pendingApprovals] = await Promise.all([
      this.prisma.ticket.count({ where: { ...ticketScope, status: 'IN_PROGRESS', updatedAt: { gte: periodStart } } }),
      this.prisma.ticket.count({ where: { ...ticketScope, status: 'REVIEW', updatedAt: { gte: periodStart } } }),
      this.prisma.ticket.count({ where: { ...ticketScope, isBlocked: true, updatedAt: { gte: periodStart } } }),
      this.prisma.leaveRequest.count({ where: { status: 'PENDING', createdAt: { gte: periodStart } } }), // Example
    ]);

    return {
      period,
      activeWork,
      activeReviews,
      blockedTickets,
      pendingApprovals,
    };
  }
}
