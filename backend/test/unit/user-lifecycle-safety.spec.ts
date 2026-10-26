import { BadRequestException } from '@nestjs/common';
import { UsersService } from '../../src/modules/core/users/users.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';

/**
 * User lifecycle safety.
 *
 * Three defects found while preparing a real duplicate-account retirement,
 * each of which made a safety feature quietly untrue:
 *
 *   1. The archive taken to justify retiring an account exported none of the
 *      attendance history that made the account unretirable.
 *   2. The delete blocker counted 20 relations out of 35, missing the entire
 *      Attendance stack including DailyAttendance and finalized payroll months.
 *   3. The profile save spread the whole request into Prisma, so the screen
 *      500'd on its own relation objects.
 */

const policy = new AccessPolicyService({} as any);

function build(over: any = {}) {
  const updates: any[] = [];
  const audit: any[] = [];
  const prisma: any = {
    user: {
      findUnique: jest.fn(async () => over.target ?? { id: 'u-1', roleId: 'r-1', employeeId: 'TE-014' }),
      update: jest.fn(async ({ data }: any) => {
        updates.push(data);
        return { id: 'u-1', password: 'hash', ...data };
      }),
    },
    role: { findUnique: jest.fn(async () => ({ name: over.roleName ?? 'EMPLOYEE' })) },
  };
  const service = new UsersService(
    prisma,
    policy as any,
    { log: jest.fn(async (e: any) => void audit.push(e)) } as any,
    {} as any,
    {} as any,
  );
  return { service, updates, audit, prisma };
}

