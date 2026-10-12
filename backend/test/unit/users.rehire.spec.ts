import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AttendanceCategory, PolicyStatus } from '@prisma/client';
import { UsersService } from '../../src/modules/core/users/users.service';

// An archived or deactivated person keeps their record, and so their email.
// Adding them again must bring back the SAME account (a rehire), with their
// earlier history still attached -- never fail silently, never fork the person.

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

function fixture(over: { user?: any; profiles?: any[]; archivedAt?: Date | null } = {}) {
  const user = {
    id: 'shruti',
    name: 'Shruti Deokule',
    email: 'shruti.technointern@outlook.com',
    isActive: false,
    roleId: 'role-intern',
    departmentId: 'dept-old',
    joiningDate: D('2026-01-05'),
    lastWorkingDate: null,
    ...over.user,
  };
  const profiles = over.profiles ?? [{ id: 'profile-old', effectiveFrom: D('2026-01-05') }];
  const tx = {
    shiftPolicy: { findMany: jest.fn().mockResolvedValue([{ id: 'shift-1', attendancePolicyId: 'ap-1', category: AttendanceCategory.REGULAR_EMPLOYEE, status: PolicyStatus.ACTIVE }]) },
    attendancePolicy: { findFirst: jest.fn().mockResolvedValue({ id: 'ap-1', status: PolicyStatus.ACTIVE, geoFenceEnabled: false }) },
    leavePolicy: { findMany: jest.fn().mockResolvedValue([{ id: 'leave-1' }]) },
    holidayCalendar: { findMany: jest.fn().mockResolvedValue([{ id: 'calendar-1' }]) },
    weeklyOffPolicy: { findMany: jest.fn().mockResolvedValue([{ id: 'weekly-1' }]) },
    attendanceLocation: { findMany: jest.fn() },
    user: {
      create: jest.fn(),
      update: jest.fn(async ({ data }: any) => ({ ...user, ...data, password: 'hashed', role: { id: data.roleId }, department: null })),
    },
    employeeAttendanceProfile: {
      findMany: jest.fn().mockResolvedValue(profiles),
      updateMany: jest.fn().mockResolvedValue({ count: profiles.length }),
      create: jest.fn().mockResolvedValue({ id: 'profile-new' }),
    },
    operationalEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    role: { findUnique: jest.fn().mockResolvedValue({ id: 'role-employee', name: 'EMPLOYEE' }) },
    operationalEvent: {
      findFirst: jest.fn().mockResolvedValue(
        over.archivedAt === null ? null : { timestamp: over.archivedAt ?? new Date('2026-10-12T10:00:00Z'), action: 'USER_ARCHIVED_AFTER_BACKUP' },
      ),
    },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const service = new UsersService(prisma as any, {} as any, { log: jest.fn().mockResolvedValue(undefined) } as any, {} as any, {} as any);
  return { service, prisma, tx, user };
}

const REHIRE = { password: 'new-secret', roleId: 'role-employee', departmentId: 'dept-retail', joiningDate: '2026-08-24', name: 'Shruti Deokule' };

describe('adding a user whose email belongs to an inactive account', () => {
  it('explains that the person can be rehired, naming the account', async () => {
    const { service, tx } = fixture();
    const attempt = service.create({ name: 'Shruti Deokule', email: 'shruti.technointern@outlook.com', password: 'x123456', roleId: 'role-employee', joiningDate: '2026-08-24' }, 'admin-1');

    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    const body = (await attempt.catch((e) => e)).getResponse();
    expect(body).toEqual(expect.objectContaining({
      code: 'EMAIL_BELONGS_TO_INACTIVE_USER',
      inactiveUser: { id: 'shruti', name: 'Shruti Deokule', archivedAt: '2026-10-12T10:00:00.000Z' },
    }));
    expect(body.message).toMatch(/Rehire them/);
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('still refuses an email that belongs to an ACTIVE account', async () => {
    const { service } = fixture({ user: { isActive: true } });
    await expect(
      service.create({ name: 'X', email: 'shruti.technointern@outlook.com', password: 'x123456', roleId: 'role-employee', joiningDate: '2026-08-24' }),
    ).rejects.toThrow(new ConflictException('Email already registered'));
  });
});

describe('rehiring an inactive person', () => {
  it('reactivates the same account with the new password, role, department and joining date', async () => {
    const { service, tx } = fixture();

    const result: any = await service.rehire('shruti', REHIRE, 'admin-1');

    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'shruti' },
      data: expect.objectContaining({
        isActive: true,
        roleId: 'role-employee',
        departmentId: 'dept-retail',
        joiningDate: D('2026-08-24'),
        lastWorkingDate: null,
        name: 'Shruti Deokule',
      }),
    }));
    const sent = tx.user.update.mock.calls[0][0].data.password;
    expect(sent).not.toBe('new-secret');
    expect(sent).toMatch(/^\$2[aby]\$/);
    expect(result.password).toBeUndefined();
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('closes the previous attendance profile the day before and opens a new one on the rehire date', async () => {
    const { service, tx } = fixture();

    await service.rehire('shruti', REHIRE, 'admin-1');

    expect(tx.employeeAttendanceProfile.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['profile-old'] } },
      data: { effectiveTo: D('2026-08-23'), updatedById: 'admin-1' },
    });
    expect(tx.employeeAttendanceProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'shruti',
        assignedShiftId: 'shift-1',
        effectiveFrom: D('2026-08-24'),
        effectiveTo: null,
        updatedById: 'admin-1',
      }),
    });
  });

  it('records a reactivation in the same transaction, keeping the previous employment dates', async () => {
    const { service, tx, prisma } = fixture();

    await service.rehire('shruti', REHIRE, 'admin-1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.operationalEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityId: 'shruti',
        action: 'USER_REACTIVATED',
        fromState: 'INACTIVE',
        toState: 'ACTIVE',
        metadata: expect.objectContaining({ rehire: true, previousJoiningDate: '2026-01-05', joiningDate: '2026-08-24', previousDepartmentId: 'dept-old' }),
      }),
    });
    // USER_REACTIVATED is a reactivation action, so the archived state clears.
    expect(UsersService.REACTIVATE_ACTIONS).toContain('USER_REACTIVATED');
  });

  it('refuses a rehire date on or before the start of the previous profile, changing nothing', async () => {
    const { service, tx } = fixture({ profiles: [{ id: 'profile-old', effectiveFrom: D('2026-09-01') }] });

    await expect(service.rehire('shruti', REHIRE, 'admin-1')).rejects.toThrow(/must be after 2026-09-01/);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.employeeAttendanceProfile.updateMany).not.toHaveBeenCalled();
    expect(tx.operationalEvent.create).not.toHaveBeenCalled();
  });

  it.each([
    ['an active account', { user: { isActive: true } }, BadRequestException, /already active/],
    ['your own account', {}, ForbiddenException, /own account/],
  ])('refuses %s', async (_l, over, type, msg) => {
    const { service, prisma } = fixture(over as any);
    const actor = _l === 'your own account' ? 'shruti' : 'admin-1';
    await expect(service.rehire('shruti', REHIRE, actor)).rejects.toBeInstanceOf(type as any);
    await expect(service.rehire('shruti', REHIRE, actor)).rejects.toThrow(msg as RegExp);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['no password', { password: '' }, /new password/],
    ['a short password', { password: '123' }, /at least 6/],
    ['no joining date', { joiningDate: undefined }, /Joining date is required/],
    ['an invalid joining date', { joiningDate: '2026-02-30' }, /valid date/],
  ])('refuses %s before changing anything', async (_l, over, msg) => {
    const { service, prisma } = fixture();
    await expect(service.rehire('shruti', { ...REHIRE, ...(over as any) }, 'admin-1')).rejects.toThrow(msg as RegExp);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses an unknown role', async () => {
    const { service, prisma } = fixture();
    prisma.role.findUnique.mockResolvedValue(null);
    await expect(service.rehire('shruti', REHIRE, 'admin-1')).rejects.toThrow(/role does not exist/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('the rehire route', () => {
  it('is limited to ADMIN and SUPER_ADMIN', () => {
    const src: string = require('fs').readFileSync(require('path').resolve(__dirname, '../../src/modules/core/users/users.controller.ts'), 'utf8');
    const block = src.slice(src.indexOf("@Post(':id/rehire')"), src.indexOf('rehire(\n') > 0 ? src.indexOf('rehire(\n') : src.indexOf('rehire(\r\n'));
    expect(block).toContain('@Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)');
  });
});
