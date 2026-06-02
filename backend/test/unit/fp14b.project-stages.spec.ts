/**
 * FP-14B — Project Stage, Activity, Member Role, Archive/Restore tests
 *
 * All new service methods are unit-tested here.
 * Prisma is fully mocked. No DB connection required.
 * Regression tests for existing project access also run.
 */
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { ProjectsService } from '../../src/modules/operations/projects/projects.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';

// ── Mocks ──────────────────────────────────────────────────────────────────

const prisma: any = {
  project: { findFirst: jest.fn(), update: jest.fn(), count: jest.fn(), groupBy: jest.fn(), delete: jest.fn() },
  projectMember: { upsert: jest.fn(), delete: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  projectStage: {
    findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(),
    create: jest.fn(), update: jest.fn(), delete: jest.fn(),
    aggregate: jest.fn().mockResolvedValue({ _max: { order: null } }),
    count: jest.fn().mockResolvedValue(0),
  },
  ticket: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
  operationalEvent: { findMany: jest.fn().mockResolvedValue([]) },
  user: { findUnique: jest.fn() },
  managerDeptAccess: { findMany: jest.fn().mockResolvedValue([]) },
  $transaction: jest.fn().mockImplementation((ops: any[]) => Promise.all(ops)),
};

const mockEventLogger: any = { log: jest.fn().mockResolvedValue(undefined) };

// Shared users
const adminUser    = { id: 'admin1',  role: { name: 'ADMIN'       } };
const superAdmin   = { id: 'super1',  role: { name: 'SUPER_ADMIN' } };
const managerUser  = { id: 'mgr1',    role: { name: 'MANAGER'     }, departmentId: 'd1' };
const tlUser       = { id: 'tl1',     role: { name: 'TEAM_LEAD'   }, departmentId: 'd1' };
const empUser      = { id: 'emp1',    role: { name: 'EMPLOYEE'    }, departmentId: 'd1' };

// A project findOne always returns this after scope check
const mockProject = { id: 'p1', projectId: 'PRJ-001', name: 'Test', status: 'ACTIVE', departmentId: 'd1', members: [{ userId: 'mgr1' }], tickets: [] };

function setupFindOne(project = mockProject) {
  prisma.project.findFirst
    .mockResolvedValueOnce({ id: project.id })            // first call: id lookup
    .mockResolvedValueOnce(project);                       // second call: full scope check
}

// ── Test suites ────────────────────────────────────────────────────────────

describe('FP-14B — ProjectsService', () => {
  let service: ProjectsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.projectStage.aggregate.mockResolvedValue({ _max: { order: null } });
    prisma.projectStage.count.mockResolvedValue(0);
    prisma.ticket.findMany.mockResolvedValue([]);
    prisma.ticket.count.mockResolvedValue(0);
    prisma.operationalEvent.findMany.mockResolvedValue([]);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.managerDeptAccess.findMany.mockResolvedValue([]);
    service = new ProjectsService(prisma, new AccessPolicyService(prisma), mockEventLogger);
  });

  // ── Stage list ────────────────────────────────────────────────────────────

  it('member can list stages', async () => {
    setupFindOne();
    prisma.projectStage.findMany.mockResolvedValue([{ id: 's1', name: 'Discovery', order: 0 }]);
    const result = await service.listStages('p1', adminUser);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Discovery');
  });

  // ── Stage create ──────────────────────────────────────────────────────────

  it('employee cannot create stage', async () => {
    setupFindOne({ ...mockProject, departmentId: 'd1', members: [] });
    await expect(service.createStage('p1', { name: 'Discovery' }, empUser)).rejects.toThrow(ForbiddenException);
  });

  it('manager can create stage if scoped', async () => {
    setupFindOne(mockProject);
    prisma.projectStage.create.mockResolvedValue({ id: 's1', name: 'Discovery', order: 0 });
    const result = await service.createStage('p1', { name: 'Discovery' }, managerUser);
    expect(result.name).toBe('Discovery');
  });

  it('admin can create stage', async () => {
    setupFindOne(mockProject);
    prisma.projectStage.create.mockResolvedValue({ id: 's1', name: 'Design', order: 0 });
    const result = await service.createStage('p1', { name: 'Design' }, adminUser);
    expect(result.name).toBe('Design');
  });

  it('invalid stage status is rejected', async () => {
    setupFindOne(mockProject);
    await expect(service.createStage('p1', { name: 'Bad', status: 'INVALID_STATUS' }, adminUser)).rejects.toThrow(BadRequestException);
  });

  it('endDate before startDate is rejected on create', async () => {
    setupFindOne(mockProject);
    await expect(
      service.createStage('p1', { name: 'Bad', startDate: '2026-06-10', endDate: '2026-06-01' }, adminUser),
    ).rejects.toThrow(BadRequestException);
  });

  // ── Stage update ──────────────────────────────────────────────────────────

  it('update stage works for manager', async () => {
    setupFindOne(mockProject);
    prisma.projectStage.findFirst.mockResolvedValue({ id: 's1', name: 'Discovery', startDate: null, endDate: null });
    prisma.projectStage.update.mockResolvedValue({ id: 's1', name: 'Discovery Updated' });
    const result = await service.updateStage('p1', 's1', { name: 'Discovery Updated' }, managerUser);
    expect(result.name).toBe('Discovery Updated');
  });

  it('endDate before startDate rejected on update', async () => {
    setupFindOne(mockProject);
    prisma.projectStage.findFirst.mockResolvedValue({ id: 's1', name: 'Stage', startDate: null, endDate: null });
    await expect(
      service.updateStage('p1', 's1', { startDate: '2026-06-10', endDate: '2026-06-01' }, adminUser),
    ).rejects.toThrow(BadRequestException);
  });

  // ── Stage delete ──────────────────────────────────────────────────────────

  it('delete stage with linked tickets is rejected', async () => {
    setupFindOne(mockProject);
    prisma.projectStage.findFirst.mockResolvedValue({ id: 's1', name: 'Dev' });
    prisma.ticket.count.mockResolvedValue(3); // 3 linked tickets
    await expect(service.deleteStage('p1', 's1', adminUser)).rejects.toThrow(BadRequestException);
  });

  it('delete stage with no linked tickets succeeds', async () => {
    setupFindOne(mockProject);
    prisma.projectStage.findFirst.mockResolvedValue({ id: 's1', name: 'Dev' });
    prisma.ticket.count.mockResolvedValue(0);
    prisma.projectStage.delete.mockResolvedValue({ id: 's1' });
    const result = await service.deleteStage('p1', 's1', adminUser);
    expect(result).toEqual({ success: true });
  });

  // ── Stage reorder ─────────────────────────────────────────────────────────

  it('reorder stages works', async () => {
    setupFindOne(mockProject);
    prisma.projectStage.findMany
      .mockResolvedValueOnce([{ id: 's1' }, { id: 's2' }])  // for verification
      .mockResolvedValueOnce([{ id: 's2', order: 0 }, { id: 's1', order: 1 }]); // for return
    prisma.projectStage.update.mockResolvedValue({});
    prisma.project.findFirst
      .mockResolvedValueOnce({ id: 'p1' })
      .mockResolvedValueOnce(mockProject);
    const result = await service.reorderStages('p1', ['s2', 's1'], adminUser);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('foreign stage id in reorder is rejected', async () => {
    setupFindOne(mockProject);
    prisma.projectStage.findMany.mockResolvedValue([{ id: 's1' }]); // only s1 belongs
    await expect(service.reorderStages('p1', ['s1', 'foreign-stage'], adminUser)).rejects.toThrow(BadRequestException);
  });

  // ── Activity ──────────────────────────────────────────────────────────────

  it('activity endpoint returns project events and linked ticket events', async () => {
    setupFindOne(mockProject);
    prisma.ticket.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
    prisma.operationalEvent.findMany.mockResolvedValue([
      { id: 'e1', entityType: 'Project', entityId: 'p1', action: 'PROJECT_CREATED' },
      { id: 'e2', entityType: 'Ticket',  entityId: 't1', action: 'TICKET_CREATED'  },
    ]);
    const result = await service.getActivity('p1', 50, adminUser);
    expect(result).toHaveLength(2);
    const call = prisma.operationalEvent.findMany.mock.calls[0][0];
    expect(call.where.OR).toEqual(expect.arrayContaining([
      { entityType: 'Project', entityId: 'p1' },
      { entityType: 'Ticket', entityId: { in: ['t1', 't2'] } },
    ]));
  });

  it('activity endpoint respects project scope', async () => {
    // Employee not a member of the project → findOne throws ForbiddenException
    prisma.project.findFirst
      .mockResolvedValueOnce({ id: 'p1' })
      .mockResolvedValueOnce(null); // scope: not visible
    await expect(service.getActivity('p1', 50, empUser)).rejects.toThrow(ForbiddenException);
  });

  // ── Member role update ────────────────────────────────────────────────────

  it('update member role works for manager', async () => {
    setupFindOne(mockProject);
    prisma.projectMember.findUnique.mockResolvedValue({ projectId: 'p1', userId: 'emp1', role: 'MEMBER' });
    prisma.projectMember.update.mockResolvedValue({ projectId: 'p1', userId: 'emp1', role: 'REVIEWER', user: {} });
    const result = await service.updateMemberRole('p1', 'emp1', 'REVIEWER', managerUser);
    expect(result.role).toBe('REVIEWER');
  });

  it('invalid role is rejected on member role update', async () => {
    setupFindOne(mockProject);
    await expect(service.updateMemberRole('p1', 'emp1', 'WIZARD', adminUser)).rejects.toThrow(BadRequestException);
  });

  it('non-member role update is rejected', async () => {
    setupFindOne(mockProject);
    prisma.projectMember.findUnique.mockResolvedValue(null); // not a member
    await expect(service.updateMemberRole('p1', 'emp1', 'LEAD', adminUser)).rejects.toThrow(NotFoundException);
  });

  it('employee cannot update member role', async () => {
    setupFindOne({ ...mockProject, members: [] });
    await expect(service.updateMemberRole('p1', 'emp2', 'LEAD', empUser)).rejects.toThrow(ForbiddenException);
  });

  // ── Archive / Restore ─────────────────────────────────────────────────────

  it('manager can archive scoped project', async () => {
    setupFindOne(mockProject);
    prisma.project.update.mockResolvedValue({ ...mockProject, status: 'ARCHIVED' });
    const result = await service.archive('p1', managerUser);
    expect(result.status).toBe('ARCHIVED');
  });

  it('admin can archive', async () => {
    setupFindOne(mockProject);
    prisma.project.update.mockResolvedValue({ ...mockProject, status: 'ARCHIVED' });
    const result = await service.archive('p1', adminUser);
    expect(result.status).toBe('ARCHIVED');
  });

  it('employee cannot archive', async () => {
    setupFindOne({ ...mockProject, members: [] });
    await expect(service.archive('p1', empUser)).rejects.toThrow(ForbiddenException);
  });

  it('restore works for admin', async () => {
    const archivedProject = { ...mockProject, status: 'ARCHIVED' };
    prisma.project.findFirst
      .mockResolvedValueOnce({ id: 'p1' })
      .mockResolvedValueOnce(archivedProject);
    prisma.project.update.mockResolvedValue({ ...archivedProject, status: 'ACTIVE' });
    const result = await service.restore('p1', adminUser);
    expect(result.status).toBe('ACTIVE');
  });

  it('hard delete still restricted to admin', async () => {
    setupFindOne(mockProject);
    prisma.project.delete.mockResolvedValue({ id: 'p1' });
    // Manager cannot hard-delete
    await expect(service.remove('p1', managerUser)).rejects.toThrow(ForbiddenException);
  });

  // ── Regression: existing project access tests ──────────────────────────────

  it('blocks a manager from editing a project outside scoped departments/membership', async () => {
    prisma.project.findFirst
      .mockResolvedValueOnce({ id: 'p1' })
      .mockResolvedValueOnce(null);
    await expect(
      service.update('p1', { name: 'Nope' }, { id: 'mgr1', role: { name: 'MANAGER' }, departmentId: 'd1' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows admin project edit', async () => {
    prisma.project.findFirst
      .mockResolvedValueOnce({ id: 'p1' })
      .mockResolvedValueOnce({ id: 'p1', departmentId: 'd2', members: [], tickets: [] });
    prisma.project.update.mockResolvedValue({ id: 'p1', name: 'Updated' });
    const result = await service.update('p1', { name: 'Updated' }, adminUser);
    expect(result.name).toBe('Updated');
  });

  it('fetches project successfully by CUID/DB id', async () => {
    prisma.project.findFirst
      .mockResolvedValueOnce({ id: 'cuid-1234' })
      .mockResolvedValueOnce({ id: 'cuid-1234', name: 'Project 1', tickets: [] });
    const result = await service.findOne('cuid-1234', adminUser);
    expect(result.id).toBe('cuid-1234');
  });
});
