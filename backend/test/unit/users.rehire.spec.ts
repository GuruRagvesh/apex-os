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
    shiftPolicy: {
      findMany: jest.fn().mockResolvedValue([{ id: 'shift-1', attendancePolicyId: 'ap-1', category: AttendanceCategory.REGULAR_EMPLOYEE, status: PolicyStatus.ACTIVE }]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    attendancePolicy: { findFirst: jest.fn().mockResolvedValue({ id: 'ap-1', status: PolicyStatus.ACTIVE, geoFenceEnabled: false }) },
    leavePolicy: { findMany: jest.fn().mockResolvedValue([{ id: 'leave-1' }]), findFirst: jest.fn().mockResolvedValue(null) },
    holidayCalendar: { findMany: jest.fn().mockResolvedValue([{ id: 'calendar-1' }]), findFirst: jest.fn().mockResolvedValue(null) },
    weeklyOffPolicy: { findMany: jest.fn().mockResolvedValue([{ id: 'weekly-1' }]), findFirst: jest.fn().mockResolvedValue(null) },
    attendanceLocation: { findMany: jest.fn() },
    user: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([{ id: 'admin-notify' }]),
      update: jest.fn(async ({ data }: any) => ({ ...user, ...data, password: 'hashed', role: { id: data.roleId }, department: null })),
    },
    userSetupIssue: { upsert: jest.fn().mockResolvedValue({ id: 'issue-1' }) },
    notification: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    employmentPeriod: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({ id: 'period-new' }),
    },
    employeeAttendanceProfile: {
      // Honours the one filter the service relies on: open profiles only.
      findMany: jest.fn(async ({ where }: any = {}) => (where?.effectiveTo === null ? profiles.filter((p: any) => !p.effectiveTo) : profiles)),
      updateMany: jest.fn().mockResolvedValue({ count: profiles.length }),
      create: jest.fn().mockResolvedValue({ id: 'profile-new' }),
      // Phase 3 reopen-on-return: nothing covers the return date, the most
      // recent earlier profile is the one continued.
      findFirst: jest.fn(async ({ where }: any = {}) =>
        where?.effectiveFrom?.lt ? [...profiles].sort((x: any, y: any) => +y.effectiveFrom - +x.effectiveFrom)[0] ?? null : null),
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
  // Email, role and department are decided inside the transaction (Phase 2).
  (tx.user as any).findFirst = prisma.user.findFirst;
  (tx as any).role = prisma.role;
  (tx as any).department = { findUnique: jest.fn().mockResolvedValue({ id: 'dept-retail' }) };
  (tx.operationalEvent as any).findFirst = prisma.operationalEvent.findFirst;
  const service = new UsersService(prisma as any, {} as any, { log: jest.fn().mockResolvedValue(undefined) } as any, {} as any, {} as any);
  return { service, prisma, tx, user };
}

const REHIRE = { password: 'new-secret', roleId: 'role-employee', departmentId: 'dept-retail', joiningDate: '2026-08-24', name: 'Shruti Deokule' };

const CREATE = { name: 'Shruti Deokule', email: 'SHRUTI.technointern@outlook.com ', password: 'x1234567', roleId: 'role-employee', joiningDate: '2026-08-24' };
const bodyOf = async (p: Promise<unknown>): Promise<any> => ((await p.catch((e) => e)) as any).getResponse();

