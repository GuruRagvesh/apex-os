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
      phone: '9999999999',
      // The relation objects that caused the 500.
      role: { id: 'r-1', name: 'INTERN', level: 5 },
      department: { id: 'd-1', name: 'HR' },
      // Server-owned columns the screen also echoes back.
      id: 'u-1',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    } as any);

    expect(updates[0]).toEqual({ designation: 'Admin', phone: '9999999999' });
    for (const forbidden of ['role', 'department', 'id', 'createdAt', 'updatedAt']) {
      expect(updates[0]).not.toHaveProperty(forbidden);
    }
  });

  it('cannot change authority through a profile save', async () => {
    // A form that looks like it edits a phone number must not be able to grant
    // HR authority or promote somebody.
    const { service, updates } = profileService();

    await service.updateProfile('req-1', 'u-1', {
      phone: '1',
      roleId: 'role-admin',
      isHR: true,
      isActive: false,
    } as any);

    expect(updates[0]).toEqual({ phone: '1' });
  });

  it('cannot change the login email through a profile save', async () => {
    const { service, updates } = profileService();
    await service.updateProfile('req-1', 'u-1', { phone: '1', email: 'new@x.com' } as any);

    expect(updates[0]).not.toHaveProperty('email');
  });

  it('cannot set a password or its hash', async () => {
    const { service, updates } = profileService();
    await service.updateProfile('req-1', 'u-1', { phone: '1', password: 'x' } as any);

    expect(updates[0]).not.toHaveProperty('password');
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
  it('the delete blocker counts the Attendance stack', () => {
    // It counted 20 relations while the schema has 35, and every Attendance V1
    // model was among the missing -- so an account holding the records payroll
    // is computed from looked free to remove.
    const { readFileSync } = require('fs');
    const src: string = readFileSync(
      require('path').resolve(__dirname, '../../src/modules/core/users/users.service.ts'),
      'utf8',
    );

    for (const model of [
      'dailyAttendance',
      'attendancePunchEvidence',
      'attendancePunchPhoto',
      'attendanceRegularization',
      'attendancePunchHandoff',
      'attendanceMonthClose',
      'compOffCredit',
      'employeeAttendanceProfile',
    ]) {
      expect(src).toContain(`${model}.count(`);
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

  it('the browser can no longer authorise archival', () => {
    // `confirmBackupDownloaded` used to gate this. A download cannot be
    // verified by the server that offered it.
    const src: string = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../src/modules/core/users/users.service.ts'),
      'utf8',
    );
    const body = src.slice(src.indexOf('async archiveAfterBackup'));
    const fn = body.slice(0, body.indexOf('async getMyTeam'));

    expect(fn).not.toMatch(/if\s*\(!confirmBackupDownloaded\)/);
    expect(fn).toContain('archiveToVault(');
    // And the OneDrive path is no longer what retires an account.
    expect(fn).not.toContain('backupVaultService.save(');
  });

  it('archives under an immutable, timestamped key', () => {
    const src: string = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../src/modules/core/users/users.service.ts'),
      'utf8',
    );
    const body = src.slice(src.indexOf('async archiveAfterBackup'));

    expect(body).toContain('user-archive/');
    expect(body).toContain('toISOString()');
  });
});
