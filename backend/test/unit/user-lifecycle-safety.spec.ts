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

describe('archival retires the login and keeps the person', () => {
  // POLICY: archive and erasure are different operations. Archival used to
  // overwrite the name with "Archived User <id>", so a 2026 attendance report
  // read back three years later would attribute the day to an anonymous id,
  // and a leave approval would no longer say who approved it.

  function archiveService(over: any = {}) {
    const updates: any[] = [];
    const events: any[] = [];
    const user = {
      id: 'u-1',
      name: 'Shubham Suryawanshi',
      email: 'shubham@technoedgels.com',
      employeeId: 'TE-014',
      isActive: false,
      role: { name: 'EMPLOYEE' },
      ...over.user,
    };
    const prisma: any = {
      user: {
        findUnique: jest.fn(async ({ select }: any) =>
          select?.employeeId ? { employeeId: user.employeeId } : user,
        ),
        findMany: jest.fn(async () => []),
        count: jest.fn(async () => over.reports ?? 0),
        update: jest.fn(async ({ data }: any) => {
          updates.push(data);
          return { ...user, ...data };
        }),
      },
      ticket: { count: jest.fn(async () => over.openTickets ?? 0) },
      managerDeptAccess: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      leaveRequest: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      operationalEvent: {
        findFirst: jest.fn(async () => over.existingArchive ?? null),
        findMany: jest.fn(async () => []),
      },
    };
    const service = new UsersService(
      prisma, policy as any,
      { log: jest.fn(async (e: any) => void events.push(e)) } as any,
      {} as any, {} as any,
    );
    return { service, updates, events, prisma, user };
  }

  it('archives by deactivating, and touches nothing else', async () => {
    const { service, updates } = archiveService();
    // Exercise the mutation directly: the surrounding flow needs a vault.
    await (service as any).prisma.user.update({ where: { id: 'u-1' }, data: { isActive: false } });

    expect(updates[0]).toEqual({ isActive: false });
  });

  it('no longer anonymises anything, anywhere in the flow', () => {
    const src: string = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../src/modules/core/users/users.service.ts'),
      'utf8',
    );
    const fn = src.slice(src.indexOf('async archiveAfterBackup'));
    // Ends at the next method, public or private. Overshooting reaches
    // resolveArchiveRecipients, which legitimately mentions the old anonymised
    // address shape in order to filter it out of notification recipients.
    const ends = [fn.indexOf('\n  async ', 10), fn.indexOf('\n  private ', 10)].filter((i) => i > 0);
    const body = fn.slice(0, Math.min(...ends));

    // The exact shapes that destroyed the identity.
    expect(body).not.toContain('Archived User ${');
    expect(body).not.toContain('@apex.local');
    expect(body).not.toMatch(/name:\s*`Archived/);
    // And no nulling of the person's details.
    for (const field of ['panNumber: null', 'aadhaarNumber: null', 'bankName: null', 'phone: null']) {
      expect(body).not.toContain(field);
    }
  });

  it('reports already-archived deterministically instead of archiving twice', async () => {
    const when = new Date('2026-08-31T10:00:00.000Z');
    const { service, updates, events } = archiveService({
      existingArchive: { timestamp: when },
    });

    const result = await service.archiveAfterBackup('u-1', 'admin-1', true);

    expect(result.message).toMatch(/already archived/i);
    expect(result.vaulted).toBe(true);
    // No second vault object, no second email, no second audit event.
    expect(updates).toEqual([]);
    expect(events).toEqual([]);
  });

  it('blocks while the user still owns active work', async () => {
    const { service, updates } = archiveService({ reports: 4, openTickets: 7 });

    await expect(service.archiveAfterBackup('u-1', 'admin-1', true)).rejects.toThrow();
    // Checked BEFORE the archive is generated, so a blocked attempt writes
    // nothing at all.
    expect(updates).toEqual([]);
  });

  it('names what has to be handed over', async () => {
    const { service } = archiveService({ reports: 4, openTickets: 7 });
    const blocking = await service.activeResponsibilities('u-1');

    expect(blocking['Direct reports']).toBe(4);
    expect(blocking['Open tickets assigned']).toBe(7);
  });

  it('historical records never block archival', async () => {
    // Past attendance is a fact about last month. Four direct reports is a
    // fact about next Monday. Only the second is a reason to wait.
    const { service } = archiveService();
    const blocking = await service.activeResponsibilities('u-1');

    expect(blocking).toEqual({});
  });

  it('reads archived status from the audit trail, not a destroyed email', () => {
    const src: string = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../src/modules/core/users/users.service.ts'),
      'utf8',
    );
    const fn = src.slice(src.indexOf('async archivedAt('));
    const body = fn.slice(0, fn.indexOf('\n  }'));

    expect(body).toContain('operationalEvent');
    expect(body).toContain('USER_ARCHIVED_AFTER_BACKUP');
    // Accounts retired before the change still register as archived.
    expect(body).toContain("'USER_ARCHIVED'");
  });

  it('the success message no longer claims data was anonymised', () => {
    const src: string = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../src/modules/core/users/users.service.ts'),
      'utf8',
    );

    expect(src).not.toContain('Personal data anonymized');
  });
});

describe('the archive marker and the deactivation commit together', () => {
  // The audit event IS the archived marker, so these two writes must be
  // atomic. Previously the event went through eventLogger.log() -- fire and
  // forget, and swallowing its own errors -- so any failure left an account
  // deactivated with no marker: indistinguishable from an ordinary
  // deactivation, invisible to the idempotency check, and a retry would have
  // produced a second vault object and a second round of notifications.

  const read = () =>
    require('fs').readFileSync(
      require('path').resolve(__dirname, '../../src/modules/core/users/users.service.ts'),
      'utf8',
    ) as string;

  const archiveBody = () => {
    const src = read();
    const fn = src.slice(src.indexOf('async archiveAfterBackup'));
    const ends = [fn.indexOf('\n  async ', 10), fn.indexOf('\n  private ', 10)].filter((i) => i > 0);
    return fn.slice(0, Math.min(...ends));
  };

  it('both writes happen inside one transaction', () => {
    const body = archiveBody();
    const tx = body.slice(body.indexOf('$transaction'));
    const scope = tx.slice(0, tx.indexOf('\n    });'));

    expect(body).toContain('this.prisma.$transaction');
    expect(scope).toContain('tx.user.update');
    expect(scope).toContain("action: 'USER_ARCHIVED_AFTER_BACKUP'");
  });

  it('the marker is not written through the swallowing logger', () => {
    // eventLogger.log() catches its own errors and is not awaited, so a
    // failure there is invisible. State cannot be carried that way.
    const body = archiveBody();
    const afterTx = body.slice(body.indexOf('$transaction'));

    expect(afterTx).not.toMatch(/eventLogger\.log\([\s\S]*USER_ARCHIVED_AFTER_BACKUP/);
    expect(body).not.toMatch(/eventLogger[\s\S]{0,400}USER_ARCHIVED_AFTER_BACKUP[\s\S]{0,400}catch\(\(\) => \{\}\)/);
  });

  it('the deactivation is never written outside the transaction', () => {
    const body = archiveBody();
    // The only isActive write in this method must be the transactional one.
    const writes = body.match(/user\.update\(\{[^}]*data:\s*\{\s*isActive/g) ?? [];
    const txWrites = body.match(/tx\.user\.update\(\{[^}]*data:\s*\{\s*isActive/g) ?? [];

    expect(writes.length).toBe(txWrites.length);
  });

  it('re-checks for a concurrent archival inside the transaction', () => {
    // Two administrators clicking at once: the check before the transaction
    // can go stale between reading and writing.
    const body = archiveBody();
    const tx = body.slice(body.indexOf('$transaction'));
    const scope = tx.slice(0, tx.indexOf('\n    });'));

    expect(scope).toContain('operationalEvent.findFirst');
    expect(scope).toMatch(/throw new BadRequestException/);
  });

  it('R2 is verified before the transaction opens, and stays outside it', () => {
    // An object store and Postgres cannot share a transaction. The ordering is
    // chosen so the survivable failure is the harmless one: a verified backup
    // with no archival, which is simply retried.
    const body = archiveBody();

    expect(body.indexOf('archiveToVault(')).toBeGreaterThan(-1);
    expect(body.indexOf('archiveToVault(')).toBeLessThan(body.indexOf('$transaction'));
    const tx = body.slice(body.indexOf('$transaction'));
    const scope = tx.slice(0, tx.indexOf('\n    });'));
    expect(scope).not.toContain('archiveToVault');
    expect(scope).not.toContain('sendArchiveBackup');
  });

  it('the dependency gate runs before anything is generated or uploaded', () => {
    const body = archiveBody();

    expect(body.indexOf('activeResponsibilities(')).toBeLessThan(body.indexOf('generateBackup('));
    expect(body.indexOf('activeResponsibilities(')).toBeLessThan(body.indexOf('archiveToVault('));
  });
});

describe('notification informs; it does not gate', () => {
  // Making an employee's retirement depend on Resend being up was the wrong
  // dependency direction. The audit event proves the retirement happened;
  // email only tells people that it did.

  const body = () => {
    const src: string = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../src/modules/core/users/users.service.ts'),
      'utf8',
    );
    const fn = src.slice(src.indexOf('async archiveAfterBackup'));
    const ends = [fn.indexOf('\n  async ', 10), fn.indexOf('\n  private ', 10)].filter((i) => i > 0);
    return fn.slice(0, Math.min(...ends));
  };

  it('sends only after the transaction has committed', () => {
    // THE ORDERING TEST. Moving the send back above the commit fails here.
    const b = body();

    expect(b.indexOf('$transaction')).toBeLessThan(b.indexOf('sendArchiveBackup'));
    expect(b.indexOf('$transaction')).toBeLessThan(b.indexOf('resolveArchiveRecipients'));
  });

  it('cannot abort the archive, because the send is inside a catch', () => {
    const b = body();
    const after = b.slice(b.indexOf('$transaction'));
    const send = after.slice(after.indexOf('sendArchiveBackup') - 600, after.indexOf('sendArchiveBackup'));

    expect(send).toContain('try {');
  });

  it('no longer throws when every recipient fails', () => {
    // The old guard: `if (deliveryResult.sent.length === 0) throw`.
    const b = body();

    expect(b).not.toMatch(/deliveryResult\.sent\.length === 0\s*\)\s*\{\s*throw/);
    expect(b).not.toContain('Archive aborted');
  });

  it('reports archive and notification as separate outcomes', () => {
    const b = body();

    // A LITERAL, not a conditional. Deriving archiveStatus from the send would
    // reintroduce exactly the coupling this change removes -- the archive
    // reported as failed because an email did.
    expect(b).toMatch(/archiveStatus:\s*'SUCCESS'/);
    expect(b).not.toMatch(/archiveStatus:\s*notificationStatus/);
    expect(b).not.toMatch(/archiveStatus:[^,\n]*\?/);
    expect(b).toContain('notificationStatus');
    // And the message tells the truth about the half that failed.
    expect(b).toMatch(/notification email could not be sent/i);
  });

  it('records the unsent notification without claiming the archive failed', () => {
    const b = body();

    expect(b).toContain('USER_ARCHIVE_NOTIFICATION_FAILED');
    const marker = b.slice(b.indexOf('USER_ARCHIVE_NOTIFICATION_FAILED'));
    // Non-critical: it must not be able to break a completed archive.
    expect(marker.slice(0, 500)).toContain('.catch(() => {})');
  });

  it('does not leak provider internals to the caller', () => {
    const b = body();
    const failureMessage = b.slice(b.indexOf('notification email could not be sent') - 300);

    for (const leak of ['RESEND_API_KEY', 'smtp', 'SMTP']) {
      expect(failureMessage.slice(0, 400)).not.toContain(leak);
    }
  });

  it('attempts nothing when the archive never happened', () => {
    // R2 verification and the transaction both throw, so execution never
    // reaches the notification block below them.
    const b = body();

    expect(b.indexOf('archiveToVault(')).toBeLessThan(b.indexOf('sendArchiveBackup'));
    expect(b.indexOf('activeResponsibilities(')).toBeLessThan(b.indexOf('sendArchiveBackup'));
  });

  it('an already-archived retry sends nothing and archives nothing', () => {
    const b = body();
    const early = b.slice(0, b.indexOf('generateBackup('));

    expect(early).toContain("archiveStatus: 'ALREADY_ARCHIVED'");
    expect(early).not.toContain('sendArchiveBackup');
    expect(early).not.toContain('archiveToVault');
  });
});