describe('adding a user whose email is already held (Phase 2, B2)', () => {
  it('an archived account: offers Rehire of the same account, naming it', async () => {
    const { service, tx, prisma, user } = fixture();
    prisma.user.findFirst.mockResolvedValueOnce(user);
    const attempt = service.create(CREATE, 'admin-1');

    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    const body = await bodyOf(attempt);
    expect(body).toEqual(expect.objectContaining({
      code: 'EMAIL_BELONGS_TO_ARCHIVED_USER',
      inactiveUser: { id: 'shruti', name: 'Shruti Deokule', archivedAt: '2026-10-12T10:00:00.000Z' },
    }));
    expect(body.message).toMatch(/Rehire them/);
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('a deactivated account: offers Reactivate, never a second account', async () => {
    const { service, tx, prisma, user } = fixture({ archivedAt: null });
    prisma.user.findFirst.mockResolvedValueOnce(user);
    const body = await bodyOf(service.create(CREATE, 'admin-1'));
    expect(body).toEqual(expect.objectContaining({ code: 'EMAIL_BELONGS_TO_DEACTIVATED_USER', inactiveUser: { id: 'shruti', name: 'Shruti Deokule', archivedAt: null } }));
    expect(body.message).toMatch(/Reactivate/);
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('an active or scheduled account: points at the existing person', async () => {
    const active = fixture({ user: { isActive: true } });
    active.prisma.user.findFirst.mockResolvedValueOnce(active.user);
    expect(await bodyOf(active.service.create(CREATE))).toEqual(expect.objectContaining({ code: 'EMAIL_BELONGS_TO_ACTIVE_USER', existingUser: expect.objectContaining({ id: 'shruti' }) }));

    const scheduled = fixture({ user: { employmentState: 'SCHEDULED_TO_JOIN', scheduledActivationOn: D('2099-01-01') } });
    scheduled.prisma.user.findFirst.mockResolvedValueOnce(scheduled.user);
    expect(await bodyOf(scheduled.service.create(CREATE))).toEqual(expect.objectContaining({
      code: 'EMAIL_BELONGS_TO_ACTIVE_USER',
      existingUser: { id: 'shruti', name: 'Shruti Deokule', scheduledActivationOn: '2099-01-01' },
    }));
  });

  it('the system account: refused outright', async () => {
    const { service, prisma, user } = fixture({ user: { isSystemAccount: true } });
    prisma.user.findFirst.mockResolvedValueOnce(user);
    expect(await bodyOf(service.create(CREATE))).toEqual(expect.objectContaining({ code: 'EMAIL_RESERVED_FOR_SYSTEM_ACCOUNT' }));
  });

  it('is decided under a lock on the normalized address, inside the transaction', async () => {
    const { service, tx } = fixture();
    tx.user.create.mockResolvedValue({ id: 'new-1', name: 'Shruti Deokule', password: 'h' });
    (tx.user as any).findMany = jest.fn().mockResolvedValue([]);
    (tx as any).$queryRaw = jest.fn().mockResolvedValue([{ employeeId: 'TE-9' }]);
    await service.create(CREATE, 'admin-1');
    const lock = (tx as any).$queryRaw.mock.calls[0];
    expect(lock[0].join('?')).toMatch(/pg_advisory_xact_lock/);
    expect(lock).toContain('user-email:shruti.technointern@outlook.com');
  });

  it('a permanently deleted person no longer holds the address: a fresh account is created', async () => {
    const { service, tx } = fixture();
    tx.user.create.mockResolvedValue({ id: 'new-1', name: 'Shruti Deokule', password: 'h' });
    (tx as any).$queryRaw = jest.fn().mockResolvedValue([{ employeeId: 'TE-9' }]);
    const created: any = await service.create(CREATE, 'admin-1');
    expect(created.employeeId).toBe('TE-9');
    expect(created.password).toBeUndefined();
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

  // Phase 3: the new profile begins on the return date. A policy that starts
  // later is applied as the baseline and recorded as setup work, never by
  // moving the profile start (which would leave the returned person uncovered).
  it('a return date before the attendance policies start keeps the date and starts the profile on it', async () => {
    const { service, tx } = fixture({ profiles: [] });
    const shift = { id: 'shift-1', attendancePolicyId: 'ap-1', category: AttendanceCategory.REGULAR_EMPLOYEE, status: PolicyStatus.ACTIVE, effectiveFrom: D('2026-09-15'), effectiveTo: null };
    tx.shiftPolicy.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([shift]);

    const result = await service.rehire('shruti', REHIRE, 'admin-1');

    expect(result.joiningDate).toEqual(D('2026-08-24'));
    expect(tx.employeeAttendanceProfile.create).toHaveBeenCalledWith({ data: expect.objectContaining({ assignedShiftId: 'shift-1', effectiveFrom: D('2026-08-24') }) });
  });

  it('rehire succeeds and opens a setup issue when attendance policies are unavailable', async () => {
    const { service, tx } = fixture({ profiles: [] });
    tx.shiftPolicy.findMany.mockResolvedValue([]);

    const result: any = await service.rehire('shruti', REHIRE, 'admin-1');

    expect(result.isActive).toBe(true);
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isActive: true, joiningDate: D('2026-08-24') }),
    }));
    expect(tx.employeeAttendanceProfile.create).not.toHaveBeenCalled();
    expect(tx.userSetupIssue.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ code: 'ATTENDANCE_POLICY_SETUP_PENDING' }),
    }));
    // Announced after commit through the notification service, not inside the transaction.
    expect(tx.notification.createMany).not.toHaveBeenCalled();
    const event = tx.operationalEvent.create.mock.calls
      .map((call: any[]) => call[0].data)
      .find((data: any) => data.action === 'USER_REHIRED');
    expect(event.metadata).toEqual(expect.objectContaining({
      attendanceProfileStart: null,
      attendanceSetupPending: true,
    }));
  });

  it('schedules a future rehire without granting login access early', async () => {
    const { service, tx } = fixture({ profiles: [] });
    await service.rehire('shruti', { ...REHIRE, joiningDate: '2099-01-01' }, 'admin-1');

    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        isActive: false,
        employmentState: 'SCHEDULED_TO_JOIN',
        scheduledActivationOn: D('2099-01-01'),
      }),
    }));
    expect(tx.employmentPeriod.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'shruti', startReason: 'REHIRE', startDate: D('2099-01-01') }),
    });
    const event = tx.operationalEvent.create.mock.calls
      .map((call: any[]) => call[0].data)
      .find((data: any) => data.action === 'USER_REHIRED');
    expect(event).toEqual(expect.objectContaining({ toState: 'SCHEDULED_TO_JOIN' }));
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
    ['no password', { password: '' }, /between 8 and 128/],
    ['a short password', { password: '123' }, /between 8 and 128/],
    ['no joining date', { joiningDate: undefined }, /Joining date is required/],
    ['an invalid joining date', { joiningDate: '2026-02-30' }, /valid date/],
  ])('refuses %s before changing anything', async (_l, over, msg) => {
    const { service, prisma } = fixture();
    await expect(service.rehire('shruti', { ...REHIRE, ...(over as any) }, 'admin-1')).rejects.toThrow(msg as RegExp);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('a role removed after the form opened: a remediation, nothing changed', async () => {
    const { service, prisma, tx } = fixture();
    prisma.role.findUnique.mockResolvedValue(null);
    const body = await bodyOf(service.rehire('shruti', REHIRE, 'admin-1'));
    expect(body).toEqual(expect.objectContaining({ error: 'REMEDIATION', code: 'ROLE_NOT_FOUND_OR_REMOVED' }));
    expect(body.remediation.actions.map((a: any) => a.id)).toContain('CHOOSE_ANOTHER_ROLE');
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('a department removed after the form opened: choose another or continue without one', async () => {
    const { service, tx } = fixture();
    (tx as any).department.findUnique.mockResolvedValue(null);
    const body = await bodyOf(service.rehire('shruti', REHIRE, 'admin-1'));
    expect(body.code).toBe('DEPARTMENT_NOT_FOUND_OR_REMOVED');
    expect(body.remediation.actions.map((a: any) => a.id)).toEqual(['CHOOSE_ANOTHER_DEPARTMENT', 'CONTINUE_WITHOUT_DEPARTMENT', 'OPEN_DEPARTMENTS', 'COPY_DIAGNOSTIC']);
    expect(tx.user.update).not.toHaveBeenCalled();

    const without = fixture();
    await without.service.rehire('shruti', { ...REHIRE, departmentId: '' }, 'admin-1');
    expect(without.tx.user.update.mock.calls[0][0].data.departmentId).toBeNull();
  });

  it('is for archived people only: a deactivated account is sent to Reactivate', async () => {
    const { service, prisma } = fixture({ archivedAt: null });
    const body = await bodyOf(service.rehire('shruti', REHIRE, 'admin-1'));
    expect(body).toEqual(expect.objectContaining({ code: 'USER_NOT_ARCHIVED' }));
    expect(body.message).toMatch(/Reactivate/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('reactivating a deactivated person (Phase 2, B6)', () => {
  const deactivated = (over: any = {}) => {
    const f = fixture({ archivedAt: null, user: { employmentState: 'DEACTIVATED', ...over } });
    f.prisma.operationalEvent.findFirst.mockResolvedValue(null);
    return f;
  };

  it('brings back the same account and employment period, revoking old sessions and reset codes', async () => {
    const { service, tx } = deactivated();
    const result: any = await service.reactivate('shruti', {}, 'admin-1');
    const data = tx.user.update.mock.calls[0][0].data;
    expect(data).toEqual(expect.objectContaining({ isActive: true, employmentState: 'ACTIVE', roleId: 'role-intern', departmentId: 'dept-old' }));
    expect(data.sessionsRevokedAt).toBeInstanceOf(Date);
    expect(data.joiningDate).toBeUndefined();
    expect(data.password).toBeUndefined();
    expect(tx.employmentPeriod.create).not.toHaveBeenCalled();
    expect(tx.employmentPeriod.updateMany).not.toHaveBeenCalled();
    expect(tx.operationalEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'USER_REACTIVATED', fromState: 'DEACTIVATED', toState: 'ACTIVE' }) });
    expect(result.password).toBeUndefined();
  });

  it('re-checks the role and department; the department may be cleared', async () => {
    const { service, prisma, tx } = deactivated();
    prisma.role.findUnique.mockResolvedValue(null);
    expect((await bodyOf(service.reactivate('shruti', { roleId: 'gone' }, 'admin-1'))).code).toBe('ROLE_NOT_FOUND_OR_REMOVED');
    expect(tx.user.update).not.toHaveBeenCalled();

    const cleared = deactivated();
    await cleared.service.reactivate('shruti', { departmentId: null }, 'admin-1');
    expect(cleared.tx.user.update.mock.calls[0][0].data.departmentId).toBeNull();
  });

  it('refuses archived, scheduled, active, own and system accounts', async () => {
    expect((await bodyOf(fixture().service.reactivate('shruti', {}, 'admin-1'))).code).toBe('USER_IS_ARCHIVED');
    expect((await bodyOf(deactivated({ employmentState: 'SCHEDULED_TO_JOIN', scheduledActivationOn: D('2099-01-01') }).service.reactivate('shruti', {}, 'admin-1'))).code).toBe('USER_SCHEDULED_TO_JOIN');
    await expect(deactivated({ isActive: true }).service.reactivate('shruti', {}, 'admin-1')).rejects.toThrow(/already active/);
    await expect(deactivated().service.reactivate('shruti', {}, 'shruti')).rejects.toThrow(/own account/);
    await expect(deactivated({ isSystemAccount: true }).service.reactivate('shruti', {}, 'admin-1')).rejects.toThrow(/system account/);
  });

  it('someone deactivated before their joining date goes back to waiting for it', async () => {
    const { service, tx } = deactivated({ joiningDate: D('2099-01-01') });
    await service.reactivate('shruti', {}, 'admin-1');
    expect(tx.user.update.mock.calls[0][0].data).toEqual(expect.objectContaining({ isActive: false, employmentState: 'SCHEDULED_TO_JOIN', scheduledActivationOn: D('2099-01-01') }));
  });

  it('cannot race an archive or deletion', async () => {
    const { service, tx } = deactivated();
    tx.userLifecycleOperation.count.mockResolvedValue(1);
    await expect(service.reactivate('shruti', {}, 'admin-1')).rejects.toThrow(/running/);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('has its own Admin / Super Admin route', () => {
    const src: string = require('fs').readFileSync(require('path').resolve(__dirname, '../../src/modules/core/users/users.controller.ts'), 'utf8');
    const block = src.slice(src.indexOf("@Post(':id/reactivate')"), src.indexOf("@Post(':id/reactivate')") + 200);
    expect(block).toContain('@Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)');
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
    expect(same.tx.user.update.mock.calls[0][0].data.email).toBe('shruti.technointern@outlook.com');

    const changed = fixture();
    await changed.service.rehire('shruti', { ...REHIRE, email: 'shruti.new@example.test' }, 'admin-1');
    expect(changed.tx.user.update.mock.calls[0][0].data.email).toBe('shruti.new@example.test');

    const taken = fixture();
    taken.prisma.user.findFirst.mockResolvedValue({ id: 'someone-else', name: 'Someone Else', isActive: true });
    expect(await bodyOf(taken.service.rehire('shruti', { ...REHIRE, email: 'taken@example.test' }, 'admin-1'))).toEqual(expect.objectContaining({ code: 'EMAIL_BELONGS_TO_ACTIVE_USER' }));
    expect(taken.tx.user.update).not.toHaveBeenCalled();
    // Never compared against the person's own row.
    expect(taken.prisma.user.findFirst.mock.calls[0][0].where.id).toEqual({ not: 'shruti' });

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
