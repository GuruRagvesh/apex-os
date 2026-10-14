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
      findFirst: jest.fn().mockResolvedValue(null),
    },
    attendancePolicy: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'attendance-policy-1',
        status: PolicyStatus.ACTIVE,
        geoFenceEnabled: false,
      }),
    },
    leavePolicy: {
      findMany: jest.fn().mockResolvedValue([{ id: 'leave-1' }]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    holidayCalendar: {
      findMany: jest.fn().mockResolvedValue([{ id: 'calendar-1' }]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    weeklyOffPolicy: {
      findMany: jest.fn().mockResolvedValue([{ id: 'weekly-1' }]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
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

  it('keeps a joining date before the policies start; the attendance profile starts with the policies', async () => {
    const { service, tx } = fixture('INTERN');
    const shifts = await tx.shiftPolicy.findMany();
    tx.shiftPolicy.findMany.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce(shifts);
    tx.shiftPolicy.findFirst.mockResolvedValue({ effectiveFrom: new Date('2026-09-15T00:00:00.000Z') });

    await expect(
      service.create({
        name: 'New Intern',
        email: 'new.intern@example.test',
        password: 'secret',
        roleId: 'role-intern',
        joiningDate: '2026-08-24',
      }),
    ).resolves.toBeDefined();

    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ joiningDate: new Date('2026-08-24T00:00:00.000Z') }) }));
    expect(tx.employeeAttendanceProfile.create).toHaveBeenCalledWith({ data: expect.objectContaining({ effectiveFrom: new Date('2026-09-15T00:00:00.000Z') }) });
    expect(tx.shiftPolicy.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ effectiveFrom: { gt: new Date('2026-08-24T00:00:00.000Z') } }),
      orderBy: { effectiveFrom: 'asc' },
    }));
  });

  it('advances to a later holiday calendar even when the shift already covers the joining date', async () => {
    const { service, tx } = fixture('INTERN');
    const calendar = { id: 'calendar-1' };
    tx.holidayCalendar.findMany.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([calendar]);
    tx.holidayCalendar.findFirst.mockResolvedValue({ effectiveFrom: new Date('2026-08-27T00:00:00.000Z') });

    await expect(
      service.create({
        name: 'Sherin Shaji',
        email: 'sherin@example.test',
        password: 'secret',
        roleId: 'role-intern',
        departmentId: 'department-1',
        joiningDate: '2026-08-24',
      }),
    ).resolves.toBeDefined();

    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ joiningDate: new Date('2026-08-24T00:00:00.000Z') }),
    }));
    expect(tx.employeeAttendanceProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assignedHolidayCalendarId: 'calendar-1',
        effectiveFrom: new Date('2026-08-27T00:00:00.000Z'),
      }),
    });
  });

  it('waits for the complete leave, holiday and weekly-off bundle', async () => {
    const { service, tx } = fixture('TEAM_LEAD');
    tx.leavePolicy.findMany.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'leave-1' }]);
    tx.leavePolicy.findFirst.mockResolvedValue({ effectiveFrom: new Date('2026-08-25T00:00:00.000Z') });
    tx.holidayCalendar.findMany.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'calendar-1' }]);
    tx.holidayCalendar.findFirst.mockResolvedValue({ effectiveFrom: new Date('2026-08-27T00:00:00.000Z') });
    tx.weeklyOffPolicy.findMany.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'weekly-1' }]);
    tx.weeklyOffPolicy.findFirst.mockResolvedValue({ effectiveFrom: new Date('2026-08-26T00:00:00.000Z') });

    await service.create({
      name: 'New Team Lead',
      email: 'new.teamlead@example.test',
      password: 'secret',
      roleId: 'role-team_lead',
      joiningDate: '2026-08-24',
    });

    expect(tx.employeeAttendanceProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ effectiveFrom: new Date('2026-08-27T00:00:00.000Z') }),
    });
  });

  it('uses a superseded policy version when its closed window governs the joining date', async () => {
    const { service, tx } = fixture('EMPLOYEE');

    await service.create({
      name: 'Historical Employee',
      email: 'historical.employee@example.test',
      password: 'secret',
      roleId: 'role-employee',
      joiningDate: '2026-09-01',
    });

    const expectedStatus = { in: [PolicyStatus.ACTIVE, PolicyStatus.SUPERSEDED] };
    expect(tx.shiftPolicy.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: expectedStatus }),
    }));
    expect(tx.leavePolicy.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: expectedStatus }),
    }));
    expect(tx.holidayCalendar.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: expectedStatus }),
    }));
    expect(tx.attendancePolicy.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: expectedStatus }),
    }));
  });

  it('still refuses when no regular shift policy exists at any date', async () => {
    const { service, tx } = fixture('INTERN');
    tx.shiftPolicy.findMany.mockResolvedValue([]);
    await expect(
      service.create({ name: 'New Intern', email: 'new.intern@example.test', password: 'secret', roleId: 'role-intern', joiningDate: '2026-08-24' }),
    ).rejects.toThrow('no active regular shift policy is configured');
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('still refuses when no holiday calendar exists at or after the joining date', async () => {
    const { service, tx } = fixture('INTERN');
    tx.holidayCalendar.findMany.mockResolvedValue([]);
    tx.holidayCalendar.findFirst.mockResolvedValue(null);

    await expect(
      service.create({
        name: 'New Intern',
        email: 'new.intern@example.test',
        password: 'secret',
        roleId: 'role-intern',
        joiningDate: '2026-08-24',
      }),
    ).rejects.toThrow('no active holiday calendar is configured');

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
