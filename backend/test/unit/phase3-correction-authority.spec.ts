import { CorrectionAuthorityService } from '../../src/modules/platform/attendance/regularization/correction-authority.service';

function service(overrides: Record<string, any> = {}) {
  const prisma: any = {
    user: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    hierarchyAssignment: { findFirst: jest.fn(), findMany: jest.fn() },
    managerDeptAccess: { findFirst: jest.fn(), findMany: jest.fn() },
    ...overrides,
  };
  return { prisma, authority: new CorrectionAuthorityService(prisma, {} as any) };
}

describe('Phase 3 correction authority', () => {
  it.each([
    [{ id: 'sa', isActive: true, role: { name: 'SUPER_ADMIN', level: 0 } }, 'SUPER_ADMIN'],
    [{ id: 'admin', isActive: true, role: { name: 'ADMIN', level: 1 } }, 'ADMIN'],
    [{ id: 'hr', isActive: true, isHR: true, role: { name: 'MANAGER', level: 2 } }, 'HR'],
  ])('recognizes company-wide authority without a manager-first stage', (actor: any, via) => {
    const { authority } = service();
    expect(authority.companyVia(actor)).toBe(via);
  });

  it('never grants a self-decision, including HR and Admin', async () => {
    const { authority } = service();
    await expect(authority.eligibility({ id: 'same', isActive: true, isHR: true, role: { name: 'ADMIN', level: 1 } }, 'same')).resolves.toBeNull();
  });

  it.each([
    ['TEAM_LEAD', 'EMPLOYEE_TL'],
    ['MANAGER', 'REPORTING_MANAGER'],
  ])('accepts a department primary %s as a final reviewer', async (assignmentRole: string, via: string) => {
    const { prisma, authority } = service();
    prisma.user.findUnique.mockResolvedValue({ id: 'employee', departmentId: 'dept', teamLeadName: null, reportingManager: null, role: { level: 4 } });
    prisma.hierarchyAssignment.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ role: assignmentRole });
    const result = await authority.eligibility({ id: 'reviewer', isActive: true, role: { name: assignmentRole, level: assignmentRole === 'TEAM_LEAD' ? 3 : 2 } }, 'employee');
    expect(result).toEqual({ via, role: assignmentRole, scope: 'team' });
  });

  it('uses the department single active Manager when no explicit link exists', async () => {
    const { prisma, authority } = service();
    prisma.user.findUnique.mockResolvedValue({ id: 'employee', departmentId: 'dept', teamLeadName: null, reportingManager: null, role: { level: 4 } });
    prisma.hierarchyAssignment.findFirst.mockResolvedValue(null);
    prisma.managerDeptAccess.findFirst.mockResolvedValue(null);
    prisma.user.findMany.mockResolvedValue([{ id: 'manager' }]);
    const result = await authority.eligibility({ id: 'manager', isActive: true, role: { name: 'MANAGER', level: 2 } }, 'employee');
    expect(result).toEqual({ via: 'REPORTING_MANAGER', role: 'MANAGER', scope: 'team' });
  });

  it('does not give an unrelated TL or Manager company-wide access', async () => {
    const { prisma, authority } = service();
    prisma.user.findUnique.mockResolvedValue({ id: 'employee', departmentId: 'dept-a', teamLeadName: null, reportingManager: null, role: { level: 4 } });
    prisma.hierarchyAssignment.findFirst.mockResolvedValue(null);
    prisma.managerDeptAccess.findFirst.mockResolvedValue(null);
    prisma.user.findMany.mockResolvedValue([]);
    await expect(authority.eligibility({ id: 'other', departmentId: 'dept-b', isActive: true, role: { name: 'MANAGER', level: 2 } }, 'employee')).resolves.toBeNull();
  });
});
