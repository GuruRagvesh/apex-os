/**
 * Archived-user lifecycle against a real PostgreSQL server.
 *
 * Real: Prisma, the NestJS injector, TicketsService and WorkdayService
 * transitions, row locks, the append-only triggers and their row-scoped
 * exception, every transaction boundary. Substituted: Google Drive (an
 * in-memory fake) and the provider file store (an in-memory map) -- the only
 * two things that would leave the machine.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { randomBytes, randomUUID } from 'crypto';
import { Workbook } from 'exceljs';
import { CommonModule } from '../../src/common/common.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { UserLifecycleModule } from '../../src/modules/core/users/lifecycle/user-lifecycle.module';
import { UsersModule } from '../../src/modules/core/users/users.module';
import { UsersService } from '../../src/modules/core/users/users.service';
import { LifecyclePorts, USER_LIFECYCLE_PORTS, UserLifecycleService } from '../../src/modules/core/users/lifecycle/user-lifecycle.service';
import { FileObject, FileProvider, FileStore } from '../../src/modules/core/users/lifecycle/archive-files';
import { DELETED_ACCOUNT } from '../../src/modules/core/users/lifecycle/system-account';
import { assertServerIdentity } from './db-guard';
import { rawClient, seedCompany, Seed } from './harness';
import { FakeDriveVault } from '../helpers/fake-drive-vault';

const ARCHIVE_ACCOUNT = 'archive-owner@example.test';
const NOW = new Date('2026-10-13T06:00:00.000Z');

class FakeFileStore implements FileStore {
  readonly objects = new Map<string, Buffer>();
  readonly removed: string[] = [];
  failRead = false;
  failRemove = false;
  /** Runs once, on the first provider read: lets a test change data mid-backup. */
  onRead: (() => Promise<unknown>) | null = null;
  async read(file: FileObject) {
    if (file.bytes) return { bytes: file.bytes, mimeType: file.mimeType };
    if (this.onRead) {
      const hook = this.onRead;
      this.onRead = null;
      await hook();
    }
    if (this.failRead) throw new Error('unreadable');
    const b = this.objects.get(file.ref);
    if (!b) throw new Error('missing');
    return { bytes: b, mimeType: 'image/jpeg' };
  }
  async remove(_provider: FileProvider, ref: string) {
    if (this.failRemove) throw Object.assign(new Error('down'), { code: 'PROVIDER_UNAVAILABLE' });
    this.removed.push(ref);
    return this.objects.delete(ref) ? ('DELETED' as const) : ('NOT_FOUND' as const);
  }
}

interface World {
  moduleRef: TestingModule;
  prisma: PrismaService;
  svc: UserLifecycleService;
  drive: FakeDriveVault;
  files: FakeFileStore;
  ports: LifecyclePorts & { setNow: (d: Date) => void };
  seed: Seed;
  admin: any;
}

const key = () => randomUUID();

const env = (): NodeJS.ProcessEnv => ({
  APP_ENV: 'staging',
  GOOGLE_DRIVE_CLIENT_ID: 'cid',
  GOOGLE_DRIVE_CLIENT_SECRET: 'csecret',
  GOOGLE_DRIVE_REFRESH_TOKEN: 'rtoken',
  GOOGLE_DRIVE_ARCHIVE_ROOT_FOLDER_ID: 'root-folder-0001',
  GOOGLE_DRIVE_ARCHIVE_ACCOUNT: ARCHIVE_ACCOUNT,
  GOOGLE_DRIVE_ARCHIVE_ENVIRONMENT: 'staging',
  LIFECYCLE_HANDLE_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  LIFECYCLE_HANDLE_HMAC_KEY: randomBytes(32).toString('base64'),
});

async function truncateEverything(prisma: PrismaService) {
  await assertServerIdentity(prisma as any);
  const tables: { tablename: string }[] = await prisma.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

async function buildWorld(): Promise<World> {
  const files = new FakeFileStore();
  const drive = new FakeDriveVault({ account: ARCHIVE_ACCOUNT, environment: 'staging' });
  await drive.ensureFolder('staging', []);
  const theEnv = env();
  let now = NOW;
  const ports: any = {
    env: () => theEnv,
    now: () => now,
    makeArchiveVault: () => drive,
    makeFileStore: () => files,
    transactionTimeoutMs: 120_000,
    setNow: (d: Date) => { now = d; },
  };
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), EventEmitterModule.forRoot(), CommonModule, UserLifecycleModule, UsersModule],
  })
    .overrideProvider(USER_LIFECYCLE_PORTS)
    .useValue(ports)
    .compile();
  const prisma = moduleRef.get(PrismaService);
  await prisma.$connect();
  await truncateEverything(prisma);
  const seed = await seedCompany(prisma);
  const admin = await prisma.user.findUniqueOrThrow({ where: { id: seed.actors.admin.id }, include: { role: true } });
  return { moduleRef, prisma, svc: moduleRef.get(UserLifecycleService), drive, files, ports, seed, admin };
}

let ticketSeq = 0;
async function ticket(prisma: PrismaService, data: Record<string, any>) {
  ticketSeq++;
  return prisma.ticket.create({
    data: { ticketId: `LC-${ticketSeq}`, title: `Lifecycle ticket ${ticketSeq}`, category: 'IT', status: 'OPEN', ...data } as any,
  });
}

