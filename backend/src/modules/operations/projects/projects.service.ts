import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Optional } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProjectStatus, Priority } from '@prisma/client';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';
import { ROLES } from '../../../shared/constants/roles';
import { NotificationEventService } from '../notifications/notification-event.service';

const VALID_STAGE_STATUSES = ['PLANNED', 'ACTIVE', 'COMPLETED', 'SKIPPED'] as const;
const VALID_MEMBER_ROLES = ['OWNER', 'LEAD', 'DEVELOPER', 'REVIEWER', 'OBSERVER', 'MEMBER'] as const;

function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str ?? '');
}

@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    private accessPolicy: AccessPolicyService,
    private eventLogger: EventLoggerService,
    @Optional() private notificationEventService?: NotificationEventService,
  ) {}

  async findAll(query: { search?: string; status?: ProjectStatus; departmentId?: string; userId?: string; page?: number; limit?: number }, user?: any) {
    // Every filter and the caller's scope are ANDed. They used to be merged
    // into one object, where the scope's OR replaced the search's OR, so a
    // Team Lead's or Manager's search was silently ignored.
    const clauses: any[] = [];
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    if (search) {
      clauses.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { projectId: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    if (query.status) {
      if (!Object.values(ProjectStatus).includes(query.status)) {
        throw new BadRequestException(`Invalid status. Allowed: ${Object.values(ProjectStatus).join(', ')}`);
      }
      clauses.push({ status: query.status });
    }
    if (query.departmentId) clauses.push({ departmentId: query.departmentId });
    if (query.userId) clauses.push({ members: { some: { userId: query.userId } } });
    // Same rule as the detail page, so a list entry never 403s when opened.
    if (user) clauses.push(await this.buildProjectScope(user));
    const where = this.andWhere(...clauses);

    const page  = Math.max(1, Number(query.page)  || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
    const skip  = (page - 1) * limit;

    const [total, projects] = await Promise.all([
      this.prisma.project.count({ where }),
      this.prisma.project.findMany({
        where,
        include: {
          department: true,
          teamAssignments: { include: { team: { select: { id: true, name: true, isActive: true } } } },
          members: { include: { user: { select: { id: true, name: true, avatar: true } } } },
          tickets: {
            select: { id: true, status: true, dueDate: true, executionDueAt: true, reviewDueAt: true, submittedAt: true }
          },
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
        teamAssignments: { include: { team: { select: { id: true, name: true, isActive: true } } } },
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

  async create(body: any, user: any) {
    const userId: string = user.id;
    const input = { ...(body ?? {}) };
    // Title -> name aliasing (form may use either field)
    if (input.title && !input.name) input.name = input.title;
    // Resolve departmentId if a name was passed instead of an id
    if (input.departmentId && !isUUID(input.departmentId)) {
      const dept = await this.prisma.department.findFirst({
        where: { OR: [{ id: input.departmentId }, { name: { equals: input.departmentId, mode: 'insensitive' } }] },
        select: { id: true },
      });
      if (!dept) throw new BadRequestException('Department not found');
      input.departmentId = dept.id;
    }
    // Only the fields a person may set are written. Status starts ACTIVE, the
    // id is generated, and the owner comes from the token, never the body.
    const data: any = this.pickProjectFields(input, ['name', 'description', 'priority', 'startDate', 'endDate', 'departmentId', 'outputTargetMinutes']);
    if (!data.name) throw new BadRequestException('Project name is required');
    await this.assertDepartmentInScope(user, data.departmentId ?? null, true);
    const benchmark = await this.validateBenchmarkConfiguration(data.departmentId ?? null, input.teamAssignments, data.outputTargetMinutes);
    data.outputTargetMinutes = benchmark.projectTarget;

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
            ...(benchmark.teamAssignments.length > 0
              ? { teamAssignments: { create: benchmark.teamAssignments } }
              : {}),
          },
          include: {
            department: true,
            teamAssignments: { include: { team: { select: { id: true, name: true, isActive: true } } } },
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
        throw new BadRequestException('Failed to create project');
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

    // Notify only people assigned through the selected project teams. The
    // creator already knows about the project and is excluded from the fanout.
    if (benchmark.teamAssignments.length > 0 && this.notificationEventService) {
      const teams = await this.prisma.team.findMany({
        where: { id: { in: benchmark.teamAssignments.map((row) => row.teamId) }, isActive: true },
        select: { teamLeadId: true, members: { select: { userId: true } } },
      });
      const recipientIds = new Set<string>();
      for (const team of teams) {
        if (team.teamLeadId) recipientIds.add(team.teamLeadId);
        for (const member of team.members) recipientIds.add(member.userId);
      }
      recipientIds.delete(userId);
      await Promise.allSettled(Array.from(recipientIds, (recipientId) =>
        this.notificationEventService!.sendNotification(recipientId, 'projectCreated', {
          title: `Project assigned: ${project.name}`,
          message: `You were assigned to ${project.projectId} through your department team.`,
          type: 'INFO',
          link: `/projects/${project.id}`,
          entityId: project.id,
          entityType: 'PROJECT',
          dedupeKey: `project-created:${project.id}`,
        })
      ));
    }

    return project;
  }

  async update(id: string, body: any, user?: any) {
    const project = await this.findOne(id, user);
    if (user) await this.assertCanEditProject(user, project);
    // The raw body used to be written as-is: a Team Lead could archive
    // (Manager+ only), move the project out of their scope or rewrite its id.
    const data: any = this.pickProjectFields(body ?? {}, ['name', 'description', 'priority', 'status', 'startDate', 'endDate', 'departmentId', 'outputTargetMinutes']);
    if ('name' in data && !data.name) throw new BadRequestException('Project name is required');
    if (data.status !== undefined && data.status !== project.status) {
      if (data.status === ProjectStatus.ARCHIVED) throw new BadRequestException('Use Archive to archive a project');
      if (project.status === ProjectStatus.ARCHIVED) throw new BadRequestException('Use Restore to reopen an archived project');
    }
    if (user && 'departmentId' in data && data.departmentId !== project.departmentId) {
      await this.assertDepartmentInScope(user, data.departmentId, false);
    }
    const benchmarkChanged = Array.isArray(body?.teamAssignments) || 'outputTargetMinutes' in (body ?? {}) || 'departmentId' in data;
    const benchmark = benchmarkChanged
      ? await this.validateBenchmarkConfiguration(
          'departmentId' in data ? data.departmentId : project.departmentId,
          body?.teamAssignments ?? (project as any).teamAssignments?.map((row: any) => ({
            teamId: row.teamId,
            outputTargetMinutes: row.outputTargetMinutes,
          })),
          'outputTargetMinutes' in data ? data.outputTargetMinutes : (project as any).outputTargetMinutes,
        )
      : null;
    if (benchmark) data.outputTargetMinutes = benchmark.projectTarget;
    const updateProject = (client: any) => client.project.update({
        where: { id: project.id },
        data,
        include: {
          department: true,
          teamAssignments: { include: { team: { select: { id: true, name: true, isActive: true } } } },
        },
      });
    const updated = benchmark
      ? await this.prisma.$transaction(async (tx) => {
          if (Array.isArray(body?.teamAssignments) || 'departmentId' in data) {
            await tx.projectTeamAssignment.deleteMany({ where: { projectId: project.id } });
            if (benchmark.teamAssignments.length > 0) {
              await tx.projectTeamAssignment.createMany({
                data: benchmark.teamAssignments.map((row) => ({ ...row, projectId: project.id })),
              });
            }
          }
          return updateProject(tx);
        })
      : await updateProject(this.prisma);
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
    role = role || 'MEMBER';
    if (!VALID_MEMBER_ROLES.includes(role as any)) {
      throw new BadRequestException(`Invalid role. Allowed: ${VALID_MEMBER_ROLES.join(', ')}`);
    }
    // Inactive people are never added, whoever asks (admins included).
    const target = await this.prisma.user.findUnique({ where: { id: userId ?? '' }, select: { id: true, isActive: true } });
    if (!target) throw new NotFoundException('User not found');
    if (!target.isActive) throw new BadRequestException('Inactive users cannot be added to a project');
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
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId } },
      select: { id: true },
    });
    if (!member) throw new NotFoundException('User is not a member of this project');
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

  private buildProjectScope(user: any): Promise<any> {
    return this.accessPolicy.projectWhereForUser(user);
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

  /**
   * Copies only the named project fields, validated and converted. Unknown
   * keys (id, projectId, createdAt, members ...) are dropped.
   */
  private pickProjectFields(input: any, fields: string[]): any {
    const out: any = {};
    for (const f of fields) {
      if (!(f in input) || input[f] === undefined) continue;
      const v = input[f];
      switch (f) {
        case 'name':
          out.name = typeof v === 'string' ? v.trim() : '';
          break;
        case 'description':
          out.description = v === null || v === '' ? null : String(v);
          break;
        case 'priority':
          if (!Object.values(Priority).includes(v)) throw new BadRequestException(`Invalid priority. Allowed: ${Object.values(Priority).join(', ')}`);
          out.priority = v;
          break;
        case 'status':
          if (!Object.values(ProjectStatus).includes(v)) throw new BadRequestException(`Invalid status. Allowed: ${Object.values(ProjectStatus).join(', ')}`);
          out.status = v;
          break;
        case 'startDate':
        case 'endDate': {
          if (v === null || v === '') { out[f] = null; break; }
          const d = new Date(v);
          if (Number.isNaN(d.getTime())) throw new BadRequestException(`${f} is not a valid date`);
          out[f] = d;
          break;
        }
        case 'departmentId':
          out.departmentId = v === '' || v === null ? null : String(v);
          break;
        case 'outputTargetMinutes':
          out.outputTargetMinutes = this.optionalMinutes(v, 'Minutes of output per day');
          break;
      }
    }
    if (out.startDate && out.endDate && out.endDate < out.startDate) {
      throw new BadRequestException('endDate must not be before startDate');
    }
    return out;
  }

  private optionalMinutes(value: any, label: string): number | null {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1440) {
      throw new BadRequestException(`${label} must be a whole number from 1 to 1440`);
    }
    return parsed;
  }

  private async validateBenchmarkConfiguration(
    departmentId: string | null,
    rawAssignments: any,
    rawProjectTarget: any,
  ): Promise<{ projectTarget: number | null; teamAssignments: { teamId: string; outputTargetMinutes: number | null }[] }> {
    const projectTarget = this.optionalMinutes(rawProjectTarget, 'Minutes of output per day');
    const assignments = Array.isArray(rawAssignments) ? rawAssignments : [];
    if (!departmentId) {
      if (assignments.length > 0) throw new BadRequestException('A project needs a department before teams can be assigned');
      return { projectTarget, teamAssignments: [] };
    }

    const department = await this.prisma.department.findUnique({
      where: { id: departmentId },
      select: { name: true },
    });
    if (!department) throw new BadRequestException('Department not found');
    const isContent = ['content', 'content sales'].includes(department.name.trim().toLowerCase());
    if (!isContent) {
      if (assignments.length > 0) {
        throw new BadRequestException('Team productivity benchmarks are available only for the Content department');
      }
      return { projectTarget, teamAssignments: [] };
    }

    const normalized = assignments.map((row: any) => ({
      teamId: String(row?.teamId ?? ''),
      outputTargetMinutes: this.optionalMinutes(row?.outputTargetMinutes, 'Team minutes of output per day'),
    }));
    if (new Set(normalized.map((row) => row.teamId)).size !== normalized.length) {
      throw new BadRequestException('A team can be assigned to a project only once');
    }
    if (normalized.some((row) => !row.teamId)) throw new BadRequestException('Team is required');
    if (normalized.length > 0) {
      const validTeams = await this.prisma.team.count({
        where: { id: { in: normalized.map((row) => row.teamId) }, departmentId, isActive: true },
      });
      if (validTeams !== normalized.length) {
        throw new BadRequestException('Every selected team must be active and belong to the project department');
      }
      return { projectTarget: null, teamAssignments: normalized };
    }
    return { projectTarget, teamAssignments: [] };
  }

  /**
   * A non-admin may only put a project in a department they manage (a Team
   * Lead: their own). A new project may have no department; taking an
   * existing one out of its department is admin-only. The department must exist.
   */
  private async assertDepartmentInScope(user: any, departmentId: string | null, allowNone: boolean): Promise<void> {
    if (departmentId) {
      const dept = await this.prisma.department.findUnique({ where: { id: departmentId }, select: { id: true } });
      if (!dept) throw new BadRequestException('Department not found');
    }
    if (!user || this.accessPolicy.isAdmin(user)) return;
    if (!departmentId) {
      if (allowNone) return;
      throw new ForbiddenException('Only an admin can remove a project from its department');
    }
    const deptIds = await this.accessPolicy.managedDepartmentIds(user);
    if (!deptIds.includes(departmentId)) {
      throw new ForbiddenException('That department is outside your allowed scope');
    }
  }

  private andWhere(...clauses: any[]): any {
    const parts = clauses.filter((clause) => clause && Object.keys(clause).length > 0);
    if (parts.length === 0) return {};
    if (parts.length === 1) return parts[0];
    return { AND: parts };
  }

  // ── FP-14B: Project Stage methods ─────────────────────────────────────────

  async listStages(projectId: string, user: any) {
    const project = await this.findOne(projectId, user);
    return this.prisma.projectStage.findMany({
      where: { projectId: project.id },
      include: { _count: { select: { tickets: true } } },
      orderBy: { order: 'asc' },
    });
  }

  async createStage(projectId: string, dto: { name: string; description?: string; order?: number; status?: string; color?: string; startDate?: string; endDate?: string }, user: any) {
    const project = await this.findOne(projectId, user);
    await this.assertCanEditProject(user, project);

    const status = dto.status ?? 'PLANNED';
    if (!VALID_STAGE_STATUSES.includes(status as any)) {
      throw new BadRequestException(`Invalid stage status. Allowed: ${VALID_STAGE_STATUSES.join(', ')}`);
    }
    if (!dto.name?.trim()) throw new BadRequestException('Stage name is required');

    const start = dto.startDate ? new Date(dto.startDate) : undefined;
    const end   = dto.endDate   ? new Date(dto.endDate)   : undefined;
    if (start && end && end < start) {
      throw new BadRequestException('endDate must not be before startDate');
    }

    // Default order = last existing + 1
    const maxOrder = await this.prisma.projectStage.aggregate({
      where: { projectId: project.id },
      _max: { order: true },
    });
    const order = dto.order ?? (maxOrder._max.order ?? -1) + 1;

    const stage = await this.prisma.projectStage.create({
      data: { projectId: project.id, name: dto.name.trim(), description: dto.description, order, status, color: dto.color, startDate: start, endDate: end },
    });

    this.eventLogger.log({ actorId: user.id, entityType: 'Project', entityId: project.id, action: OperationalAction.PROJECT_UPDATED, metadata: { action: 'STAGE_CREATED', stageId: stage.id, stageName: stage.name } }).catch(() => {});
    return stage;
  }

  async updateStage(projectId: string, stageId: string, dto: { name?: string; description?: string; order?: number; status?: string; color?: string; startDate?: string | null; endDate?: string | null }, user: any) {
    const project = await this.findOne(projectId, user);
    await this.assertCanEditProject(user, project);

    const stage = await this.prisma.projectStage.findFirst({ where: { id: stageId, projectId: project.id } });
    if (!stage) throw new NotFoundException('Stage not found');

    if (dto.status !== undefined && !VALID_STAGE_STATUSES.includes(dto.status as any)) {
      throw new BadRequestException(`Invalid stage status. Allowed: ${VALID_STAGE_STATUSES.join(', ')}`);
    }

    const start = dto.startDate === null ? null : dto.startDate ? new Date(dto.startDate) : undefined;
    const end   = dto.endDate   === null ? null : dto.endDate   ? new Date(dto.endDate)   : undefined;

    const resolvedStart = start !== undefined ? start : stage.startDate;
    const resolvedEnd   = end   !== undefined ? end   : stage.endDate;
    if (resolvedStart && resolvedEnd && resolvedEnd < resolvedStart) {
      throw new BadRequestException('endDate must not be before startDate');
    }

    const data: any = {};
    if (dto.name !== undefined)  data.name        = dto.name.trim();
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.order  !== undefined) data.order       = dto.order;
    if (dto.status !== undefined) data.status      = dto.status;
    if (dto.color  !== undefined) data.color       = dto.color;
    if (start !== undefined) data.startDate = start;
    if (end   !== undefined) data.endDate   = end;

    return this.prisma.projectStage.update({ where: { id: stageId }, data });
  }

  async deleteStage(projectId: string, stageId: string, user: any) {
    const project = await this.findOne(projectId, user);
    await this.assertCanEditProject(user, project);

    const stage = await this.prisma.projectStage.findFirst({ where: { id: stageId, projectId: project.id } });
    if (!stage) throw new NotFoundException('Stage not found');

    // Reject delete if tickets are linked — protect data integrity
    const linkedCount = await this.prisma.ticket.count({ where: { projectStageId: stageId } });
    if (linkedCount > 0) {
      throw new BadRequestException(
        `Cannot delete stage "${stage.name}" — ${linkedCount} ticket(s) are assigned to it. Reassign tickets first.`,
      );
    }

    await this.prisma.projectStage.delete({ where: { id: stageId } });
    this.eventLogger.log({ actorId: user.id, entityType: 'Project', entityId: project.id, action: OperationalAction.PROJECT_UPDATED, metadata: { action: 'STAGE_DELETED', stageId, stageName: stage.name } }).catch(() => {});
    return { success: true };
  }

  async reorderStages(projectId: string, orderedStageIds: string[], user: any) {
    const project = await this.findOne(projectId, user);
    await this.assertCanEditProject(user, project);

    if (!Array.isArray(orderedStageIds) || orderedStageIds.length === 0) {
      throw new BadRequestException('orderedStageIds must be a non-empty array');
    }

    // Verify all provided IDs belong to this project
    const existing = await this.prisma.projectStage.findMany({ where: { projectId: project.id }, select: { id: true } });
    const existingIds = new Set(existing.map((s) => s.id));
    for (const id of orderedStageIds) {
      if (!existingIds.has(id)) throw new BadRequestException(`Stage ${id} does not belong to this project`);
    }

    // Update orders in a transaction
    await this.prisma.$transaction(
      orderedStageIds.map((id, index) =>
        this.prisma.projectStage.update({ where: { id }, data: { order: index } }),
      ),
    );
    return this.listStages(projectId, user);
  }

  // ── FP-14B: Project Activity ───────────────────────────────────────────────

  async getActivity(projectId: string, limit: number, user: any) {
    const project = await this.findOne(projectId, user);
    const safeLimit = Math.min(Math.max(1, limit || 50), 100);

    // Get IDs of tickets linked to this project for event correlation
    const linkedTickets = await this.prisma.ticket.findMany({
      where: { projectId: project.id },
      select: { id: true },
    });
    const ticketIds = linkedTickets.map((t) => t.id);

    return this.prisma.operationalEvent.findMany({
      where: {
        OR: [
          { entityType: 'Project', entityId: project.id },
          ...(ticketIds.length > 0 ? [{ entityType: 'Ticket', entityId: { in: ticketIds } }] : []),
        ],
      },
      // Activity feed fields only: never the actor's IP/device or the raw
      // before/after snapshots an event may carry.
      select: {
        id: true, action: true, entityType: true, entityId: true, metadata: true,
        fromState: true, toState: true, timestamp: true,
        actor: { select: { id: true, name: true, avatar: true } },
      },
      orderBy: { timestamp: 'desc' },
      take: safeLimit,
    });
  }

  // ── FP-14B: Member role update ─────────────────────────────────────────────

  async updateMemberRole(projectId: string, userId: string, role: string, user: any) {
    const project = await this.findOne(projectId, user);
    await this.assertCanEditProject(user, project);

    if (!VALID_MEMBER_ROLES.includes(role as any)) {
      throw new BadRequestException(`Invalid role. Allowed: ${VALID_MEMBER_ROLES.join(', ')}`);
    }

    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId } },
    });
    if (!member) throw new NotFoundException('User is not a member of this project');

    return this.prisma.projectMember.update({
      where: { projectId_userId: { projectId: project.id, userId } },
      data: { role },
      include: { user: { select: { id: true, name: true, email: true, avatar: true } } },
    });
  }

  // ── FP-14B: Archive / Restore ─────────────────────────────────────────────

  private async assertCanArchiveProject(user: any, project: any) {
    const roleName = this.accessPolicy.roleName(user);
    if (this.accessPolicy.isAdmin(user)) return;
    if (roleName === ROLES.MANAGER) {
      const deptIds = await this.accessPolicy.managedDepartmentIds(user);
      const isMember = project.members?.some?.((row: any) => row.userId === user.id || row.user?.id === user.id);
      if (project.departmentId && deptIds.includes(project.departmentId)) return;
      if (isMember) return;
    }
    throw new ForbiddenException('You do not have permission to archive/restore this project');
  }

  async archive(projectId: string, user: any) {
    const project = await this.findOne(projectId, user);
    await this.assertCanArchiveProject(user, project);

    if ((project as any).status === 'ARCHIVED') {
      throw new BadRequestException('Project is already archived');
    }

    const updated = await this.prisma.project.update({
      where: { id: project.id },
      data: { status: ProjectStatus.ARCHIVED },
      include: { department: true },
    });

    this.eventLogger.log({ actorId: user.id, entityType: 'Project', entityId: project.id, action: OperationalAction.PROJECT_UPDATED, metadata: { action: 'ARCHIVED', projectId: (project as any).projectId } }).catch(() => {});
    return updated;
  }

  async restore(projectId: string, user: any) {
    const project = await this.findOne(projectId, user);
    await this.assertCanArchiveProject(user, project);

    if ((project as any).status !== 'ARCHIVED') {
      throw new BadRequestException('Project is not archived');
    }

    const updated = await this.prisma.project.update({
      where: { id: project.id },
      data: { status: ProjectStatus.ACTIVE },
      include: { department: true },
    });

    this.eventLogger.log({ actorId: user.id, entityType: 'Project', entityId: project.id, action: OperationalAction.PROJECT_UPDATED, metadata: { action: 'RESTORED', projectId: (project as any).projectId } }).catch(() => {});
    return updated;
  }
}
