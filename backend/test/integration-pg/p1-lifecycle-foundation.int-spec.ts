/**
 * Phase 1 lifecycle foundation against a real PostgreSQL server.
 *
 * The real archive and Permanent Delete run over a person who has rows in
 * every new Phase 1 table, so the §8.1 matrix handlers meet the real
 * append-only triggers, CHECKs and FK cascades inside the authorized
 * transaction. Also: the remediation answers and the append-only attempt
 * history for vault, hold, keys and cleanup failures, and the read-only
 * setup-health endpoint's authority.
 *
 * Substituted, as in l1: Google Drive (in-memory fake) and the provider file
 * store (in-memory map).
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
import { seedCompany, Seed } from './harness';
import { FakeDriveVault } from '../helpers/fake-drive-vault';

const ARCHIVE_ACCOUNT = 'archive-owner@example.test';
const NOW = new Date('2026-10-16T06:00:00.000Z');

class MemFileStore implements FileStore {
  readonly objects = new Map<string, Buffer>();
  failRemove = false;
  async read(file: FileObject) {
    if (file.bytes) return { bytes: file.bytes, mimeType: file.mimeType };
    const b = this.objects.get(file.ref);
    if (!b) throw new Error('missing');
    return { bytes: b, mimeType: 'image/jpeg' };
  }
  async remove(_provider: FileProvider, ref: string) {
    if (this.failRemove) throw Object.assign(new Error('down'), { code: 'PROVIDER_UNAVAILABLE' });
    return this.objects.delete(ref) ? ('DELETED' as const) : ('NOT_FOUND' as const);
  }
}

interface World {
  moduleRef: TestingModule;
  prisma: PrismaService;
  svc: UserLifecycleService;
  users: UsersService;
  drive: FakeDriveVault;
  files: MemFileStore;
  env: NodeJS.ProcessEnv;
  seed: Seed;
  admin: any;
}

const key = () => randomUUID();
const id = () => randomUUID();

async function buildWorld(): Promise<World> {
  const files = new MemFileStore();
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
  const ports: LifecyclePorts = { env: () => env, now: () => NOW, makeArchiveVault: () => drive, makeFileStore: () => files, transactionTimeoutMs: 120_000 };
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
  return { moduleRef, prisma, svc: moduleRef.get(UserLifecycleService), users: moduleRef.get(UsersService), drive, files, env, seed, admin };
}

/**
 * Gives `subject` a row in every Phase 1 table, and makes `subject` an actor
 * on `other`'s Phase 1 rows (the shared-record handlers).
 */
