import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TicketTemplatesService } from '../../src/modules/operations/tickets/ticket-templates.service';

const OWNER = { id: 'user-1', role: { name: 'MANAGER' }, departmentId: 'dept-1' };
const EMPLOYEE = { id: 'employee-1', role: { name: 'EMPLOYEE' }, departmentId: 'dept-1' };
const INTERN = { id: 'intern-1', role: { name: 'INTERN' }, departmentId: 'dept-1' };
const TEAM_LEAD = { id: 'lead-1', role: { name: 'TEAM_LEAD' }, departmentId: 'dept-1' };
const ADMIN = { id: 'admin-1', role: { name: 'ADMIN' }, departmentId: 'dept-admin' };
const SUPER_ADMIN = { id: 'super-admin-1', role: { name: 'SUPER_ADMIN' }, departmentId: null };

const input = {
  name: 'API Bug',
  title: 'Fix API bug',
  description: 'Investigate and repair the endpoint',
  departmentId: 'dept-1',
  taskTypeId: 'type-1',
  taskSubtypeId: 'subtype-1',
  assigneeIds: ['assignee-1', 'assignee-2'],
  priority: 'HIGH',
  estimatedMinutes: 90,
  projectId: 'project-1',
};

function build() {
  const prisma: any = {
    department: { findUnique: jest.fn().mockResolvedValue({ id: 'dept-1' }) },
    taskType: { findUnique: jest.fn().mockResolvedValue({ id: 'type-1', departmentId: 'dept-1', isGlobal: false }) },
    taskSubtype: { findUnique: jest.fn().mockResolvedValue({ taskTypeId: 'type-1' }) },
    user: { findMany: jest.fn().mockResolvedValue([
      { id: 'assignee-1', isActive: true, departmentId: 'dept-1' },
      { id: 'assignee-2', isActive: true, departmentId: 'dept-1' },
    ]) },
    project: { findFirst: jest.fn().mockResolvedValue({ id: 'project-1' }) },
    quickTicketTemplate: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _max: { codeSequence: 2, displayOrder: 4 } }),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
    quickTicketTemplatePreference: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  prisma.$transaction = jest.fn(async (arg: any) => typeof arg === 'function' ? arg(prisma) : Promise.all(arg));
  const accessPolicy: any = {
    roleName: jest.fn((user) => user?.role?.name ?? ''),
    managedDepartmentIds: jest.fn().mockResolvedValue(['dept-1']),
    projectWhereForUser: jest.fn().mockResolvedValue({ members: { some: { userId: OWNER.id } } }),
  };
  return { prisma, accessPolicy, service: new TicketTemplatesService(prisma, accessPolicy) };
}

