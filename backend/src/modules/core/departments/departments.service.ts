import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';

const MANAGER_SELECT = {
  id: true,
  name: true,
  email: true,
  avatar: true,
  isActive: true,
  role: { select: { id: true, name: true } },
};

const MANAGER_ASSIGNABLE_ROLES = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'];

@Injectable()
export class DepartmentsService {
  constructor(
    private prisma: PrismaService,
    private access: AccessPolicyService,
  ) {}

  // Product rule: a department has exactly one Department Head, sourced from ManagerDeptAccess —
  // not a guess from department membership/role. Schema still allows multiple rows for a department
  // (no DB-level uniqueness change yet), so this defensively picks one deterministic row instead of
  // throwing if legacy/accidental duplicate data exists.
  private async selectDepartmentHead(departmentId: string) {
    const rows = await this.prisma.managerDeptAccess.findMany({
      where: {
        departmentId,
        manager: { isActive: true, role: { name: { in: MANAGER_ASSIGNABLE_ROLES } } },
      },
      include: { manager: { select: MANAGER_SELECT } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (rows.length === 0) return null;
    return { ...rows[0].manager, accessLevel: rows[0].accessLevel };
  }

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
            users: { where: { isActive: true } },
            tickets: { where: { status: { notIn: ['DONE', 'CLOSED'] } } },
            projects: true,
            managerAccess: { where: { manager: { isActive: true } } },
          },
        },
        users: {
          where: { isActive: true, role: { name: { in: ['MANAGER', 'TEAM_LEAD'] } } },
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
      managerCount: d._count.managerAccess,
      hasDepartmentHead: d._count.managerAccess > 0,
    }));
  }

  async findOne(id: string) {
    const dept = await this.prisma.department.findUnique({
      where: { id },
      include: {
        users: {
          where: { isActive: true },
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
            users: { where: { isActive: true } },
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

    const departmentHead = await this.selectDepartmentHead(id);

    return {
      ...dept,
      teamLead,
      departmentHead,
      // Compatibility shape for existing consumers — at most one entry now that a
      // department head is singular.
      managers: departmentHead ? [departmentHead] : [],
      stats: {
        totalMembers: dept._count.users,
        activeTickets: dept._count.tickets,
        pendingLeave,
        projects: dept._count.projects,
      },
    };
  }

  async getManagers(departmentId: string) {
    const dept = await this.prisma.department.findUnique({ where: { id: departmentId }, select: { id: true } });
    if (!dept) throw new NotFoundException('Department not found');
    const head = await this.selectDepartmentHead(departmentId);
    return head ? [head] : [];
  }

  async addManager(departmentId: string, userId: string) {
    const dept = await this.prisma.department.findUnique({ where: { id: departmentId }, select: { id: true } });
    if (!dept) throw new NotFoundException('Department not found');

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: MANAGER_SELECT });
    if (!user) throw new NotFoundException('User not found');
    if (!user.isActive) {
      throw new BadRequestException('Cannot assign an inactive user as a department manager');
    }
    if (!MANAGER_ASSIGNABLE_ROLES.includes(user.role?.name ?? '')) {
      throw new BadRequestException(
        `${user.name} must have the MANAGER, ADMIN, or SUPER_ADMIN role to be assigned as a department manager`,
      );
    }

    const existing = await this.prisma.managerDeptAccess.findUnique({
      where: { managerId_departmentId: { managerId: userId, departmentId } },
    });
    if (existing) {
      // Already the department head — no-op, return clean success.
      return { ...user, accessLevel: existing.accessLevel };
    }

    // Department head is singular: assigning a new head replaces any existing one(s),
    // including legacy duplicate rows from before this rule existed.
    const [, created] = await this.prisma.$transaction([
      this.prisma.managerDeptAccess.deleteMany({ where: { departmentId } }),
      this.prisma.managerDeptAccess.create({
        data: { managerId: userId, departmentId, accessLevel: 'FULL' },
      }),
    ]);
    return { ...user, accessLevel: created.accessLevel };
  }

  async removeManager(departmentId: string, userId: string) {
    const existing = await this.prisma.managerDeptAccess.findUnique({
      where: { managerId_departmentId: { managerId: userId, departmentId } },
    });
    if (!existing) {
      throw new NotFoundException('This user is not assigned as a manager of this department');
    }
    await this.prisma.managerDeptAccess.delete({ where: { id: existing.id } });
    return { success: true };
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