async function givePhase1Rows(w: World, subject: string, other: string) {
  const p = w.prisma;
  const dept = (await p.department.findFirst()) ?? (await p.department.create({ data: { name: `P1 Dept ${subject}` } }));
  const ownPeriod = await p.employmentPeriod.create({ data: { id: id(), userId: subject, startDate: new Date('2026-04-01'), startReason: 'NEW_HIRE' } });
  const otherPeriod = await p.employmentPeriod.create({ data: { id: id(), userId: other, startDate: new Date('2026-04-01'), startReason: 'NEW_HIRE', createdById: subject } });
  await p.userSetupIssue.create({ data: { id: id(), userId: subject, code: 'LEGACY_JOINING_DATE_MISSING', domain: 'PROFILE', severity: 'WARNING', remediationClass: 'ADMIN_FIXABLE_FRONTEND', dedupeKey: `setup:${subject}:join` } });
  await p.userSetupIssue.create({ data: { id: id(), userId: other, code: 'LEGACY_JOINING_DATE_MISSING', domain: 'PROFILE', severity: 'WARNING', remediationClass: 'ADMIN_FIXABLE_FRONTEND', status: 'ACKNOWLEDGED', acknowledgedAt: NOW, acknowledgedById: subject, dedupeKey: `setup:${other}:join` } });
  await p.hierarchyAssignment.create({ data: { id: id(), scope: 'EMPLOYEE', role: 'TEAM_LEAD', subjectUserId: subject, assigneeUserId: w.admin.id, createdById: w.admin.id } });
  // An ENDED assignment where the subject was the other person's TL: deleted, never blocking.
  await p.hierarchyAssignment.create({ data: { id: id(), scope: 'EMPLOYEE', role: 'TEAM_LEAD', subjectUserId: other, assigneeUserId: subject, effectiveTo: new Date('2026-09-30'), createdById: subject } });
  const ownRouting = await p.routingSnapshot.create({ data: { id: id(), workflow: 'LEAVE', entityType: 'LEAVE_REQUEST', entityId: 'l-own', subjectUserId: subject, resolvedApproverId: w.admin.id, tier: 'EMPLOYEE_TL', createdById: w.admin.id } });
  const otherRouting = await p.routingSnapshot.create({ data: { id: id(), workflow: 'LEAVE', entityType: 'LEAVE_REQUEST', entityId: 'l-other', subjectUserId: other, resolvedApproverId: subject, tier: 'DEPT_TL', createdById: subject } });
  await p.policyHealthIssue.create({ data: { id: id(), policyFamily: 'LEAVE', kind: 'GAP', dedupeKey: `gap:${subject}`, status: 'RESOLVED', resolvedAt: NOW, resolvedById: subject } });
  const otherEvidence = await p.attendancePunchEvidence.create({ data: { userId: other, type: 'PUNCH_IN', businessDate: new Date('2026-10-12'), serverOccurredAt: new Date('2026-10-12T04:00:00Z'), idempotencyKey: randomUUID() } as any });
  await p.punchEvidenceReview.create({ data: { id: id(), evidenceId: otherEvidence.id, status: 'REVIEWED', reviewedById: subject, reviewedAt: NOW } });
  await p.departmentTransfer.create({ data: { id: id(), userId: subject, toDepartmentId: dept.id, fromRoleId: 'r-employee', toRoleId: 'r-employee', effectiveAt: new Date('2026-06-01'), actorId: w.admin.id, status: 'COMPLETED', impacts: { create: [{ id: id(), kind: 'PROFILE', entityId: subject, action: 'MOVED' }] } } });
  await p.departmentTransfer.create({ data: { id: id(), userId: other, toDepartmentId: dept.id, fromRoleId: 'r-employee', toRoleId: 'r-employee', effectiveAt: new Date('2026-06-01'), actorId: subject, status: 'COMPLETED' } });
  // The subject's own completed exit case, settlement, clearance and adjustments.
  const ownCase = await p.exitCase.create({ data: { id: id(), userId: subject, employmentPeriodId: ownPeriod.id, state: 'COMPLETED', resignedOn: new Date('2026-08-01'), noticeDays: 30, noticeSource: 'POLICY_CONFIRMED', lastWorkingDay: new Date('2026-08-31') } });
  await p.exitClearanceItem.create({ data: { id: id(), exitCaseId: ownCase.id, category: 'ASSETS', status: 'DONE', completedAt: NOW, completedById: w.admin.id } });
  const ownSettlement = await p.fnfSettlement.create({ data: { id: id(), exitCaseId: ownCase.id, state: 'RELEASED', deadlineOn: new Date('2026-09-10'), readyAt: NOW, releasedAt: NOW, releasedById: w.admin.id, releaseReference: 'PAY-2026-0001' } });
  const ownAdj = await p.fnfAdjustment.create({ data: { id: id(), settlementId: ownSettlement.id, subjectUserId: subject, kind: 'ASSET_RECOVERY', direction: 'DEBIT', amount: '1500.00', reasonCode: 'LAPTOP', reference: 'REF-1', approvedById: w.admin.id, approvedAt: NOW, recordedById: w.seed.actors.hr.id } });
  await p.fnfAdjustment.create({ data: { id: id(), settlementId: ownSettlement.id, subjectUserId: subject, kind: 'ASSET_RECOVERY', direction: 'CREDIT', amount: '1500.00', reasonCode: 'CORRECTION', reference: 'REF-1R', approvedById: w.admin.id, approvedAt: NOW, recordedById: w.seed.actors.hr.id, reversesId: ownAdj.id } });
  // The other person's open exit case, which the subject handled.
  const otherCase = await p.exitCase.create({ data: { id: id(), userId: other, employmentPeriodId: otherPeriod.id, state: 'CLEARANCE_IN_PROGRESS', resignedOn: new Date('2026-10-01'), noticeDays: 30, noticeSource: 'POLICY_CONFIRMED', lastWorkingDay: new Date('2026-10-31'), createdById: subject } });
  await p.exitClearanceItem.create({ data: { id: id(), exitCaseId: otherCase.id, category: 'HANDOVER', ownerId: subject } });
  const otherSettlement = await p.fnfSettlement.create({ data: { id: id(), exitCaseId: otherCase.id, deadlineOn: new Date('2026-11-11') } });
  const otherAdj = await p.fnfAdjustment.create({ data: { id: id(), settlementId: otherSettlement.id, subjectUserId: other, kind: 'NOTICE_RECOVERY', direction: 'DEBIT', amount: '900.00', reasonCode: 'NOTICE', reference: 'REF-2', approvedById: subject, approvedAt: NOW, recordedById: w.admin.id } });
  await p.leaveRequest.create({ data: { userId: other, type: 'CASUAL', startDate: new Date('2026-09-02'), endDate: new Date('2026-09-02'), reason: 'r', status: 'APPROVED', fundingBucket: 'CASUAL', fundingChangedById: subject, fundingChangeReason: 'Moved to casual' } as any });
  // Holds on the other person placed, released and requested by the subject.
  const releasedHold = await p.userLegalHold.create({ data: { id: id(), userId: other, reasonCode: 'AUDIT', status: 'RELEASED', requestedById: w.admin.id, requestedAt: NOW, placedById: subject, placedAt: NOW, releasedById: subject, releasedAt: NOW, releaseReason: 'Closed' } });
  const withdrawnHold = await p.userLegalHold.create({ data: { id: id(), userId: other, reasonCode: 'AUDIT', status: 'WITHDRAWN', requestedById: subject, requestedAt: NOW, withdrawnById: subject, withdrawnAt: NOW } });
  // Remediation attempts the subject made on someone else's operation.
  const otherOp = await p.userLifecycleOperation.create({ data: { id: id(), userId: other, kind: 'ARCHIVE', state: 'FAILED', actorId: subject, idempotencyKey: key() } });
  await p.lifecycleRemediationAttempt.create({ data: { id: id(), operationKind: 'LIFECYCLE', operationId: otherOp.id, lifecycleOperationId: otherOp.id, subjectUserId: other, attemptNo: 1, code: 'ARCHIVE_VAULT_NOT_READY', phase: 'FAILURE', outcome: 'BLOCKED', actorId: subject, remediation: {} } });
  // A non-lifecycle attempt about the subject.
  await p.lifecycleRemediationAttempt.create({ data: { id: id(), operationKind: 'LEAVE', operationId: `leave-${subject}`, subjectUserId: subject, attemptNo: 1, code: 'LEAVE_CALENDAR_UNRESOLVED', phase: 'FAILURE', outcome: 'BLOCKED', actorId: subject, remediation: {} } });
  return { ownRouting, otherRouting, otherAdj, releasedHold, withdrawnHold, otherOp, otherCase };
}