describe('the profile save writes columns, not whatever it was handed', () => {
  // The screen sends `{ ...profile }` back -- the entire object, including the
  // `role` and `department` RELATION objects. Prisma rejects a raw nested
  // object where it expects connect/update syntax, which is the Internal
  // Server Error seen on Employment Details. Deleting three known-bad keys
  // could never have caught it, because the problem was everything else.

  function profileService(requesterRole = 'ADMIN') {
    const updates: any[] = [];
    const prisma: any = {
      user: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 'req-1'
            ? { id: 'req-1', isHR: false, role: { name: requesterRole } }
            : { id: 'u-1', employeeId: 'TE-014', role: { name: 'EMPLOYEE' }, department: null },
        ),
        update: jest.fn(async ({ data }: any) => {
          updates.push(data);
          return { id: 'u-1', password: 'hash', ...data };
        }),
      },
    };
    const service = new UsersService(
      prisma, policy as any,
      { log: jest.fn(async () => undefined) } as any, {} as any, {} as any,
    );
    return { service, updates };
  }

  it('survives the whole profile object being sent back', async () => {
    const { service, updates } = profileService();

    await service.updateProfile('req-1', 'u-1', {
      designation: 'Admin',
      // The relation objects that caused the 500.
      role: { id: 'r-1', name: 'INTERN', level: 5 },
      department: { id: 'd-1', name: 'HR' },
      // Server-owned columns the screen also echoes back.
      id: 'u-1',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    } as any);

    expect(updates[0]).toEqual({ designation: 'Admin' });
    for (const forbidden of ['role', 'department', 'id', 'createdAt', 'updatedAt']) {
      expect(updates[0]).not.toHaveProperty(forbidden);
    }
  });

  it('cannot change authority through a profile save', async () => {
    // A form that looks like it edits a phone number must not be able to grant
    // HR authority or promote somebody.
    const { service, updates } = profileService();

    await service.updateProfile('req-1', 'u-1', {
      designation: 'Support specialist',
      roleId: 'role-admin',
      isHR: true,
      isActive: false,
    } as any);

    expect(updates[0]).toEqual({ designation: 'Support specialist' });
  });

  it('cannot change the login email through a profile save', async () => {
    const { service, updates } = profileService();
    await service.updateProfile('req-1', 'u-1', { bio: 'Profile bio', email: 'new@x.com' } as any);

    expect(updates[0]).not.toHaveProperty('email');
    expect(updates[0]).toEqual({ bio: 'Profile bio' });
  });

  it('cannot set a password or its hash', async () => {
    const { service, updates } = profileService();
    await service.updateProfile('req-1', 'u-1', { bio: 'Profile bio', password: 'x' } as any);

    expect(updates[0]).not.toHaveProperty('password');
    expect(updates[0]).toEqual({ bio: 'Profile bio' });
  });

  it('refuses a user reporting to themselves', async () => {
    // Observed in production. It corrupts hierarchy, scope resolution and
    // approval routing wherever the link is read.
    const { service } = profileService();

    await expect(
      service.updateProfile('req-1', 'u-1', { reportingManager: 'TE-014' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a user leading their own team', async () => {
    const { service } = profileService();

    await expect(
      service.updateProfile('req-1', 'u-1', { teamLeadName: 'TE-014' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still allows a real manager', async () => {
    const { service, updates } = profileService();
    await service.updateProfile('req-1', 'u-1', { reportingManager: 'TE-002' } as any);

    expect(updates[0]).toEqual({ reportingManager: 'TE-002' });
  });

  it('writes every profile field it claims to support', () => {
    // Guards against the list drifting from the schema: a field that is not a
    // real column reintroduces exactly the 500 this fixes.
    const { readFileSync } = require('fs');
    const { resolve } = require('path');
    const schema: string = readFileSync(
      resolve(__dirname, '../../prisma/schema.prisma'), 'utf8',
    );
    const model = /^model\s+User\s*\{([\s\S]*?)^\}/m.exec(schema)![1];
    const columns = new Set(
      model
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('//') && !l.startsWith('@@'))
        .map((l) => l.split(/\s+/)[0]),
    );

    const src: string = readFileSync(
      resolve(__dirname, '../../src/modules/core/users/users.service.ts'), 'utf8',
    );
    const block = src.slice(src.indexOf('PROFILE_FIELDS = ['));
    const fields = (block.slice(0, block.indexOf('] as const;')).match(/'(\w+)'/g) ?? []).map(
      (s) => s.slice(1, -1),
    );

    expect(fields.length).toBeGreaterThan(30);
    expect(fields.filter((f) => !columns.has(f))).toEqual([]);
  });
});

describe('retiring an account cannot lose its attendance history', () => {
  it('permanent deletion handles the Attendance stack (lifecycle dependency matrix)', () => {
    // The old blocker counted 20 relations while the schema had 35. The
    // lifecycle matrix now classifies every relation, and its schema test
    // fails on any it misses; these are the payroll-critical ones.
    const { HANDLERS } = require('../../src/modules/core/users/lifecycle/dependency-matrix');
    const models = new Set(HANDLERS.map((h: any) => h.model));
    for (const model of [
      'DailyAttendance',
      'AttendancePunchEvidence',
      'AttendancePunchPhoto',
      'AttendanceRegularization',
      'AttendancePunchHandoff',
      'AttendanceMonthClose',
      'CompOffCredit',
      'EmployeeAttendanceProfile',
    ]) {
      expect([model, models.has(model)]).toEqual([model, true]);
    }
  });

  it('the archive exports it too, not merely counts it', () => {
    // The modal counted Attendance Events as a reason the account could not be
    // removed, then produced a backup that left them out.
    const { readFileSync } = require('fs');
    const src: string = readFileSync(
      require('path').resolve(__dirname, '../../src/modules/core/users/users.service.ts'),
      'utf8',
    );

    for (const sheet of [
      'Daily Attendance',
      'Attendance Events',
      'Punch Evidence',
      'Attendance Corrections',
      'Comp-Off Credits',
    ]) {
      expect(src).toContain(`addWorksheet('${sheet}')`);
    }
    for (const model of [
      'dailyAttendance.findMany',
      'attendanceEvent.findMany',
      'attendancePunchEvidence.findMany',
      'attendanceRegularization.findMany',
      'compOffCredit.findMany',
    ]) {
      expect(src).toContain(model);
    }
  });

  it('the correction sheet keeps the values from BEFORE each correction', () => {
    // Once the official record is rewritten the previous value exists nowhere
    // else. An archive without it cannot explain what changed.
    const { readFileSync } = require('fs');
    const src: string = readFileSync(
      require('path').resolve(__dirname, '../../src/modules/core/users/users.service.ts'),
      'utf8',
    );

    expect(src).toContain('r.originalPunchIn');
    expect(src).toContain('r.originalPunchOut');
    expect(src).toContain('r.actorRoleAtEntry');
  });

  it('presence in the archive is blank when unmeasurable, never zero', () => {
    const { readFileSync } = require('fs');
    const src: string = readFileSync(
      require('path').resolve(__dirname, '../../src/modules/core/users/users.service.ts'),
      'utf8',
    );
    const sheet = src.slice(src.indexOf("addWorksheet('Daily Attendance')"));
    const cell = sheet.slice(0, sheet.indexOf('worked:'));

    // Guarded by the punch pair, with '' rather than 0 on the empty branch.
    expect(cell).toContain('d.punchInAt && d.punchOutAt');
    expect(cell).toContain(": ''");
  });

  it('the archive never carries credentials', () => {
    const { readFileSync } = require('fs');
    const src: string = readFileSync(
      require('path').resolve(__dirname, '../../src/modules/core/users/users.service.ts'),
      'utf8',
    );
    const archive = src.slice(src.indexOf('user_backup_xlsx') - 60000);
    const sheets = archive.slice(archive.indexOf("addWorksheet('User Profile')"));
    const profileSheet = sheets.slice(0, sheets.indexOf("addWorksheet('Tickets Created')"));

    for (const secret of ['user.password', 'passwordHash', 'resetToken', 'otpSecret']) {
      expect(profileSheet).not.toContain(secret);
    }
  });
});

describe('archival is fail-closed on a verified vault copy', () => {
  const { BackupVaultService } = require('../../src/modules/platform/backup-vault/backup-vault.service');

  const ENV = {
    R2_ACCOUNT_ID: 'acct',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET: 'apex-os-production-backups',
  };

  function vaultService(vault: any) {
    const svc = new BackupVaultService();
    const r2 = require('../../src/modules/platform/backup-vault/r2-vault');
    jest.spyOn(r2, 'createR2Vault').mockReturnValue(vault);
    return svc;
  }

  const original = { ...process.env };
  beforeEach(() => Object.assign(process.env, ENV));
  afterEach(() => {
    process.env = { ...original };
    jest.restoreAllMocks();
  });

  const buffer = Buffer.from('an archive');

  it('returns proof only after reading the object back', async () => {
    const puts: any[] = [];
    const svc = vaultService({
      putBuffer: jest.fn(async (k: string, b: Buffer) => void puts.push({ k, n: b.length })),
      head: jest.fn(async (k: string) => ({ key: k, byteSize: buffer.length })),
    });

    const result = await svc.archiveToVault('user-archive/2026/08/u-1/x.xlsx', buffer);

    expect(puts).toHaveLength(1);
    expect(result.provider).toBe('r2');
    expect(result.bucket).toBe('apex-os-production-backups');
    expect(result.sizeBytes).toBe(buffer.length);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses when the vault is not configured', async () => {
    delete process.env.R2_BUCKET;
    const svc = vaultService({ putBuffer: jest.fn(), head: jest.fn() });

    await expect(svc.archiveToVault('k', buffer)).rejects.toThrow(/not configured/i);
  });

  it('refuses when the upload fails', async () => {
    const svc = vaultService({
      putBuffer: jest.fn(async () => {
        throw new Error('network');
      }),
      head: jest.fn(),
    });

    await expect(svc.archiveToVault('k', buffer)).rejects.toThrow(/could not be uploaded/i);
  });

  it('refuses when the object is absent after a successful upload', async () => {
    // An upload that returns 200 and stores nothing is exactly what reading it
    // back exists to catch.
    const svc = vaultService({
      putBuffer: jest.fn(async () => undefined),
      head: jest.fn(async () => null),
    });

    await expect(svc.archiveToVault('k', buffer)).rejects.toThrow(/not present/i);
  });

  it('refuses when the stored size does not match what was sent', async () => {
    const svc = vaultService({
      putBuffer: jest.fn(async () => undefined),
      head: jest.fn(async (k: string) => ({ key: k, byteSize: 3 })),
    });

    await expect(svc.archiveToVault('k', buffer)).rejects.toThrow(/bytes but/i);
  });

  it('refuses when verification itself errors', async () => {
    const svc = vaultService({
      putBuffer: jest.fn(async () => undefined),
      head: jest.fn(async () => {
        throw new Error('r2 down');
      }),
    });

    await expect(svc.archiveToVault('k', buffer)).rejects.toThrow(/could not be verified/i);
  });

  it('never returns a credential', async () => {
    const svc = vaultService({
      putBuffer: jest.fn(async () => undefined),
      head: jest.fn(async (k: string) => ({ key: k, byteSize: buffer.length })),
    });

    const result = await svc.archiveToVault('k', buffer);
    const serialized = JSON.stringify(result);

    for (const secret of ['secret', 'key', 'acct']) {
      expect(serialized.toLowerCase()).not.toContain(`"${secret}"`);
    }
    expect(serialized).not.toContain(ENV.R2_SECRET_ACCESS_KEY);
    expect(serialized).not.toContain(ENV.R2_ACCESS_KEY_ID);
  });
});

describe('lifecycle is the latest transition, not the first one ever', () => {
  // THE BUG THIS FIXES: archivedAt() read the OLDEST archive event, so
  // archive -> reactivate left the account reading as archived permanently,
  // with no way back. Lifecycle state is the most recent transition.

  function svc(events: Array<{ action: string; timestamp: Date }>) {
    // Newest-first, as the real query orders it.
    const ordered = [...events].sort((a, b) => +b.timestamp - +a.timestamp);
    const prisma: any = {
      operationalEvent: {
        findFirst: jest.fn(async ({ where }: any) => {
          const allowed: string[] = where.action.in;
          return ordered.find((e) => allowed.includes(e.action)) ?? null;
        }),
      },
    };
    return new UsersService(
      prisma, policy as any,
      { log: jest.fn(async () => undefined) } as any, {} as any, {} as any,
    );
  }

  const T = (iso: string) => new Date(iso);

  it('reads archived status from the audit trail, not a destroyed email', () => {
    const src: string = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../src/modules/core/users/users.service.ts'),
      'utf8',
    );
    const fn = src.slice(src.indexOf('async archivedAt('));
    const body = fn.slice(0, fn.indexOf('\n  }'));

    expect(body).toContain('operationalEvent');
    expect(body).toContain('ARCHIVE_ACTIONS');
    // The vocabulary itself, now shared: the current name, the older one that
    // accounts retired before the change still carry, and the reactivation
    // that cancels either.
    expect(src).toContain("ARCHIVE_ACTIONS = ['USER_ARCHIVED_AFTER_BACKUP', 'USER_ARCHIVED']");
    // Rehire writes the canonical USER_REHIRED; readers accept both.
    expect(src).toContain("REACTIVATE_ACTIONS = ['USER_REACTIVATED', 'USER_REHIRED']");
  });

  it('is archived after an archive event', async () => {
    const at = T('2026-08-01T10:00:00.000Z');
    await expect(
      svc([{ action: 'USER_ARCHIVED_AFTER_BACKUP', timestamp: at }]).archivedAt('u-1'),
    ).resolves.toEqual(at);
  });

  it('is NOT archived once reactivated afterwards', async () => {
    // The whole point. Without this an account can never come back.
    const service = svc([
      { action: 'USER_ARCHIVED_AFTER_BACKUP', timestamp: T('2026-08-01T10:00:00.000Z') },
      { action: 'USER_REACTIVATED', timestamp: T('2026-08-02T10:00:00.000Z') },
    ]);

    await expect(service.archivedAt('u-1')).resolves.toBeNull();
  });

  it('is archived again after archive -> reactivate -> archive', async () => {
    const again = T('2026-08-03T10:00:00.000Z');
    const service = svc([
      { action: 'USER_ARCHIVED', timestamp: T('2026-08-01T10:00:00.000Z') },
      { action: 'USER_REACTIVATED', timestamp: T('2026-08-02T10:00:00.000Z') },
      { action: 'USER_ARCHIVED_AFTER_BACKUP', timestamp: again },
    ]);

    await expect(service.archivedAt('u-1')).resolves.toEqual(again);
  });

  it('recognises accounts retired under the older action name', async () => {
    const at = T('2026-07-01T10:00:00.000Z');
    await expect(svc([{ action: 'USER_ARCHIVED', timestamp: at }]).archivedAt('u-1')).resolves.toEqual(at);
  });

  it('is not archived when nothing ever happened', async () => {
    await expect(svc([]).archivedAt('u-1')).resolves.toBeNull();
  });

  it('queries newest-first everywhere the state is derived', () => {
    // Three places read it: archivedAt() and the users list here, and the
    // lifecycle service's own reader (used inside the archive transaction).
    // All must order desc or the rule silently reverts for that caller.
    const read = (p: string): string => require('fs').readFileSync(require('path').resolve(__dirname, p), 'utf8');
    const src = read('../../src/modules/core/users/users.service.ts');
    const derivations = src.match(/ARCHIVE_ACTIONS[\s\S]{0,400}?orderBy:\s*\{\s*timestamp:\s*'(asc|desc)'/g) ?? [];

    expect(derivations.length).toBeGreaterThanOrEqual(2);
    for (const d of derivations) expect(d).toContain("'desc'");
    expect(src).not.toMatch(/ARCHIVE_ACTIONS[\s\S]{0,400}?timestamp:\s*'asc'/);
    const lifecycle = read('../../src/modules/core/users/lifecycle/user-lifecycle.service.ts');
    expect(lifecycle).toMatch(/ARCHIVE_EVENT_NAMES, \.\.\.RETURN_EVENT_NAMES[\s\S]{0,200}?orderBy:\s*\{\s*timestamp:\s*'desc'/);
  });

  it('reactivation writes a transition rather than a plain edit', async () => {
    // It happens through the generic update -- the Users list just sets
    // isActive -- and used to log USER_UPDATED, which the lifecycle reader
    // cannot see.
    const audit: any[] = [];
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () => ({ roleId: 'r-1', employeeId: 'TE-1' })),
        update: jest.fn(async ({ data }: any) => ({ id: 'u-1', ...data })),
      },
      role: { findUnique: jest.fn(async () => ({ name: 'EMPLOYEE' })) },
      // A deactivated (not archived) account: no archive event.
      operationalEvent: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }: any) => void audit.push(data)) },
      employeeAttendanceProfile: { updateMany: jest.fn(async () => ({ count: 0 })) },
      attendancePunchHandoff: { updateMany: jest.fn(async () => ({ count: 0 })) },
      $queryRaw: jest.fn(async () => []),
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    const service = new UsersService(
      prisma, policy as any,
      { log: jest.fn(async (e: any) => void audit.push(e)) } as any, {} as any, {} as any,
    );

    // Reactivation is its own operation now (Phase 2, B6): it revokes sessions
    // and re-checks role and department, so the plain toggle refuses it.
    prisma.user.findUnique.mockResolvedValueOnce({ isSystemAccount: false }).mockResolvedValueOnce({ isActive: false });
    await expect(service.update('u-1', { isActive: true } as any, 'admin-1')).rejects.toThrow(/Use Reactivate/);
    expect(prisma.user.update).not.toHaveBeenCalled();

    audit.length = 0;
    await service.update('u-1', { isActive: false } as any, 'admin-1');
    expect(audit[0].action).toBe('USER_DEACTIVATED');
  });

  it('an ARCHIVED account cannot come back through the reactivate toggle: Rehire is the only way', async () => {
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () => ({ roleId: 'r-1', employeeId: 'TE-1' })),
        update: jest.fn(),
      },
      role: { findUnique: jest.fn(async () => ({ name: 'EMPLOYEE' })) },
      operationalEvent: { findFirst: jest.fn(async () => ({ action: 'USER_ARCHIVED', timestamp: new Date() })) },
    };
    const service = new UsersService(prisma, policy as any, { log: jest.fn() } as any, {} as any, {} as any);
    await expect(service.update('u-1', { isActive: true } as any, 'admin-1')).rejects.toThrow(/Use Rehire/);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('an ordinary edit is still an edit', async () => {
    const audit: any[] = [];
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () => ({ roleId: 'r-1' })),
        update: jest.fn(async ({ data }: any) => ({ id: 'u-1', ...data })),
      },
      role: { findUnique: jest.fn(async () => ({ name: 'EMPLOYEE' })) },
    };
    const service = new UsersService(
      prisma, policy as any,
      { log: jest.fn(async (e: any) => void audit.push(e)) } as any, {} as any, {} as any,
    );

    await service.update('u-1', { name: 'Shubham' }, 'admin-1');
    expect(audit[0].action).toBe('USER_UPDATED');
  });
});