/** Gives Employee A real history and live work. */
async function giveHistory(w: World, userId: string, colleagueId: string) {
  const p = w.prisma;
  const sole = await ticket(p, { createdById: userId, assignedToId: userId, status: 'IN_PROGRESS' });
  const sharedPrimary = await ticket(p, { createdById: w.admin.id, assignedToId: userId });
  await p.ticketAssignee.createMany({ data: [
    { ticketId: sharedPrimary.id, userId: colleagueId, assignedAt: new Date('2026-09-01T00:00:00Z') },
  ] });
  const sharedCo = await ticket(p, { createdById: w.admin.id, assignedToId: colleagueId });
  await p.ticketAssignee.create({ data: { ticketId: sharedCo.id, userId } });
  const watched = await ticket(p, { createdById: w.admin.id, assignedToId: colleagueId });
  await p.ticketWatcher.create({ data: { ticketId: watched.id, userId } });
  await p.comment.create({ data: { ticketId: sharedCo.id, authorId: userId, content: 'Handing this over next week.' } });
  await p.attachment.create({ data: { ticketId: sharedCo.id, filename: 'spec.png', url: 'cloudinary:authenticated:image:apex%2Fshared-spec:png', uploadedById: userId } as any });
  w.files.objects.set('cloudinary:authenticated:image:apex%2Fshared-spec:png', Buffer.from('shared attachment bytes'));

  const session = await p.workSession.create({ data: { userId, date: new Date('2026-10-13T00:00:00Z'), loginAt: new Date('2026-10-13T04:00:00Z'), startWorkAt: new Date('2026-10-13T04:00:00Z'), status: 'ON_BREAK' } as any });
  await p.breakLog.create({ data: { userId, workSessionId: session.id, breakType: 'TEA', startAt: new Date('2026-10-13T05:30:00Z') } as any });
  await p.leaveRequest.create({ data: { userId, type: 'CASUAL', startDate: new Date('2026-11-02T00:00:00Z'), endDate: new Date('2026-11-02T00:00:00Z'), reason: 'Family event', status: 'PENDING' } as any });
  const photoRef = 'cloudinary:authenticated:image:apex%2Fpunch-a-1:jpg';
  w.files.objects.set(photoRef, Buffer.from('punch photo bytes for A'));
  await p.attendancePunchPhoto.create({ data: { userId, objectKey: photoRef, sha256: 'x'.repeat(64), mimeType: 'image/jpeg', byteSize: 23, expiresAt: new Date('2027-01-01T00:00:00Z') } as any });
  await p.attendancePunchEvidence.create({ data: { userId, type: 'PUNCH_IN', businessDate: new Date('2026-10-12T00:00:00Z'), serverOccurredAt: new Date('2026-10-12T04:00:00Z'), idempotencyKey: randomUUID(), photoObjectKey: photoRef } as any });
  await p.workdayNote.create({ data: { userId, content: 'Started on the vendor list', idempotencyKey: randomUUID() } as any });
  await p.employeeDocument.create({ data: { userId, documentType: 'ID', fileName: 'id.pdf', fileUrl: `data:application/pdf;base64,${Buffer.from('%PDF-1.4 fake').toString('base64')}` } as any });
  await p.dailyAttendance.create({ data: { userId, date: new Date('2026-10-12T00:00:00Z'), status: 'PRESENT' } as any }).catch(() => undefined);
  return { sole, sharedPrimary, sharedCo, watched, session, photoRef };
}

async function workbookFiles(w: World, snapshot: any) {
  const wbFile = w.drive.files.get(snapshot.workbookFileId)!;
  const wb = new Workbook();
  await wb.xlsx.load(wbFile.bytes as any);
  return wb;
}

