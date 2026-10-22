import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ChangeRequestsService } from '../../src/modules/core/users/change-requests.service';

describe('personal information change requests', () => {
  const employee = {
    id: 'employee-1', name: 'Display Name', legalName: 'Legal Name', personalEmail: 'old@example.com',
    phone: '9999999999', dateOfBirth: new Date('2000-01-01T00:00:00.000Z'), isActive: true,
    password: '$2a$10$not-used', role: { name: 'EMPLOYEE' },
  };
  let prisma: any;
  let events: any;
  let notifications: any;
  let service: ChangeRequestsService;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      employeeDocument: { findMany: jest.fn().mockResolvedValue([]) },
      employeeProfileChangeRequest: {
        findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn(), findMany: jest.fn(),
        create: jest.fn(), update: jest.fn(),
      },
    };
    prisma.$transaction = jest.fn(async (work: any) => work(prisma));
    events = { log: jest.fn().mockResolvedValue(undefined) };
    notifications = { sendNotification: jest.fn().mockResolvedValue(undefined) };
    service = new ChangeRequestsService(
      prisma,
      { roleName: (user: any) => user?.role?.name, managedDepartmentIds: jest.fn() } as any,
      events,
      notifications,
      { now: () => new Date('2026-10-21T10:00:00.000Z') } as any,
    );
  });

  it('routes an employee request directly to HR and captures the submitted baseline', async () => {
    prisma.user.findUnique.mockResolvedValue(employee);
    prisma.employeeProfileChangeRequest.create.mockImplementation(async ({ data }: any) => ({ id: 'request-1', ...data }));

    const result: any = await service.createPersonalInformationRequest(employee.id, {
      changes: [{ field: 'personalEmail', newValue: 'new@example.com' }], reason: 'My email changed',
    }, employee);

    expect(result.status).toBe('PENDING_HR_REVIEW');
    expect(result.changes).toEqual([{ field: 'personalEmail', oldValue: 'old@example.com', newValue: 'new@example.com' }]);
    expect(prisma.employeeProfileChangeRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ requestedById: employee.id, targetUserId: employee.id }),
    }));
  });

  it('requires evidence for legal-name and date-of-birth corrections', async () => {
    prisma.user.findUnique.mockResolvedValue(employee);
    await expect(service.createPersonalInformationRequest(employee.id, {
      changes: [{ field: 'legalName', newValue: 'Correct Legal Name' }], reason: 'Correction',
    }, employee)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows only one unresolved personal information request per employee', async () => {
    prisma.user.findUnique.mockResolvedValue(employee);
    prisma.employeeProfileChangeRequest.findFirst.mockResolvedValue({ id: 'already-pending' });
    await expect(service.createPersonalInformationRequest(employee.id, {
      changes: [{ field: 'phone', newValue: '8888888888' }], reason: 'Correction',
    }, employee)).rejects.toBeInstanceOf(ConflictException);
  });

  it('prevents an HR initiator from approving their own request', async () => {
    const hr = { id: 'hr-1', isHR: true, role: { name: 'EMPLOYEE' } };
    const request = { id: 'request-1', requestType: 'PERSONAL_INFORMATION', requestedById: hr.id,
      targetUserId: employee.id, status: 'PENDING_HR_REVIEW', changes: [] };
    prisma.employeeProfileChangeRequest.findUnique.mockResolvedValue(request);
    prisma.user.findUnique.mockResolvedValue(hr);
    await expect(service.approveChangeRequest(request.id, hr)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('atomically refuses approval when the official value changed after submission', async () => {
    const reviewer = { id: 'hr-2', isHR: true, role: { name: 'EMPLOYEE' } };
    const request = { id: 'request-1', requestType: 'PERSONAL_INFORMATION', requestedById: employee.id,
      targetUserId: employee.id, status: 'PENDING_HR_REVIEW',
      changes: [{ field: 'phone', oldValue: '9999999999', newValue: '8888888888' }] };
    prisma.employeeProfileChangeRequest.findUnique.mockResolvedValue(request);
    prisma.user.findUnique.mockResolvedValueOnce(reviewer).mockResolvedValueOnce({ ...employee, phone: '7777777777' });

    await expect(service.approveChangeRequest(request.id, reviewer)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('does not allow employees to withdraw a submitted personal information request', async () => {
    prisma.employeeProfileChangeRequest.findUnique.mockResolvedValue({
      id: 'request-1', requestType: 'PERSONAL_INFORMATION', requestedById: employee.id, status: 'PENDING_HR_REVIEW',
    });
    await expect(service.cancelChangeRequest('request-1', employee.id)).rejects.toBeInstanceOf(BadRequestException);
  });
});
