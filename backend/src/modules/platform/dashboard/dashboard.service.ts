import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { TicketStatus, Priority, LeaveStatus } from '@prisma/client';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getOverview(userId: string, userRole: string) {
    const isManagerPlus = ['ADMIN', 'MANAGER', 'SUPER_ADMIN'].includes(userRole);
    const isEmployeeRole = ['EMPLOYEE', 'INTERN'].includes(userRole);

    // Fetch managed department IDs for managers
    let managedDeptIds: string[] = [];
    let managerUser: any = null;
    if (userRole === 'MANAGER') {
      managerUser = await this.prisma.user.findUnique({ where: { id: userId } });
      const access = await (this.prisma as any).managerDeptAccess.findMany({
        where: { managerId: userId }, select: { departmentId: true },
      });
      managedDeptIds = access.map((a: any) => a.departmentId);
      if (managerUser?.departmentId) managedDeptIds.push(managerUser.departmentId);
      managedDeptIds = [...new Set(managedDeptIds)];
    }

    const ticketWhere = isManagerPlus
      ? (managedDeptIds.length > 0 ? { departmentId: { in: managedDeptIds } } : {})
      : { OR: [{ assignedToId: userId }, { createdById: userId }] };

    const [
      totalTickets,
      openTickets,
      inProgressTickets,
      doneTickets,
      urgentTickets,
      overdueTickets,
      totalProjects,
      activeProjects,
      pendingLeave,
      totalUsers,
      teamMembers,
      recentTickets,
      myTickets,
    ] = await Promise.all([
      this.prisma.ticket.count(),
      this.prisma.ticket.count({ where: { status: TicketStatus.OPEN, ...ticketWhere } }),
      this.prisma.ticket.count({ where: { status: TicketStatus.IN_PROGRESS, ...ticketWhere } }),
      this.prisma.ticket.count({ where: { status: TicketStatus.DONE, ...ticketWhere } }),
      this.prisma.ticket.count({ where: { priority: Priority.URGENT, status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] }, ...ticketWhere } }),
      this.prisma.ticket.count({
        where: { dueDate: { lt: new Date() }, status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] }, ...ticketWhere },
      }),
      this.prisma.project.count(),
      this.prisma.project.count({ where: { status: 'ACTIVE' } }),
      // Employees see only their own pending leave; managers see their dept; admins see all
      isEmployeeRole
        ? this.prisma.leaveRequest.count({ where: { status: LeaveStatus.PENDING, userId } })
        : managedDeptIds.length > 0
          ? this.prisma.leaveRequest.count({ where: { status: LeaveStatus.PENDING, user: { departmentId: { in: managedDeptIds } } } })
          : this.prisma.leaveRequest.count({ where: { status: LeaveStatus.PENDING } }),
      this.prisma.user.count({ where: { isActive: true } }),
      // Team member count for managers
      managedDeptIds.length > 0
        ? this.prisma.user.count({ where: { isActive: true, departmentId: { in: managedDeptIds } } })
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
        where: isManagerPlus ? {} : { OR: [{ assignedToId: userId }, { createdById: userId }] },
        take: 5,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        include: {
          assignedTo: { select: { id: true, name: true, avatar: true } },
          department: true,
        },
      }),
    ]);

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

  async getTicketsByCategory() {
    const data = await this.prisma.ticket.groupBy({
      by: ['category'],
      _count: { _all: true },
    });
    return data.map((d) => ({ category: d.category, count: d._count._all }));
  }

  async getTicketsByDepartment() {
    const departments = await this.prisma.department.findMany({
      include: {
        _count: {
          select: { tickets: true },
        },
        tickets: {
          select: { status: true },
        },
      },
    });

    return departments.map((dept) => ({
      id: dept.id,
      name: dept.name,
      color: dept.color,
      total: dept._count.tickets,
      open: dept.tickets.filter((t) => t.status === TicketStatus.OPEN).length,
      inProgress: dept.tickets.filter((t) => t.status === TicketStatus.IN_PROGRESS).length,
      done: dept.tickets.filter((t) => t.status === TicketStatus.DONE).length,
    }));
  }

  async getActivityFeed(limit = 20) {
    return this.prisma.activityLog.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    });
  }

  async getWorkloadByUser() {
    const users = await this.prisma.user.findMany({
      where: { isActive: true },
      include: {
        assignedTickets: {
          where: { status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] } },
          select: { status: true, priority: true },
        },
        role: true,
        department: true,
      },
      take: 100,
      orderBy: { name: 'asc' },
    });

    return users.map((user) => ({
      id: user.id,
      name: user.name,
      role: user.role.name,
      department: user.department?.name,
      totalAssigned: user.assignedTickets.length,
      urgent: user.assignedTickets.filter((t) => t.priority === Priority.URGENT).length,
      high: user.assignedTickets.filter((t) => t.priority === Priority.HIGH).length,
      inProgress: user.assignedTickets.filter((t) => t.status === TicketStatus.IN_PROGRESS).length,
    }));
  }

  // ── Home Summary ─────────────────────────────────────────────────────────────

  private async buildRoleScope(user: any): Promise<any> {
    const roleName: string = user?.role?.name ?? user?.role ?? '';
    if (['ADMIN', 'SUPER_ADMIN'].includes(roleName)) return {};
    if (roleName === 'MANAGER') {
      const access = await (this.prisma as any).managerDeptAccess.findMany({ where: { managerId: user.id } });
      const deptIds: string[] = access.map((a: any) => a.departmentId as string);
      if (user.departmentId) deptIds.push(user.departmentId);
      const uniqueDeptIds: string[] = [...new Set(deptIds)];
      if (uniqueDeptIds.length > 0) return { departmentId: { in: uniqueDeptIds } };
      return {};
    }
    if (roleName === 'TEAM_LEAD') {
      if (user.departmentId) {
        return { OR: [{ departmentId: user.departmentId }, { createdById: user.id }, { assignedToId: user.id }] };
      }
    }
    return { OR: [{ assignedToId: user.id }, { createdById: user.id }] };
  }

  private async buildLeaveScope(user: any): Promise<any> {
    const roleName: string = user?.role?.name ?? user?.role ?? '';
    if (['EMPLOYEE', 'INTERN'].includes(roleName)) return { userId: user.id };
    if (roleName === 'TEAM_LEAD') {
      if (!user.departmentId) return { userId: user.id };
      return { user: { departmentId: user.departmentId } };
    }
    if (roleName === 'MANAGER') {
      const access = await (this.prisma as any).managerDeptAccess.findMany({ where: { managerId: user.id } });
      const deptIds: string[] = access.map((a: any) => a.departmentId as string);
      if (user.departmentId && !deptIds.includes(user.departmentId)) deptIds.push(user.departmentId);
      const unique = [...new Set(deptIds)];
      if (unique.length === 0) return { userId: user.id };
      return { user: { departmentId: { in: unique } } };
    }
    return {};
  }

  private async getCriticalAlerts(user: any) {
    const roleName: string = user?.role?.name ?? user?.role ?? '';
    const scope = await this.buildRoleScope(user);
    const alerts: any[] = [];

    const overdueCount = await this.prisma.ticket.count({
      where: { ...scope, dueDate: { lt: new Date() }, status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] } },
    });
    if (overdueCount > 0) {
      alerts.push({ type: 'TICKET_OVERDUE', severity: 'red', title: `${overdueCount} overdue ticket${overdueCount > 1 ? 's' : ''}`, desc: 'Tickets past their due date need immediate attention', actionLabel: 'View', actionUrl: '/tickets?overdue=true' });
    }

    const reviewCount = await this.prisma.ticket.count({
      where: { ...scope, status: TicketStatus.REVIEW },
    });
    if (reviewCount > 0 && ['MANAGER', 'ADMIN', 'SUPER_ADMIN', 'TEAM_LEAD'].includes(roleName)) {
      alerts.push({ type: 'REVIEW_PENDING', severity: 'purple', title: `${reviewCount} ticket${reviewCount > 1 ? 's' : ''} awaiting review`, desc: 'Review and approve or reject to unblock your team', actionLabel: 'Review', actionUrl: '/tickets?status=REVIEW' });
    }

    if (['MANAGER', 'ADMIN', 'SUPER_ADMIN', 'TEAM_LEAD'].includes(roleName)) {
      const leaveScope = await this.buildLeaveScope(user);
      const pendingLeave = await this.prisma.leaveRequest.count({ where: { ...leaveScope, status: LeaveStatus.PENDING } });
      if (pendingLeave > 0) {
        alerts.push({ type: 'LEAVE_PENDING', severity: 'amber', title: `${pendingLeave} leave request${pendingLeave > 1 ? 's' : ''} pending`, desc: 'Approve or reject leave requests from your team', actionLabel: 'View', actionUrl: '/leave' });
      }
    }

    return alerts;
  }

  private async getMetrics(user: any) {
    const roleName: string = user?.role?.name ?? user?.role ?? '';
    const scope = await this.buildRoleScope(user);

    if (['EMPLOYEE', 'INTERN'].includes(roleName)) {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - 7);
      const [open, inProgress, inReview, doneThisWeek] = await Promise.all([
        this.prisma.ticket.count({ where: { ...scope, status: TicketStatus.OPEN } }),
        this.prisma.ticket.count({ where: { ...scope, status: TicketStatus.IN_PROGRESS } }),
        this.prisma.ticket.count({ where: { ...scope, status: TicketStatus.REVIEW } }),
        this.prisma.ticket.count({ where: { ...scope, status: TicketStatus.DONE, updatedAt: { gte: weekStart } } }),
      ]);
      return { open, inProgress, inReview, doneThisWeek };
    }

    if (roleName === 'TEAM_LEAD') {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const [total, overdue, inReview, teamOnline] = await Promise.all([
        this.prisma.ticket.count({ where: scope }),
        this.prisma.ticket.count({ where: { ...scope, dueDate: { lt: new Date() }, status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] } } }),
        this.prisma.ticket.count({ where: { ...scope, status: TicketStatus.REVIEW } }),
        this.prisma.user.count({ where: { departmentId: user.departmentId, currentStatus: { in: ['WORKING', 'ON_BREAK', 'LOGGED_IN'] } } }),
      ]);
      return { total, overdue, inReview, teamOnline };
    }

    if (roleName === 'MANAGER') {
      const leaveScope = await this.buildLeaveScope(user);
      const [total, overdue, pendingLeave, teamCount] = await Promise.all([
        this.prisma.ticket.count({ where: scope }),
        this.prisma.ticket.count({ where: { ...scope, dueDate: { lt: new Date() }, status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] } } }),
        this.prisma.leaveRequest.count({ where: { ...leaveScope, status: LeaveStatus.PENDING } }),
        this.prisma.user.count({ where: { isActive: true, ...(user.departmentId ? { departmentId: user.departmentId } : {}) } }),
      ]);
      return { total, overdue, pendingLeave, teamCount };
    }

    // ADMIN / SUPER_ADMIN
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [activeToday, totalTickets, overdue, pendingLeave] = await Promise.all([
      this.prisma.user.count({ where: { currentStatus: { in: ['WORKING', 'ON_BREAK', 'LOGGED_IN'] } } }),
      this.prisma.ticket.count({ where: { status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] } } }),
      this.prisma.ticket.count({ where: { dueDate: { lt: new Date() }, status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] } } }),
      this.prisma.leaveRequest.count({ where: { status: LeaveStatus.PENDING } }),
    ]);
    return { activeToday, totalTickets, overdue, pendingLeave };
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
    const scope = await this.buildRoleScope(user);
    const now = new Date();
    const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const events: any[] = [];

    const tickets = await this.prisma.ticket.findMany({
      where: { ...scope, status: { notIn: [TicketStatus.DONE, TicketStatus.CLOSED] }, dueDate: { gte: now, lte: in3Days } },
      select: { id: true, ticketId: true, title: true, dueDate: true, priority: true, status: true },
      orderBy: { dueDate: 'asc' },
      take: 10,
    });

    for (const t of tickets) {
      events.push({ title: `${t.ticketId}: ${t.title}`, time: t.dueDate, color: t.priority === 'URGENT' ? 'red' : 'blue', url: `/tickets/${t.id}` });
    }

    const leaveScope = await this.buildLeaveScope(user);
    const leaves = await this.prisma.leaveRequest.findMany({
      where: { ...leaveScope, status: LeaveStatus.APPROVED, startDate: { gte: now, lte: in3Days } },
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

  async getTicketTrend(days = 14) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const tickets = await this.prisma.ticket.findMany({
      where: { createdAt: { gte: startDate } },
      select: { createdAt: true, status: true },
    });

    const trend: Record<string, { created: number; resolved: number }> = {};
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      trend[key] = { created: 0, resolved: 0 };
    }

    tickets.forEach((t) => {
      const key = t.createdAt.toISOString().split('T')[0];
      if (trend[key]) trend[key].created++;
      if (t.status === TicketStatus.DONE || t.status === TicketStatus.CLOSED) {
        if (trend[key]) trend[key].resolved++;
      }
    });

    return Object.entries(trend)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({ date, ...data }));
  }
}
