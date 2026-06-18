import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';

@Injectable()
export class DepartmentsService {
  constructor(
    private prisma: PrismaService,
    private access: AccessPolicyService,
  ) {}

  async findAll(user?: any) {
    let where: any = {};
    if (!this.access.isAdmin(user)) {
      const deptIds = await this.access.managedDepartmentIds(user);
      if (deptIds.length === 0) return [];
      where = { id: { in: deptIds } };
    }

    const departments = await this.prisma.department.findMany({
      where,
      include: {
        _count: {
          select: {
            users: true,
            tickets: { where: { status: { notIn: ['DONE', 'CLOSED'] } } },
            projects: true,
          },
        },
        users: {
          where: { role: { name: { in: ['MANAGER', 'TEAM_LEAD'] } } },
          include: { role: true },
          orderBy: { role: { level: 'asc' } },
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
    });

    return departments.map((d) => ({
      ...d,
      teamLead: d.users[0] ?? null,
      activeTickets: d._count.tickets,
    }));
  }

  async findOne(id: string) {
    const dept = await this.prisma.department.findUnique({
      where: { id },
      include: {
        users: {
          include: {
            role: true,
            _count: { select: { assignedTickets: true } },
          },
          orderBy: { name: 'asc' },
        },
        tickets: {
          where: { status: { notIn: ['DONE', 'CLOSED'] } },
          include: {
            assignedTo: { select: { id: true, name: true, avatar: true } },
            createdBy: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        _count: {
          select: {
            users: true,
            tickets: { where: { status: { notIn: ['DONE', 'CLOSED'] } } },
            projects: true,
          },
        },
      },
    });

    if (!dept) throw new NotFoundException('Department not found');

    const pendingLeave = await this.prisma.leaveRequest.count({
      where: { user: { departmentId: id }, status: 'PENDING' },
    });

    const teamLead =
      dept.users.find((u) => ['MANAGER', 'TEAM_LEAD'].includes((u as any).role?.name)) ?? null;

    return {
      ...dept,
      teamLead,
      stats: {
        totalMembers: dept._count.users,
        activeTickets: dept._count.tickets,
        pendingLeave,
        projects: dept._count.projects,
      },
    };
  }

  create(data: { name: string; description?: string; color?: string }) {
    return this.prisma.department.create({ data });
  }

  update(id: string, data: { name?: string; description?: string; color?: string }) {
    return this.prisma.department.update({ where: { id }, data });
  }

  async remove(id: string) {
    const dept = await this.prisma.department.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!dept) throw new NotFoundException('Department not found');

    // Block on operational/historical data — these must be preserved or reassigned
    const [activeUsers, allTickets, projects] = await Promise.all([
      this.prisma.user.count({ where: { departmentId: id, isActive: true } }),
      this.prisma.ticket.count({ where: { departmentId: id } }),
      this.prisma.project.count({ where: { departmentId: id } }),
    ]);

    if (activeUsers > 0) {
      throw new ConflictException(
        `"${dept.name}" has ${activeUsers} active member${activeUsers > 1 ? 's' : ''}. Reassign them to another department first.`,
      );
    }
    if (allTickets > 0) {
      throw new ConflictException(
        `"${dept.name}" has ${allTickets} ticket${allTickets > 1 ? 's' : ''} (including historical). Archive this department instead of deleting it, or reassign all tickets first.`,
      );
    }
    if (projects > 0) {
      throw new ConflictException(
        `"${dept.name}" has ${projects} linked project${projects > 1 ? 's' : ''}. Reassign them before deleting this department.`,
      );
    }

    // ManagerDeptAccess rows are permission links, not operational data.
    // Safe to remove automatically when no users, tickets, or projects remain.
    await this.prisma.$transaction([
      this.prisma.managerDeptAccess.deleteMany({ where: { departmentId: id } }),
      this.prisma.department.delete({ where: { id } }),
    ]);
  }
}
