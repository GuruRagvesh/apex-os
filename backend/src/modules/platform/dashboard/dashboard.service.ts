import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { TicketStatus, Priority, LeaveStatus } from '@prisma/client';
import { TicketAccessService } from '../../../common/services/ticket-access.service';
import { TicketTimingService } from '../../../common/services/ticket-timing.service';
import { LeaveAccessService } from '../../../common/services/leave-access.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { calculateWorkdayRuntime } from '../workday/workday.calculation';
import { LeaveBalanceService } from '../../operations/leave/leave-balance.service';
import { TVAService } from '../../../common/services/tva.service';

@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    private ticketAccess: TicketAccessService,
    private ticketTiming: TicketTimingService,
    private leaveAccess: LeaveAccessService,
    private accessPolicy: AccessPolicyService,
    private leaveBalance: LeaveBalanceService,
    private tva: TVAService,
  ) {}

  private andWhere(...clauses: any[]): any {
    const parts = clauses.filter((clause) => clause && Object.keys(clause).length > 0);
    if (parts.length === 0) return {};
    if (parts.length === 1) return parts[0];
    return { AND: parts };
  }

  private async countOverdueTickets(scope: any): Promise<number> {
    const tickets = await this.prisma.ticket.findMany({
      where: this.andWhere(scope, { status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] } }),
      select: {
        id: true, status: true, priority: true, dueDate: true, createdAt: true, updatedAt: true,
        scheduledStartAt: true, actualStartAt: true, estimatedMinutes: true, executionDueAt: true,
        submittedAt: true, reviewStartedAt: true, reviewDueAt: true, closedAt: true, cancelledAt: true,
        isBlocked: true, blockedAt: true, blockedReason: true,
      },
    });
    const config = await this.ticketTiming.getSlaConfig();
    // Blocked tickets are excluded from overdue counts
    return tickets.filter((ticket) => this.ticketTiming.getTimingState(ticket, config).isOverdue).length;
  }

  private async buildProjectScope(user: any): Promise<any> {
    const roleName = this.accessPolicy.roleName(user);
    if (!user || this.accessPolicy.isAdmin(user)) return {};
    if (['EMPLOYEE', 'INTERN'].includes(roleName)) {
      return { members: { some: { userId: user.id } } };
    }
    if (['MANAGER', 'TEAM_LEAD'].includes(roleName)) {
      const deptIds = await this.accessPolicy.managedDepartmentIds(user);
      const clauses: any[] = [{ members: { some: { userId: user.id } } }];
      if (deptIds.length > 0) clauses.push({ departmentId: { in: deptIds } });
      return { OR: clauses };
    }
    return { members: { some: { userId: user.id } } };
  }

  async getOverview(user: any) {
    const ticketWhere = await this.ticketAccess.buildTicketWhereForUser({}, user);
    const activeTicketWhere = this.andWhere(ticketWhere, { status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] } });
    const projectWhere = await this.buildProjectScope(user);
    const visibleUserIds = await this.ticketAccess.visibleUserIdsForWorkload(user);
    const leaveScope = await this.leaveAccess.buildLeaveWhereForUser({}, user);

    const [
      totalTickets,
      openTickets,
      inProgressTickets,
      doneTickets,
      urgentTickets,
      totalProjects,
      activeProjects,
      pendingLeave,
      totalUsers,
      teamMembers,
      recentTickets,
      myTickets,
    ] = await Promise.all([
      this.prisma.ticket.count({ where: ticketWhere }),
      this.prisma.ticket.count({ where: this.andWhere(ticketWhere, { status: TicketStatus.OPEN }) }),
      this.prisma.ticket.count({ where: this.andWhere(ticketWhere, { status: TicketStatus.IN_PROGRESS }) }),
      this.prisma.ticket.count({ where: this.andWhere(ticketWhere, { status: TicketStatus.DONE }) }),
      this.prisma.ticket.count({ where: this.andWhere(activeTicketWhere, { priority: Priority.URGENT }) }),
      this.prisma.project.count({ where: projectWhere }),
      this.prisma.project.count({ where: this.andWhere(projectWhere, { status: 'ACTIVE' }) }),
      this.prisma.leaveRequest.count({ where: this.andWhere(leaveScope, { status: LeaveStatus.PENDING }) }),
      visibleUserIds
        ? this.prisma.user.count({ where: { isActive: true, id: { in: visibleUserIds } } })
        : this.prisma.user.count({ where: { isActive: true } }),
      visibleUserIds
        ? this.prisma.user.count({ where: { isActive: true, id: { in: visibleUserIds } } })
        : this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.ticket.findMany({
        where: ticketWhere,
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          assignedTo: { select: { id: true, name: true, avatar: true } },
          createdBy: { select: { id: true, name: true } },
          department: true,
        },
      }),
      this.prisma.ticket.findMany({
        where: ticketWhere,
        take: 5,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        include: {
          assignedTo: { select: { id: true, name: true, avatar: true } },
          department: true,
        },
      }),
    ]);
    const overdueTickets = await this.countOverdueTickets(ticketWhere);

    // Fetch active tickets for bottleneck + blocked counts
    const activeTickets = await this.prisma.ticket.findMany({
      where: this.andWhere(ticketWhere, { status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] } }),
      include: {
        assignedTo: { select: { id: true, name: true, avatar: true } },
        department: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    const config = await this.ticketTiming.getSlaConfig();

    const blockedTickets = activeTickets.filter((ticket: any) => ticket.isBlocked).slice(0, 5);
    const blockedCount   = activeTickets.filter((ticket: any) => ticket.isBlocked).length;

    const bottleneckTickets = activeTickets.filter((ticket: any) => {
      if (ticket.isBlocked) return false; // blocked tickets surface separately
      const isOverdue = this.ticketTiming.getTimingState(ticket, config).isOverdue;
      const isReview = ticket.status === TicketStatus.REVIEW;
      return isOverdue || isReview;
    }).slice(0, 10);

    return {
      stats: {
        totalTickets, openTickets, inProgressTickets, doneTickets,
        urgentTickets, overdueTickets, blockedCount,
        totalProjects, activeProjects,
        pendingLeave, totalUsers, teamMembers,
      },
      recentTickets,
      myTickets,
      bottleneckTickets,
      blockedTickets,
    };
  }

  async getTicketsByCategory(user?: any) {
    const where = await this.ticketAccess.buildTicketWhereForUser({}, user);
    const data = await this.prisma.ticket.groupBy({
      by: ['category'],
      where,
      _count: { _all: true },
    });
    return data.map((d) => ({ category: d.category, count: d._count._all }));
  }

  async getTicketsByDepartment(user?: any) {
    const roleName = this.accessPolicy.roleName(user);
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(roleName);

    const deptWhere = isAdmin ? {} : { id: { in: await this.accessPolicy.managedDepartmentIds(user) } };
    const ticketWhere = await this.ticketAccess.buildTicketWhereForUser({}, user);

    const departments = await this.prisma.department.findMany({
      where: deptWhere,
      include: {
        tickets: {
          where: ticketWhere,
          select: { status: true },
        },
      },
    });

    return departments.map((dept) => ({
      id: dept.id,
      name: dept.name,
      color: dept.color,
      total: dept.tickets.length,
      open: dept.tickets.filter((t) => t.status === TicketStatus.OPEN).length,
      inProgress: dept.tickets.filter((t) => t.status === TicketStatus.IN_PROGRESS).length,
      done: dept.tickets.filter((t) => t.status === TicketStatus.DONE).length,
    }));
  }

  async getActivityFeed(limit = 20, user?: any, userId?: string) {
    const roleName = this.accessPolicy.roleName(user);
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(roleName);

    let whereClause: any = {};
    if (!isAdmin && user) {
      if (['MANAGER', 'TEAM_LEAD'].includes(roleName)) {
        const deptIds = await this.accessPolicy.managedDepartmentIds(user);
        whereClause = {
          OR: [
            { userId: user.id },
            { user: { departmentId: { in: deptIds } } },
          ],
        };
      } else {
        whereClause = { userId: user.id };
      }
    }

    if (userId) {
      if (!isAdmin && user) {
        // Enforce access control: target user must be self or in managed department
        if (userId !== user.id) {
          const deptIds = await this.accessPolicy.managedDepartmentIds(user);
          const targetUser = await this.prisma.user.findUnique({ where: { id: userId } });
          if (!targetUser || !targetUser.departmentId || !deptIds.includes(targetUser.departmentId)) {
            return []; // forbidden
          }
        }
      }
      whereClause = {
        ...whereClause,
        userId: userId,
      };
    }

    return this.prisma.activityLog.findMany({
      where: whereClause,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, avatar: true, departmentId: true } } },
    });
  }

  async getWorkloadByUser(user?: any) {
    const visibleUserIds = user ? await this.ticketAccess.visibleUserIdsForWorkload(user) : null;
    const ticketScope = await this.ticketAccess.buildTicketWhereForUser({}, user);
    const activeTicketScope = this.andWhere(ticketScope, { status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] } });
    const users = await this.prisma.user.findMany({
      where: { isActive: true, ...(visibleUserIds ? { id: { in: visibleUserIds } } : {}) },
      include: {
        role: true,
        department: true,
      },
      take: 100,
      orderBy: { name: 'asc' },
    });
    const userIds = users.map((u) => u.id);
    const tickets = userIds.length > 0
      ? await this.prisma.ticket.findMany({
        where: this.andWhere(activeTicketScope, { assignedToId: { in: userIds } }),
        select: { assignedToId: true, status: true, priority: true },
      })
      : [];
    const ticketMap = new Map<string, Array<{ status: TicketStatus; priority: Priority }>>();
    for (const ticket of tickets) {
      if (!ticket.assignedToId) continue;
      const bucket = ticketMap.get(ticket.assignedToId) ?? [];
      bucket.push(ticket as any);
      ticketMap.set(ticket.assignedToId, bucket);
    }

    return users.map((user) => ({
      id: user.id,
      name: user.name,
      role: user.role.name,
      department: user.department?.name,
      totalAssigned: (ticketMap.get(user.id) ?? []).length,
      urgent: (ticketMap.get(user.id) ?? []).filter((t) => t.priority === Priority.URGENT).length,
      high: (ticketMap.get(user.id) ?? []).filter((t) => t.priority === Priority.HIGH).length,
      inProgress: (ticketMap.get(user.id) ?? []).filter((t) => t.status === TicketStatus.IN_PROGRESS).length,
    }));
  }

  // ── Home Summary ─────────────────────────────────────────────────────────────

  private async getCriticalAlerts(user: any) {
    const roleName: string = user?.role?.name ?? user?.role ?? '';
    const ticketScope = await this.ticketAccess.buildTicketWhereForUser({}, user);
    const alerts: any[] = [];

    const overdueCount = await this.countOverdueTickets(ticketScope);
    if (overdueCount > 0) {
      alerts.push({ type: 'TICKET_OVERDUE', severity: 'red', title: `${overdueCount} overdue ticket${overdueCount > 1 ? 's' : ''}`, desc: 'Tickets past their active SLA timer need immediate attention', actionLabel: 'View', actionUrl: '/tickets?overdue=true' });
    }

    const reviewCount = await this.prisma.ticket.count({
      where: this.andWhere(ticketScope, { status: TicketStatus.REVIEW }),
    });
    if (reviewCount > 0 && ['MANAGER', 'ADMIN', 'SUPER_ADMIN', 'TEAM_LEAD'].includes(roleName)) {
      alerts.push({ type: 'REVIEW_PENDING', severity: 'purple', title: `${reviewCount} ticket${reviewCount > 1 ? 's' : ''} awaiting review`, desc: 'Review and approve or reject to unblock your team', actionLabel: 'Review', actionUrl: '/tickets?status=REVIEW' });
    }

    if (['MANAGER', 'ADMIN', 'SUPER_ADMIN', 'TEAM_LEAD'].includes(roleName)) {
      const leaveScope = await this.leaveAccess.buildLeaveWhereForUser({}, user);
      const pendingLeave = await this.prisma.leaveRequest.count({ where: this.andWhere(leaveScope, { status: LeaveStatus.PENDING }) });
      if (pendingLeave > 0) {
        alerts.push({ type: 'LEAVE_PENDING', severity: 'amber', title: `${pendingLeave} leave request${pendingLeave > 1 ? 's' : ''} pending`, desc: 'Approve or reject leave requests from your team', actionLabel: 'View', actionUrl: '/leave' });
      }
    }

    return alerts;
  }

  private async getMetrics(user: any) {
    const roleName: string = user?.role?.name ?? user?.role ?? '';
    const ticketScope = await this.ticketAccess.buildTicketWhereForUser({}, user);
    const projectScope = await this.buildProjectScope(user);

    if (['EMPLOYEE', 'INTERN'].includes(roleName)) {
      const weekStart = this.tva.now();
      weekStart.setDate(weekStart.getDate() - 7);
      const [open, inProgress, inReview, doneThisWeek, activeProjects] = await Promise.all([
        this.prisma.ticket.count({ where: this.andWhere(ticketScope, { status: TicketStatus.OPEN }) }),
        this.prisma.ticket.count({ where: this.andWhere(ticketScope, { status: TicketStatus.IN_PROGRESS }) }),
        this.prisma.ticket.count({ where: this.andWhere(ticketScope, { status: TicketStatus.REVIEW }) }),
        this.prisma.ticket.count({ where: this.andWhere(ticketScope, { status: TicketStatus.DONE, updatedAt: { gte: weekStart } }) }),
        this.prisma.project.count({ where: this.andWhere(projectScope, { status: 'ACTIVE' }) }),
      ]);
      const overdue = await this.countOverdueTickets(ticketScope);
      return { open, inProgress, inReview, doneThisWeek, activeProjects, overdue };
    }

    if (roleName === 'TEAM_LEAD') {
      const visibleUserIds = await this.ticketAccess.visibleUserIdsForWorkload(user);
      const [total, overdue, inReview, teamOnline, activeProjects] = await Promise.all([
        this.prisma.ticket.count({ where: ticketScope }),
        this.countOverdueTickets(ticketScope),
        this.prisma.ticket.count({ where: this.andWhere(ticketScope, { status: TicketStatus.REVIEW }) }),
        this.prisma.user.count({
          where: this.andWhere(
            { currentStatus: { in: ['WORKING', 'ON_BREAK', 'LOGGED_IN'] } },
            visibleUserIds ? { id: { in: visibleUserIds } } : {},
          ),
        }),
        this.prisma.project.count({ where: this.andWhere(projectScope, { status: 'ACTIVE' }) }),
      ]);
      return { total, overdue, inReview, teamOnline, activeProjects };
    }

    if (roleName === 'MANAGER') {
      const leaveScope = await this.leaveAccess.buildLeaveWhereForUser({}, user);
      const visibleUserIds = await this.ticketAccess.visibleUserIdsForWorkload(user);
      const [total, overdue, pendingLeave, teamCount, activeProjects] = await Promise.all([
        this.prisma.ticket.count({ where: ticketScope }),
        this.countOverdueTickets(ticketScope),
        this.prisma.leaveRequest.count({ where: this.andWhere(leaveScope, { status: LeaveStatus.PENDING }) }),
        this.prisma.user.count({ where: { isActive: true, ...(visibleUserIds ? { id: { in: visibleUserIds } } : {}) } }),
        this.prisma.project.count({ where: this.andWhere(projectScope, { status: 'ACTIVE' }) }),
      ]);
      return { total, overdue, pendingLeave, teamCount, activeProjects };
    }

    // ADMIN / SUPER_ADMIN
    const leaveScope = await this.leaveAccess.buildLeaveWhereForUser({}, user);
    const [activeToday, totalTickets, openTickets, overdue, pendingLeave, activeProjects] = await Promise.all([
      this.prisma.user.count({ where: { currentStatus: { in: ['WORKING', 'ON_BREAK', 'LOGGED_IN'] } } }),
      this.prisma.ticket.count({ where: this.andWhere(ticketScope, { status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] } }) }),
      this.prisma.ticket.count({ where: this.andWhere(ticketScope, { status: TicketStatus.OPEN }) }),
      this.countOverdueTickets(ticketScope),
      this.prisma.leaveRequest.count({ where: this.andWhere(leaveScope, { status: LeaveStatus.PENDING }) }),
      this.prisma.project.count({ where: this.andWhere(projectScope, { status: 'ACTIVE' }) }),
    ]);
    return { activeToday, totalTickets, openTickets, overdue, pendingLeave, activeProjects };
  }

  private async getWorkdayStatus(user: any) {
    const today = this.tva.companyDayStart();
    const now = this.tva.now();
    
    const sessions = await this.prisma.workSession.findMany({
      where: { userId: user.id, date: today },
      orderBy: { createdAt: 'asc' },
      include: { breakLogs: { orderBy: { startAt: 'asc' } } },
    });

    const latestSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;
    if (!latestSession) return null;

    const rt = calculateWorkdayRuntime(sessions as any, now);
    
    return {
      ...latestSession,
      totalBreakMinutes: rt.totalBreakMinutes,
      totalWorkMinutes: rt.elapsedWorkMinutes,
      startWorkAt: rt.firstStartTime,
    };
  }

  private async getUpcomingEvents(user: any) {
    const ticketScope = await this.ticketAccess.buildTicketWhereForUser({}, user);
    const now = this.tva.now();
    const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const events: any[] = [];

    const tickets = await this.prisma.ticket.findMany({
      where: this.andWhere(ticketScope, { status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] }, dueDate: { gte: now, lte: in3Days } }),
      select: { id: true, ticketId: true, title: true, dueDate: true, priority: true, status: true },
      orderBy: { dueDate: 'asc' },
      take: 10,
    });

    for (const t of tickets) {
      events.push({ title: `${t.ticketId}: ${t.title}`, time: t.dueDate, color: t.priority === 'URGENT' ? 'red' : 'blue', url: `/tickets/${t.id}` });
    }

    const leaveScope = await this.leaveAccess.buildLeaveWhereForUser({}, user);
    const leaves = await this.prisma.leaveRequest.findMany({
      where: this.andWhere(leaveScope, { status: LeaveStatus.APPROVED, startDate: { gte: now, lte: in3Days } }),
      include: { user: { select: { id: true, name: true } } },
      take: 5,
    });

    for (const l of leaves) {
      events.push({ title: `${l.user.name}: ${l.type} leave`, time: l.startDate, color: 'green', url: '/leave' });
    }

    events.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    return events.slice(0, 10);
  }

  private async getPreviews(user: any) {
    const roleName: string = user?.role?.name ?? user?.role ?? '';
    const ticketScope = await this.ticketAccess.buildTicketWhereForUser({}, user);
    const projectScope = await this.buildProjectScope(user);
    const leaveScope = await this.leaveAccess.buildLeaveWhereForUser({}, user);

    const [overdueTicketsList, activeProjectsList, pendingLeaveList, inReviewList] = await Promise.all([
      // Overdue tickets
      this.prisma.ticket.findMany({
        where: this.andWhere(ticketScope, { status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] } }),
        select: {
          id: true, ticketId: true, title: true, dueDate: true, createdAt: true, updatedAt: true,
          scheduledStartAt: true, actualStartAt: true, estimatedMinutes: true, executionDueAt: true,
          submittedAt: true, reviewStartedAt: true, reviewDueAt: true, closedAt: true, cancelledAt: true,
        },
      }),
      // Active projects
      this.prisma.project.findMany({
        where: this.andWhere(projectScope, { status: 'ACTIVE' }),
        select: { projectId: true, name: true },
        take: 5,
        orderBy: { createdAt: 'desc' },
      }),
      // Pending leave
      ['MANAGER', 'ADMIN', 'SUPER_ADMIN', 'TEAM_LEAD'].includes(roleName)
        ? this.prisma.leaveRequest.findMany({
            where: this.andWhere(leaveScope, { status: LeaveStatus.PENDING }),
            select: {
              startDate: true, endDate: true, type: true, isHalfDay: true,
              user: { select: { name: true } },
            },
            take: 5,
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve([]),
      // In Review tickets
      this.prisma.ticket.findMany({
        where: this.andWhere(ticketScope, { status: TicketStatus.REVIEW }),
        select: { ticketId: true, title: true },
        take: 5,
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    const config = await this.ticketTiming.getSlaConfig();
    const overdue = overdueTicketsList
      .filter((ticket) => this.ticketTiming.getTimingState(ticket, config).isOverdue)
      .slice(0, 5)
      .map((t) => `${t.ticketId}: ${t.title}`);

    const activeProjects = activeProjectsList.map((p) => `${p.projectId}: ${p.name}`);

    const pendingLeave = await Promise.all(pendingLeaveList.map(async (l) => {
      const dur = await this.leaveBalance.getDurationForRequest(l.startDate, l.endDate, l.isHalfDay);
      return `${l.user.name}: ${l.type} (${dur}d)`;
    }));

    const inReviewTickets = inReviewList.map((t) => `${t.ticketId}: ${t.title}`);

    return {
      overdueTickets: overdue,
      activeProjects,
      pendingLeave,
      inReviewTickets,
    };
  }

  private async getApprovalWorkload(user: any) {
    const roleName: string = user?.role?.name ?? user?.role ?? '';
    if (!['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleName)) return null;

    const reviewCycles = await this.prisma.reviewCycleLog.findMany({
      where: { reviewerId: user.id, decision: { not: null } },
      select: { reviewerWorkSeconds: true, ticket: { select: { priority: true } } },
    });

    const config = await this.ticketTiming.getSlaConfig();
    let slaBreaches = 0;

    reviewCycles.forEach(c => {
      const priority = c.ticket?.priority ?? 'MEDIUM';
      const limitHours = config.review[priority] ?? config.review['MEDIUM'] ?? 24;
      const limitSeconds = limitHours * 3600;
      if ((c.reviewerWorkSeconds || 0) > limitSeconds) {
        slaBreaches++;
      }
    });

    const completedReviews = reviewCycles.length;
    const totalApprovalSeconds = reviewCycles.reduce((acc, c) => acc + (c.reviewerWorkSeconds || 0), 0);
    const avgApprovalTime = completedReviews > 0 ? totalApprovalSeconds / completedReviews : 0;

    const pendingReviews = await this.prisma.ticket.count({
      where: { status: 'REVIEW', reviewDueAt: { not: null } },
    });

    return { pendingReviews, completedReviews, avgApprovalTime, slaBreaches };
  }

  async getSummary(user: any) {
    const [criticalAlerts, metrics, workdayStatus, upcomingEvents, previews, approvalWorkload] = await Promise.all([
      this.getCriticalAlerts(user),
      this.getMetrics(user),
      this.getWorkdayStatus(user),
      this.getUpcomingEvents(user),
      this.getPreviews(user),
      this.getApprovalWorkload(user),
    ]);

    return { criticalAlerts, metrics, workdayStatus, upcomingEvents, previews, approvalWorkload };
  }

  async getTicketTrend(days = 14, user?: any) {
    const startDate = this.tva.now();
    startDate.setDate(startDate.getDate() - days);
    const ticketScope = await this.ticketAccess.buildTicketWhereForUser({}, user);

    const [createdTickets, resolvedTickets] = await Promise.all([
      this.prisma.ticket.findMany({
        where: this.andWhere(ticketScope, { createdAt: { gte: startDate } }),
        select: { createdAt: true },
      }),
      this.prisma.ticket.findMany({
        where: this.andWhere(ticketScope, {
          status: { in: [TicketStatus.DONE, TicketStatus.CLOSED] },
          resolvedAt: { gte: startDate },
        }),
        select: { resolvedAt: true },
      }),
    ]);

    const trend: Record<string, { created: number; resolved: number }> = {};
    for (let i = 0; i < days; i++) {
      const d = this.tva.now();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      trend[key] = { created: 0, resolved: 0 };
    }

    createdTickets.forEach((t) => {
      const key = t.createdAt.toISOString().split('T')[0];
      if (trend[key]) trend[key].created++;
    });
    resolvedTickets.forEach((t) => {
      const key = t.resolvedAt?.toISOString().split('T')[0];
      if (key && trend[key]) trend[key].resolved++;
    });

    return Object.entries(trend)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({ date, ...data }));
  }
}
