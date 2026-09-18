import { BadRequestException } from '@nestjs/common';
import { AttendanceCategory, PolicyStatus } from '@prisma/client';
import { UsersService } from '../../src/modules/core/users/users.service';

const CANONICAL_ROLES = [
  'INTERN',
  'EMPLOYEE',
  'TEAM_LEAD',
  'MANAGER',
  'ADMIN',
  'SUPER_ADMIN',
] as const;

function fixture(roleName: string = 'INTERN') {
  const roleSlug = roleName.toLowerCase();
  const createdUser = {
    id: 'user-1',
    name: `New ${roleName}`,
    email: `new.${roleSlug}@example.test`,
    password: 'hashed',
    roleId: `role-${roleSlug}`,
    departmentId: 'department-1',
    joiningDate: new Date('2026-09-01T00:00:00.000Z'),
    role: { id: `role-${roleSlug}`, name: roleName },
    department: { id: 'department-1', name: 'QA' },
  };
  const tx = {
    shiftPolicy: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'shift-1',
          attendancePolicyId: 'attendance-policy-1',
          category: AttendanceCategory.REGULAR_EMPLOYEE,
          status: PolicyStatus.ACTIVE,
        },
      ]),
    },
    attendancePolicy: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'attendance-policy-1',
        status: PolicyStatus.ACTIVE,
        geoFenceEnabled: false,
      }),
    },
    leavePolicy: { findMany: jest.fn().mockResolvedValue([{ id: 'leave-1' }]) },
    holidayCalendar: { findMany: jest.fn().mockResolvedValue([{ id: 'calendar-1' }]) },
    weeklyOffPolicy: { findMany: jest.fn().mockResolvedValue([{ id: 'weekly-1' }]) },
    attendanceLocation: { findMany: jest.fn() },
    user: { create: jest.fn().mockResolvedValue(createdUser) },
    employeeAttendanceProfile: { create: jest.fn().mockResolvedValue({ id: 'profile-1' }) },
  };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    role: { findUnique: jest.fn().mockResolvedValue({ id: `role-${roleSlug}`, name: roleName }) },
    $transaction: jest.fn(async (callback: any) => callback(tx)),
  };
  const eventLogger = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new UsersService(
    prisma as any,
    {} as any,
    eventLogger as any,
    {} as any,
    {} as any,
  );
  return { service, prisma, tx, createdUser };
}

describe('UsersService attendance onboarding', () => {
  it.each(CANONICAL_ROLES)('rejects a %s without a joining date before creating a user', async (roleName) => {
    const { service, prisma } = fixture(roleName);
    const roleSlug = roleName.toLowerCase();

    await expect(
      service.create({
        name: `New ${roleName}`,
        email: `new.${roleSlug}@example.test`,
        password: 'secret',
        roleId: `role-${roleSlug}`,
        departmentId: 'department-1',
      }),
    ).rejects.toThrow(new BadRequestException('Joining date is required for attendance onboarding'));

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(CANONICAL_ROLES)('creates a %s and its effective attendance profile in one transaction', async (roleName) => {
    const { service, prisma, tx } = fixture(roleName);
    const roleSlug = roleName.toLowerCase();

    await service.create(
      {
        name: `New ${roleName}`,
        email: `new.${roleSlug}@example.test`,
        password: 'secret',
        roleId: `role-${roleSlug}`,
        departmentId: 'department-1',
        joiningDate: '2026-09-01',
      },
      'admin-1',
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ joiningDate: new Date('2026-09-01T00:00:00.000Z') }),
      }),
    );
    expect(tx.employeeAttendanceProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        category: AttendanceCategory.REGULAR_EMPLOYEE,
        attendanceRequired: true,
        assignedShiftId: 'shift-1',
        assignedLeavePolicyId: 'leave-1',
        assignedHolidayCalendarId: 'calendar-1',
        assignedWeeklyOffPolicyId: 'weekly-1',
        effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
        updatedById: 'admin-1',
      }),
    });
  });

  it('refuses ambiguous attendance configuration before inserting the user', async () => {
    const { service, prisma, tx } = fixture('EMPLOYEE');
    tx.leavePolicy.findMany.mockResolvedValue([{ id: 'leave-1' }, { id: 'leave-2' }]);

    await expect(
      service.create({
        name: 'New Employee',
        email: 'new.employee@example.test',
        password: 'secret',
        roleId: 'role-employee',
        joiningDate: '2026-09-01',
      }),
    ).rejects.toThrow('multiple active leave policy records are configured');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.employeeAttendanceProfile.create).not.toHaveBeenCalled();
  });

  it('refuses missing attendance configuration before inserting the user', async () => {
    const { service, tx } = fixture('MANAGER');
    tx.shiftPolicy.findMany.mockResolvedValue([]);

    await expect(
      service.create({
        name: 'New Manager',
        email: 'new.manager@example.test',
        password: 'secret',
        roleId: 'role-manager',
        joiningDate: '2026-09-01',
      }),
    ).rejects.toThrow('no active regular shift policy is configured');

    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.employeeAttendanceProfile.create).not.toHaveBeenCalled();
  });

  it('propagates profile creation failure through the user transaction', async () => {
    const { service, tx } = fixture('SUPER_ADMIN');
    tx.employeeAttendanceProfile.create.mockRejectedValue(new Error('profile insert failed'));

    await expect(
      service.create({
        name: 'New Super Admin',
        email: 'new.super_admin@example.test',
        password: 'secret',
        roleId: 'role-super_admin',
        joiningDate: '2026-09-01',
      }),
    ).rejects.toThrow('profile insert failed');

    expect(tx.user.create).toHaveBeenCalledTimes(1);
    expect(tx.employeeAttendanceProfile.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a role id that does not exist before opening a transaction', async () => {
    const { service, prisma } = fixture();
    prisma.role.findUnique.mockResolvedValue(null);

    await expect(
      service.create({
        name: 'Unknown Role',
        email: 'unknown.role@example.test',
        password: 'secret',
        roleId: 'missing-role',
        joiningDate: '2026-09-01',
      }),
    ).rejects.toThrow('Selected role does not exist');

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an impossible joining date before opening a transaction', async () => {
    const { service, prisma } = fixture('TEAM_LEAD');

    await expect(
      service.create({
        name: 'Invalid Date',
        email: 'invalid.date@example.test',
        password: 'secret',
        roleId: 'role-team_lead',
        joiningDate: '2026-02-31',
      }),
    ).rejects.toThrow('Joining date must be a valid date');

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
