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
    user: { create: jest.fn().mockResolvedValue(createdUser), findMany: jest.fn().mockResolvedValue([{ id: 'admin-1' }]) },
    employmentPeriod: { create: jest.fn().mockResolvedValue({ id: 'period-1' }) },
    employeeAttendanceProfile: { create: jest.fn().mockResolvedValue({ id: 'profile-1' }) },
    userSetupIssue: { upsert: jest.fn().mockResolvedValue({ id: 'issue-1' }) },
    notification: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $queryRaw: jest.fn().mockResolvedValue([{ employeeId: 'TE-101' }]),
  };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null) },
    role: { findUnique: jest.fn().mockResolvedValue({ id: `role-${roleSlug}`, name: roleName }) },
    $transaction: jest.fn(async (callback: any) => callback(tx)),
  };
  // Email, role and department are decided inside the transaction (Phase 2).
  (tx.user as any).findFirst = prisma.user.findFirst;
  (tx as any).role = prisma.role;
  (tx as any).department = { findUnique: jest.fn().mockResolvedValue({ id: 'department-1' }) };
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
  it('normalizes email, allocates a permanent employee ID and opens the first employment period', async () => {
    const { service, tx } = fixture('EMPLOYEE');

    const result: any = await service.create({
      name: 'New Employee',
      email: '  New.Employee@Example.Test  ',
      password: 'a secure passphrase',
      roleId: 'role-employee',
      joiningDate: '2026-09-01',
    }, 'admin-1');

    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        email: 'new.employee@example.test',
        employmentState: 'ACTIVE',
        isActive: true,
        scheduledActivationOn: null,
      }),
    }));
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.employmentPeriod.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        startDate: new Date('2026-09-01T00:00:00.000Z'),
        startReason: 'NEW_HIRE',
        createdById: 'admin-1',
      }),
    });
    expect(result.employeeId).toBe('TE-101');
  });

  it('creates a future joiner without login access until the scheduled date', async () => {
    const { service, tx } = fixture('EMPLOYEE');

    await service.create({
      name: 'Future Employee',
      email: 'future@example.test',
      password: 'future-passphrase',
      roleId: 'role-employee',
      joiningDate: '2099-01-01',
    });

    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        isActive: false,
        employmentState: 'SCHEDULED_TO_JOIN',
        scheduledActivationOn: new Date('2099-01-01T00:00:00.000Z'),
      }),
    }));
  });

  it('rejects dates before the company baseline and passwords outside the shared policy', async () => {
    const { service, prisma } = fixture('EMPLOYEE');
    await expect(service.create({
      name: 'Old Date', email: 'old@example.test', password: 'password1', roleId: 'role-employee', joiningDate: '2020-11-30',
    })).rejects.toThrow(/cannot be before 2020-12-01/);
    await expect(service.create({
      name: 'Short Password', email: 'short@example.test', password: 'short', roleId: 'role-employee', joiningDate: '2026-09-01',
    })).rejects.toThrow(/between 8 and 128/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(CANONICAL_ROLES)('rejects a %s without a joining date before creating a user', async (roleName) => {
    const { service, prisma } = fixture(roleName);
    const roleSlug = roleName.toLowerCase();

    await expect(
      service.create({
        name: `New ${roleName}`,
        email: `new.${roleSlug}@example.test`,
        password: 'password1',
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
        password: 'password1',
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

  it('creates the user with a setup issue when attendance configuration is ambiguous', async () => {
    const { service, prisma, tx } = fixture('EMPLOYEE');
    tx.leavePolicy.findMany.mockResolvedValue([{ id: 'leave-1' }, { id: 'leave-2' }]);

    await expect(
      service.create({
        name: 'New Employee',
        email: 'new.employee@example.test',
        password: 'password1',
        roleId: 'role-employee',
        joiningDate: '2026-09-01',
      }),
    ).resolves.toBeDefined();

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.user.create).toHaveBeenCalled();
    expect(tx.employeeAttendanceProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ assignedLeavePolicyId: 'leave-1' }),
    });
    expect(tx.userSetupIssue.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ code: 'ATTENDANCE_POLICY_SETUP_PENDING', severity: 'WARNING' }),
    }));
    // Announced after commit through the notification service (channels apply).
    expect(tx.notification.createMany).not.toHaveBeenCalled();
  });

  it('creates the user with a setup issue when attendance configuration is missing', async () => {
    const { service, tx } = fixture('MANAGER');
    tx.shiftPolicy.findMany.mockResolvedValue([]);

    await expect(
      service.create({
        name: 'New Manager',
        email: 'new.manager@example.test',
        password: 'password1',
        roleId: 'role-manager',
        joiningDate: '2026-09-01',
      }),
    ).resolves.toBeDefined();

    expect(tx.user.create).toHaveBeenCalled();
    expect(tx.employeeAttendanceProfile.create).not.toHaveBeenCalled();
    expect(tx.userSetupIssue.upsert).toHaveBeenCalled();
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
        password: 'password1',
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
        password: 'password1',
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
      password: 'password1',
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
      password: 'password1',
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

  it('does not block the account when no regular shift policy exists at any date', async () => {
    const { service, tx } = fixture('INTERN');
    tx.shiftPolicy.findMany.mockResolvedValue([]);
    await expect(
      service.create({ name: 'New Intern', email: 'new.intern@example.test', password: 'password1', roleId: 'role-intern', joiningDate: '2026-08-24' }),
    ).resolves.toBeDefined();
    expect(tx.user.create).toHaveBeenCalled();
    expect(tx.userSetupIssue.upsert).toHaveBeenCalled();
  });

  it('does not block the account when no holiday calendar exists at or after the joining date', async () => {
    const { service, tx } = fixture('INTERN');
    tx.holidayCalendar.findMany.mockResolvedValue([]);
    tx.holidayCalendar.findFirst.mockResolvedValue(null);

    await expect(
      service.create({
        name: 'New Intern',
        email: 'new.intern@example.test',
        password: 'password1',
        roleId: 'role-intern',
        joiningDate: '2026-08-24',
      }),
    ).resolves.toBeDefined();

    expect(tx.user.create).toHaveBeenCalled();
    expect(tx.employeeAttendanceProfile.create).not.toHaveBeenCalled();
    expect(tx.userSetupIssue.upsert).toHaveBeenCalled();
  });

  it('propagates profile creation failure through the user transaction', async () => {
    const { service, tx } = fixture('SUPER_ADMIN');
    tx.employeeAttendanceProfile.create.mockRejectedValue(new Error('profile insert failed'));

    await expect(
      service.create({
        name: 'New Super Admin',
        email: 'new.super_admin@example.test',
        password: 'password1',
        roleId: 'role-super_admin',
        joiningDate: '2026-09-01',
      }),
    ).rejects.toThrow('profile insert failed');

    expect(tx.user.create).toHaveBeenCalledTimes(1);
    expect(tx.employeeAttendanceProfile.create).toHaveBeenCalledTimes(1);
  });

  it('a role id that no longer exists is a remediation; nothing is created', async () => {
    const { service, prisma, tx } = fixture();
    prisma.role.findUnique.mockResolvedValue(null);

    const error: any = await service.create({
      name: 'Unknown Role',
      email: 'unknown.role@example.test',
      password: 'password1',
      roleId: 'missing-role',
      joiningDate: '2026-09-01',
    }).catch((e) => e);

    expect(error.getResponse()).toEqual(expect.objectContaining({ error: 'REMEDIATION', code: 'ROLE_NOT_FOUND_OR_REMOVED' }));
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('the department is optional: blank means none', async () => {
    const { service, tx } = fixture();
    await service.create({ name: 'No Dept', email: 'no.dept@example.test', password: 'password1', roleId: 'role-intern', departmentId: '', joiningDate: '2026-09-01' });
    expect(tx.user.create.mock.calls[0][0].data.departmentId).toBeNull();
    expect((tx as any).department.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['a blank name', { name: '   ' }, /name/],
    ['a whitespace-only password', { password: '         ' }, /between 8 and 128/],
    ['a 129-character password', { password: 'x'.repeat(129) }, /between 8 and 128/],
    ['a joining date before 1 Dec 2020', { joiningDate: '2020-11-30' }, /2020-12-01/],
    ['an invalid email', { email: 'not-an-email' }, /valid email/],
  ])('refuses %s before opening a transaction', async (_l, over, msg) => {
    const { service, prisma } = fixture();
    await expect(service.create({ name: 'N', email: 'n@example.test', password: 'password1', roleId: 'role-intern', joiningDate: '2026-09-01', ...(over as any) })).rejects.toThrow(msg as RegExp);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an impossible joining date before opening a transaction', async () => {
    const { service, prisma } = fixture('TEAM_LEAD');

    await expect(
      service.create({
        name: 'Invalid Date',
        email: 'invalid.date@example.test',
        password: 'password1',
        roleId: 'role-team_lead',
        joiningDate: '2026-02-31',
      }),
    ).rejects.toThrow('Joining date must be a valid date');

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
