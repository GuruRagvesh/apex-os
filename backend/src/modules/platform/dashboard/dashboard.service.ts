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
