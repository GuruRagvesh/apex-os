/**
 * Phase 2, Track A: Permanent Delete recovery against a real PostgreSQL server.
 *
 * Covers the archive-repair path (Prepare / Rebuild Verified Archive), the
 * deletion keys, the corrected retention rule, legal-hold precedence, Drive
 * sharing repair and retry, and the guarantees that Permanent Delete never
 * builds a backup and never needs R2.
 *
 * Substituted, as in l1: Google Drive (in-memory fake) and the provider file
 * store (in-memory map). No external service is contacted.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { randomBytes, randomUUID } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { CommonModule } from '../../src/common/common.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { UserLifecycleModule } from '../../src/modules/core/users/lifecycle/user-lifecycle.module';
import { UsersModule } from '../../src/modules/core/users/users.module';
import { LifecyclePorts, USER_LIFECYCLE_PORTS, UserLifecycleService } from '../../src/modules/core/users/lifecycle/user-lifecycle.service';
import { FileObject, FileProvider, FileStore } from '../../src/modules/core/users/lifecycle/archive-files';
import { assertServerIdentity } from './db-guard';
import { seedCompany, Seed } from './harness';
import { FakeDriveVault } from '../helpers/fake-drive-vault';

const ARCHIVE_ACCOUNT = 'archive-owner@example.test';
const NOW = new Date('2026-10-16T06:00:00.000Z');

class MemFileStore implements FileStore {
  readonly objects = new Map<string, Buffer>();
  async read(file: FileObject) {
    if (file.bytes) return { bytes: file.bytes, mimeType: file.mimeType };
    const b = this.objects.get(file.ref);
    if (!b) throw new Error('missing');
    return { bytes: b, mimeType: 'image/png' };
  }
  async remove(_provider: FileProvider, ref: string) {
    return this.objects.delete(ref) ? ('DELETED' as const) : ('NOT_FOUND' as const);
  }
}

interface World {
  moduleRef: TestingModule;
  prisma: PrismaService;
  svc: UserLifecycleService;
  drive: FakeDriveVault;
  files: MemFileStore;
  env: NodeJS.ProcessEnv;
  seed: Seed;
  admin: any;
  setNow: (d: Date) => void;
}

const key = () => randomUUID();

async function buildWorld(): Promise<World> {
  const files = new MemFileStore();
  const drive = new FakeDriveVault({ account: ARCHIVE_ACCOUNT, environment: 'staging' });
  await drive.ensureFolder('staging', []);
  // Deliberately no R2_* variable anywhere: the lifecycle must not need one.
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
  let now = NOW;
  const ports: LifecyclePorts = { env: () => env, now: () => now, makeArchiveVault: () => drive, makeFileStore: () => files, transactionTimeoutMs: 120_000 };
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
  return { moduleRef, prisma, svc: moduleRef.get(UserLifecycleService), drive, files, env, seed, admin, setNow: (d) => { now = d; } };
}

/** A document file (so the archive holds a file) and a protected attendance day. */
async function giveHistory(w: World, userId: string) {
  const ref = `cloudinary:authenticated:image:apex%2Fp2-${userId}:png`;
  w.files.objects.set(ref, Buffer.from(`document bytes for ${userId}`));
  await w.prisma.employeeDocument.create({ data: { userId, documentType: 'ID', fileName: 'id.png', fileUrl: ref } as any });
  await w.prisma.dailyAttendance.create({ data: { userId, date: new Date('2026-10-12T00:00:00Z'), status: 'PRESENT' } as any });
}

async function refusal(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (err: any) {
    return err?.getResponse?.() ?? err;
  }
  throw new Error('expected a refusal');
}

const codes = (p: any) => p.reasons.map((r: any) => r.code);

