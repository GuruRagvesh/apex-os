/**
 * Archive storage initialisation and exact privacy failures, against a real
 * PostgreSQL server.
 *
 * The first production archive failed with ARCHIVE_PRIVACY_FAILED because the
 * archive checked <root>/production before creating it. These suites prove a
 * first archive in a new environment creates its folders under a verified
 * root; that every privacy failure stores and returns an exact safe category
 * and folder path (never a Drive id or who a folder is shared with); that a
 * failure leaves the user unchanged and removes the pending folder; and that
 * Retry Verification is read-only and never archives anyone.
 *
 * Substituted: Google Drive (an in-memory fake) and the provider file store.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Logger } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { CommonModule } from '../../src/common/common.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { UserLifecycleModule } from '../../src/modules/core/users/lifecycle/user-lifecycle.module';
import { UsersModule } from '../../src/modules/core/users/users.module';
import { USER_LIFECYCLE_PORTS, UserLifecycleService } from '../../src/modules/core/users/lifecycle/user-lifecycle.service';
import { FileObject, FileProvider, FileStore } from '../../src/modules/core/users/lifecycle/archive-files';
import { assertServerIdentity } from './db-guard';
import { seedCompany, Seed } from './harness';
import { FakeDriveVault } from '../helpers/fake-drive-vault';

const ARCHIVE_ACCOUNT = 'archive-owner@example.test';
const OTHER = 'colleague@example.test';
const NOW = new Date('2026-10-17T06:00:00.000Z');

class FakeFileStore implements FileStore {
  readonly objects = new Map<string, Buffer>();
  async read(file: FileObject) {
    if (file.bytes) return { bytes: file.bytes, mimeType: file.mimeType };
    const b = this.objects.get(file.ref);
    if (!b) throw new Error('missing');
    return { bytes: b, mimeType: 'image/jpeg' };
  }
  async remove(_p: FileProvider, ref: string) {
    return this.objects.delete(ref) ? ('DELETED' as const) : ('NOT_FOUND' as const);
  }
}

interface World {
  moduleRef: TestingModule;
  prisma: PrismaService;
  svc: UserLifecycleService;
  drive: FakeDriveVault;
  seed: Seed;
  admin: any;
  logs: string[];
}

const key = () => randomUUID();

async function buildWorld(environment: 'production' | 'staging' = 'production'): Promise<World> {
  // A brand-new environment: the root exists and is private; <environment> does not exist yet.
  const drive = new FakeDriveVault({ account: ARCHIVE_ACCOUNT, environment });
  const files = new FakeFileStore();
  const theEnv: NodeJS.ProcessEnv = {
    APP_ENV: environment,
    GOOGLE_DRIVE_CLIENT_ID: 'cid',
    GOOGLE_DRIVE_CLIENT_SECRET: 'csecret',
    GOOGLE_DRIVE_REFRESH_TOKEN: 'rtoken',
    GOOGLE_DRIVE_ARCHIVE_ROOT_FOLDER_ID: drive.rootId,
    GOOGLE_DRIVE_ARCHIVE_ACCOUNT: ARCHIVE_ACCOUNT,
    GOOGLE_DRIVE_ARCHIVE_ENVIRONMENT: environment,
    LIFECYCLE_HANDLE_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    LIFECYCLE_HANDLE_HMAC_KEY: randomBytes(32).toString('base64'),
  };
  const ports: any = { env: () => theEnv, now: () => NOW, makeArchiveVault: () => drive, makeFileStore: () => files, transactionTimeoutMs: 120_000 };
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), EventEmitterModule.forRoot(), CommonModule, UserLifecycleModule, UsersModule],
  })
    .overrideProvider(USER_LIFECYCLE_PORTS)
    .useValue(ports)
    .compile();
  const prisma = moduleRef.get(PrismaService);
  await prisma.$connect();
  await assertServerIdentity(prisma as any);
  const tables: { tablename: string }[] = await prisma.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  const seed = await seedCompany(prisma);
  const admin = await prisma.user.findUniqueOrThrow({ where: { id: seed.actors.admin.id }, include: { role: true } });

  const logs: string[] = [];
  for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
    jest.spyOn(Logger.prototype, level).mockImplementation(function (this: any, ...args: any[]) {
      logs.push(args.map((a) => String(a)).join(' '));
    } as any);
  }
  return { moduleRef, prisma, svc: moduleRef.get(UserLifecycleService), drive, seed, admin, logs };
}

/** Closed history with one inline file, so the archive needs a real backup and closes no work. */
async function giveHistory(w: World, userId: string) {
  await w.prisma.ticket.create({ data: { ticketId: `AP-${randomUUID().slice(0, 8)}`, title: 'Archived ticket', category: 'IT', status: 'CLOSED', createdById: userId, assignedToId: userId } as any });
  await w.prisma.employeeDocument.create({ data: { userId, documentType: 'ID', fileName: 'id.pdf', fileUrl: `data:application/pdf;base64,${Buffer.from('%PDF-1.4 fake').toString('base64')}` } as any });
}

