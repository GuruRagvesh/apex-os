import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ForbiddenException } from '@nestjs/common';
import { ProjectStatus, Priority } from '@prisma/client';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';
import { ROLES } from '../../../shared/constants/roles';

function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str ?? '');
}

@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    private accessPolicy: AccessPolicyService,
    private eventLogger: EventLoggerService,
  ) {}

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
        const deptIds = await this.accessPolicy.managedDepartmentIds(user);
        if (deptIds.length > 0) {
          where.OR = [
            { departmentId: { in: deptIds } },
            { members: { some: { userId: user.id } } },
          ];
        } else {
          where.members = { some: { userId: user.id } };
        }
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

  async findOne(id: string, user?: any) {
    const existing = await this.prisma.project.findFirst({
      where: { OR: [{ id }, { projectId: id }] },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Project not found');
    const scope = user ? await this.buildProjectScope(user) : {};
    const project = await this.prisma.project.findFirst({
      where: this.andWhere({ id: existing.id }, scope),
      include: {
        department: true,
        members: { include: { user: { select: { id: true, name: true, email: true, avatar: true, role: true } } } },
        tickets: {
          include: { assignedTo: { select: { id: true, name: true, avatar: true } }, createdBy: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!project) throw new ForbiddenException('You do not have permission to view this project');

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

    this.eventLogger.log({
      actorId: userId,
      entityType: 'Project',
      entityId: project.id,
      action: OperationalAction.PROJECT_CREATED,
      metadata: { projectId: project.projectId, name: project.name, priority: project.priority },
    }).catch(() => {});

    return project;
  }

  async update(id: string, data: any, user?: any) {
    const project = await this.findOne(id, user);
    if (user) await this.assertCanEditProject(user, project);
    const updated = await this.prisma.project.update({
      where: { id: project.id },
      data,
      include: { department: true },
    });
    if (user) {
      this.eventLogger.log({
        actorId: user.id,
        entityType: 'Project',
        entityId: project.id,
        action: OperationalAction.PROJECT_UPDATED,
        metadata: { projectId: (project as any).projectId, fields: Object.keys(data) },
      }).catch(() => {});
    }
    return updated;
  }

  async addMember(projectId: string, userId: string, role = 'MEMBER', user?: any) {
    const project = await this.findOne(projectId, user);
    if (user) await this.assertCanEditProject(user, project);
    if (user) await this.assertUserWithinProjectScope(user, userId);
    const result = await this.prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId } },
      update: { role },
      create: { projectId: project.id, userId, role },
    });
    if (user) {
      this.eventLogger.log({
        actorId: user.id,
        entityType: 'Project',
        entityId: project.id,
        action: OperationalAction.PROJECT_MEMBER_ADDED,
        metadata: { projectId: (project as any).projectId, memberId: userId, role },
      }).catch(() => {});
    }
    return result;
  }

  async removeMember(projectId: string, userId: string, user?: any) {
    const project = await this.findOne(projectId, user);
    if (user) await this.assertCanEditProject(user, project);
    const result = await this.prisma.projectMember.delete({
      where: { projectId_userId: { projectId: project.id, userId } },
    });
    if (user) {
      this.eventLogger.log({
        actorId: user.id,
        entityType: 'Project',
        entityId: project.id,
        action: OperationalAction.PROJECT_MEMBER_REMOVED,
        metadata: { projectId: (project as any).projectId, memberId: userId },
      }).catch(() => {});
    }
    return result;
  }

  async remove(id: string, user?: any) {
    const project = await this.findOne(id, user);
    if (user && !this.accessPolicy.isAdmin(user)) throw new ForbiddenException('Only admins can delete projects');
    const result = await this.prisma.project.delete({ where: { id: project.id } });
    if (user) {
      this.eventLogger.log({
        actorId: user.id,
        entityType: 'Project',
        entityId: project.id,
        action: OperationalAction.PROJECT_DELETED,
        metadata: { projectId: (project as any).projectId },
      }).catch(() => {});
    }
    return result;
  }

  async getStats(projectId?: string, user?: any) {
    const where = this.andWhere(projectId ? { projectId } : {}, user ? await this.buildProjectScope(user) : {});
    const [total, byStatus, byPriority] = await Promise.all([
      this.prisma.project.count({ where }),
      this.prisma.project.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.project.groupBy({ by: ['priority'], where, _count: true }),
    ]);
    return { total, byStatus, byPriority };
  }

  private async buildProjectScope(user: any): Promise<any> {
    const roleName = this.accessPolicy.roleName(user);
    if (this.accessPolicy.isAdmin(user)) return {};
    if ([ROLES.EMPLOYEE, ROLES.INTERN].includes(roleName as any)) {
      return { members: { some: { userId: user.id } } };
    }
    if ([ROLES.MANAGER, ROLES.TEAM_LEAD].includes(roleName as any)) {
      const deptIds = await this.accessPolicy.managedDepartmentIds(user);
      const clauses: any[] = [{ members: { some: { userId: user.id } } }];
      if (deptIds.length > 0) clauses.push({ departmentId: { in: deptIds } });
      return { OR: clauses };
    }
    return { members: { some: { userId: user.id } } };
  }

  private async assertCanEditProject(user: any, project: any) {
    const roleName = this.accessPolicy.roleName(user);
    if (this.accessPolicy.isAdmin(user)) return;
    if (![ROLES.MANAGER, ROLES.TEAM_LEAD].includes(roleName as any)) {
      throw new ForbiddenException('You do not have permission to edit this project');
    }
    const deptIds = await this.accessPolicy.managedDepartmentIds(user);
    const isMember = project.members?.some?.((row: any) => row.userId === user.id || row.user?.id === user.id);
    const inDepartment = Boolean(project.departmentId && deptIds.includes(project.departmentId));
    if (!inDepartment && !isMember) {
      throw new ForbiddenException('You do not have permission to edit this project');
    }
  }

  private async assertUserWithinProjectScope(user: any, targetUserId: string) {
    if (this.accessPolicy.isAdmin(user)) return;
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, departmentId: true, isActive: true } });
    if (!target || !target.isActive) throw new ForbiddenException('Project member is not available');
    const deptIds = await this.accessPolicy.managedDepartmentIds(user);
    if (!target.departmentId || !deptIds.includes(target.departmentId)) {
      throw new ForbiddenException('Project member is outside your allowed scope');
    }
  }

  private andWhere(...clauses: any[]): any {
    const parts = clauses.filter((clause) => clause && Object.keys(clause).length > 0);
    if (parts.length === 0) return {};
    if (parts.length === 1) return parts[0];
    return { AND: parts };
  }
}
