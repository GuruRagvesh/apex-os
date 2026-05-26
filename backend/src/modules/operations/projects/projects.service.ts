import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProjectStatus, Priority } from '@prisma/client';

function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str ?? '');
}

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: { search?: string; status?: ProjectStatus; departmentId?: string; userId?: string; page?: number; limit?: number }, user?: any) {
    const where: any = {};
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { projectId: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.status) where.status = query.status;
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.userId) where.members = { some: { userId: query.userId } };

    if (user) {
      const roleName = user?.role?.name ?? user?.role ?? '';
      if (['INTERN', 'EMPLOYEE'].includes(roleName)) {
        where.members = { some: { userId: user.id } };
      } else if (roleName === 'TEAM_LEAD') {
        where.OR = [
          { departmentId: user.departmentId },
          { members: { some: { userId: user.id } } },
        ];
      } else if (roleName === 'MANAGER') {
        if (user.departmentId) where.departmentId = user.departmentId;
      }
      // ADMIN/SUPER_ADMIN: no filter
    }

    const page  = Math.max(1, Number(query.page)  || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
    const skip  = (page - 1) * limit;

    const [total, projects] = await Promise.all([
      this.prisma.project.count({ where }),
      this.prisma.project.findMany({
        where,
        include: {
          department: true,
          members: { include: { user: { select: { id: true, name: true, avatar: true } } } },
          _count: { select: { tickets: true, members: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);
    return { projects, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const project = await this.prisma.project.findFirst({
      where: { OR: [{ id }, { projectId: id }] },
      include: {
        department: true,
        members: { include: { user: { select: { id: true, name: true, email: true, avatar: true, role: true } } } },
        tickets: {
          include: { assignedTo: { select: { id: true, name: true, avatar: true } }, createdBy: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!project) throw new NotFoundException('Project not found');

    // Compute progress: percentage of linked tickets in terminal state (DONE or CLOSED).
    // Returned as an integer 0–100 for direct use in progress bars.
    const tickets = project.tickets ?? [];
    const total = tickets.length;
    const done  = tickets.filter((t) => t.status === 'DONE' || t.status === 'CLOSED').length;
    const progress = total > 0 ? Math.round((done / total) * 100) : 0;

    return { ...project, progress, ticketStats: { total, done, open: total - done } };
  }

  async create(data: any, userId: string) {
    // Resolve departmentId if name was passed instead of UUID
    if (data.departmentId && !isUUID(data.departmentId)) {
      const dept = await this.prisma.department.findFirst({
        where: { name: { equals: data.departmentId, mode: 'insensitive' } },
      });
      data.departmentId = dept?.id ?? undefined;
    }
    // Drop any stray client-supplied createdById — owner comes from JWT
    delete data.createdById;
    // Title -> name aliasing (form may use either field)
    if (data.title && !data.name) {
      data.name = data.title;
      delete data.title;
    }
    if (!data.name) throw new BadRequestException('Project name is required');

    // Convert endDate string → proper ISO DateTime
    if (data.endDate) {
      data.endDate = new Date(data.endDate);
    }

    let project: any;
    let attempts = 0;
    while (attempts < 10) {
      const count = await this.prisma.project.count();
      const projectId = `PRJ-${String(count + 1 + attempts).padStart(3, '0')}`;
      try {
        project = await this.prisma.project.create({
          data: {
            ...data,
            projectId,
            members: { create: { userId, role: 'OWNER' } },
          },
          include: {
            department: true,
            members: { include: { user: { select: { id: true, name: true } } } },
          },
        });
        break;
      } catch (err: any) {
        if (err?.code === 'P2002' && err?.meta?.target?.includes('projectId')) {
          attempts++;
          continue;
        }
        console.error('PROJECT CREATE ERROR:', { message: err?.message, code: err?.code, meta: err?.meta });
        throw new BadRequestException(err?.message ?? 'Failed to create project');
      }
    }
    if (!project) {
      throw new BadRequestException('Failed to generate a unique project ID — please try again');
    }

    await this.prisma.activityLog.create({
      data: {
        userId,
        action: 'PROJECT_CREATED',
        entityType: 'PROJECT',
        entityId: project.id,
        details: {
          projectId: project.projectId,
          name: project.name,
          priority: project.priority,
        },
      },
    });

    return project;
  }

  async update(id: string, data: any) {
    return this.prisma.project.update({
      where: { id },
      data,
      include: { department: true },
    });
  }

  async addMember(projectId: string, userId: string, role = 'MEMBER') {
    return this.prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId } },
      update: { role },
      create: { projectId, userId, role },
    });
  }

  async removeMember(projectId: string, userId: string) {
    return this.prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId } },
    });
  }

  async remove(id: string) {
    return this.prisma.project.delete({ where: { id } });
  }

  async getStats(projectId?: string) {
    const where = projectId ? { projectId } : {};
    const [total, byStatus, byPriority] = await Promise.all([
      this.prisma.project.count(),
      this.prisma.project.groupBy({ by: ['status'], _count: true }),
      this.prisma.project.groupBy({ by: ['priority'], _count: true }),
    ]);
    return { total, byStatus, byPriority };
  }
}
