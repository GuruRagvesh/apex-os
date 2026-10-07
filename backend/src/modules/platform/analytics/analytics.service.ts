import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { TicketAccessService } from '../../../common/services/ticket-access.service';
import { TicketTimingService } from '../../../common/services/ticket-timing.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { LeaveAccessService } from '../../../common/services/leave-access.service';
import { TVAService } from '../../../common/services/tva.service';
import { LEDGER_OWNER_TYPES, LEDGER_STAGES } from '../../operations/tickets/ticket-ledger.service';
import { computeReviewerMetrics, REVIEW_METRICS_CYCLE_SELECT, toMetricsCycle } from '../../../common/services/review-metrics';
import { calculateWorkdayRuntime } from '../workday/workday.calculation';
import { periodStart, resolveRange, secondsByDay, AnalyticsRange } from './analytics-period';

// Productive employee time = the primary assignee's WORK and REWORK ledger
// segments that count as work. (The ledger never writes a stage called
// IN_PROGRESS; pause markers and INTEGRITY_REPAIR closures are countsAsWork = false.)
const PRODUCTIVE_ASSIGNEE_LOGS = {
  ownerType: LEDGER_OWNER_TYPES.ASSIGNEE,
  stage: { in: [LEDGER_STAGES.WORK, LEDGER_STAGES.REWORK] },
  countsAsWork: true,
};

// Reviewer active time: explicit Start Review segments. Reported beside
// productive time, never added to it.
const REVIEWER_ACTIVE_LOGS = {
  ownerType: LEDGER_OWNER_TYPES.REVIEWER,
  countsAsWork: true,
};

const COMPLETED = ['DONE', 'CLOSED'];

export interface ProductivityQuery {
  from?: string;
  to?: string;
  projectId?: string;
  userId?: string;
}

