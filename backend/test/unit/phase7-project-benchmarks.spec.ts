import { BadRequestException } from '@nestjs/common';
import { ProjectsService } from '../../src/modules/operations/projects/projects.service';

describe('Phase 7 project productivity benchmarks', () => {
  const prisma: any = {
    department: { findUnique: jest.fn() },
    team: { count: jest.fn() },
  };
  const service = new ProjectsService(prisma, {} as any, {} as any) as any;

  beforeEach(() => jest.clearAllMocks());

  it('accepts independent team targets for active Content teams and clears the project target', async () => {
    prisma.department.findUnique.mockResolvedValue({ name: 'Content Sales' });
    prisma.team.count.mockResolvedValue(2);
    await expect(service.validateBenchmarkConfiguration('content', [
      { teamId: 'a', outputTargetMinutes: 30 },
      { teamId: 'b', outputTargetMinutes: 60 },
    ], 90)).resolves.toEqual({
      projectTarget: null,
      teamAssignments: [
        { teamId: 'a', outputTargetMinutes: 30 },
        { teamId: 'b', outputTargetMinutes: 60 },
      ],
    });
  });

  it('uses one optional project target when Content has no selected team', async () => {
    prisma.department.findUnique.mockResolvedValue({ name: 'Content' });
    await expect(service.validateBenchmarkConfiguration('content', [], 75)).resolves.toEqual({
      projectTarget: 75,
      teamAssignments: [],
    });
  });

  it('rejects team benchmarks outside Content', async () => {
    prisma.department.findUnique.mockResolvedValue({ name: 'Retail Business' });
    await expect(service.validateBenchmarkConfiguration('retail', [{ teamId: 'a', outputTargetMinutes: 30 }], null))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects targets outside 1 to 1440', async () => {
    prisma.department.findUnique.mockResolvedValue({ name: 'Content' });
    await expect(service.validateBenchmarkConfiguration('content', [], 1441)).rejects.toThrow(/1 to 1440/);
  });
});
