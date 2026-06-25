import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UsersService } from '../../src/modules/core/users/users.service';
import { OperationalAction } from '../../src/common/services/event-logger.service';

// Regression coverage for the Admin Correction feature: SUPER_ADMIN/ADMIN need a
// controlled way to fix a user's login email (e.g. mahendra@technoedgels.com) without
// touching the internal database id, password, or role, and with a clear audit trail.
describe('UsersService.adminCorrectEmail', () => {
  let prisma: any;
  let eventLogger: any;
  let service: UsersService;
  let users: any[];

  function makeUserStore() {
    return {
      findUnique: jest.fn(async ({ where }: any) => users.find((u) => u.id === where.id) ?? null),
      findFirst: jest.fn(async ({ where }: any) => {
        const emailFilter = where.email?.equals?.toLowerCase();
        return users.find((u) => u.email.toLowerCase() === emailFilter && u.id !== where.id?.not) ?? null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const u = users.find((x) => x.id === where.id);
        Object.assign(u, data);
        return u;
      }),
    };
  }

  beforeEach(() => {
    users = [
      { id: 'admin-1', email: 'admin@technoedgels.com', role: { name: 'ADMIN' } },
      { id: 'superadmin-1', email: 'superadmin@technoedgels.com', role: { name: 'SUPER_ADMIN' } },
      { id: 'manager-1', email: 'manager@technoedgels.com', role: { name: 'MANAGER' } },
      { id: 'other-1', email: 'existing@technoedgels.com', role: { name: 'EMPLOYEE' } },
      {
        id: 'target-1', email: 'Mahendra@technoedgels.com', name: 'Mahendra', avatar: null,
        isActive: true, employeeId: 'EMP-001', role: { name: 'EMPLOYEE' }, department: { id: 'd1', name: 'Ops' },
      },
    ];
    prisma = { user: makeUserStore() };
    eventLogger = { log: jest.fn().mockResolvedValue(undefined) };
    service = new UsersService(prisma, {} as any, eventLogger, {} as any, {} as any);
  });

  it('allows ADMIN to correct the login email', async () => {
    const result = await service.adminCorrectEmail('admin-1', 'target-1', 'Mahendra.Fixed@TechnoEdgels.com', 'Typo in original email');
    expect(result.email).toBe('mahendra.fixed@technoedgels.com');
  });

  it('allows SUPER_ADMIN to correct the login email', async () => {
    const result = await service.adminCorrectEmail('superadmin-1', 'target-1', 'mahendra.fixed@technoedgels.com', 'Typo in original email');
    expect(result.email).toBe('mahendra.fixed@technoedgels.com');
  });

  it('blocks MANAGER from correcting the login email', async () => {
    await expect(
      service.adminCorrectEmail('manager-1', 'target-1', 'mahendra.fixed@technoedgels.com', 'Typo in original email'),
    ).rejects.toThrow(ForbiddenException);
    expect(users.find((u) => u.id === 'target-1')!.email).toBe('Mahendra@technoedgels.com');
  });

  it('blocks a case-insensitive duplicate email', async () => {
    await expect(
      service.adminCorrectEmail('admin-1', 'target-1', 'EXISTING@TechnoEdgels.com', 'Typo in original email'),
    ).rejects.toThrow(ConflictException);
  });

  it('requires a non-empty reason', async () => {
    await expect(
      service.adminCorrectEmail('admin-1', 'target-1', 'mahendra.fixed@technoedgels.com', ''),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.adminCorrectEmail('admin-1', 'target-1', 'mahendra.fixed@technoedgels.com', '   '),
    ).rejects.toThrow(BadRequestException);
  });

  it('requires a valid email format', async () => {
    await expect(
      service.adminCorrectEmail('admin-1', 'target-1', 'not-an-email', 'Typo in original email'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a "new" email identical to the current one', async () => {
    await expect(
      service.adminCorrectEmail('admin-1', 'target-1', 'mahendra@technoedgels.com', 'No actual change'),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException for a missing target user', async () => {
    await expect(
      service.adminCorrectEmail('admin-1', 'no-such-user', 'someone@technoedgels.com', 'Typo'),
    ).rejects.toThrow(NotFoundException);
  });

  it('never changes the internal id, and lowercases/trims the new email', async () => {
    const result = await service.adminCorrectEmail('admin-1', 'target-1', '  Mahendra.Fixed@TechnoEdgels.com  ', 'Typo in original email');
    expect(result.id).toBe('target-1');
    expect(result.email).toBe('mahendra.fixed@technoedgels.com');
  });

  it('returns only safe fields — no password, salary, or bank details', async () => {
    const result = await service.adminCorrectEmail('admin-1', 'target-1', 'mahendra.fixed@technoedgels.com', 'Typo in original email');
    expect(result).toEqual({
      id: 'target-1',
      name: 'Mahendra',
      email: 'mahendra.fixed@technoedgels.com',
      avatar: null,
      role: { name: 'EMPLOYEE' },
      department: { id: 'd1', name: 'Ops' },
      isActive: true,
      employeeId: 'EMP-001',
    });
  });

  it('creates an audit event with actor, target, old/new email, and reason', async () => {
    await service.adminCorrectEmail('admin-1', 'target-1', 'mahendra.fixed@technoedgels.com', 'Typo in original email — fixing for Mahendra');

    expect(eventLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'admin-1',
      entityType: 'User',
      entityId: 'target-1',
      action: OperationalAction.ADMIN_USER_EMAIL_CORRECTED,
      metadata: expect.objectContaining({
        oldEmail: 'Mahendra@technoedgels.com',
        newEmail: 'mahendra.fixed@technoedgels.com',
        reason: 'Typo in original email — fixing for Mahendra',
      }),
    }));
  });
});