async function failureOf(p: Promise<unknown>): Promise<any> {
  const err: any = await p.then(() => null, (e) => e);
  expect(err).not.toBeNull();
  return err.getResponse ? err.getResponse() : err;
}

/** What a failed archive must leave exactly as it was. */
async function expectUserUnchanged(w: World, userId: string) {
  const u = await w.prisma.user.findUniqueOrThrow({ where: { id: userId } });
  expect(u.isActive).toBe(true);
  expect(u.sessionsRevokedAt).toBeNull();
  expect(await w.prisma.userArchiveSnapshot.count({ where: { userId } })).toBe(0);
  expect(await w.prisma.operationalEvent.count({ where: { entityId: userId, action: { in: ['USER_ARCHIVED', 'ARCHIVE_BACKUP_VERIFIED'] } } })).toBe(0);
  expect([...w.drive.files.values()].filter((f) => f.info.appProperties.apexArchiveKind === 'archived-user')).toHaveLength(0);
}

/** No Drive id, archive-account email or sharing identity in anything that leaves the service. */
function expectNoProviderData(w: World, ...values: unknown[]) {
  const text = JSON.stringify(values) + w.logs.join('\n');
  for (const id of w.drive.files.keys()) expect(text).not.toContain(id);
  for (const id of w.drive.removed) expect(text).not.toContain(id);
  expect(text).not.toContain(OTHER);
  expect(text).not.toContain(ARCHIVE_ACCOUNT);
  expect(text).not.toContain('example.test');
}