async function remediationOf(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (err: any) {
    return err?.getResponse?.() ?? err;
  }
  throw new Error('expected a refusal');
}

describe('Phase 1 lifecycle foundation (PostgreSQL)', () => {
  let w: World;

  beforeEach(async () => {
    w = await buildWorld();
  });
  afterEach(async () => {
    await w?.prisma.$disconnect();
    await w?.moduleRef.close();
  });

  it('an open primary TL/Manager assignment blocks archival until it is ended', async () => {
    const A = w.seed.employees.A;
    const B = w.seed.employees.B;
    const row = await w.prisma.hierarchyAssignment.create({ data: { id: id(), scope: 'EMPLOYEE', role: 'TEAM_LEAD', subjectUserId: B.id, assigneeUserId: A.id } });
    const pre = await w.svc.archivePreflight(A.id, w.admin);
    expect(pre.blockers).toEqual(expect.objectContaining({ OPEN_REPORTING_LINES: 1 }));
    expect(pre.canArchive).toBe(false);
    await w.prisma.hierarchyAssignment.update({ where: { id: row.id }, data: { effectiveTo: NOW } });
    expect((await w.svc.archivePreflight(A.id, w.admin)).blockers.OPEN_REPORTING_LINES).toBeUndefined();
  });

  it('archives a person with rows in every Phase 1 table, then Permanent Delete runs every §8.1 handler under the real triggers', async () => {
    const A = w.seed.employees.A;
    const B = w.seed.employees.B;
    const rows = await givePhase1Rows(w, A.id, B.id);
    const archive = await w.svc.archive(A.id, w.admin, { idempotencyKey: key() });
    expect(archive.state).toBe('COMPLETED');
    const snapshot = await w.prisma.userArchiveSnapshot.findFirstOrThrow({ where: { userId: A.id } });
    expect(snapshot.status).toBe('VERIFIED');

    // The workbook carries the new sheets, completely (F&F included).
    const wb = new Workbook();
    await wb.xlsx.load(w.drive.files.get(snapshot.workbookFileId!)!.bytes as any);
    const names = wb.worksheets.map((s) => s.name);
    for (const sheet of ['Exit and F&F', 'Employment Periods', 'Setup Health', 'Reporting Lines', 'Routing History', 'Transfers']) expect(names).toContain(sheet);

    // An attempt on A's own earlier (archive) operation cascades with it.
    await w.prisma.lifecycleRemediationAttempt.create({ data: { id: id(), operationKind: 'LIFECYCLE', operationId: archive.operationId, lifecycleOperationId: archive.operationId, subjectUserId: A.id, attemptNo: 1, code: 'ARCHIVE_VAULT_NOT_READY', phase: 'FAILURE', outcome: 'BLOCKED', actorId: w.admin.id, remediation: {} } });
    // That attempt is bookkeeping: it does not make the verified snapshot stale.
    expect((await w.svc.deletePreflight(A.id, w.admin)).reasons).toEqual([]);

    const op = await w.svc.permanentDelete(A.id, w.admin, { idempotencyKey: key(), confirmation: `${A.id}@integration.invalid` });
    expect(['PERMANENTLY_DELETED', 'CLEANUP_PENDING']).toContain(op.state);
    const p = w.prisma;
    expect(await p.user.findUnique({ where: { id: A.id } })).toBeNull();

    // Own rows are gone, children included.
    expect(await p.exitCase.count({ where: { userId: A.id } })).toBe(0);
    expect(await p.fnfAdjustment.count({ where: { subjectUserId: A.id } })).toBe(0);
    expect(await p.employmentPeriod.count({ where: { userId: A.id } })).toBe(0);
    expect(await p.userSetupIssue.count({ where: { userId: A.id } })).toBe(0);
    expect(await p.departmentTransfer.count({ where: { userId: A.id } })).toBe(0);
    expect(await p.departmentTransferImpact.count()).toBe(0);
    expect(await p.hierarchyAssignment.count({ where: { OR: [{ subjectUserId: A.id }, { assigneeUserId: A.id }] } })).toBe(0);
    expect(await p.lifecycleRemediationAttempt.count({ where: { subjectUserId: A.id } })).toBe(0);
    expect(await p.lifecycleRemediationAttempt.count({ where: { operationId: archive.operationId } })).toBe(0);

    // Routing snapshots are never deleted: only the reference is cleared (E4).
    const own = await p.routingSnapshot.findUniqueOrThrow({ where: { id: rows.ownRouting.id } });
    expect(own).toEqual(expect.objectContaining({ subjectUserId: null, resolvedApproverId: w.admin.id, tier: 'EMPLOYEE_TL' }));
    const other = await p.routingSnapshot.findUniqueOrThrow({ where: { id: rows.otherRouting.id } });
    expect(other).toEqual(expect.objectContaining({ subjectUserId: B.id, resolvedApproverId: null, createdById: null }));

    // Shared records keep a valid actor (v2.3 REASSIGN) or a cleared optional one.
    const released = await p.userLegalHold.findUniqueOrThrow({ where: { id: rows.releasedHold.id } });
    expect(released).toEqual(expect.objectContaining({ status: 'RELEASED', requestedById: w.admin.id, placedById: DELETED_ACCOUNT.id, releasedById: DELETED_ACCOUNT.id }));
    expect((await p.userLegalHold.findUniqueOrThrow({ where: { id: rows.withdrawnHold.id } })).withdrawnById).toBe(DELETED_ACCOUNT.id);
    expect(await p.fnfAdjustment.findUniqueOrThrow({ where: { id: rows.otherAdj.id } })).toEqual(expect.objectContaining({ approvedById: DELETED_ACCOUNT.id, recordedById: w.admin.id, amount: expect.anything() }));
    expect(await p.lifecycleRemediationAttempt.count({ where: { operationId: rows.otherOp.id, actorId: DELETED_ACCOUNT.id } })).toBe(1);
    expect((await p.exitCase.findUniqueOrThrow({ where: { id: rows.otherCase.id } })).createdById).toBeNull();
    expect(await p.exitClearanceItem.count({ where: { exitCaseId: rows.otherCase.id, ownerId: null } })).toBe(1);
    expect(await p.departmentTransfer.count({ where: { userId: B.id, actorId: DELETED_ACCOUNT.id } })).toBe(1);
    expect(await p.leaveRequest.count({ where: { userId: B.id, fundingChangedById: null, fundingChangeReason: 'Moved to casual' } })).toBe(1);

    // No Phase 1 column still names the deleted person.
    const leftovers: { n: bigint }[] = await p.$queryRawUnsafe(`
      SELECT (
        (SELECT count(*) FROM employment_periods WHERE $1 IN ("userId", "createdById")) +
        (SELECT count(*) FROM user_setup_issues WHERE $1 IN ("userId", "acknowledgedById", "resolvedById", "waivedById")) +
        (SELECT count(*) FROM hierarchy_assignments WHERE $1 IN ("subjectUserId", "assigneeUserId", "createdById")) +
        (SELECT count(*) FROM routing_snapshots WHERE $1 IN ("subjectUserId", "resolvedApproverId", "createdById")) +
        (SELECT count(*) FROM policy_health_issues WHERE "resolvedById" = $1) +
        (SELECT count(*) FROM punch_evidence_reviews WHERE "reviewedById" = $1) +
        (SELECT count(*) FROM department_transfers WHERE $1 IN ("userId", "actorId")) +
        (SELECT count(*) FROM exit_cases WHERE $1 IN ("userId", "createdById", "withdrawnById")) +
        (SELECT count(*) FROM exit_clearance_items WHERE $1 IN ("ownerId", "completedById")) +
        (SELECT count(*) FROM fnf_settlements WHERE "releasedById" = $1) +
        (SELECT count(*) FROM fnf_adjustments WHERE $1 IN ("subjectUserId", "approvedById", "recordedById")) +
        (SELECT count(*) FROM lifecycle_remediation_attempts WHERE $1 IN ("subjectUserId", "actorId")) +
        (SELECT count(*) FROM leave_requests WHERE "fundingChangedById" = $1) +
        (SELECT count(*) FROM user_legal_holds WHERE $1 IN ("userId", "requestedById", "placedById", "rejectedById", "withdrawnById", "releasedById"))
      ) AS n`, A.id);
    expect(Number(leftovers[0].n)).toBe(0);
    // The receipt counts the Phase 1 handlers it ran.
    const receipt = await p.userDeletionReceipt.findFirstOrThrow({ where: { operationId: op.operationId } });
    expect(Object.keys(receipt.counts as any)).toEqual(expect.arrayContaining(['ExitCase.userId', 'RoutingSnapshot.subjectUserId', 'UserLegalHold.placedById', 'FnfAdjustment.approvedById']));
  });

  it('archive with the vault not ready answers ARCHIVE_VAULT_NOT_READY from the POST, records the attempt, and changes nothing', async () => {
    const A = w.seed.employees.A;
    await givePhase1Rows(w, A.id, w.seed.employees.B.id); // history, so a backup is required
    w.env.APP_ENV = 'development';
    const pre = await w.svc.archivePreflight(A.id, w.admin);
    expect(pre.remediation?.code).toBe('ARCHIVE_VAULT_NOT_READY');
    const body = await remediationOf(w.svc.archive(A.id, w.admin, { idempotencyKey: key() }));
    expect(body).toMatchObject({ error: 'REMEDIATION', code: 'ARCHIVE_VAULT_NOT_READY', reasonCode: 'ARCHIVE_VAULT_NOT_READY' });
    expect(body.remediation).toMatchObject({ remediationClass: 'BACKEND_OPERATIONS', blockingScope: 'SUBSYSTEM', affectedUserId: A.id, retryEndpoint: 'ARCHIVE_PREFLIGHT' });
    expect(body.remediation.actions.map((a: any) => a.id)).toEqual(['RETRY_VERIFICATION', 'COPY_DIAGNOSTIC']);
    expect((await w.prisma.user.findUniqueOrThrow({ where: { id: A.id } })).isActive).toBe(true);
    const op = await w.prisma.userLifecycleOperation.findFirstOrThrow({ where: { userId: A.id, kind: 'ARCHIVE' } });
    expect((op.remediation as any).code).toBe('ARCHIVE_VAULT_NOT_READY');
    const history = await w.svc.operationAttempts(op.id);
    expect(history.attempts).toEqual([expect.objectContaining({ attemptNo: 1, code: 'ARCHIVE_VAULT_NOT_READY', phase: 'FAILURE', outcome: 'BLOCKED', actorId: w.admin.id })]);
    // Append-only at the database.
    await expect(w.prisma.lifecycleRemediationAttempt.updateMany({ where: { operationId: op.id }, data: { outcome: 'RESOLVED' } })).rejects.toBeDefined();
    await expect(w.prisma.lifecycleRemediationAttempt.deleteMany({ where: { operationId: op.id } })).rejects.toBeDefined();
  });

  it('Permanent Delete precedence on the real database: hold, then keys, then retention; the POST answers with the remediation', async () => {
    const F = w.seed.employees.F;
    await w.svc.archive(F.id, w.admin, { idempotencyKey: key() });
    await w.prisma.userLegalHold.create({ data: { id: id(), userId: F.id, reasonCode: 'LITIGATION', status: 'REQUESTED', requestedById: w.admin.id, requestedAt: NOW } });
    delete w.env.LIFECYCLE_HANDLE_ENCRYPTION_KEY;
    let pre = await w.svc.deletePreflight(F.id, w.admin);
    expect(pre.holdStatus).toBe('REQUESTED');
    expect(pre.remediation).toMatchObject({ code: 'LEGAL_HOLD_REQUESTED', title: 'Awaiting hold review', details: { holdStatus: 'REQUESTED', otherBlockers: ['LIFECYCLE_KEYS_MISSING'] } });
    expect((await w.svc.archivedStatus([F.id]))[0].holdStatus).toBe('REQUESTED');
    const body = await remediationOf(w.svc.permanentDelete(F.id, w.admin, { idempotencyKey: key(), confirmation: `${F.id}@integration.invalid` }));
    expect(body).toMatchObject({ error: 'REMEDIATION', code: 'LEGAL_HOLD_REQUESTED' });

    // Withdraw the request: keys are next.
    await w.prisma.userLegalHold.updateMany({ where: { userId: F.id }, data: { status: 'WITHDRAWN', withdrawnById: w.admin.id, withdrawnAt: NOW } });
    pre = await w.svc.deletePreflight(F.id, w.admin);
    expect(pre.holdStatus).toBeNull();
    expect(pre.remediation?.code).toBe('LIFECYCLE_KEYS_MISSING');
    expect(pre.remediation?.details?.otherBlockers).toBeUndefined();
    expect(await w.prisma.user.findUnique({ where: { id: F.id } })).not.toBeNull();
  });

  it('cleanup failures are SYSTEM_REPAIRABLE with Safe Repair, append history without any user id, and resolve on retry', async () => {
    const A = w.seed.employees.A;
    const ref = 'cloudinary:authenticated:image:apex%2Fp1-doc:png';
    w.files.objects.set(ref, Buffer.from('doc bytes'));
    await w.prisma.employeeDocument.create({ data: { userId: A.id, documentType: 'ID', fileName: 'id.png', fileUrl: ref } as any });
    await w.svc.archive(A.id, w.admin, { idempotencyKey: key() });
    w.files.failRemove = true;
    const op: any = await w.svc.permanentDelete(A.id, w.admin, { idempotencyKey: key(), confirmation: `${A.id}@integration.invalid` });
    expect(op.state).toBe('CLEANUP_PENDING');
    expect(op.remediation).toMatchObject({ code: 'CLEANUP_PENDING', remediationClass: 'SYSTEM_REPAIRABLE', canSystemRepair: true, retryEndpoint: 'LIFECYCLE_CLEANUP_RETRY', operationId: op.operationId });
    expect(op.remediation.actions.map((a: any) => a.id)).toEqual(['SAFE_REPAIR', 'COPY_DIAGNOSTIC']);
    w.files.failRemove = false;
    const done: any = await w.svc.runCleanup(op.operationId, w.admin);
    expect(done.state).toBe('PERMANENTLY_DELETED');
    const history = await w.svc.operationAttempts(op.operationId);
    expect(history.attempts.map((a: any) => [a.phase, a.outcome])).toEqual([['FAILURE', 'PENDING'], ['RESOLUTION', 'RESOLVED']]);
    expect(await w.prisma.lifecycleRemediationAttempt.count({ where: { operationId: op.operationId, subjectUserId: { not: null } } })).toBe(0);
    expect(JSON.stringify(history)).not.toContain(A.id);
  });

  it('setup health is readable by Admin, Super Admin and HR only', async () => {
    const B = w.seed.employees.B;
    await w.prisma.userSetupIssue.create({ data: { id: id(), userId: B.id, code: 'LEGACY_JOINING_DATE_MISSING', domain: 'PROFILE', severity: 'WARNING', remediationClass: 'ADMIN_FIXABLE_FRONTEND', dedupeKey: `setup:${B.id}:join` } });
    expect((await w.users.listSetupIssues(B.id, w.admin)).issues).toHaveLength(1);
    await expect(w.users.listSetupIssues(B.id, { id: 'x', role: { name: 'EMPLOYEE' }, isHR: true })).resolves.toEqual(expect.objectContaining({ userId: B.id }));
    await expect(w.users.listSetupIssues(B.id, { id: 'x', role: { name: 'MANAGER' }, isHR: false })).rejects.toBeDefined();
  });

  it('notification preferences store only validated channels', async () => {
    const B = w.seed.employees.B;
    const saved = await w.users.savePreferences(B.id, { assignedTicket: false, channels: { assignedTicket: { popup: true, push: 'yes' }, 'bad key': { popup: true } } });
    expect(saved.channels).toEqual({ assignedTicket: { popup: true } });
    expect(saved.assignedTicket).toBe(false);
  });
});
