/**
 * Phase 2, Track B: identity, Create User / Reactivate / Rehire and setup
 * issues against a real PostgreSQL server.
 *
 * Substituted: Google Drive (in-memory fake) for the archive that Rehire
 * needs, and the realtime gateway (a recorder) behind the notification
 * service. No email, push or external service is contacted. Every person is
 * synthetic.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { randomBytes, randomUUID } from 'crypto';
import { CommonModule } from '../../src/common/common.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { UserLifecycleModule } from '../../src/modules/core/users/lifecycle/user-lifecycle.module';
import { UsersModule } from '../../src/modules/core/users/users.module';
import { UsersService } from '../../src/modules/core/users/users.service';
import { UserSetupIssuesService } from '../../src/modules/core/users/user-setup-issues.service';
import { ScheduledUserActivationService } from '../../src/modules/core/users/scheduled-user-activation.service';
import { LifecyclePorts, USER_LIFECYCLE_PORTS, UserLifecycleService } from '../../src/modules/core/users/lifecycle/user-lifecycle.service';
import { FileObject, FileProvider, FileStore } from '../../src/modules/core/users/lifecycle/archive-files';
import { EventsGateway } from '../../src/modules/platform/gateway/events.gateway';
import { AuthService } from '../../src/modules/core/auth/auth.service';
import { AuthModule } from '../../src/modules/core/auth/auth.module';
import { assertServerIdentity } from './db-guard';
import { seedCompany, Seed } from './harness';
import { FakeDriveVault } from '../helpers/fake-drive-vault';
import { backfillMissingEmployeeIds } from '../../scripts/employee-id/backfill-missing-employee-ids';

const ARCHIVE_ACCOUNT = 'archive-owner@example.test';

class MemFileStore implements FileStore {
  async read(file: FileObject) {
    return { bytes: file.bytes ?? Buffer.from('x'), mimeType: file.mimeType };
  }
  async remove(_provider: FileProvider, _ref: string) {
    return 'NOT_FOUND' as const;
  }
}

interface World {
  moduleRef: TestingModule;
  prisma: PrismaService;
  users: UsersService;
  issues: UserSetupIssuesService;
  activation: ScheduledUserActivationService;
  lifecycle: UserLifecycleService;
  auth: AuthService;
  seed: Seed;
  admin: any;
  dept: { id: string };
  pushed: Array<{ userId: string; notification: any }>;
}

async function buildWorld(): Promise<World> {
  const drive = new FakeDriveVault({ account: ARCHIVE_ACCOUNT, environment: 'staging' });
  await drive.ensureFolder('staging', []);
  const env: NodeJS.ProcessEnv = {
    APP_ENV: 'staging',
    GOOGLE_DRIVE_CLIENT_ID: 'cid',
    GOOGLE_DRIVE_CLIENT_SECRET: 'csecret',
    GOOGLE_DRIVE_REFRESH_TOKEN: 'rtoken',
    GOOGLE_DRIVE_ARCHIVE_ROOT_FOLDER_ID: 'root-folder-0001',
    GOOGLE_DRIVE_ARCHIVE_ACCOUNT: ARCHIVE_ACCOUNT,
    GOOGLE_DRIVE_ARCHIVE_ENVIRONMENT: 'staging',
    LIFECYCLE_HANDLE_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    LIFECYCLE_HANDLE_HMAC_KEY: randomBytes(32).toString('base64'),
  };
  const ports: LifecyclePorts = { env: () => env, now: () => new Date(), makeArchiveVault: () => drive, makeFileStore: () => new MemFileStore(), transactionTimeoutMs: 120_000 };
  const pushed: World['pushed'] = [];
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), EventEmitterModule.forRoot(), CommonModule, UserLifecycleModule, UsersModule, AuthModule],
  })
    .overrideProvider(USER_LIFECYCLE_PORTS)
    .useValue(ports)
    .overrideProvider(EventsGateway)
    .useValue({ emitNotificationToUser: (userId: string, notification: any) => pushed.push({ userId, notification }) })
    .compile();
  const prisma = moduleRef.get(PrismaService);
  await prisma.$connect();
  await assertServerIdentity(prisma as any);
  const tables: { tablename: string }[] = await prisma.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  const seed = await seedCompany(prisma);
  const admin = await prisma.user.findUniqueOrThrow({ where: { id: seed.actors.admin.id }, include: { role: true } });
  const dept = await prisma.department.create({ data: { name: `Synthetic Ops ${randomUUID().slice(0, 6)}` } });
  return {
    moduleRef, prisma, seed, admin, dept, pushed,
    users: moduleRef.get(UsersService),
    issues: moduleRef.get(UserSetupIssuesService),
    activation: moduleRef.get(ScheduledUserActivationService),
    lifecycle: moduleRef.get(UserLifecycleService),
    auth: moduleRef.get(AuthService),
  };
}

async function refusal(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (err: any) {
    return err?.getResponse?.() ?? err;
  }
  throw new Error('expected a refusal');
}

const PASSWORD = 'synthetic-pass-123';
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

describe('Phase 2 identity and setup issues (PostgreSQL)', () => {
  let w: World;
  const input = (over: any = {}) => ({ name: 'Synthetic Person', email: `p-${randomUUID().slice(0, 8)}@example.test`, password: PASSWORD, roleId: 'r-employee', departmentId: w.dept.id, joiningDate: addDays(-1), ...over });

  beforeEach(async () => {
    w = await buildWorld();
  });
  afterEach(async () => {
    await w?.prisma.$disconnect();
    await w?.moduleRef.close();
  });

  it('B1/B2: emails are trimmed and lowercased; each existing state gets its own outcome', async () => {
    const created: any = await w.users.create(input({ email: '  Mixed.Case@Example.TEST ' }), w.admin.id);
    expect(created.email).toBe('mixed.case@example.test');
    expect(created.employeeId).toMatch(/\S/);

    expect((await refusal(w.users.create(input({ email: 'MIXED.case@example.test' }), w.admin.id))).code).toBe('EMAIL_BELONGS_TO_ACTIVE_USER');

    await w.users.remove(created.id, w.admin.id);
    const deactivated = await refusal(w.users.create(input({ email: 'mixed.case@example.test' }), w.admin.id));
    expect(deactivated).toEqual(expect.objectContaining({ code: 'EMAIL_BELONGS_TO_DEACTIVATED_USER', inactiveUser: expect.objectContaining({ id: created.id }) }));

    await w.lifecycle.archive(created.id, w.admin, { idempotencyKey: randomUUID() });
    expect((await refusal(w.users.create(input({ email: 'mixed.case@example.test' }), w.admin.id))).code).toBe('EMAIL_BELONGS_TO_ARCHIVED_USER');

    const system = await w.prisma.user.create({ data: { name: 'Deleted account', email: 'deleted-account@system.test', password: 'x', roleId: 'r-employee', isActive: false, isSystemAccount: true } as any });
    expect((await refusal(w.users.create(input({ email: system.email }), w.admin.id))).code).toBe('EMAIL_RESERVED_FOR_SYSTEM_ACCOUNT');
  });

  it('B2: two simultaneous creates for one address produce exactly one account', async () => {
    const email = `race-${randomUUID().slice(0, 6)}@example.test`;
    const results = await Promise.allSettled([
      w.users.create(input({ email }), w.admin.id),
      w.users.create(input({ email: email.toUpperCase() }), w.admin.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason.getResponse().code).toBe('EMAIL_BELONGS_TO_ACTIVE_USER');
    expect(await w.prisma.user.count({ where: { email: { equals: email, mode: 'insensitive' } } })).toBe(1);
  });

  it('B3/B8: department optional; a removed department or role is a remediation that changes nothing', async () => {
    const before = await w.prisma.user.count();
    const ghostDept = await w.prisma.department.create({ data: { name: `Gone ${randomUUID().slice(0, 6)}` } });
    await w.prisma.department.delete({ where: { id: ghostDept.id } });
    const dept = await refusal(w.users.create(input({ departmentId: ghostDept.id }), w.admin.id));
    expect(dept).toEqual(expect.objectContaining({ error: 'REMEDIATION', code: 'DEPARTMENT_NOT_FOUND_OR_REMOVED' }));
    expect(dept.remediation.actions.map((a: any) => a.id)).toContain('CONTINUE_WITHOUT_DEPARTMENT');
    expect((await refusal(w.users.create(input({ roleId: 'r-removed' }), w.admin.id))).code).toBe('ROLE_NOT_FOUND_OR_REMOVED');
    expect(await w.prisma.user.count()).toBe(before);

    // Continue without department: created, with a setup warning, never a failure.
    const created: any = await w.users.create(input({ departmentId: '' }), w.admin.id);
    expect(created.departmentId).toBeNull();
    expect(created.setupWarnings).toContain('DEPARTMENT_MISSING');
    expect(await w.prisma.employmentPeriod.count({ where: { userId: created.id, startReason: 'NEW_HIRE' } })).toBe(1);
  });

  it('B3: employee IDs come from the allocator and are never reused', async () => {
    const a: any = await w.users.create(input(), w.admin.id);
    const b: any = await w.users.create(input(), w.admin.id);
    expect(a.employeeId).not.toBe(b.employeeId);
    await w.users.remove(b.id, w.admin.id);
    await w.lifecycle.archive(b.id, w.admin, { idempotencyKey: randomUUID() });
    const c: any = await w.users.create(input(), w.admin.id);
    expect([a.employeeId, b.employeeId]).not.toContain(c.employeeId);
  });

  it('B4: a future joiner cannot sign in before the date, then activates once, idempotently', async () => {
    const email = `future-${randomUUID().slice(0, 6)}@example.test`;
    const joining = addDays(5);
    const created: any = await w.users.create(input({ email, joiningDate: joining }), w.admin.id);
    expect(created).toEqual(expect.objectContaining({ isActive: false, employmentState: 'SCHEDULED_TO_JOIN' }));
    const blocked = await refusal(w.auth.login({ email, password: PASSWORD } as any));
    expect(blocked).toEqual(expect.objectContaining({ code: 'ACCOUNT_SCHEDULED_TO_JOIN' }));
    expect(blocked.message).toContain(joining);
    // A wrong password learns nothing.
    expect((await refusal(w.auth.login({ email, password: 'wrong-password-1' } as any))).message).toBe('Invalid credentials');

    // Reactivate is not a way around the joining date.
    expect((await refusal(w.users.reactivate(created.id, {}, w.admin.id))).code).toBe('USER_SCHEDULED_TO_JOIN');

    const date = new Date(`${joining}T00:00:00.000Z`);
    expect((await w.activation.activateDue(date)).activated).toBe(1);
    expect((await w.activation.activateDue(date)).activated).toBe(0);
    expect(await w.prisma.operationalEvent.count({ where: { entityId: created.id, action: 'USER_SCHEDULED_ACTIVATED' } })).toBe(1);
    await expect(w.auth.login({ email, password: PASSWORD } as any)).resolves.toBeDefined();
  });

  it('B4/B9: a failed activation opens a setup issue for admins; success resolves it', async () => {
    const created: any = await w.users.create(input({ joiningDate: addDays(3) }), w.admin.id);
    const date = new Date(`${addDays(3)}T00:00:00.000Z`);
    const spy = jest.spyOn(w.prisma, '$transaction').mockImplementationOnce(async () => { throw new Error('synthetic outage'); });
    const failed = await w.activation.activateDue(date);
    expect(failed.failed).toEqual([created.id]);
    const issue = await w.prisma.userSetupIssue.findFirstOrThrow({ where: { userId: created.id, code: 'SCHEDULED_ACTIVATION_FAILED' } });
    expect(issue.status).toBe('OPEN');
    expect(issue.firstNotifiedAt).not.toBeNull();
    expect(await w.prisma.notification.count({ where: { userId: w.admin.id, dedupeKey: `setup:${issue.id}:initial` } })).toBe(1);
    spy.mockRestore();

    expect((await w.activation.activateDue(date)).activated).toBe(1);
    expect((await w.prisma.userSetupIssue.findUniqueOrThrow({ where: { id: issue.id } })).status).toBe('RESOLVED');
  });

  it('B6: Reactivate keeps the same user, employment period and joining date; old sessions stop', async () => {
    const created: any = await w.users.create(input({ joiningDate: '2025-04-01' }), w.admin.id);
    const period = await w.prisma.employmentPeriod.findFirstOrThrow({ where: { userId: created.id } });
    await w.users.remove(created.id, w.admin.id);
    expect((await w.prisma.user.findUniqueOrThrow({ where: { id: created.id } })).employmentState).toBe('DEACTIVATED');
    // The generic edit cannot do it.
    expect((await refusal(w.users.update(created.id, { isActive: true }, w.admin.id))).code).toBe('USE_REACTIVATE');
    // Rehire is for archived people only.
    expect((await refusal(w.users.rehire(created.id, { password: PASSWORD, roleId: 'r-employee', joiningDate: addDays(0) }, w.admin.id))).code).toBe('USER_NOT_ARCHIVED');

    const back: any = await w.users.reactivate(created.id, {}, w.admin.id);
    expect(back).toEqual(expect.objectContaining({ id: created.id, isActive: true, employmentState: 'ACTIVE', employeeId: created.employeeId }));
    const after = await w.prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(iso(after.joiningDate!)).toBe('2025-04-01');
    expect(after.sessionsRevokedAt).not.toBeNull();
    const periods = await w.prisma.employmentPeriod.findMany({ where: { userId: created.id } });
    expect(periods.map((p) => p.id)).toEqual([period.id]);
    expect(periods[0].endDate).toBeNull();
    expect(await w.prisma.operationalEvent.count({ where: { entityId: created.id, action: 'USER_REACTIVATED' } })).toBe(1);
  });

  it('B7: Rehire of an archived person keeps the ID, opens a new period and preserves the gap', async () => {
    const created: any = await w.users.create(input({ joiningDate: '2025-04-01' }), w.admin.id);
    await w.users.remove(created.id, w.admin.id);
    await w.lifecycle.archive(created.id, w.admin, { idempotencyKey: randomUUID() });
    const newEmail = `returning-${randomUUID().slice(0, 6)}@example.test`;
    const rehired: any = await w.users.rehire(created.id, { password: PASSWORD, roleId: 'r-employee', departmentId: null, joiningDate: addDays(0), email: newEmail.toUpperCase() }, w.admin.id);
    expect(rehired).toEqual(expect.objectContaining({ id: created.id, employeeId: created.employeeId, email: newEmail, departmentId: null }));
    const periods = await w.prisma.employmentPeriod.findMany({ where: { userId: created.id }, orderBy: { startDate: 'asc' } });
    expect(periods.map((p) => p.startReason)).toEqual(['NEW_HIRE', 'REHIRE']);
    expect(periods[0].endDate).not.toBeNull();
    expect(periods[1].endDate).toBeNull();
    expect(await w.prisma.userArchiveSnapshot.count({ where: { userId: created.id, status: { in: ['VERIFIED', 'NO_HISTORY_VERIFIED'] } } })).toBe(0);
  });

  it('B9: setup issues notify once, follow up once after 15 days, and resolve themselves', async () => {
    const created: any = await w.users.create(input({ departmentId: null }), w.admin.id);
    const issue = await w.prisma.userSetupIssue.findFirstOrThrow({ where: { userId: created.id, code: 'DEPARTMENT_MISSING' } });
    const initial = await w.prisma.notification.findMany({ where: { dedupeKey: `setup:${issue.id}:initial` } });
    // Admin, Super Admin and HR are told; the Notification Center keeps it.
    expect(initial.map((n) => n.userId)).toEqual(expect.arrayContaining([w.admin.id, w.seed.actors.hr.id]));
    await w.issues.notifyPending();
    expect(await w.prisma.notification.count({ where: { dedupeKey: `setup:${issue.id}:initial` } })).toBe(initial.length);

    expect(await w.issues.sendFollowUps(new Date(Date.now() + 14 * 86_400_000))).toBe(0);
    expect(await w.issues.sendFollowUps(new Date(Date.now() + 16 * 86_400_000))).toBeGreaterThan(0);
    expect(await w.issues.sendFollowUps(new Date(Date.now() + 40 * 86_400_000))).toBe(0);
    expect(await w.prisma.notification.count({ where: { dedupeKey: { startsWith: `setup:${issue.id}:` } } })).toBe(initial.length * 2);
    // Nothing monthly, and no access was removed.
    expect((await w.prisma.userSetupIssue.findUniqueOrThrow({ where: { id: issue.id } })).monthlyDigestAt).toBeNull();
    expect((await w.prisma.user.findUniqueOrThrow({ where: { id: created.id } })).isActive).toBe(true);

    await w.prisma.user.update({ where: { id: created.id }, data: { departmentId: w.dept.id } });
    await w.issues.runDaily();
    expect((await w.prisma.userSetupIssue.findUniqueOrThrow({ where: { id: issue.id } })).status).toBe('RESOLVED');
  });

  it('B5: a joining date with no approved policy is a setup issue, not a failure; logins and tickets stay available', async () => {
    await w.prisma.employeeAttendanceProfile.deleteMany({});
    await w.prisma.shiftPolicy.deleteMany({});
    const email = `nopolicy-${randomUUID().slice(0, 6)}@example.test`;
    const created: any = await w.users.create(input({ email }), w.admin.id);
    expect(created.isActive).toBe(true);
    expect(created.setupWarnings).toContain('ATTENDANCE_POLICY_SETUP_PENDING');
    const issue = await w.prisma.userSetupIssue.findFirstOrThrow({ where: { userId: created.id, code: 'ATTENDANCE_POLICY_SETUP_PENDING' } });
    expect(issue.firstNotifiedAt).not.toBeNull();
    await expect(w.auth.login({ email, password: PASSWORD } as any)).resolves.toBeDefined();
  });

  it('B3: the employee-ID backfill is a dry run by default, idempotent, and leaves existing codes alone', async () => {
    const legacy = await Promise.all(['L1', 'L2'].map((n) => w.prisma.user.create({ data: { name: `Legacy ${n}`, email: `legacy-${n.toLowerCase()}-${randomUUID().slice(0, 4)}@example.test`, password: 'x', roleId: 'r-employee', employeeId: null } as any })));
    const malformed = await w.prisma.user.create({ data: { name: 'Legacy Malformed', email: `legacy-m-${randomUUID().slice(0, 4)}@example.test`, password: 'x', roleId: 'r-employee', employeeId: 'te_77' } as any });

    const dry = await backfillMissingEmployeeIds(w.prisma as any, { execute: false });
    expect(dry.candidates).toBe(2);
    expect(dry.assigned).toEqual([]);
    expect(await w.prisma.user.count({ where: { id: { in: legacy.map((u) => u.id) }, employeeId: null } })).toBe(2);

    const run = await backfillMissingEmployeeIds(w.prisma as any, { execute: true });
    expect(run.assigned.map((a) => a.userId).sort()).toEqual(legacy.map((u) => u.id).sort());
    expect(new Set(run.assigned.map((a) => a.employeeId)).size).toBe(2);
    expect((await w.prisma.user.findUniqueOrThrow({ where: { id: malformed.id } })).employeeId).toBe('te_77');
    // A new hire afterwards still gets a fresh number; nothing is reused.
    const next: any = await w.users.create(input(), w.admin.id);
    expect(run.assigned.map((a) => a.employeeId)).not.toContain(next.employeeId);

    const again = await backfillMissingEmployeeIds(w.prisma as any, { execute: true });
    expect(again).toEqual(expect.objectContaining({ candidates: 0, assigned: [], failed: [] }));
  });

  it('B3/B9: a backfill failure for one person opens a setup issue and the run continues', async () => {
    const [bad, good] = await Promise.all(['B', 'G'].map((n) => w.prisma.user.create({ data: { name: `Legacy ${n}`, email: `legacy-${n.toLowerCase()}-${randomUUID().slice(0, 4)}@example.test`, password: 'x', roleId: 'r-employee', employeeId: null } as any })));
    let calls = 0;
    const flaky: any = new Proxy(w.prisma, {
      get(target: any, prop) {
        if (prop === '$transaction') {
          return async (fn: any) => {
            calls += 1;
            return target.$transaction(async (tx: any) => {
              const peek = new Proxy(tx, {
                get(t: any, p) {
                  if (p === '$queryRaw') {
                    return (strings: TemplateStringsArray, ...values: any[]) => {
                      if (values.includes(bad.id) && strings.join('?').includes('apex_assign_employee_id')) throw new Error('synthetic allocator failure');
                      return t.$queryRaw(strings, ...values);
                    };
                  }
                  return t[p];
                },
              });
              return fn(peek);
            });
          };
        }
        const v = target[prop];
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const run = await backfillMissingEmployeeIds(flaky, { execute: true });
    expect(calls).toBe(2);
    expect(run.failed.map((f) => f.userId)).toEqual([bad.id]);
    expect(run.assigned.map((a) => a.userId)).toEqual([good.id]);
    const issue = await w.prisma.userSetupIssue.findFirstOrThrow({ where: { userId: bad.id, code: 'EMPLOYEE_ID_BACKFILL_FAILED' } });
    expect(issue.status).toBe('OPEN');

    // A clean re-run assigns it and the issue resolves.
    const retry = await backfillMissingEmployeeIds(w.prisma as any, { execute: true });
    expect(retry.assigned.map((a) => a.userId)).toEqual([bad.id]);
    expect((await w.prisma.userSetupIssue.findUniqueOrThrow({ where: { id: issue.id } })).status).toBe('RESOLVED');
  });

  it('B1: passwords and reset codes never reach logs or setup issue details', async () => {
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...a: any[]) => { logs.push(a.join(' ')); });
    const secret = 'never-log-this-password';
    await w.users.create(input({ password: secret, departmentId: null }), w.admin.id);
    spy.mockRestore();
    expect(logs.join('\n')).not.toContain(secret);
    const details = await w.prisma.userSetupIssue.findMany({ select: { details: true } });
    expect(JSON.stringify(details)).not.toContain(secret);
    const events = await w.prisma.operationalEvent.findMany({ select: { metadata: true } });
    expect(JSON.stringify(events)).not.toContain(secret);
  });
});
