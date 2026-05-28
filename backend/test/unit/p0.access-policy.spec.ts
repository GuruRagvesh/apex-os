import { AccessPolicyService } from '../../src/common/services/access-policy.service';

const prisma: any = {
  managerDeptAccess: { findMany: jest.fn() },
  user: { findUnique: jest.fn() },
};

describe('P0 AccessPolicyService', () => {
  let service: AccessPolicyService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AccessPolicyService(prisma);
  });

  it('strips payroll, statutory, document and password fields from broad user responses', () => {
    const safe = service.safeUser({
      id: 'u1',
      name: 'Employee',
      password: 'secret',
      ctcAnnual: 100000,
      accountNumber: '123456789',
      panNumber: 'ABCDE1234F',
      aadhaarNumber: '123412341234',
      employeeDocuments: [{ id: 'doc1' }],
      role: { name: 'EMPLOYEE' },
    });

    expect(safe.password).toBeUndefined();
    expect(safe.ctcAnnual).toBeUndefined();
    expect(safe.accountNumber).toBeUndefined();
    expect(safe.panNumber).toBeUndefined();
    expect(safe.aadhaarNumber).toBeUndefined();
    expect(safe.employeeDocuments).toBeUndefined();
    expect(safe.name).toBe('Employee');
  });

  it('does not allow managers to view payroll or documents by default', () => {
    const manager = { id: 'mgr1', role: { name: 'MANAGER' }, departmentId: 'd1' };
    const employee = { id: 'emp1', role: { name: 'EMPLOYEE' }, departmentId: 'd1' };

    expect(service.canViewPayroll(manager, employee)).toBe(false);
    expect(service.canViewDocuments(manager, employee)).toBe(false);
  });

  it('allows employees to view their own payroll/documents and admins to view all', () => {
    const employee = { id: 'emp1', role: { name: 'EMPLOYEE' }, departmentId: 'd1' };
    const admin = { id: 'admin1', role: { name: 'ADMIN' } };

    expect(service.canViewPayroll(employee, employee)).toBe(true);
    expect(service.canViewDocuments(employee, employee)).toBe(true);
    expect(service.canViewPayroll(admin, employee)).toBe(true);
    expect(service.canViewDocuments(admin, employee)).toBe(true);
  });
});