describe('Phase 2 Permanent Delete recovery (PostgreSQL)', () => {
  let w: World;

  beforeEach(async () => {
    w = await buildWorld();
  });
  afterEach(async () => {
    await w?.prisma.$disconnect();
    await w?.moduleRef.close();
  });

  it('A1: an unchanged archive stays valid; a real employment state or scheduled date set afterwards is detected', async () => {
    const A = w.seed.employees.A;
    await giveHistory(w, A.id);
    await w.svc.archive(A.id, w.admin, { idempotencyKey: key() });
    const snapshot = await w.prisma.userArchiveSnapshot.findFirstOrThrow({ where: { userId: A.id } });
    expect(codes(await w.svc.deletePreflight(A.id, w.admin))).not.toContain('SNAPSHOT_STALE');

    await w.prisma.user.update({ where: { id: A.id }, data: { employmentState: 'ARCHIVED' } });
    const stale = await w.svc.deletePreflight(A.id, w.admin);
    expect(codes(stale)).toContain('SNAPSHOT_STALE');
    expect(stale.remediation).toMatchObject({ code: 'ARCHIVE_SNAPSHOT_STALE', retryEndpoint: 'VERIFIED_ARCHIVE_PREPARE' });
    expect(stale.remediation!.actions.find((a) => a.id === 'SAFE_REPAIR')?.label).toBe('Rebuild Verified Archive');

    await w.prisma.user.update({ where: { id: A.id }, data: { employmentState: null, scheduledActivationOn: new Date('2026-12-01') } });
    expect(codes(await w.svc.deletePreflight(A.id, w.admin))).toContain('SNAPSHOT_STALE');

    // The stored hash is never rewritten to hide drift.
    expect((await w.prisma.userArchiveSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } })).dataFingerprint).toBe(snapshot.dataFingerprint);
  });

  it('A2: a legacy archived user without a snapshot gets Prepare Verified Archive, which then lets deletion proceed', async () => {
    const F = w.seed.employees.F;
    await w.svc.archive(F.id, w.admin, { idempotencyKey: key() });
    // A legacy archive: archived, but its snapshot predates verified snapshots.
    await w.prisma.userArchiveSnapshot.deleteMany({ where: { userId: F.id } });
    const pre = await w.svc.deletePreflight(F.id, w.admin);
    expect(pre.remediation).toMatchObject({ code: 'ARCHIVE_SNAPSHOT_MISSING', retryEndpoint: 'VERIFIED_ARCHIVE_PREPARE' });
    expect(pre.remediation!.actions.find((a) => a.id === 'SAFE_REPAIR')?.label).toBe('Prepare Verified Archive');
    expect(await w.svc.verifiedArchivePreflight(F.id, w.admin)).toEqual(expect.objectContaining({ action: 'PREPARE', reason: 'SNAPSHOT_MISSING' }));

    const op = await w.svc.prepareVerifiedArchive(F.id, w.admin, { idempotencyKey: key() });
    expect(op.state).toBe('COMPLETED');
    expect((await w.svc.deletePreflight(F.id, w.admin)).allowed).toBe(true);
    expect((await w.prisma.user.findUniqueOrThrow({ where: { id: F.id } })).isActive).toBe(false);
  });

  it('A2: concurrent rebuilds create exactly one new usable snapshot; replaying a key returns the same operation', async () => {
    const A = w.seed.employees.A;
    await giveHistory(w, A.id);
    await w.svc.archive(A.id, w.admin, { idempotencyKey: key() });
    await w.prisma.employeeDocument.updateMany({ where: { userId: A.id }, data: { fileName: 'id-renamed.png' } });

    const k1 = key();
    const results = await Promise.allSettled([
      w.svc.prepareVerifiedArchive(A.id, w.admin, { idempotencyKey: k1 }),
      w.svc.prepareVerifiedArchive(A.id, w.admin, { idempotencyKey: key() }),
      w.svc.prepareVerifiedArchive(A.id, w.admin, { idempotencyKey: key() }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled' && (r.value as any).state === 'COMPLETED').length).toBeGreaterThanOrEqual(1);
    expect(await w.prisma.userArchiveSnapshot.count({ where: { userId: A.id, status: { in: ['VERIFIED', 'NO_HISTORY_VERIFIED'] } } })).toBe(1);
    expect(await w.prisma.userArchiveSnapshot.count({ where: { userId: A.id } })).toBe(2);
    const first = results[0];
    if (first.status === 'fulfilled') {
      const replay = await w.svc.prepareVerifiedArchive(A.id, w.admin, { idempotencyKey: k1 });
      expect(replay.operationId).toBe((first.value as any).operationId);
    }
  });

  it('A3: missing, malformed or identical keys refuse deletion with the variable names only; archiving works without keys', async () => {
    const F = w.seed.employees.F;
    const enc = w.env.LIFECYCLE_HANDLE_ENCRYPTION_KEY!;
    const hmac = w.env.LIFECYCLE_HANDLE_HMAC_KEY!;
    delete w.env.LIFECYCLE_HANDLE_ENCRYPTION_KEY;
    delete w.env.LIFECYCLE_HANDLE_HMAC_KEY;
    await w.svc.archive(F.id, w.admin, { idempotencyKey: key() });
    let pre = await w.svc.deletePreflight(F.id, w.admin);
    expect(pre.remediation).toMatchObject({ code: 'LIFECYCLE_KEYS_MISSING', details: { keyConfigurationIssues: ['LIFECYCLE_HANDLE_ENCRYPTION_KEY', 'LIFECYCLE_HANDLE_HMAC_KEY'] } });
    expect(pre.remediation!.actions.some((a) => a.id === 'SAFE_REPAIR')).toBe(false);
    expect(JSON.stringify(pre)).not.toContain(enc);

    w.env.LIFECYCLE_HANDLE_ENCRYPTION_KEY = 'not-base64-of-32-bytes';
    w.env.LIFECYCLE_HANDLE_HMAC_KEY = hmac;
    pre = await w.svc.deletePreflight(F.id, w.admin);
    expect(pre.remediation?.details?.keyConfigurationIssues).toEqual(['LIFECYCLE_HANDLE_ENCRYPTION_KEY']);

    w.env.LIFECYCLE_HANDLE_ENCRYPTION_KEY = enc;
    w.env.LIFECYCLE_HANDLE_HMAC_KEY = 'short';
    pre = await w.svc.deletePreflight(F.id, w.admin);
    expect(pre.remediation?.details?.keyConfigurationIssues).toEqual(['LIFECYCLE_HANDLE_HMAC_KEY']);

    w.env.LIFECYCLE_HANDLE_HMAC_KEY = enc; // same value for both
    pre = await w.svc.deletePreflight(F.id, w.admin);
    expect(pre.remediation?.details?.keyConfigurationIssues).toEqual(['LIFECYCLE_HANDLE_KEYS_MUST_DIFFER']);
    const body = await refusal(w.svc.permanentDelete(F.id, w.admin, { idempotencyKey: key(), confirmation: `${F.id}@integration.invalid` }));
    expect(body).toMatchObject({ error: 'REMEDIATION', code: 'LIFECYCLE_KEYS_MISSING' });
    expect(await w.prisma.user.findUnique({ where: { id: F.id } })).not.toBeNull();

    w.env.LIFECYCLE_HANDLE_HMAC_KEY = hmac;
    expect((await w.svc.deletePreflight(F.id, w.admin)).allowed).toBe(true);
    expect((await w.svc.archivedStatus([F.id]))[0]).toEqual(expect.objectContaining({ deletionKeysConfigured: true }));
  });

  it('A4: no rule is a warning; an approved unelapsed period blocks with its eligibility date; an expired one allows', async () => {
    const A = w.seed.employees.A;
    await giveHistory(w, A.id);
    await w.svc.archive(A.id, w.admin, { idempotencyKey: key() });

    let pre = await w.svc.deletePreflight(A.id, w.admin);
    expect(pre.allowed).toBe(true);
    expect(pre.warnings.map((x) => x.code)).toEqual(['RETENTION_POLICY_NOT_CONFIGURED']);
    expect(pre.warnings[0]).toMatchObject({ severity: 'WARNING', remediationClass: 'WARNING_NON_BLOCKING', details: { retentionCategories: ['ATTENDANCE'] } });

    await w.prisma.retentionRule.create({ data: { category: 'ATTENDANCE', retentionMonths: 12, active: true, approvedAt: NOW } });
    pre = await w.svc.deletePreflight(A.id, w.admin);
    expect(pre.allowed).toBe(false);
    expect(pre.remediation).toMatchObject({ code: 'RETENTION_PERIOD_ACTIVE', details: { retentionCategories: ['ATTENDANCE'], eligibleOn: '2027-10-12' } });
    expect(pre.retention?.categories.ATTENDANCE).toEqual(expect.objectContaining({ reason: 'PERIOD_NOT_ELAPSED', eligibleOn: '2027-10-12' }));

    w.setNow(new Date('2027-10-13T00:00:00Z'));
    pre = await w.svc.deletePreflight(A.id, w.admin);
    expect(pre.allowed).toBe(true);
    expect(pre.warnings).toEqual([]);
  });

  it('A4: requested and active holds block (hold first, keys second); rejected, withdrawn and released do not', async () => {
    const F = w.seed.employees.F;
    await w.svc.archive(F.id, w.admin, { idempotencyKey: key() });
    const enc = w.env.LIFECYCLE_HANDLE_ENCRYPTION_KEY;
    delete w.env.LIFECYCLE_HANDLE_ENCRYPTION_KEY;
    const hold = await w.prisma.userLegalHold.create({ data: { id: randomUUID(), userId: F.id, reasonCode: 'AUDIT', status: 'REQUESTED', requestedById: w.admin.id, requestedAt: NOW } });
    let pre = await w.svc.deletePreflight(F.id, w.admin);
    expect(pre.remediation).toMatchObject({ code: 'LEGAL_HOLD_REQUESTED', details: { otherBlockers: ['LIFECYCLE_KEYS_MISSING'] } });

    await w.prisma.userLegalHold.update({ where: { id: hold.id }, data: { status: 'ACTIVE', placedById: w.admin.id, placedAt: NOW } });
    pre = await w.svc.deletePreflight(F.id, w.admin);
    expect(pre.remediation?.code).toBe('LEGAL_HOLD_ACTIVE');
    w.env.LIFECYCLE_HANDLE_ENCRYPTION_KEY = enc;

    await w.prisma.userLegalHold.update({ where: { id: hold.id }, data: { status: 'RELEASED', releasedById: w.admin.id, releasedAt: NOW, releaseReason: 'Closed' } });
    await w.prisma.userLegalHold.create({ data: { id: randomUUID(), userId: F.id, reasonCode: 'AUDIT', status: 'REJECTED', requestedById: w.admin.id, requestedAt: NOW, rejectedById: w.admin.id, rejectedAt: NOW, rejectionReason: 'No case' } });
    await w.prisma.userLegalHold.create({ data: { id: randomUUID(), userId: F.id, reasonCode: 'AUDIT', status: 'WITHDRAWN', requestedById: w.admin.id, requestedAt: NOW, withdrawnById: w.admin.id, withdrawnAt: NOW } });
    pre = await w.svc.deletePreflight(F.id, w.admin);
    expect(pre.holdStatus).toBeNull();
    expect(pre.allowed).toBe(true);
  });

  it('A5: a Drive sharing problem asks for the archive owner to fix it, opens the folder, and passes on retry', async () => {
    const A = w.seed.employees.A;
    await giveHistory(w, A.id);
    await w.svc.archive(A.id, w.admin, { idempotencyKey: key() });
    const snapshot = await w.prisma.userArchiveSnapshot.findFirstOrThrow({ where: { userId: A.id } });
    const workbook = (w.drive as any).files.get(snapshot.workbookFileId);
    workbook.perms.push({ type: 'anyone', role: 'reader' });

    const pre = await w.svc.deletePreflight(A.id, w.admin);
    expect(pre.remediation).toMatchObject({ code: 'ARCHIVE_PRIVACY_FAILED', requiresManualExternalAction: true });
    expect(pre.remediation!.actions.map((a) => a.id)).toEqual(['OPEN_ARCHIVE_FOLDER', 'RETRY_VERIFICATION', 'COPY_DIAGNOSTIC']);
    expect(JSON.stringify(pre.remediation)).not.toContain(snapshot.folderId!);
    expect(await w.svc.archiveFolder(A.id, w.admin)).toEqual({ url: `https://drive.google.com/drive/folders/${snapshot.folderId}` });

    workbook.perms = workbook.perms.filter((p: any) => p.type !== 'anyone');
    expect((await w.svc.deletePreflight(A.id, w.admin)).allowed).toBe(true);
  });

  it('Permanent Delete verifies the existing archive and never builds a backup', async () => {
    const A = w.seed.employees.A;
    await giveHistory(w, A.id);
    await w.svc.archive(A.id, w.admin, { idempotencyKey: key() });
    const filesBefore = (w.drive as any).files.size;
    const snapshotsBefore = await w.prisma.userArchiveSnapshot.count();
    const op = await w.svc.permanentDelete(A.id, w.admin, { idempotencyKey: key(), confirmation: `${A.id}@integration.invalid` });
    expect(['PERMANENTLY_DELETED', 'CLEANUP_PENDING']).toContain(op.state);
    expect((w.drive as any).files.size).toBe(filesBefore);
    expect(await w.prisma.userArchiveSnapshot.count()).toBe(snapshotsBefore);
    expect(await w.prisma.user.findUnique({ where: { id: A.id } })).toBeNull();
  });

  it('a failed rebuild puts the diagnosis in the acting admin\'s Notification Center', async () => {
    const A = w.seed.employees.A;
    await giveHistory(w, A.id);
    await w.svc.archive(A.id, w.admin, { idempotencyKey: key() });
    await w.prisma.employeeDocument.updateMany({ where: { userId: A.id }, data: { fileName: 'changed.png' } });
    w.env.APP_ENV = 'development'; // the vault is not available here
    const body = await refusal(w.svc.prepareVerifiedArchive(A.id, w.admin, { idempotencyKey: key() }));
    expect(body).toMatchObject({ error: 'REMEDIATION', code: 'ARCHIVE_VAULT_NOT_READY' });
    expect(await w.prisma.notification.count({ where: { userId: w.admin.id, entityType: 'UserLifecycleOperation', title: 'Archive storage is not ready' } })).toBe(1);
    expect((await w.prisma.userArchiveSnapshot.findFirstOrThrow({ where: { userId: A.id } })).status).toBe('VERIFIED');
  });

  it('the lifecycle never imports or needs the R2 vault', () => {
    const dir = join(__dirname, '../../src/modules/core/users/lifecycle');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      expect([f, /r2-vault|backup-vault\.service|R2_/.test(readFileSync(join(dir, f), 'utf8'))]).toEqual([f, false]);
    }
  });
});
