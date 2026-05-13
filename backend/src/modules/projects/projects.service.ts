import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectStatus, Priority } from '@prisma/client';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: { search?: string; status?: ProjectStatus; departmentId?: string; userId?: string }) {
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

    return this.prisma.project.findMany({
      where,
      include: {
        department: true,
        members: { include: { user: { select: { id: true, name: true, avatar: true } } } },
        _count: { select: { tickets: true, members: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
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
    return project;
  }

  async create(data: any, userId: string) {
    const count = await this.prisma.project.count();
    const projectId = `PRJ-${String(count + 1).padStart(3, '0')}`;

    const project = await this.prisma.project.create({
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
