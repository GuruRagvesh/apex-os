import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AttendanceCategory, PolicyStatus } from '@prisma/client';
import { UsersService } from '../../src/modules/core/users/users.service';

// An archived or deactivated person keeps their record, and so their email.
// Adding them again must bring back the SAME account (a rehire), with their
// earlier history still attached -- never fail silently, never fork the person.

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

function fixture(over: { user?: any; profiles?: any[]; archivedAt?: Date | null; snapshot?: any } = {}) {
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
      // Honours the one filter the service relies on: open profiles only.
      findMany: jest.fn(async ({ where }: any = {}) => (where?.effectiveTo === null ? profiles.filter((p: any) => !p.effectiveTo) : profiles)),
      updateMany: jest.fn().mockResolvedValue({ count: profiles.length }),
      create: jest.fn().mockResolvedValue({ id: 'profile-new' }),
    },
    operationalEvent: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    userLifecycleOperation: { count: jest.fn().mockResolvedValue(0) },
    userArchiveSnapshot: {
      findFirst: jest.fn().mockResolvedValue(over.snapshot === undefined ? null : over.snapshot),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(user), findFirst: jest.fn().mockResolvedValue(null) },
    role: { findUnique: jest.fn().mockResolvedValue({ id: 'role-employee', name: 'EMPLOYEE' }) },
    operationalEvent: {
      findFirst: jest.fn().mockResolvedValue(
        over.archivedAt === null ? null : { timestamp: over.archivedAt ?? new Date('2026-10-12T10:00:00Z'), action: 'USER_ARCHIVED_AFTER_BACKUP' },
      ),
    },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
    userLifecycleOperation: { create: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) },
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
        action: 'USER_REHIRED',
        fromState: 'INACTIVE',
        toState: 'ACTIVE',
        metadata: expect.objectContaining({
          rehire: true, previousJoiningDate: '2026-01-05', joiningDate: '2026-08-24', previousDepartmentId: 'dept-old',
          reasonCode: 'USER_REHIRED', eventSchemaVersion: 1, operationId: expect.any(String),
        }),
      }),
    });
    // Only the canonical event is written for a rehire.
    expect(tx.operationalEvent.create.mock.calls.filter((c: any) => c[0].data.action === 'USER_REACTIVATED')).toHaveLength(0);
  });

  it('refuses a rehire date on or before the start of a CLOSED previous profile, changing nothing', async () => {
    const { service, tx } = fixture({ profiles: [{ id: 'profile-old', effectiveFrom: D('2026-09-01'), effectiveTo: D('2026-10-12') }] });

    await expect(service.rehire('shruti', REHIRE, 'admin-1')).rejects.toThrow(/must be after 2026-09-01/);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.employeeAttendanceProfile.updateMany).not.toHaveBeenCalled();
    expect(tx.operationalEvent.create).not.toHaveBeenCalled();
  });

  it('undoing an archive with the original joining date keeps their open attendance profile', async () => {
    // Archiving never closes the profile. Restoring with the original joining
    // date carries it on: no new profile, nothing closed, no policy lookup.
    const { service, tx } = fixture({ profiles: [{ id: 'profile-current', effectiveFrom: D('2026-09-15') }] });

    const result = await service.rehire('shruti', REHIRE, 'admin-1');

    expect(result.joiningDate).toEqual(D('2026-08-24'));
    expect(tx.employeeAttendanceProfile.create).not.toHaveBeenCalled();
    expect(tx.employeeAttendanceProfile.updateMany).not.toHaveBeenCalled();
    expect(tx.shiftPolicy.findMany).not.toHaveBeenCalled();
    const event = tx.operationalEvent.create.mock.calls.map((c: any[]) => c[0].data).find((d: any) => d.action === 'USER_REHIRED');
    expect(event.metadata).toEqual(expect.objectContaining({ reusedProfileId: 'profile-current', attendanceProfileStart: '2026-09-15', closedProfiles: 0 }));
  });

  it('a joining date before the attendance policies start keeps the date; the new profile starts with the policies', async () => {
    const { service, tx } = fixture({ profiles: [] });
    const shift = { id: 'shift-1', attendancePolicyId: 'ap-1', category: AttendanceCategory.REGULAR_EMPLOYEE, status: PolicyStatus.ACTIVE };
    tx.shiftPolicy.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([shift]);
    (tx.shiftPolicy as any).findFirst = jest.fn().mockResolvedValue({ effectiveFrom: D('2026-09-15') });

    const result = await service.rehire('shruti', REHIRE, 'admin-1');

    expect(result.joiningDate).toEqual(D('2026-08-24'));
    expect(tx.employeeAttendanceProfile.create).toHaveBeenCalledWith({ data: expect.objectContaining({ assignedShiftId: 'shift-1', effectiveFrom: D('2026-09-15') }) });
    // Only one step forward, from the policy's own start.
    expect(tx.shiftPolicy.findMany).toHaveBeenCalledTimes(2);
    expect(tx.shiftPolicy.findMany.mock.calls[1][0].where.effectiveFrom).toEqual({ lte: D('2026-09-15') });
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

describe('rehire and the archive lifecycle', () => {
  it('invalidates the usable archive snapshot so it can no longer authorize a deletion', async () => {
    const { service, tx } = fixture({ snapshot: { id: 'snap-1', version: 2 } });
    await service.rehire('shruti', REHIRE, 'admin-1');
    expect(tx.userArchiveSnapshot.update).toHaveBeenCalledWith({
      where: { id: 'snap-1' },
      data: expect.objectContaining({ status: 'INVALIDATED_REHIRED', invalidationReason: 'USER_REHIRED' }),
    });
    const events = tx.operationalEvent.create.mock.calls.map((c: any) => c[0].data.action);
    expect(events).toEqual(['ARCHIVE_SNAPSHOT_INVALIDATED', 'USER_REHIRED']);
  });

  it('revokes every token issued before the rehire', async () => {
    const { service, tx } = fixture();
    await service.rehire('shruti', REHIRE, 'admin-1');
    expect(tx.user.update.mock.calls[0][0].data.sessionsRevokedAt).toBeInstanceOf(Date);
  });

  it('accepts the same email, and a changed email only when it is free', async () => {
    const same = fixture();
    await same.service.rehire('shruti', { ...REHIRE, email: 'SHRUTI.technointern@outlook.com' }, 'admin-1');
    expect(same.tx.user.update.mock.calls[0][0].data.email).toBeUndefined();

    const changed = fixture();
    await changed.service.rehire('shruti', { ...REHIRE, email: 'shruti.new@example.test' }, 'admin-1');
    expect(changed.tx.user.update.mock.calls[0][0].data.email).toBe('shruti.new@example.test');

    const taken = fixture();
    taken.prisma.user.findFirst.mockResolvedValue({ id: 'someone-else' });
    await expect(taken.service.rehire('shruti', { ...REHIRE, email: 'taken@example.test' }, 'admin-1')).rejects.toThrow(/Email already registered/);
    expect(taken.prisma.$transaction).not.toHaveBeenCalled();

    const bad = fixture();
    await expect(bad.service.rehire('shruti', { ...REHIRE, email: 'not-an-email' }, 'admin-1')).rejects.toThrow(/valid email/);
  });

  it('cannot run while another lifecycle operation holds the user', async () => {
    const { service, prisma } = fixture();
    prisma.userLifecycleOperation.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    await expect(service.rehire('shruti', REHIRE, 'admin-1')).rejects.toThrow(/already running/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('cannot rehire a user who is being permanently deleted', async () => {
    const { service, tx, prisma } = fixture();
    tx.userLifecycleOperation.count.mockResolvedValue(1);
    await expect(service.rehire('shruti', REHIRE, 'admin-1')).rejects.toThrow(/being permanently deleted/);
    expect(prisma.userLifecycleOperation.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'FAILED' }) }));
  });

  it('refuses the system account', async () => {
    const { service } = fixture({ user: { isSystemAccount: true } });
    await expect(service.rehire('shruti', REHIRE, 'admin-1')).rejects.toThrow(/system account/);
  });
});