describe('Account & Access can make an inactive INTERN an active HR ADMIN', () => {
  // THE EXACT PRODUCTION CASE. hr@technoedgels.com sits INTERN / inactive /
  // isHR, and needs to become ADMIN / active / isHR / Department HR in one
  // save from the Account & Access screen.

  function build(roleName: string) {
    const updates: any[] = [];
    const audit: any[] = [];
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () => ({ roleId: 'role-intern', employeeId: 'TE-014' })),
        update: jest.fn(async ({ data }: any) => {
          updates.push(data);
          return { id: 'u-1', password: 'hash', ...data };
        }),
      },
      role: { findUnique: jest.fn(async () => ({ name: roleName })) },
      // Deactivated, not archived.
      operationalEvent: { findFirst: jest.fn(async () => null) },
    };
    const service = new UsersService(
      prisma, policy as any,
      { log: jest.fn(async (e: any) => void audit.push(e)) } as any, {} as any, {} as any,
    );
    return { service, updates, audit };
  }

  it('applies role, department, HR authority and reactivation in one call', async () => {
    const { service, updates } = build('ADMIN');

    await service.update(
      'u-1',
      { roleId: 'role-admin', departmentId: 'dept-hr', isHR: true, isActive: true } as any,
      'sa-1',
    );

    expect(updates[0]).toEqual({
      roleId: 'role-admin',
      departmentId: 'dept-hr',
      isHR: true,
      isActive: true,
    });
  });

  it('records the reactivation, so the account stops reading as archived', async () => {
    // Without the lifecycle event the latest-transition reader has nothing to
    // cancel an earlier archival with.
    const { service, audit } = build('ADMIN');
    await service.update('u-1', { roleId: 'role-admin', isHR: true, isActive: true } as any, 'sa-1');

    expect(audit[0].action).toBe('USER_REACTIVATED');
  });

  it('still refuses HR authority on a SUPER_ADMIN from this screen', async () => {
    const { service, updates } = build('SUPER_ADMIN');

    await expect(
      service.update('u-1', { roleId: 'role-sa', isHR: true, isActive: true } as any, 'sa-1'),
    ).rejects.toThrow(/cannot be combined with SUPER_ADMIN/i);
    expect(updates).toEqual([]);
  });

  it('cannot smuggle anything else through the same call', async () => {
    const { service, updates } = build('ADMIN');

    await service.update(
      'u-1',
      {
        roleId: 'role-admin',
        isHR: true,
        isActive: true,
        // The screen must not become a route to these.
        email: 'someone-else@x.com',
        password: 'no',
        ctcAnnual: 1,
        basicSalary: 2,
        panNumber: 'X',
      } as any,
      'sa-1',
    );

    expect(updates[0]).toEqual({ roleId: 'role-admin', isHR: true, isActive: true });
  });

  it('the screen sends authority through the account route, not the profile one', () => {
    // The profile save is whitelisted to profile columns and drops isActive
    // silently -- which is why the old header toggle reported success and did
    // nothing.
    const ui: string = require('fs').readFileSync(
      require('path').resolve(
        __dirname,
        '../../../platforms/core/users/profiles/frontend/screens/UserProfileScreen.tsx',
      ),
      'utf8',
    );

    expect(ui).toContain('accessMutation');
    expect(ui).toMatch(/accessMutation[\s\S]{0,200}usersApi as any\)\.update\(userId/);
    // And the activate toggle no longer goes through updateProfile.
    expect(ui).not.toMatch(/updateMutation\.mutate\(\{\s*isActive/);
  });

  it('authority editing is administrators only, not everyone who may edit a profile', () => {
    const ui: string = require('fs').readFileSync(
      require('path').resolve(
        __dirname,
        '../../../platforms/core/users/profiles/frontend/screens/UserProfileScreen.tsx',
      ),
      'utf8',
    );

    // canEditAll includes HR; deciding who is an administrator is a different
    // job. The server enforces this independently.
    expect(ui).toContain("const canEditAccess = ['SUPER_ADMIN', 'ADMIN'].includes(currentRoleName)");
    expect(ui).toContain('canEditAccess && !isOwnProfile');
  });
});
