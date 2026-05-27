import { ForbiddenException } from '@nestjs/common';
import { ProjectsService } from '../../src/modules/operations/projects/projects.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';

const prisma: any = {
  project: {
    findFirst: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  projectMember: {
    upsert: jest.fn(),
    delete: jest.fn(),
  },
  user: { findUnique: jest.fn() },
  managerDeptAccess: { findMany: jest.fn().mockResolvedValue([]) },
};

describe('P0 project edit access', () => {
  let service: ProjectsService;

  beforeEach(() => {
    jest.clearAllMocks();
    const mockEventLogger: any = { log: jest.fn().mockResolvedValue(undefined) };
    service = new ProjectsService(prisma, new AccessPolicyService(prisma), mockEventLogger);
  });

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
      .mockResolvedValueOnce({ id: 'p1', departmentId: 'd2', members: [] });
    prisma.project.update.mockResolvedValue({ id: 'p1', name: 'Updated' });

    const result = await service.update('p1', { name: 'Updated' }, { id: 'admin1', role: { name: 'ADMIN' } });
    expect(result.name).toBe('Updated');
  });
});