describe('archive privacy and first-time storage (PostgreSQL)', () => {
  let w: World;
  beforeEach(async () => {
    w = await buildWorld();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await w?.prisma.$disconnect();
    await w?.moduleRef.close();
  });

  it('a first production archive creates production/archived-users/<year> under the verified root and completes', async () => {
    const A = w.seed.employees.A;
    await giveHistory(w, A.id);
    expect(w.drive.folderAt('production')).toBeUndefined();

    const op = await w.svc.archive(A.id, w.admin, { idempotencyKey: key() });

    expect(op.state).toBe('COMPLETED');
    expect(w.drive.folderAt('production', 'archived-users', '2026')).toBeDefined();
    const snap = await w.prisma.userArchiveSnapshot.findFirstOrThrow({ where: { userId: A.id } });
    expect(snap.status).toBe('VERIFIED');
    expect(snap.folderPath).toMatch(/^Apex OS Secure Archives\/production\/archived-users\/2026\/[0-9a-f-]{36}$/);
    expect(w.drive.files.get(snap.folderId!)!.info.appProperties.apexArchiveState).toBe('verified');
    // Every folder Apex OS created is owner-only.
    for (const f of w.drive.files.values()) expect(f.perms).toEqual([{ type: 'user', role: 'owner', emailAddress: ARCHIVE_ACCOUNT }]);
  });

  it.each([
    ['public link', { type: 'anyone', role: 'reader' }, 'PUBLIC_LINK'],
    ['domain', { type: 'domain', role: 'reader', domain: 'example.test' }, 'DOMAIN_SHARE'],
    ['group', { type: 'group', role: 'reader', emailAddress: 'team@example.test' }, 'GROUP_SHARE'],
    ['another user', { type: 'user', role: 'writer', emailAddress: OTHER }, 'EXTRA_USER'],
  ])('a root shared with a %s is refused as %s: user unchanged, nothing created, exact details stored and returned', async (_l, perm, issue) => {
    const A = w.seed.employees.A;
    await giveHistory(w, A.id);
    w.drive.addPermission(w.drive.rootId, perm as any);
    const perms = w.drive.permissionSnapshot();
    const filesBefore = w.drive.files.size;

    const body = await failureOf(w.svc.archive(A.id, w.admin, { idempotencyKey: key() }));

    const details = { folderPath: 'Apex OS Secure Archives', privacyIssue: issue };
    expect(body).toMatchObject({ error: 'REMEDIATION', code: 'ARCHIVE_PRIVACY_FAILED', details, remediation: { code: 'ARCHIVE_PRIVACY_FAILED', details, retryEndpoint: 'ARCHIVE_STORAGE_VERIFY' } });
    await expectUserUnchanged(w, A.id);
    expect(w.drive.files.size).toBe(filesBefore);
    expect(w.drive.permissionSnapshot()).toBe(perms);

    const opRow = await w.prisma.userLifecycleOperation.findFirstOrThrow({ where: { userId: A.id } });
    expect(opRow.state).toBe('FAILED');
    expect(opRow.result).toEqual({ reasonCode: 'ARCHIVE_PRIVACY_FAILED', ...details });
    const view = await w.svc.operationStatus(opRow.id);
    expect(view.result).toEqual({ reasonCode: 'ARCHIVE_PRIVACY_FAILED', ...details });
    expect((view.remediation as any).details).toEqual(details);
    const history = await w.svc.operationAttempts(opRow.id);
    expect(history.attempts).toHaveLength(1);
    expect(history.attempts[0]).toMatchObject({ code: 'ARCHIVE_PRIVACY_FAILED', phase: 'FAILURE', outcome: 'BLOCKED' });
    expect(history.attempts[0].remediation.details).toEqual(details);
    expect(w.logs.join('\n')).toContain(`blocked: ${issue} at Apex OS Secure Archives`);
    expectNoProviderData(w, body, opRow.result, view, history);
  });

  it('a root owned by the wrong account and a root in a Shared Drive each name their own category', async () => {
    const A = w.seed.employees.A;
    await giveHistory(w, A.id);
    w.drive.setOwner(w.drive.rootId, OTHER);
    expect((await failureOf(w.svc.archive(A.id, w.admin, { idempotencyKey: key() }))).details).toEqual({ folderPath: 'Apex OS Secure Archives', privacyIssue: 'WRONG_OWNER' });
    w.drive.setOwner(w.drive.rootId, ARCHIVE_ACCOUNT);
    w.drive.setDriveId(w.drive.rootId, 'shared-drive-1');
    const body = await failureOf(w.svc.archive(A.id, w.admin, { idempotencyKey: key() }));
    expect(body.details).toEqual({ folderPath: 'Apex OS Secure Archives', privacyIssue: 'SHARED_DRIVE' });
    expect(body.remediation.problem).toMatch(/Shared Drive/);
    await expectUserUnchanged(w, A.id);
    expectNoProviderData(w, body);
  });

  it('a duplicate production folder is refused as DUPLICATE_FOLDER without choosing one', async () => {
    const A = w.seed.employees.A;
    await giveHistory(w, A.id);
    w.drive.addFolder(w.drive.rootId, 'production', { apexArchiveEnvironment: 'production' });
    w.drive.addFolder(w.drive.rootId, 'production', { apexArchiveEnvironment: 'production' });
    const before = w.drive.files.size;
    const body = await failureOf(w.svc.archive(A.id, w.admin, { idempotencyKey: key() }));
    expect(body.details).toEqual({ folderPath: 'Apex OS Secure Archives/production', privacyIssue: 'DUPLICATE_FOLDER' });
    expect(w.drive.files.size).toBe(before);
    await expectUserUnchanged(w, A.id);
  });

  it('an environment folder labelled for staging is refused as WRONG_LABEL', async () => {
    const A = w.seed.employees.A;
    await giveHistory(w, A.id);
    w.drive.addFolder(w.drive.rootId, 'production', { apexArchiveEnvironment: 'staging' });
    const body = await failureOf(w.svc.archive(A.id, w.admin, { idempotencyKey: key() }));
    expect(body.details).toEqual({ folderPath: 'Apex OS Secure Archives/production', privacyIssue: 'WRONG_LABEL' });
    await expectUserUnchanged(w, A.id);
  });

  it.each([
    ['the workbook', (name: string) => name === 'records.xlsx', /^Apex OS Secure Archives\/production\/archived-users\/2026\/[0-9a-f-]{36}$/],
    ['an associated file', (name: string) => name !== 'records.xlsx', /^Apex OS Secure Archives\/production\/archived-users\/2026\/[0-9a-f-]{36}\/files$/],
  ])('%s uploaded non-private is UPLOADED_FILE_NOT_PRIVATE: pending folder removed, user unchanged', async (_l, match, path) => {
    const A = w.seed.employees.A;
    await giveHistory(w, A.id);
    w.drive.onUpload = (id) => {
      if (match(w.drive.files.get(id)!.info.name)) w.drive.addPermission(id, { type: 'user', role: 'reader', emailAddress: OTHER });
    };
    const body = await failureOf(w.svc.archive(A.id, w.admin, { idempotencyKey: key() }));
    expect(body.details.privacyIssue).toBe('UPLOADED_FILE_NOT_PRIVATE');
    expect(body.details.folderPath).toMatch(path);
    expect(w.drive.removed.length).toBeGreaterThan(0);
    expect(w.drive.storedFiles()).toHaveLength(0);
    await expectUserUnchanged(w, A.id);
    const opRow = await w.prisma.userLifecycleOperation.findFirstOrThrow({ where: { userId: A.id } });
    expect(opRow.state).toBe('FAILED');
    expectNoProviderData(w, body, opRow.result, await w.svc.operationStatus(opRow.id));
  });

  it('Retry Verification is read-only: it reports the exact issue, then "storage is ready", and never archives', async () => {
    const A = w.seed.employees.A;
    await giveHistory(w, A.id);
    w.drive.addPermission(w.drive.rootId, { type: 'user', role: 'writer', emailAddress: OTHER });
    await failureOf(w.svc.archive(A.id, w.admin, { idempotencyKey: key() }));
    const opRow = await w.prisma.userLifecycleOperation.findFirstOrThrow({ where: { userId: A.id } });
    const perms = w.drive.permissionSnapshot();
    const filesBefore = w.drive.files.size;

    const blocked = await w.svc.verifyArchiveStorage(A.id, w.admin, { operationId: opRow.id });
    expect(blocked.ready).toBe(false);
    expect(blocked.remediation).toMatchObject({ code: 'ARCHIVE_PRIVACY_FAILED', details: { folderPath: 'Apex OS Secure Archives', privacyIssue: 'EXTRA_USER' }, operationId: opRow.id });
    expect(w.drive.permissionSnapshot()).toBe(perms); // never removes sharing

    // The archive owner removes the extra access in Drive.
    w.drive.setOwner(w.drive.rootId, ARCHIVE_ACCOUNT);
    const ready = await w.svc.verifyArchiveStorage(A.id, w.admin, { operationId: opRow.id });
    expect(ready.ready).toBe(true);
    expect(ready.remediation.code).toBe('ARCHIVE_STORAGE_READY');
    expect(ready.remediation.problem).toBe('Archive storage is ready. Close this message and confirm Archive again.');

    // Nothing was archived, created or changed by either check.
    expect(w.drive.files.size).toBe(filesBefore);
    expect(w.drive.folderAt('production')).toBeUndefined();
    await expectUserUnchanged(w, A.id);
    expect(await w.prisma.userLifecycleOperation.count({ where: { userId: A.id } })).toBe(1);
    expect((await w.prisma.userLifecycleOperation.findUniqueOrThrow({ where: { id: opRow.id } })).state).toBe('FAILED');
    const history = await w.svc.operationAttempts(opRow.id);
    expect(history.attempts.map((a: any) => [a.phase, a.outcome, a.code])).toEqual([
      ['FAILURE', 'BLOCKED', 'ARCHIVE_PRIVACY_FAILED'],
      ['VERIFICATION', 'BLOCKED', 'ARCHIVE_PRIVACY_FAILED'],
      ['VERIFICATION', 'PASSED', 'ARCHIVE_STORAGE_READY'],
    ]);
    expectNoProviderData(w, blocked, ready, history);

    // Archive still requires its own confirmation, and repeats every check.
    const op = await w.svc.archive(A.id, w.admin, { idempotencyKey: key() });
    expect(op.state).toBe('COMPLETED');
  });

  it('a failed archive whose pending folder cannot be removed never returns the Drive folder id', async () => {
    const A = w.seed.employees.A;
    await giveHistory(w, A.id);
    w.drive.opts.failUpload = true;
    w.drive.opts.failRemove = true;
    await failureOf(w.svc.archive(A.id, w.admin, { idempotencyKey: key() }));
    const opRow = await w.prisma.userLifecycleOperation.findFirstOrThrow({ where: { userId: A.id } });
    expect(opRow.state).toBe('ARCHIVE_CLEANUP_PENDING');
    expect((opRow.result as any).pendingFolderId).toBeTruthy(); // kept server-side for the cleanup retry
    const view = await w.svc.operationStatus(opRow.id);
    expect(view.result).toEqual({ reasonCode: 'ARCHIVE_DB_FAILED' });
    expect(JSON.stringify(view)).not.toContain((opRow.result as any).pendingFolderId);
    w.drive.opts.failRemove = false;
    expect((await w.svc.retryArchiveCleanup(opRow.id, w.admin)).state).toBe('FAILED');
  });

  it('existing verified archives still pass Permanent Delete verification; a missing archive folder is reported as missing, not as sharing', async () => {
    const A = w.seed.employees.A;
    await giveHistory(w, A.id);
    expect((await w.svc.archive(A.id, w.admin, { idempotencyKey: key() })).state).toBe('COMPLETED');
    const pre = await w.svc.deletePreflight(A.id, w.admin);
    expect(pre.verifiedArchive).toBe(true);
    expect(pre.reasons.map((r) => r.code)).not.toContain('ARCHIVE_PRIVACY_FAILED');

    // A shared year folder is still a privacy failure.
    const year = w.drive.folderAt('production', 'archived-users', '2026')!;
    w.drive.addPermission(year, { type: 'anyone', role: 'reader' });
    expect((await w.svc.deletePreflight(A.id, w.admin)).reasons.map((r) => r.code)).toContain('ARCHIVE_PRIVACY_FAILED');
    w.drive.setOwner(year, ARCHIVE_ACCOUNT);

    // The archive folder deleted in Drive: a rebuild is needed, not a sharing fix.
    const snap = await w.prisma.userArchiveSnapshot.findFirstOrThrow({ where: { userId: A.id } });
    await w.drive.remove(snap.folderId!);
    const gone = await w.svc.deletePreflight(A.id, w.admin);
    expect(gone.reasons.map((r) => r.code)).toContain('ARCHIVE_MISSING_OR_CHANGED');
    expect(gone.reasons.map((r) => r.code)).not.toContain('ARCHIVE_PRIVACY_FAILED');
  });
});
