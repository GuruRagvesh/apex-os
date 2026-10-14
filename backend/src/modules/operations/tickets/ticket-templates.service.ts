import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Priority, ProjectStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';

const PRIORITIES = Object.values(Priority);
const DEFAULT_VISIBLE_COUNT = 5;
const MAX_VISIBLE_COUNT = 20;

export type QuickTicketTemplateInput = {
  name?: unknown;
  title?: unknown;
  description?: unknown;
  departmentId?: unknown;
  taskTypeId?: unknown;
  taskSubtypeId?: unknown;
  assigneeIds?: unknown;
  priority?: unknown;
  estimatedMinutes?: unknown;
  projectId?: unknown;
  isVisible?: unknown;
  isPinned?: unknown;
};

type ReferenceValidation = {
  status: 'READY' | 'NEEDS_UPDATE';
  invalidFields: string[];
  messages: string[];
};

@Injectable()
export class TicketTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessPolicy: AccessPolicyService,
  ) {}

  private ownerId(user: any): string {
    const id = user?.id ?? user?.sub;
    if (!id) throw new ForbiddenException('Authenticated user is required');
    return id;
  }

  private requiredText(value: unknown, field: string, max: number): string {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) throw new BadRequestException(`${field} is required`);
    if (text.length > max) throw new BadRequestException(`${field} must be ${max} characters or fewer`);
    return text;
  }

  private optionalId(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private normalizeInput(input: QuickTicketTemplateInput, partial = false): any {
    const data: any = {};
    const has = (key: keyof QuickTicketTemplateInput) => Object.prototype.hasOwnProperty.call(input ?? {}, key);

    if (!partial || has('name')) data.name = this.requiredText(input?.name, 'Template name', 80);
    if (!partial || has('title')) data.title = this.requiredText(input?.title, 'Ticket title', 200);
    if (!partial || has('departmentId')) data.departmentId = this.optionalId(input?.departmentId);
    if (!partial || has('taskTypeId')) data.taskTypeId = this.optionalId(input?.taskTypeId);
    if (!partial || has('assigneeIds')) {
      if (input?.assigneeIds === undefined || input.assigneeIds === null) data.assigneeIds = [];
      else {
        if (!Array.isArray(input.assigneeIds)) throw new BadRequestException('Assigned To must be a list');
        const assigneeIds = input.assigneeIds.map((id) => typeof id === 'string' ? id.trim() : '');
        if (assigneeIds.some((id) => !id)) throw new BadRequestException('Assigned To contains an invalid user');
        data.assigneeIds = [...new Set(assigneeIds)];
        if (data.assigneeIds.length > 50) throw new BadRequestException('Assigned To supports up to 50 users');
      }
    }

    if (!partial || has('description')) {
      const description = typeof input?.description === 'string' ? input.description.trim() : '';
      if (description.length > 10_000) throw new BadRequestException('Description is too long');
      data.description = description || null;
    }
    if (!partial || has('taskSubtypeId')) data.taskSubtypeId = this.optionalId(input?.taskSubtypeId);
    if (!partial || has('projectId')) data.projectId = this.optionalId(input?.projectId);

    if (!partial || has('priority')) {
      const rawPriority = typeof input?.priority === 'string' ? input.priority.trim() : '';
      if (!rawPriority) data.priority = null;
      else {
        const priority = rawPriority.toUpperCase() as Priority;
        if (!PRIORITIES.includes(priority)) throw new BadRequestException('Priority is invalid');
        data.priority = priority;
      }
    }

    if (!partial || has('estimatedMinutes')) {
      const rawMinutes = input?.estimatedMinutes;
      if (rawMinutes === null || rawMinutes === undefined || rawMinutes === '') data.estimatedMinutes = null;
      else {
        const minutes = Number(rawMinutes);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 100_000) {
          throw new BadRequestException('Estimated time must be a positive whole number of minutes');
        }
        data.estimatedMinutes = minutes;
      }
    }

    if (has('isVisible')) data.isVisible = Boolean(input.isVisible);
    if (has('isPinned')) data.isPinned = Boolean(input.isPinned);
    return data;
  }

  private async validateReferences(data: any, user: any, throwOnInvalid: boolean): Promise<ReferenceValidation> {
    const invalidFields: string[] = [];
    const messages: string[] = [];
    const invalid = (field: string, message: string) => {
      invalidFields.push(field);
      messages.push(message);
    };

    const department = data.departmentId
      ? await this.prisma.department.findUnique({ where: { id: data.departmentId }, select: { id: true } })
      : null;
    if (data.departmentId && !department) invalid('departmentId', 'Department is unavailable');

    const roleName = this.accessPolicy.roleName(user);
    if (data.departmentId && ['EMPLOYEE', 'INTERN', 'TEAM_LEAD'].includes(roleName) && data.departmentId !== user?.departmentId) {
      invalid('departmentId', 'Department is outside your ticket-creation scope');
    } else if (data.departmentId && roleName === 'MANAGER') {
      const allowedDepartments = await this.accessPolicy.managedDepartmentIds(user);
      if (!allowedDepartments.includes(data.departmentId)) {
        invalid('departmentId', 'Department is outside your ticket-creation scope');
      }
    }

    const taskType = data.taskTypeId
      ? await this.prisma.taskType.findUnique({
          where: { id: data.taskTypeId },
          select: { id: true, departmentId: true, isGlobal: true },
        })
      : null;
    if (data.taskTypeId && (!data.departmentId || !taskType || (!taskType.isGlobal && taskType.departmentId !== data.departmentId))) {
      invalid('taskTypeId', 'Task Type is unavailable for this department');
    }

    if (data.taskSubtypeId) {
      const subtype = await this.prisma.taskSubtype.findUnique({
        where: { id: data.taskSubtypeId },
        select: { taskTypeId: true },
      });
      if (!subtype || subtype.taskTypeId !== data.taskTypeId) {
        invalid('taskSubtypeId', 'Subtype is unavailable for this Task Type');
      }
    }

    const assigneeIds: string[] = Array.isArray(data.assigneeIds) ? data.assigneeIds : [];
    const assignees = assigneeIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: assigneeIds } },
          select: { id: true, isActive: true, departmentId: true },
        })
      : [];
    if (assigneeIds.length && (assignees.length !== assigneeIds.length || assignees.some((assignee) => !assignee.isActive))) {
      invalid('assigneeIds', 'Every assignee must be an active user');
    }
    if (assigneeIds.length && ['EMPLOYEE', 'INTERN'].includes(roleName) && (assigneeIds.length !== 1 || assigneeIds[0] !== this.ownerId(user))) {
      invalid('assigneeIds', 'Employees and interns can save Task templates only for themselves');
    }

    if (data.projectId) {
      const scope = await this.accessPolicy.projectWhereForUser(user);
      const project = await this.prisma.project.findFirst({
        where: { AND: [{ id: data.projectId }, { status: ProjectStatus.ACTIVE }, scope] },
        select: { id: true },
      });
      if (!project) invalid('projectId', 'Project is inactive or inaccessible');
    }

    const validation: ReferenceValidation = {
      status: invalidFields.length ? 'NEEDS_UPDATE' : 'READY',
      invalidFields: [...new Set(invalidFields)],
      messages,
    };
    if (throwOnInvalid && invalidFields.length) throw new BadRequestException(messages.join('; '));
    return validation;
  }

  private async decorated(template: any, user: any) {
    return { ...template, validation: await this.validateReferences(template, user, false) };
  }

  private async assertNameAvailable(ownerUserId: string, name: string, excludingId?: string) {
    const duplicate = await this.prisma.quickTicketTemplate.findFirst({
      where: {
        ownerUserId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludingId ? { id: { not: excludingId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) throw new ConflictException('Template name already used');
  }

  async list(user: any) {
    const ownerUserId = this.ownerId(user);
    const [templates, preference] = await Promise.all([
      this.prisma.quickTicketTemplate.findMany({
        where: { ownerUserId },
        orderBy: [{ isPinned: 'desc' }, { displayOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.quickTicketTemplatePreference.findUnique({ where: { ownerUserId } }),
    ]);
    return {
      templates: await Promise.all(templates.map((template) => this.decorated(template, user))),
      preference: { visibleCount: preference?.visibleCount ?? DEFAULT_VISIBLE_COUNT },
    };
  }

  async get(id: string, user: any) {
    const template = await this.prisma.quickTicketTemplate.findFirst({
      where: { id, ownerUserId: this.ownerId(user) },
    });
    if (!template) throw new NotFoundException('Default Ticket not found');
    return this.decorated(template, user);
  }

  private async createWithCode(data: any, user: any) {
    const ownerUserId = this.ownerId(user);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quick-ticket-template:${ownerUserId}`}))`;
      const aggregate = await tx.quickTicketTemplate.aggregate({
        where: { ownerUserId },
        _max: { codeSequence: true, displayOrder: true },
      });
      const codeSequence = (aggregate._max.codeSequence ?? 0) + 1;
      const displayOrder = (aggregate._max.displayOrder ?? -1) + 1;
      return tx.quickTicketTemplate.create({
        data: {
          ...data,
          ownerUserId,
          codeSequence,
          code: `QTT-${String(codeSequence).padStart(3, '0')}`,
          displayOrder,
        },
      });
    });
  }

  async create(input: QuickTicketTemplateInput, user: any) {
    const data = this.normalizeInput(input);
    await this.validateReferences(data, user, true);
    await this.assertNameAvailable(this.ownerId(user), data.name);
    try {
      return await this.decorated(await this.createWithCode(data, user), user);
    } catch (error: any) {
      if (error?.code === 'P2002') throw new ConflictException('Template name already used');
      throw error;
    }
  }

  async update(id: string, input: QuickTicketTemplateInput, user: any) {
    const ownerUserId = this.ownerId(user);
    const existing = await this.prisma.quickTicketTemplate.findFirst({ where: { id, ownerUserId } });
    if (!existing) throw new NotFoundException('Default Ticket not found');
    const patch = this.normalizeInput(input, true);
    const candidate = { ...existing, ...patch };
    await this.validateReferences(candidate, user, true);
    await this.assertNameAvailable(ownerUserId, candidate.name, id);
    try {
      const updated = await this.prisma.quickTicketTemplate.update({ where: { id }, data: patch });
      return this.decorated(updated, user);
    } catch (error: any) {
      if (error?.code === 'P2002') throw new ConflictException('Template name already used');
      throw error;
    }
  }

  async duplicate(id: string, user: any) {
    const existing = await this.prisma.quickTicketTemplate.findFirst({
      where: { id, ownerUserId: this.ownerId(user) },
    });
    if (!existing) throw new NotFoundException('Default Ticket not found');
    await this.validateReferences(existing, user, true);

    const base = `${existing.name} Copy`;
    const siblings = await this.prisma.quickTicketTemplate.findMany({
      where: { ownerUserId: existing.ownerUserId, name: { startsWith: base, mode: 'insensitive' } },
      select: { name: true },
    });
    const names = new Set(siblings.map((row) => row.name.toLowerCase()));
    let name = base;
    for (let suffix = 2; names.has(name.toLowerCase()); suffix++) name = `${base} ${suffix}`;

    const { id: _id, code: _code, codeSequence: _sequence, displayOrder: _order, createdAt: _created, updatedAt: _updated, ownerUserId: _owner, ...copy } = existing;
    return this.decorated(await this.createWithCode({ ...copy, name, isPinned: false }, user), user);
  }

  async remove(id: string, user: any) {
    const result = await this.prisma.quickTicketTemplate.deleteMany({
      where: { id, ownerUserId: this.ownerId(user) },
    });
    if (result.count !== 1) throw new NotFoundException('Default Ticket not found');
    return { success: true };
  }

  async setVisibility(id: string, isVisible: unknown, user: any) {
    if (typeof isVisible !== 'boolean') throw new BadRequestException('isVisible must be a boolean');
    return this.updateFlags(id, { isVisible }, user);
  }

  async setPin(id: string, isPinned: unknown, user: any) {
    if (typeof isPinned !== 'boolean') throw new BadRequestException('isPinned must be a boolean');
    return this.updateFlags(id, { isPinned }, user);
  }

  private async updateFlags(id: string, data: { isVisible?: boolean; isPinned?: boolean }, user: any) {
    const template = await this.prisma.quickTicketTemplate.findFirst({
      where: { id, ownerUserId: this.ownerId(user) },
      select: { id: true },
    });
    if (!template) throw new NotFoundException('Default Ticket not found');
    return this.prisma.quickTicketTemplate.update({ where: { id }, data });
  }

  async reorder(ids: unknown, user: any) {
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string')) {
      throw new BadRequestException('Template order is required');
    }
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Template order contains duplicates');
    const ownerUserId = this.ownerId(user);
    const owned = await this.prisma.quickTicketTemplate.count({ where: { ownerUserId, id: { in: ids } } });
    if (owned !== ids.length) throw new ForbiddenException('Template order contains an unavailable template');
    await this.prisma.$transaction(ids.map((id, displayOrder) =>
      this.prisma.quickTicketTemplate.update({ where: { id }, data: { displayOrder } }),
    ));
    return { success: true };
  }

  async updatePreference(visibleCount: unknown, user: any) {
    const count = Number(visibleCount);
    if (!Number.isInteger(count) || count < 1 || count > MAX_VISIBLE_COUNT) {
      throw new BadRequestException(`Visible tag count must be from 1 to ${MAX_VISIBLE_COUNT}`);
    }
    const ownerUserId = this.ownerId(user);
    return this.prisma.quickTicketTemplatePreference.upsert({
      where: { ownerUserId },
      create: { ownerUserId, visibleCount: count },
      update: { visibleCount: count },
      select: { visibleCount: true },
    });
  }
}
