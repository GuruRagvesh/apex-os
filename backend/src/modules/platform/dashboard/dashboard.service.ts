import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { TicketStatus, Priority, LeaveStatus } from '@prisma/client';
import { TicketAccessService } from '../../../common/services/ticket-access.service';
import { TicketTimingService } from '../../../common/services/ticket-timing.service';
import { LeaveAccessService } from '../../../common/services/leave-access.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';

@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    private ticketAccess: TicketAccessService,
    private ticketTiming: TicketTimingService,
    private leaveAccess: LeaveAccessService,
    private accessPolicy: AccessPolicyService,
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
      },
    });
    const config = await this.ticketTiming.getSlaConfig();
    return tickets.filter((ticket) => this.ticketTiming.getTimingState(ticket, config).isOverdue).length;
  }

  async getOverview(user: any) {
    const userId = user.id;
    const userRole = user.role?.name ?? user.role ?? '';
    const isEmployeeRole = ['EMPLOYEE', 'INTERN'].includes(userRole);
    const ticketWhere = await this.ticketAccess.buildTicketWhereForUser({}, user);
    const activeTicketWhere = this.andWhere(ticketWhere, { status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] } });
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
      this.prisma.project.count(),
      this.prisma.project.count({ where: { status: 'ACTIVE' } }),
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

    return {
      stats: {
        totalTickets, openTickets, inProgressTickets, doneTickets,
        urgentTickets, overdueTickets, totalProjects, activeProjects,
        pendingLeave, totalUsers, teamMembers,
      },
      recentTickets,
      myTickets,
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
      const deptIds = await this.accessPolicy.managedDepartmentIds(user);
      whereClause = {
        OR: [
          { userId: user.id },
          { user: { departmentId: { in: deptIds } } },
        ],
      };
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

    const overdueCount = await this.prisma.ticket.count({
      where: this.andWhere(ticketScope, { dueDate: { lt: new Date() }, status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] } }),
    });
    if (overdueCount > 0) {
      alerts.push({ type: 'TICKET_OVERDUE', severity: 'red', title: `${overdueCount} overdue ticket${overdueCount > 1 ? 's' : ''}`, desc: 'Tickets past their due date need immediate attention', actionLabel: 'View', actionUrl: '/tickets?overdue=true' });
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

    if (['EMPLOYEE', 'INTERN'].includes(roleName)) {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - 7);
      const [open, inProgress, inReview, doneThisWeek, activeProjects] = await Promise.all([
        this.prisma.ticket.count({ where: this.andWhere(ticketScope, { status: TicketStatus.OPEN }) }),
        this.prisma.ticket.count({ where: this.andWhere(ticketScope, { status: TicketStatus.IN_PROGRESS }) }),
        this.prisma.ticket.count({ where: this.andWhere(ticketScope, { status: TicketStatus.REVIEW }) }),
        this.prisma.ticket.count({ where: this.andWhere(ticketScope, { status: TicketStatus.DONE, updatedAt: { gte: weekStart } }) }),
        this.prisma.project.count({ where: { status: 'ACTIVE' } }),
      ]);
      return { open, inProgress, inReview, doneThisWeek, activeProjects };
    }

    if (roleName === 'TEAM_LEAD') {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const [total, overdue, inReview, teamOnline, activeProjects] = await Promise.all([
        this.prisma.ticket.count({ where: ticketScope }),
        this.prisma.ticket.count({ where: this.andWhere(ticketScope, { dueDate: { lt: new Date() }, status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] } }) }),
        this.prisma.ticket.count({ where: this.andWhere(ticketScope, { status: TicketStatus.REVIEW }) }),
        this.prisma.user.count({ where: { departmentId: user.departmentId, currentStatus: { in: ['WORKING', 'ON_BREAK', 'LOGGED_IN'] } } }),
        this.prisma.project.count({ where: { status: 'ACTIVE' } }),
      ]);
      return { total, overdue, inReview, teamOnline, activeProjects };
    }

    if (roleName === 'MANAGER') {
      const leaveScope = await this.leaveAccess.buildLeaveWhereForUser({}, user);
      const [total, overdue, pendingLeave, teamCount, activeProjects] = await Promise.all([
        this.prisma.ticket.count({ where: ticketScope }),
        this.prisma.ticket.count({ where: this.andWhere(ticketScope, { dueDate: { lt: new Date() }, status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] } }) }),
        this.prisma.leaveRequest.count({ where: this.andWhere(leaveScope, { status: LeaveStatus.PENDING }) }),
        this.prisma.user.count({ where: { isActive: true, ...(user.departmentId ? { departmentId: user.departmentId } : {}) } }),
        this.prisma.project.count({ where: { status: 'ACTIVE' } }),
      ]);
      return { total, overdue, pendingLeave, teamCount, activeProjects };
    }

    // ADMIN / SUPER_ADMIN
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [activeToday, totalTickets, overdue, pendingLeave, activeProjects] = await Promise.all([
      this.prisma.user.count({ where: { currentStatus: { in: ['WORKING', 'ON_BREAK', 'LOGGED_IN'] } } }),
      this.prisma.ticket.count({ where: { status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] } } }),
      this.prisma.ticket.count({ where: { dueDate: { lt: new Date() }, status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] } } }),
      this.prisma.leaveRequest.count({ where: { status: LeaveStatus.PENDING } }),
      this.prisma.project.count({ where: { status: 'ACTIVE' } }),
    ]);
    return { activeToday, totalTickets, overdue, pendingLeave, activeProjects };
  }

  private async getWorkdayStatus(user: any) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const session = await this.prisma.workSession.findUnique({
      where: { userId_date: { userId: user.id, date: today } },
      include: { breakLogs: { orderBy: { startAt: 'desc' }, take: 1 } },
    });
    return session;
  }

  private async getUpcomingEvents(user: any) {
    const ticketScope = await this.ticketAccess.buildTicketWhereForUser({}, user);
    const now = new Date();
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

  async getSummary(user: any) {
    const [criticalAlerts, metrics, workdayStatus, upcomingEvents] = await Promise.all([
      this.getCriticalAlerts(user),
      this.getMetrics(user),
      this.getWorkdayStatus(user),
      this.getUpcomingEvents(user),
    ]);

    return { criticalAlerts, metrics, workdayStatus, upcomingEvents };
  }

  async getTicketTrend(days = 14, user?: any) {
    const startDate = new Date();
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
      const d = new Date();
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