/**
 * Analytics figures. Every count is limited to what the caller may see:
 * tickets through TicketAccessService, leave through LeaveAccessService,
 * projects through AccessPolicyService.projectWhereForUser, people through
 * assertCanViewUser. Periods and day buckets are company-timezone dates.
 *
 * Kept separate, never summed together: workday time (WorkSession), productive
 * ticket time (assignee ledger), reviewer active time (reviewer ledger), review
 * turnaround (submission to decision), rework counts, SLA compliance.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private prisma: PrismaService,
    private ticketAccess: TicketAccessService,
    private ticketTiming: TicketTimingService,
    private accessPolicy: AccessPolicyService,
    private tva: TVAService,
    private leaveAccess: LeaveAccessService,
  ) {}

  private andWhere(...clauses: any[]): any {
    const parts = clauses.filter((c) => c && Object.keys(c).length > 0);
    if (parts.length === 0) return {};
    if (parts.length === 1) return parts[0];
    return { AND: parts };
  }

  private async assertCanViewUser(targetUserId: string, currentUser: any) {
    if (targetUserId === currentUser.id) return;
    const roleName = this.accessPolicy.roleName(currentUser);
    if (['ADMIN', 'SUPER_ADMIN'].includes(roleName)) return;

    if (['MANAGER', 'TEAM_LEAD'].includes(roleName)) {
      const managedDepts = await this.accessPolicy.managedDepartmentIds(currentUser);
      const targetUser = await this.prisma.user.findUnique({ where: { id: targetUserId }, select: { departmentId: true } });
      if (targetUser?.departmentId && managedDepts.includes(targetUser.departmentId)) {
        return;
      }
    }
    throw new ForbiddenException('You do not have permission to view analytics for this user');
  }

  /** The people whose figures the caller may see, as a user where clause. */
  private async peopleWhere(currentUser: any): Promise<{ where: any; scope: 'self' | 'team' | 'company' }> {
    const roleName = this.accessPolicy.roleName(currentUser);
    if (this.accessPolicy.isAdmin(currentUser)) return { where: {}, scope: 'company' };
    if (['MANAGER', 'TEAM_LEAD'].includes(roleName)) {
      const deptIds = await this.accessPolicy.managedDepartmentIds(currentUser);
      if (deptIds.length > 0) {
        return { where: { OR: [{ id: currentUser.id }, { departmentId: { in: deptIds } }] }, scope: 'team' };
      }
    }
    return { where: { id: currentUser.id }, scope: 'self' };
  }

  /** A project the caller may see, or 404/403. */
  private async accessibleProject(projectId: string, currentUser: any) {
    const exists = await this.prisma.project.findFirst({
      where: { OR: [{ id: projectId }, { projectId }] },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Project not found');
    const scope = await this.accessPolicy.projectWhereForUser(currentUser);
    const project = await this.prisma.project.findFirst({
      where: this.andWhere({ id: exists.id }, scope),
      select: { id: true, projectId: true, name: true },
    });
    if (!project) throw new ForbiddenException('You do not have permission to view this project');
    return project;
  }

  private completedAt(t: { actualCompletedAt?: Date | null; resolvedAt?: Date | null; closedAt?: Date | null }): Date | null {
    return t.actualCompletedAt ?? t.resolvedAt ?? t.closedAt ?? null;
  }

  // ── PHASE 1: EMPLOYEE METRICS (all time) ─────────────────────────────────────
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
      // Productive assignee time as the ledger records it (WORK / REWORK segments).
      where: { userId: targetUserId, ...PRODUCTIVE_ASSIGNEE_LOGS, durationSeconds: { not: null } },
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

  // ── PRODUCTIVITY OVER A RANGE (TKT-1027 / TKT-1036) ──────────────────────────
  /**
   * Per-employee output for a company-date range, optionally for one project:
   * productive ticket time, reviewer active time, workday time, tickets
   * completed and review outcomes, plus a per-day series for the selection.
   * Workday time belongs to the person, not to a project, so it is reported
   * unchanged when a project is selected (the response says so).
   */
  async getProductivity(currentUser: any, q: ProductivityQuery) {
    const range = resolveRange(this.tva, q.from, q.to, 30);
    const project = q.projectId ? await this.accessibleProject(q.projectId, currentUser) : null;

    let people = await this.peopleWhere(currentUser);
    if (q.userId) {
      await this.assertCanViewUser(q.userId, currentUser);
      people = { where: { id: q.userId }, scope: people.scope };
    }
    const users = await this.prisma.user.findMany({
      where: this.andWhere(people.where, q.userId ? {} : { isActive: true }),
      select: { id: true, name: true, department: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    const userIds = users.map((u) => u.id);
    const now = this.tva.now();
    const ticketFilter = project ? { ticket: { projectId: project.id } } : {};

    const [workLogs, reviewLogs, sessions, completed, cycles] = await Promise.all([
      this.prisma.ticketTimeLog.findMany({
        where: {
          userId: { in: userIds }, ...PRODUCTIVE_ASSIGNEE_LOGS, ...ticketFilter,
          startedAt: { lt: range.end },
          OR: [{ endedAt: null }, { endedAt: { gt: range.start } }],
        },
        select: { userId: true, startedAt: true, endedAt: true },
      }),
      this.prisma.ticketTimeLog.findMany({
        where: {
          userId: { in: userIds }, ...REVIEWER_ACTIVE_LOGS, ...ticketFilter,
          startedAt: { lt: range.end },
          OR: [{ endedAt: null }, { endedAt: { gt: range.start } }],
        },
        select: { userId: true, startedAt: true, endedAt: true },
      }),
      this.prisma.workSession.findMany({
        where: {
          userId: { in: userIds },
          date: { gte: new Date(`${range.from}T00:00:00.000Z`), lte: new Date(`${range.to}T00:00:00.000Z`) },
        },
        select: {
          userId: true, date: true, startWorkAt: true, logoutAt: true, totalBreakMinutes: true, totalWorkMinutes: true,
          autoClosed: true, autoClosedAt: true, closureReason: true, continuationOfSessionId: true,
          breakLogs: { select: { startAt: true, endAt: true, durationMinutes: true } },
        },
      }),
      this.prisma.ticket.findMany({
        where: {
          assignedToId: { in: userIds }, status: { in: COMPLETED as any },
          ...(project ? { projectId: project.id } : {}),
          OR: [
            { actualCompletedAt: { gte: range.start, lt: range.end } },
            { resolvedAt: { gte: range.start, lt: range.end } },
            { closedAt: { gte: range.start, lt: range.end } },
          ],
        },
        select: { assignedToId: true, actualCompletedAt: true, resolvedAt: true, closedAt: true },
      }),
      this.prisma.reviewCycleLog.findMany({
        where: {
          assigneeId: { in: userIds }, decision: { in: ['APPROVED', 'REWORK'] },
          reviewEndedAt: { gte: range.start, lt: range.end },
          ...ticketFilter,
        },
        select: {
          assigneeId: true, decision: true,
          taskEfficiencyRating: true, employeePerformanceRating: true, employeeAttitudeRating: true,
        },
      }),
    ]);

    // Rating sums are kept so totals can be averaged over every rated review,
    // not as an average of averages.
    type Row = {
      productiveSeconds: number; reviewerSeconds: number; workdaySeconds: number; ticketsCompleted: number; approvals: number; reworks: number;
      ratedReviews: number; efficiencySum: number; performanceSum: number; attitudeSum: number;
    };
    const blank = (): Row => ({
      productiveSeconds: 0, reviewerSeconds: 0, workdaySeconds: 0, ticketsCompleted: 0, approvals: 0, reworks: 0,
      ratedReviews: 0, efficiencySum: 0, performanceSum: 0, attitudeSum: 0,
    });
    const perUser = new Map<string, Row>(userIds.map((id) => [id, blank()]));
    const perDay = new Map<string, { productiveSeconds: number; workdaySeconds: number; ticketsCompleted: number }>(
      range.days.map((d) => [d, { productiveSeconds: 0, workdaySeconds: 0, ticketsCompleted: 0 }]),
    );

    for (const log of workLogs) {
      for (const [day, secs] of secondsByDay(this.tva, range, log.startedAt, log.endedAt ?? now)) {
        perUser.get(log.userId)!.productiveSeconds += secs;
        perDay.get(day)!.productiveSeconds += secs;
      }
    }
    for (const log of reviewLogs) {
      for (const [, secs] of secondsByDay(this.tva, range, log.startedAt, log.endedAt ?? now)) {
        perUser.get(log.userId)!.reviewerSeconds += secs;
      }
    }
    for (const s of sessions) {
      // The workday's own runtime rule (read only), per session.
      const minutes = calculateWorkdayRuntime([s as any], now).elapsedWorkMinutes;
      const day = s.date.toISOString().slice(0, 10);
      perUser.get(s.userId)!.workdaySeconds += minutes * 60;
      if (perDay.has(day)) perDay.get(day)!.workdaySeconds += minutes * 60;
    }
    for (const t of completed) {
      const at = this.completedAt(t);
      if (!at || at < range.start || at >= range.end || !t.assignedToId) continue;
      perUser.get(t.assignedToId)!.ticketsCompleted += 1;
      perDay.get(this.tva.companyBusinessDate(at))!.ticketsCompleted += 1;
    }
    for (const c of cycles) {
      const row = c.assigneeId ? perUser.get(c.assigneeId) : undefined;
      if (!row) continue;
      if (c.decision === 'APPROVED') row.approvals += 1;
      else row.reworks += 1;
      // Quality (QC) ratings the reviewer gave at decision time. A cycle
      // counts as rated only when all three ratings were recorded.
      if (c.taskEfficiencyRating != null && c.employeePerformanceRating != null && c.employeeAttitudeRating != null) {
        row.ratedReviews += 1;
        row.efficiencySum += c.taskEfficiencyRating;
        row.performanceSum += c.employeePerformanceRating;
        row.attitudeSum += c.employeeAttitudeRating;
      }
    }

    const withQuality = (r: Row) => {
      const { efficiencySum, performanceSum, attitudeSum, ...rest } = r;
      const avg = (sum: number) => (r.ratedReviews > 0 ? Math.round((sum / r.ratedReviews) * 10) / 10 : null);
      return {
        ...rest,
        quality: {
          ratedReviews: r.ratedReviews,
          taskEfficiency: avg(efficiencySum),
          performance: avg(performanceSum),
          attitude: avg(attitudeSum),
        },
      };
    };
    const sumRow = blank();
    for (const row of perUser.values()) {
      for (const k of Object.keys(sumRow) as (keyof Row)[]) sumRow[k] += row[k];
    }
    const employees = users.map((u) => ({ userId: u.id, name: u.name, department: u.department?.name ?? null, ...withQuality(perUser.get(u.id)!) }));
    const totals = withQuality(sumRow);

    return {
      range: { from: range.from, to: range.to, timezone: range.timezone },
      project,
      scope: people.scope,
      workdayTimeIsPerPerson: Boolean(project),
      totals,
      employees,
      daily: range.days.map((date) => ({ date, ...perDay.get(date)! })),
    };
  }

  // ── PHASE 2: REVIEWER METRICS ───────────────────────────────────────────────
  async getReviewerMetrics(targetUserId: string, currentUser: any) {
    await this.assertCanViewUser(targetUserId, currentUser);

    // Definitions: src/common/services/review-metrics.ts (shared with the dashboard).
    const reviewCycles = await this.prisma.reviewCycleLog.findMany({
      where: { reviewerId: targetUserId, decision: { not: null } },
      select: REVIEW_METRICS_CYCLE_SELECT,
    });
    const config = await this.ticketTiming.getSlaConfig();
    const m = computeReviewerMetrics(reviewCycles.map(toMetricsCycle), config.review);

    let approvalsToday = 0;
    let approvalsThisWeek = 0;
    const todayStart = periodStart(this.tva, 'today');
    const weekStart = periodStart(this.tva, 'week');
    for (const c of reviewCycles) {
      // Decisions only: a withdrawal is not a review the reviewer completed.
      if (!['APPROVED', 'REWORK'].includes(c.decision ?? '') || !c.reviewEndedAt) continue;
      if (c.reviewEndedAt >= todayStart) approvalsToday++;
      if (c.reviewEndedAt >= weekStart) approvalsThisWeek++;
    }

    // Tickets waiting in review that the caller can see -- it used to count
    // every REVIEW ticket in the company, whoever asked.
    const ticketScope = await this.ticketAccess.buildTicketWhereForUser({}, currentUser);
    const pendingApprovalsCount = await this.prisma.ticket.count({
      where: this.andWhere(ticketScope, { status: 'REVIEW' }),
    });

    return {
      completedApprovalsCount: m.decidedReviews,
      // Reviewer ACTIVE time (explicit Start Review segments), per timed review.
      averageApprovalSeconds: m.averageReviewerActiveSeconds,
      totalApprovalSeconds: m.reviewerActiveSeconds,
      timedReviewsCount: m.timedReviews,
      // Review TURNAROUND (wall clock, the SLA clock), a separate figure.
      averageTurnaroundSeconds: m.averageTurnaroundSeconds,
      withdrawnCount: m.withdrawn,
      approvalPercent: m.approvalPercent,
      rejectionPercent: m.rejectionPercent,
      pendingApprovalsCount,
      // Turnaround versus the configured review SLA, never reviewer active time.
      approvalSlaBreaches: m.reviewSlaBreaches,
      approvalSlaBreachRate: m.reviewSlaBreachRate,
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

    // Review turnaround (submission to decision) for reviews of these
    // departments' tickets: the same calculator the Review tab uses.
    const cycles = await this.prisma.reviewCycleLog.findMany({
      where: { decision: { not: null }, ticket: { departmentId: { in: deptIds } } },
      select: REVIEW_METRICS_CYCLE_SELECT,
    });
    const review = computeReviewerMetrics(cycles.map(toMetricsCycle), config.review);

    return {
      departmentThroughput: ticketsCompleted,
      ticketsCompleted,
      overdueTickets: overdueCount,
      blockedTickets: blockedCount,
      averageTurnaroundTime: review.turnaroundMeasured > 0 ? review.averageTurnaroundSeconds : null,
      // No scoring model has been approved, so there is no ranking to show.
      // Reported as unavailable, not as an empty (zero) list.
      rankingsAvailable: false,
      employeeRankings: [],
      reviewerRankings: [],
    };
  }

  // ── PHASE 4: SLA ANALYTICS ──────────────────────────────────────────────────
  /**
   * Execution SLA compliance for completed tickets, judged on the SLA clock --
   * when the work was first submitted (or completed, with no review) against
   * the execution due time, using the same due-time rule as the live timer.
   * It used to compare productive work hours with the SLA hours, which marked
   * a ticket "on time" whenever little work was logged, however late it was.
   * Tickets with no due basis are counted separately, not as on time.
   */
  async getSlaAnalytics(currentUser: any, q: { from?: string; to?: string } = {}) {
    const ticketScope = await this.ticketAccess.buildTicketWhereForUser({}, currentUser);
    const range: AnalyticsRange | null = q.from || q.to ? resolveRange(this.tva, q.from, q.to, 30) : null;
    const config = await this.ticketTiming.getSlaConfig();

    const tickets = await this.prisma.ticket.findMany({
      where: this.andWhere(ticketScope, { status: { in: COMPLETED as any } }),
      select: {
        id: true, priority: true, executionDueAt: true, actualStartAt: true, estimatedMinutes: true, dueDate: true,
        submittedAt: true, actualCompletedAt: true, resolvedAt: true, closedAt: true,
        reviewCycles: { select: { createdAt: true }, orderBy: { cycleNo: 'asc' }, take: 1 },
      },
    });

    let onTimeCount = 0;
    let overdueCount = 0;
    let noDueBasis = 0;
    let totalDelaySeconds = 0;
    for (const t of tickets) {
      const doneAt = this.completedAt(t);
      if (range && (!doneAt || doneAt < range.start || doneAt >= range.end)) continue;
      const startedAt = t.actualStartAt;
      const priority = String(t.priority ?? 'MEDIUM');
      const dueAt =
        t.executionDueAt ??
        (startedAt && t.estimatedMinutes ? new Date(startedAt.getTime() + t.estimatedMinutes * 60000) : null) ??
        t.dueDate ??
        (startedAt ? new Date(startedAt.getTime() + (config.execution[priority] ?? config.execution.MEDIUM ?? 24) * 3600000) : null);
      const deliveredAt = t.reviewCycles[0]?.createdAt ?? t.submittedAt ?? doneAt;
      if (!dueAt || !deliveredAt) { noDueBasis++; continue; }
      if (deliveredAt.getTime() <= dueAt.getTime()) {
        onTimeCount++;
      } else {
        overdueCount++;
        totalDelaySeconds += Math.floor((deliveredAt.getTime() - dueAt.getTime()) / 1000);
      }
    }

    // Open tickets past due right now, by the live timer.
    const active = await this.prisma.ticket.findMany({
      where: this.andWhere(ticketScope, { status: { notIn: ['PENDING_APPROVAL', 'DONE', 'CLOSED'] as any } }),
      select: {
        id: true, status: true, priority: true, dueDate: true, createdAt: true, updatedAt: true,
        scheduledStartAt: true, actualStartAt: true, estimatedMinutes: true, executionDueAt: true,
        submittedAt: true, reviewStartedAt: true, reviewDueAt: true, closedAt: true, cancelledAt: true,
        isBlocked: true, blockedAt: true, blockedReason: true,
      },
    });
    const currentlyOverdue = active.filter((t) => this.ticketTiming.getTimingState(t, config).isOverdue).length;

    const total = onTimeCount + overdueCount;
    return {
      onTimePercent: total > 0 ? Math.round((onTimeCount / total) * 100) : 0,
      overduePercent: total > 0 ? Math.round((overdueCount / total) * 100) : 0,
      onTimeCount,
      slaBreaches: overdueCount,
      measuredTickets: total,
      noDueBasis,
      averageDelaySeconds: overdueCount > 0 ? totalDelaySeconds / overdueCount : 0,
      currentlyOverdue,
      range: range ? { from: range.from, to: range.to, timezone: range.timezone } : null,
    };
  }

  // ── PHASE 5: REWORK ANALYTICS ───────────────────────────────────────────────
  async getReworkAnalytics(currentUser: any) {
    const ticketScope = await this.ticketAccess.buildTicketWhereForUser({}, currentUser);

    const tickets = await this.prisma.ticket.findMany({
      where: this.andWhere(ticketScope, { reworkCount: { gt: 0 } }),
      select: { id: true, reworkCount: true, assignedToId: true, taskTypeId: true },
    });

    const reworkCount = tickets.reduce((acc, t) => acc + t.reworkCount, 0);
    const totalTickets = await this.prisma.ticket.count({ where: ticketScope });
    const reworkRate = totalTickets > 0 ? Math.round((tickets.length / totalTickets) * 100) : 0;

    // Rework decisions on visible tickets, by the person who did the work and
    // by task type. Real rows, not placeholders.
    const cycles = await this.prisma.reviewCycleLog.findMany({
      where: { decision: 'REWORK', ticket: ticketScope },
      select: {
        assignee: { select: { id: true, name: true } },
        ticket: { select: { taskType: { select: { id: true, name: true } } } },
      },
    });
    const byEmployee = new Map<string, { userId: string; name: string; count: number }>();
    const byType = new Map<string, { typeId: string; name: string; count: number }>();
    for (const c of cycles) {
      if (c.assignee) {
        const row = byEmployee.get(c.assignee.id) ?? { userId: c.assignee.id, name: c.assignee.name, count: 0 };
        row.count += 1;
        byEmployee.set(c.assignee.id, row);
      }
      const type = c.ticket?.taskType;
      if (type) {
        const row = byType.get(type.id) ?? { typeId: type.id, name: type.name, count: 0 };
        row.count += 1;
        byType.set(type.id, row);
      }
    }
    const top = <T extends { count: number; name: string }>(m: Map<string, T>) =>
      [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 10);

    return {
      reworkCount,
      reworkRate,
      reworkDecisions: cycles.length,
      mostReworkedEmployees: top(byEmployee),
      mostReworkedTicketTypes: top(byType),
    };
  }

  // ── PHASE 6: COMMAND CENTER ─────────────────────────────────────────────────
  /**
   * "Right now" counts are current state and do not depend on the period.
   * Period counts cover the last day / 7 days / 30 days from company midnight.
   * (Before: current-state counts were filtered by updatedAt, and "Pending
   * Approvals" counted every pending leave request in the company.)
   */
  async getCommandCenter(currentUser: any, period: 'today' | 'week' | 'month') {
    const p = (['today', 'week', 'month'] as const).includes(period as any) ? period : 'today';
    const ticketScope = await this.ticketAccess.buildTicketWhereForUser({}, currentUser);
    const leaveScope = await this.leaveAccess.buildLeaveWhereForUser({}, currentUser);
    const since = periodStart(this.tva, p);

    const [activeWork, activeReviews, blockedTickets, pendingApprovals, createdInPeriod, completedInPeriod] = await Promise.all([
      this.prisma.ticket.count({ where: this.andWhere(ticketScope, { status: 'IN_PROGRESS' }) }),
      this.prisma.ticket.count({ where: this.andWhere(ticketScope, { status: 'REVIEW' }) }),
      this.prisma.ticket.count({ where: this.andWhere(ticketScope, { isBlocked: true, status: { notIn: ['PENDING_APPROVAL', 'DONE', 'CLOSED'] } }) }),
      this.prisma.leaveRequest.count({ where: this.andWhere(leaveScope, { status: 'PENDING' }) }),
      this.prisma.ticket.count({ where: this.andWhere(ticketScope, { createdAt: { gte: since } }) }),
      this.prisma.ticket.count({
        where: this.andWhere(ticketScope, {
          status: { in: COMPLETED },
          // Same completion moment as completedAt(): first stamp present wins.
          OR: [
            { actualCompletedAt: { gte: since } },
            { actualCompletedAt: null, resolvedAt: { gte: since } },
            { actualCompletedAt: null, resolvedAt: null, closedAt: { gte: since } },
          ],
        }),
      }),
    ]);

    return {
      period: p,
      since,
      activeWork,
      activeReviews,
      blockedTickets,
      pendingApprovals,
      createdInPeriod,
      completedInPeriod,
    };
  }
}