describe('TicketTemplatesService', () => {
  it('creates an owner-scoped template with a stable sequential code', async () => {
    const { prisma, service } = build();
    prisma.quickTicketTemplate.create.mockImplementation(async ({ data }: any) => ({ id: 'template-1', ...data }));

    const created = await service.create(input, OWNER);

    expect(created.code).toBe('QTT-003');
    expect(created.ownerUserId).toBe(OWNER.id);
    expect(created.displayOrder).toBe(5);
    expect(created.validation.status).toBe('READY');
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('lists only templates belonging to the authenticated owner', async () => {
    const { prisma, service } = build();
    await service.list(OWNER);
    expect(prisma.quickTicketTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerUserId: OWNER.id },
    }));
  });

  it('does not reveal another owner template', async () => {
    const { prisma, service } = build();
    prisma.quickTicketTemplate.findFirst.mockResolvedValue(null);
    await expect(service.get('other-template', OWNER)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.quickTicketTemplate.findFirst).toHaveBeenCalledWith({
      where: { id: 'other-template', ownerUserId: OWNER.id },
    });
  });

  it('rejects zero estimated time before writing', async () => {
    const { prisma, service } = build();
    await expect(service.create({ ...input, estimatedMinutes: 0 }, OWNER)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.quickTicketTemplate.create).not.toHaveBeenCalled();
  });

  it('creates a default ticket when only its name and ticket title are provided', async () => {
    const { prisma, service } = build();
    prisma.quickTicketTemplate.create.mockImplementation(async ({ data }: any) => ({ id: 'template-minimal', ...data }));

    const created = await service.create({ name: 'Daily update', title: 'Post daily update' }, OWNER);

    expect(created).toEqual(expect.objectContaining({
      name: 'Daily update',
      title: 'Post daily update',
      departmentId: null,
      taskTypeId: null,
      assigneeIds: [],
      priority: null,
      estimatedMinutes: null,
    }));
    expect(created.validation.status).toBe('READY');
    expect(prisma.department.findUnique).not.toHaveBeenCalled();
    expect(prisma.taskType.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it.each([EMPLOYEE, INTERN, TEAM_LEAD, OWNER, ADMIN, SUPER_ADMIN])(
    'allows %s to own a personal Default Ticket when that role can use ticket creation',
    async (actor) => {
      const { prisma, service } = build();
      prisma.quickTicketTemplate.create.mockImplementation(async ({ data }: any) => ({ id: `template-${actor.id}`, ...data }));

      const created = await service.create({ name: `Default ${actor.id}`, title: 'Reusable ticket' }, actor);

      expect(created.ownerUserId).toBe(actor.id);
      expect(created.validation.status).toBe('READY');
    },
  );

  it('rejects a subtype that does not belong to the task type', async () => {
    const { prisma, service } = build();
    prisma.taskSubtype.findUnique.mockResolvedValue({ taskTypeId: 'different-type' });
    await expect(service.create(input, OWNER)).rejects.toThrow('Subtype is unavailable for this Task Type');
  });

  it('rejects an inactive assignee', async () => {
    const { prisma, service } = build();
    prisma.user.findMany.mockResolvedValue([
      { id: 'assignee-1', isActive: false, departmentId: 'dept-1' },
      { id: 'assignee-2', isActive: true, departmentId: 'dept-1' },
    ]);
    await expect(service.create(input, OWNER)).rejects.toThrow('Every assignee must be an active user');
  });

  it('keeps employee templates self-assigned without changing role rules', async () => {
    const { service } = build();
    await expect(service.create({ ...input, assigneeIds: ['employee-1', 'someone-else'] }, EMPLOYEE)).rejects.toThrow(
      'Employees and interns can save Task templates only for themselves',
    );
  });

  it('keeps Team Leads inside their own department', async () => {
    const { prisma, service } = build();
    prisma.department.findUnique.mockResolvedValue({ id: 'dept-2' });
    await expect(service.create({ ...input, departmentId: 'dept-2' }, TEAM_LEAD)).rejects.toThrow(
      'Department is outside your ticket-creation scope',
    );
  });

  it('keeps Managers inside their managed department scope', async () => {
    const { prisma, accessPolicy, service } = build();
    prisma.department.findUnique.mockResolvedValue({ id: 'dept-2' });
    accessPolicy.managedDepartmentIds.mockResolvedValue(['dept-1']);
    await expect(service.create({ ...input, departmentId: 'dept-2' }, OWNER)).rejects.toThrow(
      'Department is outside your ticket-creation scope',
    );
  });

  it.each([TEAM_LEAD, OWNER, ADMIN, SUPER_ADMIN])(
    'allows %s to save cross-department assignees in a Default Ticket',
    async (actor) => {
    const { prisma, service } = build();
    prisma.user.findMany.mockResolvedValue([
      { id: 'assignee-1', isActive: true, departmentId: 'dept-1' },
      { id: 'assignee-2', isActive: true, departmentId: 'dept-2' },
    ]);
      prisma.quickTicketTemplate.create.mockImplementation(async ({ data }: any) => ({ id: `cross-${actor.id}`, ...data }));

      await expect(service.create(input, actor)).resolves.toEqual(expect.objectContaining({
        assigneeIds: ['assignee-1', 'assignee-2'],
      }));
    },
  );

  it('rejects an inaccessible or inactive project', async () => {
    const { prisma, service } = build();
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(service.create(input, OWNER)).rejects.toThrow('Project is inactive or inaccessible');
  });

  it('marks a stored template NEEDS_UPDATE when a reference becomes unavailable', async () => {
    const { prisma, service } = build();
    prisma.quickTicketTemplate.findMany.mockResolvedValue([{ id: 'template-1', ownerUserId: OWNER.id, ...input, code: 'QTT-001' }]);
    prisma.department.findUnique.mockResolvedValue(null);
    const result = await service.list(OWNER);
    expect(result.templates[0].validation.status).toBe('NEEDS_UPDATE');
    expect(result.templates[0].validation.invalidFields).toContain('departmentId');
  });

  it('prevents reorder requests containing another owner template', async () => {
    const { prisma, service } = build();
    prisma.quickTicketTemplate.count.mockResolvedValue(1);
    await expect(service.reorder(['mine', 'not-mine'], OWNER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('deletes only by id plus authenticated owner and never touches tickets', async () => {
    const { prisma, service } = build();
    prisma.quickTicketTemplate.deleteMany.mockResolvedValue({ count: 1 });
    await expect(service.remove('template-1', OWNER)).resolves.toEqual({ success: true });
    expect(prisma.quickTicketTemplate.deleteMany).toHaveBeenCalledWith({
      where: { id: 'template-1', ownerUserId: OWNER.id },
    });
    expect((prisma as any).ticket).toBeUndefined();
  });

  it('stores visible count in the tickets preference table only', async () => {
    const { prisma, service } = build();
    prisma.quickTicketTemplatePreference.upsert.mockResolvedValue({ visibleCount: 7 });
    await expect(service.updatePreference(7, OWNER)).resolves.toEqual({ visibleCount: 7 });
    expect(prisma.quickTicketTemplatePreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerUserId: OWNER.id },
    }));
  });
});