describe('archived-user lifecycle (PostgreSQL)', () => {
  let w: World;

  beforeEach(async () => {
    w = await buildWorld();
  });
  afterEach(async () => {
    await w?.prisma.$disconnect();
    await w?.moduleRef.close();
  });

  it('archives a user with no history as NO_HISTORY_VERIFIED, with no backup file and one canonical event', async () => {
    const u = w.seed.employees.F;
    const pre = await w.svc.archivePreflight(u.id, w.admin);
    expect(pre).toEqual(expect.objectContaining({ canArchive: true, backupRequired: false, state: 'ACTIVE' }));
    const filesBefore = w.drive.files.size;

    const op = await w.svc.archive(u.id, w.admin, { idempotencyKey: key() });

    expect(op.state).toBe('COMPLETED');
    expect(w.drive.files.size).toBe(filesBefore);
    const snap = await w.prisma.userArchiveSnapshot.findFirstOrThrow({ where: { userId: u.id } });
    expect(snap).toEqual(expect.objectContaining({ status: 'NO_HISTORY_VERIFIED', backupRequired: false, version: 1, folderPath: null, classificationVersion: 'no-history-v1' }));
    expect(snap.ignoredSetupCounts).toEqual(expect.objectContaining({ 'EmployeeAttendanceProfile.userId': 1 }));
    const user = await w.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(user.isActive).toBe(false);
    expect(user.sessionsRevokedAt).toBeInstanceOf(Date);
    const events = await w.prisma.operationalEvent.findMany({ where: { entityId: u.id }, orderBy: { timestamp: 'asc' } });
    expect(events.filter((e) => e.action === 'USER_ARCHIVED')).toHaveLength(1);
    expect(events.filter((e) => e.action === 'USER_ARCHIVED_AFTER_BACKUP')).toHaveLength(0);
    const archived = events.find((e) => e.action === 'USER_ARCHIVED')!;
    expect(archived.metadata).toEqual(expect.objectContaining({ operationId: op.operationId, snapshotVersion: 1, reasonCode: 'USER_ARCHIVED', eventSchemaVersion: 1 }));
  });

  it('closes or re-homes live work, archives every row and file, and verifies them before marking VERIFIED', async () => {
    const A = w.seed.employees.A;
    const B = w.seed.employees.B;
    const t = await giveHistory(w, A.id, B.id);
    const pre = await w.svc.archivePreflight(A.id, w.admin);
    expect(pre.activeWork).toEqual(expect.objectContaining({ soleTickets: 1, sharedTickets: 1, coAssignments: 1, watching: 1, activeSessions: 1, activeBreaks: 1, pendingOwnLeave: 1 }));
    expect(pre.backupRequired).toBe(true);

    const op = await w.svc.archive(A.id, w.admin, { idempotencyKey: key() });
    expect(op.state).toBe('COMPLETED');

    const sole = await w.prisma.ticket.findUniqueOrThrow({ where: { id: t.sole.id } });
    expect(sole.status).toBe('CLOSED');
    const shared = await w.prisma.ticket.findUniqueOrThrow({ where: { id: t.sharedPrimary.id }, include: { assignees: true } });
    expect(shared.status).toBe('OPEN');
    expect(shared.assignedToId).toBe(B.id);
    const co = await w.prisma.ticket.findUniqueOrThrow({ where: { id: t.sharedCo.id }, include: { assignees: true } });
    expect(co.status).toBe('OPEN');
    expect(co.assignees.map((a) => a.userId)).not.toContain(A.id);
    expect(await w.prisma.ticketWatcher.count({ where: { userId: A.id, ticketId: t.watched.id } })).toBe(0);
    const session = await w.prisma.workSession.findUniqueOrThrow({ where: { id: t.session.id } });
    expect(session.status).toBe('AUTO_CLOSED');
    expect(session.closureReason).toBe('USER_ARCHIVED');
    expect(await w.prisma.breakLog.count({ where: { userId: A.id, endAt: null } })).toBe(0);
    expect((await w.prisma.leaveRequest.findFirstOrThrow({ where: { userId: A.id } })).status).toBe('CANCELLED');
    expect(await w.prisma.ticketHistory.count({ where: { field: 'archiveOperation', newValue: op.operationId } })).toBeGreaterThanOrEqual(3);

    const snap = await w.prisma.userArchiveSnapshot.findFirstOrThrow({ where: { userId: A.id }, include: { files: true } });
    expect(snap.status).toBe('VERIFIED');
    expect(snap.folderPath).toMatch(/^Apex OS Secure Archives\/staging\/archived-users\/2026\/[0-9a-f-]{36}$/);
    expect(snap.folderPath).not.toMatch(new RegExp(`${A.id}|${A.employeeId}|Employee`));
    // Every file copied once, the attachment marked shared, the punch photo deduplicated across photo + evidence.
    const providers = snap.files.map((f) => [f.provider, f.shared, f.sourceCount]);
    expect(providers).toEqual(expect.arrayContaining([['cloudinary', true, 1], ['cloudinary', false, 2], ['inline', false, 1]]));
    for (const f of snap.files) {
      const stored = w.drive.files.get(f.archiveFileId)!;
      expect(stored.bytes.length).toBe(f.sizeBytes);
      expect(stored.perms).toEqual([{ type: 'user', role: 'owner', emailAddress: ARCHIVE_ACCOUNT }]);
      expect(f.archivePath).toMatch(/^files\/\d{4}-[0-9a-f]{12}\.\w+$/);
    }
    // The archive folder ends labelled verified; nothing identifying in any Drive name.
    expect(w.drive.files.get(snap.folderId!)!.info.appProperties.apexArchiveState).toBe('verified');
    for (const f of w.drive.files.values()) expect(f.info.name).not.toMatch(/Employee|integration\.invalid|TE-0/);

    // Workbook: complete rows, and the Files sheet keeps the original references.
    const wb = await workbookFiles(w, snap);
    const manifest = wb.getWorksheet('Manifest')!;
    expect(manifest.rowCount).toBeGreaterThan(10);
    const filesSheet = wb.getWorksheet('Files')!;
    const refs: string[] = [];
    filesSheet.eachRow((row, n) => { if (n > 1) refs.push(String(row.getCell(11).value)); });
    expect(refs).toEqual(expect.arrayContaining([t.photoRef, 'cloudinary:authenticated:image:apex%2Fshared-spec:png']));
    // No plain provider handle in PostgreSQL.
    const leaked = await w.prisma.$queryRawUnsafe<any[]>(`SELECT 1 FROM user_archive_files f WHERE f::text LIKE '%punch-a-1%'`);
    expect(leaked).toHaveLength(0);
  });

  /** Everything archiving would change, still exactly as giveHistory left it. */
  async function expectUntouched(userId: string, t: Awaited<ReturnType<typeof giveHistory>>, active = true) {
    const user = await w.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.isActive).toBe(active);
    expect(user.sessionsRevokedAt).toBeNull();
    expect((await w.prisma.ticket.findUniqueOrThrow({ where: { id: t.sole.id } })).status).toBe('IN_PROGRESS');
    expect((await w.prisma.ticket.findUniqueOrThrow({ where: { id: t.sharedPrimary.id } })).assignedToId).toBe(userId);
    expect(await w.prisma.ticketAssignee.count({ where: { userId, ticketId: t.sharedCo.id } })).toBe(1);
    expect(await w.prisma.ticketWatcher.count({ where: { userId, ticketId: t.watched.id } })).toBe(1);
    expect((await w.prisma.workSession.findUniqueOrThrow({ where: { id: t.session.id } })).status).toBe('ON_BREAK');
    expect(await w.prisma.breakLog.count({ where: { userId, endAt: null } })).toBe(1);
    expect((await w.prisma.leaveRequest.findFirstOrThrow({ where: { userId } })).status).toBe('PENDING');
    expect(await w.prisma.ticketHistory.count({ where: { field: 'archiveOperation' } })).toBe(0);
    expect(await w.prisma.operationalEvent.count({ where: { entityId: userId, action: { in: ['ARCHIVE_PREFLIGHT_COMPLETED', 'ACTIVE_WORK_CLOSED_FOR_ARCHIVE', 'ARCHIVE_BACKUP_VERIFIED', 'USER_ARCHIVED'] } } })).toBe(0);
    expect(await w.prisma.userArchiveSnapshot.count({ where: { userId } })).toBe(0);
    // No pending archive folder left behind.
    expect([...w.drive.files.values()].filter((f) => f.info.appProperties.apexArchiveKind === 'archived-user')).toHaveLength(0);
  }

  it('a failed backup changes nothing: no work closed, no access revoked, no folder left', async () => {
    const A = w.seed.employees.A;
    const t = await giveHistory(w, A.id, w.seed.employees.B.id);
    w.files.failRead = true;
    await expect(w.svc.archive(A.id, w.admin, { idempotencyKey: key() })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'ARCHIVE_FILE_UNREADABLE' }) });
    await expectUntouched(A.id, t);
    const op = await w.prisma.userLifecycleOperation.findFirstOrThrow({ where: { userId: A.id } });
    expect(op.state).toBe('FAILED');
    expect(op.result).toEqual({ reasonCode: 'ARCHIVE_FILE_UNREADABLE' });
    // A later archive succeeds and closes the work then.
    w.files.failRead = false;
    expect((await w.svc.archive(A.id, w.admin, { idempotencyKey: key() })).state).toBe('COMPLETED');
    expect((await w.prisma.ticket.findUniqueOrThrow({ where: { id: t.sole.id } })).status).toBe('CLOSED');
  });

  it('a failure while closing work (final transaction) rolls everything back and removes the uploaded archive', async () => {
    const A = w.seed.employees.A;
    const t = await giveHistory(w, A.id, w.seed.employees.B.id);
    await w.prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION l1_fail_leave_update() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected leave failure'; END $$ LANGUAGE plpgsql`);
    await w.prisma.$executeRawUnsafe(`CREATE TRIGGER l1_fail_leave_update BEFORE UPDATE ON leave_requests FOR EACH ROW EXECUTE FUNCTION l1_fail_leave_update()`);
    try {
      await expect(w.svc.archive(A.id, w.admin, { idempotencyKey: key() })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'ARCHIVE_DB_FAILED' }) });
    } finally {
      await w.prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS l1_fail_leave_update ON leave_requests`);
      await w.prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS l1_fail_leave_update()`);
    }
    await expectUntouched(A.id, t);
    // The backup had been fully written before the transaction; it was removed.
    expect(w.drive.removed.length).toBeGreaterThan(0);
    const op = await w.prisma.userLifecycleOperation.findFirstOrThrow({ where: { userId: A.id } });
    expect(op.state).toBe('FAILED');
    expect(op.result).toEqual({ reasonCode: 'ARCHIVE_DB_FAILED' });
  });

  it('refuses to archive when the data changed during the backup, and changes nothing', async () => {
    const A = w.seed.employees.A;
    const t = await giveHistory(w, A.id, w.seed.employees.B.id);
    // Arrives while the files are being copied, after the inventory was taken.
    w.files.onRead = () => w.prisma.comment.create({ data: { ticketId: t.sharedCo.id, authorId: A.id, content: 'Late comment during archive' } });
    await expect(w.svc.archive(A.id, w.admin, { idempotencyKey: key() })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'ARCHIVE_DATA_CHANGED' }) });
    await expectUntouched(A.id, t);
    const op = await w.prisma.userLifecycleOperation.findFirstOrThrow({ where: { userId: A.id } });
    expect(op.result).toEqual({ reasonCode: 'ARCHIVE_DATA_CHANGED' });
    // Retrying captures the new comment too.
    expect((await w.svc.archive(A.id, w.admin, { idempotencyKey: key() })).state).toBe('COMPLETED');
  });

  it('refuses to archive when only the closure plan changed during the backup (a co-assignee left)', async () => {
    const A = w.seed.employees.A;
    const B = w.seed.employees.B;
    const t = await giveHistory(w, A.id, B.id);
    // B is the co-assignee the shared ticket would move to. Deactivating B mid-backup
    // changes who gets it, which the workbook's closure sheet already recorded.
    w.files.onRead = () => w.prisma.user.update({ where: { id: B.id }, data: { isActive: false } });
    await expect(w.svc.archive(A.id, w.admin, { idempotencyKey: key() })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'ARCHIVE_DATA_CHANGED' }) });
    await expectUntouched(A.id, t);
  });

  it('a deactivated user stays deactivated, with nothing closed, after a failed backup', async () => {
    const A = w.seed.employees.A;
    const t = await giveHistory(w, A.id, w.seed.employees.B.id);
    await w.prisma.user.update({ where: { id: A.id }, data: { isActive: false } });
    w.files.failRead = true;
    await expect(w.svc.archive(A.id, w.admin, { idempotencyKey: key() })).rejects.toBeDefined();
    await expectUntouched(A.id, t, false);
  });

  it('records the exact closures in the workbook, and permanent delete accepts the archive afterwards', async () => {
    const A = w.seed.employees.A;
    const t = await giveHistory(w, A.id, w.seed.employees.B.id);
    const op = await w.svc.archive(A.id, w.admin, { idempotencyKey: key() });
    expect(op.state).toBe('COMPLETED');
    const snap = await w.prisma.userArchiveSnapshot.findFirstOrThrow({ where: { userId: A.id } });
    // The workbook is the data before the closures; the snapshot also keeps the data after them.
    expect(snap.backupFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(snap.dataFingerprint).not.toBe(snap.backupFingerprint);
    const wb = await workbookFiles(w, snap);
    const sheet = wb.getWorksheet('Archive Closures')!;
    const rows: string[] = [];
    sheet.eachRow((row, n) => { if (n > 1) rows.push(`${row.getCell(1).value}:${row.getCell(3).value}`); });
    expect(rows).toEqual(expect.arrayContaining([
      `TICKET_CLOSED:${t.sole.id}`,
      `TICKET_REASSIGNED:${t.sharedPrimary.id}`,
      `TICKET_UNASSIGNED:${t.sharedCo.id}`,
      `TICKET_UNWATCHED:${t.watched.id}`,
      `SESSION_ENDED:${t.session.id}`,
      expect.stringMatching(/^BREAK_ENDED:/),
      expect.stringMatching(/^LEAVE_CANCELLED:/),
      'USER_DEACTIVATED_AND_SIGNED_OUT:',
    ]));
    // The settled fingerprint is what the deletion preflight compares, so it is not stale.
    const pre = await w.svc.deletePreflight(A.id, w.admin);
    const codes = pre.reasons.map((r: any) => r.code);
    expect(codes).not.toContain('SNAPSHOT_STALE');
    expect(codes).not.toContain('ARCHIVE_MISSING_OR_CHANGED');
    expect(codes).not.toContain('NEW_ACTIVE_WORK');
  });

  it('records ARCHIVE_CLEANUP_PENDING when Drive cleanup fails, blocks re-archive, and retries idempotently', async () => {
    const A = w.seed.employees.A;
    await giveHistory(w, A.id, w.seed.employees.B.id);
    w.drive.opts.failUpload = true;
    w.drive.opts.failRemove = true;
    // Upload fails after the folder exists, and the folder cannot be removed.
    await expect(w.svc.archive(A.id, w.admin, { idempotencyKey: key() })).rejects.toBeDefined();
    const op = await w.prisma.userLifecycleOperation.findFirstOrThrow({ where: { userId: A.id } });
    expect(op.state).toBe('ARCHIVE_CLEANUP_PENDING');
    expect(JSON.stringify(op.result)).not.toMatch(/Employee|integration\.invalid/);
    w.drive.opts.failUpload = false;
    await expect(w.svc.archive(A.id, w.admin, { idempotencyKey: key() })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'ARCHIVE_CLEANUP_PENDING' }) });
    w.drive.opts.failRemove = false;
    const retried = await w.svc.retryArchiveCleanup(op.id, w.admin);
    expect(retried.state).toBe('FAILED');
    expect(await w.svc.retryArchiveCleanup(op.id, w.admin)).toEqual(retried);
    // Now a fresh archive works.
    const ok = await w.svc.archive(A.id, w.admin, { idempotencyKey: key() });
    expect(ok.state).toBe('COMPLETED');
  });

  it('returns the same result for a retried idempotency key and lets only one archive run', async () => {
    const u = w.seed.employees.E;
    const keys = [key(), key()];
    const results = await Promise.allSettled(keys.map((k) => w.svc.archive(u.id, w.admin, { idempotencyKey: k })));
    const winners = results.map((r, i) => ({ r, k: keys[i] })).filter((x) => x.r.status === 'fulfilled');
    expect(winners).toHaveLength(1);
    expect(await w.prisma.userArchiveSnapshot.count({ where: { userId: u.id } })).toBe(1);
    // Replaying the winning key returns the same operation; nothing runs twice.
    const first = (winners[0].r as PromiseFulfilledResult<any>).value;
    const again = await w.svc.archive(u.id, w.admin, { idempotencyKey: winners[0].k });
    expect(again).toEqual(first);
    expect(await w.prisma.userArchiveSnapshot.count({ where: { userId: u.id } })).toBe(1);
    // The losing key never started anything, so the user is simply already archived.
    const loser = keys.find((k) => k !== winners[0].k)!;
    await expect(w.svc.archive(u.id, w.admin, { idempotencyKey: loser })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'ALREADY_ARCHIVED' }) });
  });

  it('blocks archival for live responsibilities and changes nothing', async () => {
    const C = w.seed.employees.C;
    await w.prisma.user.update({ where: { id: w.seed.employees.D.id }, data: { reportingManager: C.employeeId } });
    const pre = await w.svc.archivePreflight(C.id, w.admin);
    expect(pre.canArchive).toBe(false);
    expect(pre.blockers).toEqual({ DIRECT_REPORTS: 1 });
    await expect(w.svc.archive(C.id, w.admin, { idempotencyKey: key() })).rejects.toBeDefined();
    expect((await w.prisma.user.findUniqueOrThrow({ where: { id: C.id } })).isActive).toBe(true);
  });

  it('permanently deletes a NO_HISTORY_VERIFIED user, releases the email, and keeps no identifier', async () => {
    const u = w.seed.employees.F;
    const email = `${u.id}@integration.invalid`;
    await w.svc.archive(u.id, w.admin, { idempotencyKey: key() });
    const pre = await w.svc.deletePreflight(u.id, w.admin);
    expect(pre).toEqual(expect.objectContaining({ allowed: true, verifiedArchive: true }));
    expect(pre.retention?.result).toBe('NO_HOLD');
    await expect(w.svc.permanentDelete(u.id, w.admin, { idempotencyKey: key(), confirmation: 'wrong@example.test' })).rejects.toBeDefined();

    const op = await w.svc.permanentDelete(u.id, w.admin, { idempotencyKey: key(), confirmation: email });
    expect(op.state).toBe('PERMANENTLY_DELETED');
    expect(await w.prisma.user.findUnique({ where: { id: u.id } })).toBeNull();
    const opRow = await w.prisma.userLifecycleOperation.findUniqueOrThrow({ where: { id: op.operationId } });
    expect(opRow.userId).toBeNull();
    expect(opRow.deleteTxid).toBeNull();
    const receipt = await w.prisma.userDeletionReceipt.findFirstOrThrow({ where: { operationId: op.operationId } });
    expect(JSON.stringify(receipt)).not.toMatch(new RegExp(`${u.id}|${email}|${u.employeeId}`));
    expect(await w.prisma.operationalEvent.count({ where: { action: 'USER_PERMANENTLY_DELETED', entityType: 'UserDeletionReceipt', entityId: receipt.receiptId } })).toBe(1);

    // The email and employee code can be used again by a brand-new account.
    const fresh = await w.prisma.user.create({ data: { email, employeeId: u.employeeId, name: 'Employee F', password: 'x', roleId: 'r-employee' } as any });
    expect(fresh.id).not.toBe(u.id);
    expect(await w.prisma.ticket.count({ where: { OR: [{ assignedToId: fresh.id }, { createdById: fresh.id }] } })).toBe(0);
  });

  it('blocks deletion on retention until an approved period has passed, then deletes and cleans up non-shared files', async () => {
    const A = w.seed.employees.A;
    const B = w.seed.employees.B;
    const t = await giveHistory(w, A.id, B.id);
    await w.svc.archive(A.id, w.admin, { idempotencyKey: key() });

    const blocked = await w.svc.deletePreflight(A.id, w.admin);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reasons.map((r) => r.code)).toContain('RETENTION_BLOCKED');
    expect(blocked.retention?.categories.ATTENDANCE?.reason).toBe('POLICY_NOT_CONFIGURED');

    // An active rule with NULL months is not a policy.
    await w.prisma.retentionRule.create({ data: { category: 'ATTENDANCE', retentionMonths: null, active: true, approvedAt: NOW } });
    expect((await w.svc.deletePreflight(A.id, w.admin)).retention?.categories.ATTENDANCE?.reason).toBe('POLICY_NOT_CONFIGURED');
    await w.prisma.retentionRule.update({ where: { category: 'ATTENDANCE' }, data: { retentionMonths: 12 } });
    await w.prisma.retentionRule.create({ data: { category: 'LEAVE', retentionMonths: 12, active: true, approvedAt: NOW } });
    expect((await w.svc.deletePreflight(A.id, w.admin)).retention?.categories.ATTENDANCE?.reason).toBe('PERIOD_NOT_ELAPSED');

    w.ports.setNow(new Date('2028-01-01T00:00:00Z'));
    const pre = await w.svc.deletePreflight(A.id, w.admin);
    expect(pre.reasons).toEqual([]);
    expect(pre.retention?.result).toBe('RETENTION_APPROVED_FOR_DELETION');
    expect(pre.cleanupObjects).toBe(1); // the punch photo; the shared attachment stays
    const uploadsBefore = w.drive.files.size;

    const op = await w.svc.permanentDelete(A.id, w.admin, { idempotencyKey: key(), confirmation: `${A.id}@integration.invalid` });
    expect(op.state).toBe('PERMANENTLY_DELETED');
    expect(w.drive.files.size).toBe(uploadsBefore); // no new backup
    expect(w.files.removed).toEqual([t.photoRef]);
    expect(w.files.objects.has('cloudinary:authenticated:image:apex%2Fshared-spec:png')).toBe(true);

    // Shared records survive, re-pointed at the system principal.
    expect((await w.prisma.ticket.findUniqueOrThrow({ where: { id: t.sole.id } })).createdById).toBe(DELETED_ACCOUNT.id);
    expect((await w.prisma.comment.findFirstOrThrow({ where: { ticketId: t.sharedCo.id } })).authorId).toBe(DELETED_ACCOUNT.id);
    expect((await w.prisma.attachment.findFirstOrThrow({ where: { ticketId: t.sharedCo.id } })).uploadedById).toBeNull();
    const items = await w.prisma.userDeletionCleanupItem.findMany();
    expect(items.every((i) => i.state === 'DONE' && i.resourceHandleEncrypted === null && /^[0-9a-f]{64}$/.test(i.resourceHandleHmac))).toBe(true);

    // Identifier sweep: no ordinary text or JSON column anywhere names A.
    const needles = [A.id, `${A.id}@integration.invalid`, A.employeeId];
    const cols: { table_name: string; column_name: string }[] = await w.prisma.$queryRawUnsafe(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
          AND data_type IN ('text', 'character varying', 'jsonb', 'json')`,
    );
    const hits: string[] = [];
    for (const c of cols) {
      for (const n of needles) {
        const r: any[] = await w.prisma.$queryRawUnsafe(`SELECT 1 FROM "${c.table_name}" WHERE "${c.column_name}"::text ILIKE $1 LIMIT 1`, `%${n}%`);
        if (r.length) hits.push(`${c.table_name}.${c.column_name}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('keeps the user archived with CLEANUP_PENDING when a provider deletion fails, and completes on retry', async () => {
    const A = w.seed.employees.A;
    await giveHistory(w, A.id, w.seed.employees.B.id);
    await w.svc.archive(A.id, w.admin, { idempotencyKey: key() });
    await w.prisma.retentionRule.createMany({ data: [
      { category: 'ATTENDANCE', retentionMonths: 1, active: true, approvedAt: NOW },
      { category: 'LEAVE', retentionMonths: 1, active: true, approvedAt: NOW },
    ] });
    w.ports.setNow(new Date('2027-06-01T00:00:00Z'));
    w.files.failRemove = true;
    const op = await w.svc.permanentDelete(A.id, w.admin, { idempotencyKey: key(), confirmation: `${A.id}@integration.invalid` });
    expect(op.state).toBe('CLEANUP_PENDING');
    expect(await w.prisma.user.findUnique({ where: { id: A.id } })).toBeNull();
    expect(await w.prisma.operationalEvent.count({ where: { action: 'USER_PERMANENTLY_DELETED' } })).toBe(0);
    const pending = await w.prisma.userDeletionCleanupItem.findFirstOrThrow();
    expect(pending).toEqual(expect.objectContaining({ state: 'PENDING', lastErrorCode: 'PROVIDER_UNAVAILABLE' }));
    expect(pending.resourceHandleEncrypted).toMatch(/^k1\./);
    w.files.failRemove = false;
    const done = await w.svc.runCleanup(op.operationId, w.admin);
    expect(done.state).toBe('PERMANENTLY_DELETED');
    expect(await w.svc.runCleanup(op.operationId, w.admin)).toEqual(done);
    expect(await w.prisma.operationalEvent.count({ where: { action: 'USER_PERMANENTLY_DELETED' } })).toBe(1);
  });

  it('refuses deletion when the data changed after archiving, or the archive changed in Drive', async () => {
    const A = w.seed.employees.A;
    const t = await giveHistory(w, A.id, w.seed.employees.B.id);
    await w.svc.archive(A.id, w.admin, { idempotencyKey: key() });
    await w.prisma.retentionRule.createMany({ data: [
      { category: 'ATTENDANCE', retentionMonths: 1, active: true, approvedAt: NOW },
      { category: 'LEAVE', retentionMonths: 1, active: true, approvedAt: NOW },
    ] });
    w.ports.setNow(new Date('2027-06-01T00:00:00Z'));
    await w.prisma.comment.create({ data: { ticketId: t.sharedCo.id, authorId: A.id, content: 'late comment' } });
    expect((await w.svc.deletePreflight(A.id, w.admin)).reasons.map((r) => r.code)).toContain('SNAPSHOT_STALE');
    await w.prisma.comment.deleteMany({ where: { content: 'late comment' } });
    expect((await w.svc.deletePreflight(A.id, w.admin)).allowed).toBe(true);

    const snap = await w.prisma.userArchiveSnapshot.findFirstOrThrow({ where: { userId: A.id }, include: { files: true } });
    w.drive.files.get(snap.files[0].archiveFileId)!.bytes = Buffer.from('tampered');
    const pre = await w.svc.deletePreflight(A.id, w.admin);
    expect(pre.reasons.map((r) => r.code)).toContain('ARCHIVE_MISSING_OR_CHANGED');
    await expect(w.svc.permanentDelete(A.id, w.admin, { idempotencyKey: key(), confirmation: `${A.id}@integration.invalid` })).rejects.toBeDefined();
    expect(await w.prisma.user.findUnique({ where: { id: A.id } })).not.toBeNull();
  });

  it('rehire invalidates the snapshot, reopens nothing, and a re-archive is a new version in a new folder', async () => {
    const A = w.seed.employees.A;
    const t = await giveHistory(w, A.id, w.seed.employees.B.id);
    await w.svc.archive(A.id, w.admin, { idempotencyKey: key() });
    const first = await w.prisma.userArchiveSnapshot.findFirstOrThrow({ where: { userId: A.id } });
    const users = w.moduleRef.get(UsersService);
    await users.rehire(A.id, { password: 'brand-new-pass', roleId: 'r-employee', departmentId: null, joiningDate: '2026-11-01', email: 'a.rehired@integration.invalid' }, w.admin.id);

    expect((await w.prisma.userArchiveSnapshot.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('INVALIDATED_REHIRED');
    const back = await w.prisma.user.findUniqueOrThrow({ where: { id: A.id } });
    expect(back).toEqual(expect.objectContaining({ isActive: true, email: 'a.rehired@integration.invalid' }));
    expect(back.sessionsRevokedAt).toBeInstanceOf(Date);
    expect((await w.prisma.ticket.findUniqueOrThrow({ where: { id: t.sole.id } })).status).toBe('CLOSED');
    expect((await w.svc.deletePreflight(A.id, w.admin)).reasons.map((r) => r.code)).toContain('NOT_ARCHIVED');
    expect(await w.prisma.operationalEvent.count({ where: { entityId: A.id, action: 'USER_REHIRED' } })).toBe(1);

    await w.svc.archive(A.id, w.admin, { idempotencyKey: key() });
    const second = await w.prisma.userArchiveSnapshot.findFirstOrThrow({ where: { userId: A.id, status: 'VERIFIED' } });
    expect(second.version).toBe(2);
    expect(second.archiveRef).not.toBe(first.archiveRef);
    expect(w.drive.files.has(first.folderId!)).toBe(true); // the earlier archive is never overwritten
  });

  it('shows legacy archived users as "Backup verification unavailable" and never deletes them', async () => {
    const u = w.seed.employees.D;
    await w.prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
    await w.prisma.operationalEvent.create({ data: { actorId: w.admin.id, entityType: 'User', entityId: u.id, action: 'USER_ARCHIVED_AFTER_BACKUP', metadata: { provider: 'r2' } } });
    const status = await w.svc.archivedStatus([u.id]);
    expect(status[0]).toEqual(expect.objectContaining({ verificationAvailable: false }));
    const pre = await w.svc.deletePreflight(u.id, w.admin);
    expect(pre.allowed).toBe(false);
    expect(pre.reasons[0].message).toMatch(/Backup verification unavailable/);
  });

  it('reads archived state latest-wins across legacy and canonical event names', async () => {
    const u = w.seed.employees.E;
    const ev = (action: string, at: string) => w.prisma.operationalEvent.create({ data: { actorId: w.admin.id, entityType: 'User', entityId: u.id, action, timestamp: new Date(at) } as any });
    await w.prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
    await ev('USER_ARCHIVED_AFTER_BACKUP', '2026-01-01T00:00:00Z');
    await ev('USER_REACTIVATED', '2026-02-01T00:00:00Z');
    await ev('USER_ARCHIVED', '2026-03-01T00:00:00Z');
    expect((await w.svc.archivePreflight(u.id, w.admin)).state).toBe('ARCHIVED');
    await ev('USER_REHIRED', '2026-04-01T00:00:00Z');
    await w.prisma.user.update({ where: { id: u.id }, data: { isActive: true } });
    expect((await w.svc.archivePreflight(u.id, w.admin)).state).toBe('ACTIVE');
  });

  it('keeps the Deleted account principal out of every user list', async () => {
    const u = w.seed.employees.F;
    await w.svc.archive(u.id, w.admin, { idempotencyKey: key() });
    await w.svc.permanentDelete(u.id, w.admin, { idempotencyKey: key(), confirmation: `${u.id}@integration.invalid` });
    expect(await w.prisma.user.findUnique({ where: { id: DELETED_ACCOUNT.id } })).toEqual(expect.objectContaining({ isSystemAccount: true, isActive: false }));
    const listed = await w.prisma.user.findMany({ select: { id: true } });
    expect(listed.map((x) => x.id)).not.toContain(DELETED_ACCOUNT.id);
    expect(await w.prisma.user.count({ where: { isActive: false } })).toBe(await w.prisma.user.count({ where: { isActive: false, isSystemAccount: false } }));
    expect(await w.prisma.user.count({ where: { isSystemAccount: true } })).toBe(1);
  });
});

// ── The row-scoped append-only exception, directly in SQL ──────────────────

describe('append-only DELETE exception (PostgreSQL)', () => {
  let w: World;
  const a = rawClient();
  beforeAll(async () => {
    w = await buildWorld();
  });
  afterAll(async () => {
    await a.$disconnect();
    await w.prisma.$disconnect();
    await w.moduleRef.close();
  });

  async function evidenceFor(userId: string) {
    await w.prisma.attendancePunchEvidence.create({ data: { userId, type: 'PUNCH_IN', businessDate: new Date('2026-10-12T00:00:00Z'), serverOccurredAt: new Date('2026-10-12T04:00:00Z'), idempotencyKey: randomUUID() } as any });
  }
  async function op(userId: string, state = 'RUNNING') {
    const id = randomUUID();
    await w.prisma.userLifecycleOperation.create({ data: { id, userId, kind: 'PERMANENT_DELETE', state, actorId: w.admin.id, idempotencyKey: randomUUID() } });
    return id;
  }
  const authorize = (tx: any, id: string, userId: string) => tx.$executeRaw`
    UPDATE "user_lifecycle_operations" SET "state" = 'VERIFIED_FOR_DELETE', "deleteTxid" = pg_current_xact_id()::text
     WHERE "id" = ${id} AND "userId" = ${userId}`;
  const setOp = (tx: any, id: string) => tx.$queryRaw`SELECT set_config('apex.lifecycle_operation_id', ${id}, true)`;
  const delFor = (tx: any, userId: string) => tx.$executeRaw`DELETE FROM "attendance_punch_evidence" WHERE "userId" = ${userId}`;

  it('1. rejects a DELETE without the operation setting', async () => {
    const u = w.seed.employees.A.id;
    await evidenceFor(u);
    await expect(a.$executeRaw`DELETE FROM "attendance_punch_evidence" WHERE "userId" = ${u}`).rejects.toThrow(/append-only/);
  });

  it('2. rejects a wrong state, a wrong user or a foreign transaction id', async () => {
    const u = w.seed.employees.B.id;
    await evidenceFor(u);
    const id = await op(u);
    await expect(a.$transaction(async (tx) => { await setOp(tx, id); await delFor(tx, u); })).rejects.toThrow(/append-only/); // RUNNING
    const other = await op(w.seed.employees.C.id);
    await expect(a.$transaction(async (tx) => { await authorize(tx, other, w.seed.employees.C.id); await setOp(tx, other); await delFor(tx, u); })).rejects.toThrow(/append-only/);
    // Authorized in one transaction, used in another: stale txid.
    await a.$transaction(async (tx) => { await authorize(tx, id, u); });
    await expect(a.$transaction(async (tx) => { await setOp(tx, id); await delFor(tx, u); })).rejects.toThrow(/append-only/);
    await w.prisma.userLifecycleOperation.update({ where: { id }, data: { state: 'FAILED' } });
  });

  it('3. rejects another user\'s rows inside an authorized transaction', async () => {
    const u = w.seed.employees.D.id;
    const other = w.seed.employees.E.id;
    await evidenceFor(u);
    await evidenceFor(other);
    const id = await op(u);
    await expect(a.$transaction(async (tx) => {
      await authorize(tx, id, u);
      await setOp(tx, id);
      await tx.$executeRaw`DELETE FROM "attendance_punch_evidence" WHERE "userId" = ${other}`;
    })).rejects.toThrow(/append-only/);
    expect(await w.prisma.attendancePunchEvidence.count({ where: { userId: other } })).toBe(1);
    await w.prisma.userLifecycleOperation.update({ where: { id }, data: { state: 'FAILED' } });
  });

  it('4. always rejects UPDATE, even when authorized', async () => {
    const u = w.seed.employees.F.id;
    await evidenceFor(u);
    const id = await op(u);
    await expect(a.$transaction(async (tx) => {
      await authorize(tx, id, u);
      await setOp(tx, id);
      await tx.$executeRaw`UPDATE "attendance_punch_evidence" SET "idempotencyKey" = 'x' WHERE "userId" = ${u}`;
    })).rejects.toThrow(/append-only/);
    await w.prisma.userLifecycleOperation.update({ where: { id }, data: { state: 'FAILED' } });
  });

  it('5 and 6. protection is fully back after a rollback and after a commit', async () => {
    const u = w.seed.employees.A.id;
    await evidenceFor(u);
    const id = await op(u);
    await expect(a.$transaction(async (tx) => {
      await authorize(tx, id, u);
      await setOp(tx, id);
      await delFor(tx, u);
      throw new Error('forced failure');
    })).rejects.toThrow(/forced failure/);
    expect(await w.prisma.attendancePunchEvidence.count({ where: { userId: u } })).toBeGreaterThan(0);
    expect((await w.prisma.userLifecycleOperation.findUniqueOrThrow({ where: { id } })).state).toBe('RUNNING');
    await expect(a.$executeRaw`DELETE FROM "attendance_punch_evidence" WHERE "userId" = ${u}`).rejects.toThrow(/append-only/);

    await a.$transaction(async (tx) => { await authorize(tx, id, u); await setOp(tx, id); await delFor(tx, u); });
    expect(await w.prisma.attendancePunchEvidence.count({ where: { userId: u } })).toBe(0);
    await evidenceFor(u);
    await expect(a.$executeRaw`DELETE FROM "attendance_punch_evidence" WHERE "userId" = ${u}`).rejects.toThrow(/append-only/);
    await w.prisma.userLifecycleOperation.update({ where: { id }, data: { state: 'FAILED' } });
  });

  it('7. scrubs the operation user id before commit without breaking the authorized deletes', async () => {
    const u = w.seed.employees.B.id;
    await evidenceFor(u);
    const id = await op(u);
    await a.$transaction(async (tx) => {
      await authorize(tx, id, u);
      await setOp(tx, id);
      await delFor(tx, u);
      await tx.$executeRaw`UPDATE "user_lifecycle_operations" SET "state" = 'DB_DELETED', "userId" = NULL, "deleteTxid" = NULL WHERE "id" = ${id}`;
      // After the scrub the exception can no longer match, even in this transaction.
      await tx.$executeRaw`INSERT INTO "attendance_punch_evidence" ("id","userId","type","businessDate","serverOccurredAt","idempotencyKey") VALUES (${randomUUID()}, ${u}, 'PUNCH_IN', now(), now(), ${randomUUID()})`;
      await expect(tx.$executeRaw`DELETE FROM "attendance_punch_evidence" WHERE "userId" = ${u}`).rejects.toThrow(/append-only/);
    }).catch(() => undefined);
    await w.prisma.userLifecycleOperation.update({ where: { id }, data: { state: 'FAILED' } });
    // The failed in-transaction delete aborted that transaction; prove the committed path separately.
    const id2 = await op(u);
    await a.$transaction(async (tx) => {
      await authorize(tx, id2, u);
      await setOp(tx, id2);
      await delFor(tx, u);
      await tx.$executeRaw`UPDATE "user_lifecycle_operations" SET "state" = 'DB_DELETED', "userId" = NULL, "deleteTxid" = NULL WHERE "id" = ${id2}`;
    });
    const row = await w.prisma.userLifecycleOperation.findUniqueOrThrow({ where: { id: id2 } });
    expect(row).toEqual(expect.objectContaining({ userId: null, deleteTxid: null, state: 'DB_DELETED' }));
    expect(await w.prisma.attendancePunchEvidence.count({ where: { userId: u } })).toBe(0);
    await evidenceFor(u);
    await expect(a.$executeRaw`DELETE FROM "attendance_punch_evidence" WHERE "userId" = ${u}`).rejects.toThrow(/append-only/);
  });
});
