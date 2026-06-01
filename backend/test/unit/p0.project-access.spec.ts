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

  describe('Project Detail Fetching (FP-13.4A)', () => {
    it('fetches successfully by CUID/DB id', async () => {
      prisma.project.findFirst
        .mockResolvedValueOnce({ id: 'cuid-1234' })
        .mockResolvedValueOnce({ id: 'cuid-1234', name: 'Project 1', tickets: [] });

      const result = await service.findOne('cuid-1234', { id: 'admin1', role: { name: 'ADMIN' } });
      expect(result.id).toBe('cuid-1234');
      expect(prisma.project.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
        where: { OR: [{ id: 'cuid-1234' }, { projectId: 'cuid-1234' }] }
      }));
    });

    it('fetches successfully by project code (PRJ-XXX)', async () => {
      prisma.project.findFirst
        .mockResolvedValueOnce({ id: 'cuid-9999' })
        .mockResolvedValueOnce({ id: 'cuid-9999', projectId: 'PRJ-003', tickets: [] });

      const result = await service.findOne('PRJ-003', { id: 'admin1', role: { name: 'ADMIN' } });
      expect(result.id).toBe('cuid-9999');
      expect(prisma.project.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
        where: { OR: [{ id: 'PRJ-003' }, { projectId: 'PRJ-003' }] }
      }));
    });

    it('rejects unauthorized scoped user (ForbiddenException)', async () => {
      prisma.project.findFirst
        .mockResolvedValueOnce({ id: 'cuid-1234' }) // exists
        .mockResolvedValueOnce(null); // not found within scope

      await expect(
        service.findOne('cuid-1234', { id: 'emp1', role: { name: 'EMPLOYEE' } })
      ).rejects.toThrow(ForbiddenException);
    });

    it('does not crash or reject CUID/string formats in service layer', async () => {
      // The controller's removal of ParseUUIDPipe allows any string to reach the service.
      // This test confirms the service handles random strings safely.
      prisma.project.findFirst
        .mockResolvedValueOnce({ id: 'weird-string-format_123' })
        .mockResolvedValueOnce({ id: 'weird-string-format_123', tickets: [] });

      const result = await service.findOne('weird-string-format_123', { id: 'admin1', role: { name: 'ADMIN' } });
      expect(result.id).toBe('weird-string-format_123');
    });
  });
});
