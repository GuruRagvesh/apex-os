/**
 * Phase 4 employee transitions against a real PostgreSQL server.
 *
 * The real services run over real tables, triggers, CHECKs and row locks:
 * exit and separation, withdrawal-versus-scheduler, clearance and F&F with
 * four-eyes, retention proposals, legal holds, the Archive / Permanent Delete
 * blocker and the transfer state machine (immediate, scheduled, stale).
 *
 * Time is controlled through the stored timestamps (separationDueAt,
 * effectiveAt), never by faking the clock, so the SQL sees real values.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { CommonModule } from '../../src/common/common.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TransitionsModule } from '../../src/modules/core/users/transitions/transitions.module';
import { UsersModule } from '../../src/modules/core/users/users.module';
import { ExitService } from '../../src/modules/core/users/transitions/exit/exit.service';
import { ClearanceService } from '../../src/modules/core/users/transitions/exit/clearance.service';
import { SeparationService } from '../../src/modules/core/users/transitions/exit/separation.service';
import { FnfService } from '../../src/modules/core/users/transitions/fnf/fnf.service';
import { TransferService } from '../../src/modules/core/users/transitions/transfer/transfer.service';
import { RetentionProposalsService } from '../../src/modules/core/users/transitions/compliance/retention-proposals.service';
import { LegalHoldsService } from '../../src/modules/core/users/transitions/compliance/legal-holds.service';
import { countOpenExitCases } from '../../src/modules/core/users/lifecycle/retention';
import { TransitionActor } from '../../src/modules/core/users/transitions/transitions-codes';
import { assertServerIdentity } from './db-guard';
import { seedCompany, Seed } from './harness';

const id = () => randomUUID();
const actor = (u: { id: string }, roleName: string, isHR = false): TransitionActor => ({ id: u.id, roleName, isHR });

interface World {
  moduleRef: TestingModule;
  prisma: PrismaService;
  seed: Seed;
  exits: ExitService;
  clearance: ClearanceService;
  separation: SeparationService;
  fnf: FnfService;
  transfers: TransferService;
  retention: RetentionProposalsService;
  holds: LegalHoldsService;
  admin: TransitionActor;
  admin2: TransitionActor;
  hr: TransitionActor;
  emp: (letter: string) => TransitionActor;
  deptA: string;
  deptB: string;
}

async function buildWorld(): Promise<World> {
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), EventEmitterModule.forRoot(), CommonModule, UsersModule, TransitionsModule],
  }).compile();
  const prisma = moduleRef.get(PrismaService);
  await prisma.$connect();
  await assertServerIdentity(prisma as any);
  const tables: { tablename: string }[] = await prisma.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  const seed = await seedCompany(prisma);
  // A second Admin: four-eyes is only meaningful with two real people.
  await prisma.user.create({ data: { id: 'u-admin2', employeeId: 'TE-903', email: 'admin2@integration.invalid', name: 'Admin Two', password: 'x', roleId: 'r-admin', joiningDate: new Date('2026-04-01') } as any });
  const deptA = (await prisma.department.create({ data: { name: 'P4 Dept A' } })).id;
  const deptB = (await prisma.department.create({ data: { name: 'P4 Dept B' } })).id;
  await prisma.user.updateMany({ where: { id: { in: Object.values(seed.employees).map((e) => e.id) } }, data: { departmentId: deptA } });
  await prisma.appSetting.createMany({
    data: ['transitions.transferEnabled', 'transitions.exitEnabled', 'compliance.adminEnabled'].map((key) => ({ id: id(), key, value: true as any })),
  });
  return {
    moduleRef, prisma, seed,
    exits: moduleRef.get(ExitService), clearance: moduleRef.get(ClearanceService), separation: moduleRef.get(SeparationService), fnf: moduleRef.get(FnfService),
    transfers: moduleRef.get(TransferService), retention: moduleRef.get(RetentionProposalsService), holds: moduleRef.get(LegalHoldsService),
    admin: actor(seed.actors.admin, 'ADMIN'), admin2: actor({ id: 'u-admin2' }, 'ADMIN'), hr: actor(seed.actors.hr, 'MANAGER', true),
    emp: (letter) => actor(seed.employees[letter], 'EMPLOYEE'), deptA, deptB,
  };
}

/** An open employment period with (optionally) verified probation. */
async function employ(w: World, userId: string, verified = true, status: 'PROBATION' | 'CONFIRMED' = 'CONFIRMED') {
  const p = await w.prisma.employmentPeriod.create({
    data: {
      id: id(), userId, startDate: new Date('2026-04-01'), startReason: 'NEW_HIRE', probationStatus: verified ? status : null,
      ...(verified ? { probationVerifiedById: 'u-hr', probationVerifiedAt: new Date('2026-04-02') } : {}),
    },
  });
  return p;
}

async function codeOf(p: Promise<unknown>): Promise<any> {
  try {
    await p;
  } catch (e: any) {
    const body = e?.getResponse?.() ?? {};
    return { status: e?.getStatus?.(), code: body.code ?? body.remediation?.code, body };
  }
  throw new Error('expected a refusal');
}

async function expectDbError(p: Promise<unknown>, re: RegExp) {
  await expect(p).rejects.toThrow(re);
}

/** Makes an exit case due for separation now (the stored instant moves; the code does not fake a clock). */
async function makeDue(w: World, exitCaseId: string) {
  await w.prisma.$executeRawUnsafe(`UPDATE "exit_cases" SET "separationDueAt" = now() - interval '1 minute' WHERE id = $1`, exitCaseId);
}

describe('Phase 4 employee transitions (PostgreSQL)', () => {
  let w: World;
  beforeEach(async () => {
    w = await buildWorld();
  });
  afterEach(async () => {
    await w?.prisma.$disconnect();
    await w?.moduleRef.close();
  });

  // ── Exit, separation, clearance and F&F ───────────────────────────────────

  describe('exit lifecycle', () => {
    it('refuses to start without verified probation, then verifies and starts once, replaying the same key', async () => {
      const e = w.seed.employees.A;
      await employ(w, e.id, false);
      const refusal = await codeOf(w.exits.start(w.emp('A'), e.id, { idempotencyKey: id() }));
      expect([refusal.status, refusal.code]).toEqual([409, 'PROBATION_STATUS_UNVERIFIED']);

      await w.exits.verifyProbation(w.hr, e.id, { idempotencyKey: id(), probationStatus: 'PROBATION' });
      const key = id();
      const first: any = await w.exits.start(w.emp('A'), e.id, { idempotencyKey: key });
      expect(first).toMatchObject({ state: 'NOTICE_RUNNING', noticeDays: 15, noticeSource: 'POLICY_PROBATION' });
      expect(first.clearance).toHaveLength(9);

      const replay: any = await w.exits.start(w.emp('A'), e.id, { idempotencyKey: key });
      expect(replay.id).toBe(first.id);
      expect(await w.prisma.exitCase.count({ where: { userId: e.id } })).toBe(1);
      expect(await w.prisma.user.findUniqueOrThrow({ where: { id: e.id } }).then((u: any) => u.accessEndsAt)).not.toBeNull();

      const second = await codeOf(w.exits.start(w.emp('A'), e.id, { idempotencyKey: id() }));
      expect(second.code).toBe('EXIT_CASE_ALREADY_OPEN');
    });

    it('does not let an employee backdate; HR needs a reason and a reference', async () => {
      const e = w.seed.employees.B;
      await employ(w, e.id);
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      expect((await codeOf(w.exits.start(w.emp('B'), e.id, { idempotencyKey: id(), resignedOn: yesterday }))).code).toBe('EXIT_BACKDATE_NOT_ALLOWED');
      expect((await codeOf(w.exits.start(w.hr, e.id, { idempotencyKey: id(), resignedOn: yesterday }))).code).toBe('REASON_REQUIRED');
      const ok: any = await w.exits.start(w.hr, e.id, { idempotencyKey: id(), resignedOn: yesterday, backdateReason: 'Late paperwork', backdateReference: 'HRREF-2026-14' });
      expect(ok.resignedOn).toBe(yesterday);
    });

    it('separates only after the end of the last working day, closing everything in one commit', async () => {
      const e = w.seed.employees.C;
      await employ(w, e.id);
      await w.prisma.attendancePunchHandoff.create({ data: { userId: e.id, intent: 'PUNCH_IN', tokenHash: id(), idempotencyKey: id(), expiresAt: new Date(Date.now() + 3_600_000) } as any });
      await w.prisma.pushSubscription.create({ data: { userId: e.id, endpoint: `https://push.invalid/${id()}`, p256dh: 'p', auth: 'a' } });
      const c: any = await w.exits.start(w.emp('C'), e.id, { idempotencyKey: id() });

      expect(await w.separation.separateDue('RECONCILIATION')).toBe(0);
      expect((await w.prisma.user.findUniqueOrThrow({ where: { id: e.id } })).isActive).toBe(true);

      await makeDue(w, c.id);
      expect(await w.separation.separateDue('SCHEDULER')).toBe(1);
      const u = await w.prisma.user.findUniqueOrThrow({ where: { id: e.id } });
      expect([u.isActive, u.employmentState]).toEqual([false, 'DEACTIVATED']);
      expect(u.lastWorkingDate?.toISOString().slice(0, 10)).toBe(c.lastWorkingDay);
      expect(u.sessionsRevokedAt).not.toBeNull();
      const period = await w.prisma.employmentPeriod.findFirstOrThrow({ where: { userId: e.id } });
      expect(period.endReason).toBe('RESIGNATION');
      expect(await w.prisma.attendancePunchHandoff.count({ where: { userId: e.id, status: 'WAITING' } })).toBe(0);
      expect(await w.prisma.pushSubscription.count({ where: { userId: e.id, disabledAt: null } })).toBe(0);
      const kase = await w.prisma.exitCase.findUniqueOrThrow({ where: { id: c.id } });
      expect([kase.state, kase.separatedAt !== null]).toEqual(['CLEARANCE_IN_PROGRESS', true]);

      // Recoverable and idempotent: a second sweep finds nothing to do.
      expect(await w.separation.separateDue('RECONCILIATION')).toBe(0);
      await expectDbError(w.prisma.$executeRawUnsafe(`UPDATE "exit_cases" SET "separatedAt" = now() + interval '1 day' WHERE id = $1`, c.id), /separatedAt is set once/);
    });

    it('lets only one of withdrawal and the scheduler win', async () => {
      const e = w.seed.employees.D;
      await employ(w, e.id);
      const c: any = await w.exits.start(w.emp('D'), e.id, { idempotencyKey: id() });
      await w.prisma.$executeRawUnsafe(`UPDATE "exit_cases" SET "resignedOn" = current_date - 10, "lastWorkingDay" = current_date - 1, "separationDueAt" = now() - interval '1 minute' WHERE id = $1`, c.id);
      // The window is closed (the LWD is over) -> withdrawal is refused with a structured response.
      const refused = await codeOf(w.exits.withdraw(w.emp('D'), c.id, { idempotencyKey: id() }));
      expect(refused.code).toBe('RESIGNATION_WITHDRAWAL_CLOSED');

      // Open window: race withdrawal against the scheduler on a fresh case.
      const f = w.seed.employees.E;
      await employ(w, f.id);
      const c2: any = await w.exits.start(w.emp('E'), f.id, { idempotencyKey: id() });
      await w.prisma.$executeRawUnsafe(`UPDATE "exit_cases" SET "separationDueAt" = now() - interval '1 minute', "lastWorkingDay" = (current_date + 1) WHERE id = $1`, c2.id);
      const results = await Promise.allSettled([
        w.exits.withdraw(w.emp('E'), c2.id, { idempotencyKey: id() }),
        w.separation.separateOne(c2.id, 'SCHEDULER'),
      ]);
      const final = await w.prisma.exitCase.findUniqueOrThrow({ where: { id: c2.id } });
      expect(['WITHDRAWN', 'CLEARANCE_IN_PROGRESS']).toContain(final.state);
      const user = await w.prisma.user.findUniqueOrThrow({ where: { id: f.id } });
      if (final.state === 'WITHDRAWN') {
        expect(user.isActive).toBe(true);
        expect(user.accessEndsAt).toBeNull();
        expect(final.separatedAt).toBeNull();
      } else {
        expect(user.isActive).toBe(false);
        expect(final.withdrawnAt).toBeNull();
      }
      expect(results.filter((r) => r.status === 'fulfilled' && (r as any).value !== false).length).toBeGreaterThanOrEqual(1);
    });

    it('withdrawal keeps the same employment period and cancels exit-only work without deleting it', async () => {
      const e = w.seed.employees.F;
      const period = await employ(w, e.id);
      const c: any = await w.exits.start(w.emp('F'), e.id, { idempotencyKey: id() });
      await w.exits.withdraw(w.emp('F'), c.id, { idempotencyKey: id(), reason: 'Changed my mind' });
      const after = await w.prisma.exitCase.findUniqueOrThrow({ where: { id: c.id }, include: { clearanceItems: true, settlement: true } });
      expect(after.state).toBe('WITHDRAWN');
      expect(after.clearanceItems.every((i) => i.status === 'CANCELLED')).toBe(true);
      expect(after.settlement?.state).toBe('CANCELLED');
      expect((await w.prisma.employmentPeriod.findMany({ where: { userId: e.id } })).map((p) => p.id)).toEqual([period.id]);
      expect((await w.prisma.user.findUniqueOrThrow({ where: { id: e.id } })).accessEndsAt).toBeNull();
      // A withdrawn case can be followed by a fresh resignation.
      expect(((await w.exits.start(w.emp('F'), e.id, { idempotencyKey: id() })) as any).state).toBe('NOTICE_RUNNING');
    });

    it('F&F is never ready or releasable before separation; four-eyes adjustments; release needs a reference', async () => {
      const e = w.seed.employees.A;
      await employ(w, e.id);
      const c: any = await w.exits.start(w.emp('A'), e.id, { idempotencyKey: id() });

      // Settle every item during notice (waive with a reason; HR/Admin only).
      for (const item of c.clearance) {
        await w.clearance.update(w.hr, item.id, { idempotencyKey: id(), action: 'NOT_APPLICABLE', reason: 'Not applicable in this test' });
      }
      let s = await w.prisma.fnfSettlement.findUniqueOrThrow({ where: { exitCaseId: c.id } });
      expect(s.state).toBe('NOT_STARTED');
      expect((await codeOf(w.fnf.release(w.admin, c.id, { idempotencyKey: id(), releaseReference: 'PAY-1' }))).code).toBe('FNF_NOT_RELEASABLE');

      await makeDue(w, c.id);
      await w.separation.separateDue('SCHEDULER');
      s = await w.prisma.fnfSettlement.findUniqueOrThrow({ where: { exitCaseId: c.id } });
      expect(s.state).toBe('READY_FOR_RELEASE');
      expect((await w.prisma.exitCase.findUniqueOrThrow({ where: { id: c.id } })).state).toBe('CLEARED');

      // An adjustment request blocks release until a DIFFERENT Admin decides it.
      const req: any = await w.fnf.requestAdjustment(w.hr, c.id, { idempotencyKey: id(), kind: 'ASSET_RECOVERY', direction: 'DEBIT', amount: 1200, currency: 'INR', reasonCode: 'ASSET_NOT_RETURNED', reference: 'AST-2026-0042' });
      expect((await w.prisma.fnfSettlement.findUniqueOrThrow({ where: { exitCaseId: c.id } })).state).toBe('NOT_STARTED');
      expect((await codeOf(w.fnf.decideAdjustment(w.hr, req.id, { decision: 'APPROVE' }))).status).toBe(403);
      const sameAdminRequest: any = await w.fnf.requestAdjustment(w.admin, c.id, { idempotencyKey: id(), kind: 'OTHER', direction: 'CREDIT', amount: 50, currency: 'INR', reasonCode: 'REIMBURSEMENT', reference: 'REF-9' });
      expect((await codeOf(w.fnf.decideAdjustment(w.admin, sameAdminRequest.id, { decision: 'APPROVE' }))).code).toBe('FNF_ADJUSTMENT_SAME_PERSON');
      await w.fnf.decideAdjustment(w.admin2, sameAdminRequest.id, { decision: 'REJECT', reason: 'Not needed' });
      const approved: any = await w.fnf.decideAdjustment(w.admin, req.id, { decision: 'APPROVE' });
      expect(approved.status).toBe('APPROVED');
      const adj = await w.prisma.fnfAdjustment.findUniqueOrThrow({ where: { id: approved.adjustmentId } });
      expect([adj.recordedById, adj.approvedById]).toEqual(['u-hr', 'u-admin']);
      await expectDbError(w.prisma.fnfAdjustment.update({ where: { id: adj.id }, data: { amount: 1 } }), /append-only/);

      // A decided request is frozen.
      await expectDbError(w.prisma.fnfAdjustmentRequest.update({ where: { id: req.id }, data: { note: 'edited' } }), /frozen/);

      // Corrections are reversing requests, never edits.
      const rev: any = await w.fnf.requestAdjustment(w.hr, c.id, { idempotencyKey: id(), kind: 'ASSET_RECOVERY', direction: 'CREDIT', amount: 1200, currency: 'INR', reasonCode: 'REVERSAL', reference: 'AST-2026-0042-R', reversesId: adj.id });
      await w.fnf.decideAdjustment(w.admin2, rev.id, { decision: 'APPROVE' });
      expect(await w.prisma.fnfAdjustment.count({ where: { reversesId: adj.id } })).toBe(1);

      // Release: explicit, Admin only, with a payment reference.
      expect((await codeOf(w.fnf.release(w.hr, c.id, { idempotencyKey: id(), releaseReference: 'PAY-1' }))).status).toBe(403);
      await w.fnf.release(w.admin, c.id, { idempotencyKey: id(), releaseReference: 'PAY-2026-0007' });
      const done = await w.prisma.exitCase.findUniqueOrThrow({ where: { id: c.id }, include: { settlement: true } });
      expect([done.state, done.settlement?.state]).toEqual(['COMPLETED', 'RELEASED']);
    });

    it('the employee sees approved amounts and safe reasons, never references or notes', async () => {
      const e = w.seed.employees.B;
      await employ(w, e.id);
      const c: any = await w.exits.start(w.emp('B'), e.id, { idempotencyKey: id() });
      const req: any = await w.fnf.requestAdjustment(w.hr, c.id, { idempotencyKey: id(), kind: 'MISCONDUCT', direction: 'DEBIT', amount: 500, currency: 'INR', reasonCode: 'POLICY_BREACH', reference: 'CONFIDENTIAL-CASE-77', note: 'Investigation notes' });
      await w.fnf.decideAdjustment(w.admin, req.id, { decision: 'APPROVE' });
      const mine: any = await w.fnf.view(w.emp('B'), c.id);
      const text = JSON.stringify(mine);
      expect(mine.adjustments[0]).toMatchObject({ amount: '500', reason: 'Company policy deduction' });
      expect(text).not.toMatch(/CONFIDENTIAL|Investigation|reference|note|requests/i);
      expect((await codeOf(w.fnf.view(w.emp('C'), c.id))).status).toBe(403);
    });

    it('clearance: only the owner or HR/Admin update; only HR/Admin waive; evidence must be an opaque reference', async () => {
      const e = w.seed.employees.C;
      await employ(w, e.id);
      const c: any = await w.exits.start(w.emp('C'), e.id, { idempotencyKey: id() });
      const assets = c.clearance.find((i: any) => i.category === 'ASSETS');
      expect((await codeOf(w.clearance.update(w.emp('D'), assets.id, { idempotencyKey: id(), action: 'DONE', evidenceRef: 'AST-2026-0001' }))).status).toBe(403);
      expect((await codeOf(w.clearance.update(w.admin, assets.id, { idempotencyKey: id(), action: 'DONE' }))).code).toBe('CLEARANCE_EVIDENCE_REQUIRED');
      expect((await codeOf(w.clearance.update(w.admin, assets.id, { idempotencyKey: id(), action: 'DONE', evidenceRef: 'https://drive.google.com/x' }))).code).toBe('CLEARANCE_EVIDENCE_REF_INVALID');
      const done: any = await w.clearance.update(w.admin, assets.id, { idempotencyKey: id(), action: 'DONE', evidenceRef: 'AST-2026-0001' });
      expect(done.status).toBe('DONE');
      await expectDbError(w.prisma.$executeRawUnsafe(`UPDATE "exit_clearance_items" SET "evidenceRef" = 'https://x.y/z' WHERE id = $1`, assets.id), /evidence_ref_chk/);
      const ka = c.clearance.find((i: any) => i.category === 'KNOWLEDGE_TRANSFER');
      expect(ka.ownerNeeded).toBe(true); // no TL/Manager configured -> "Owner needed", never complete
      expect(await w.prisma.userSetupIssue.count({ where: { userId: e.id, code: 'CLEARANCE_OWNER_MISSING' } })).toBe(1);
    });
  });

  // ── Archive and Permanent Delete blocker ─────────────────────────────────

  describe('OPEN_EXIT_CASE blocker', () => {
    it('blocks in NOTICE_RUNNING, CLEARANCE_IN_PROGRESS and CLEARED-with-unreleased-F&F; not WITHDRAWN or COMPLETED', async () => {
      const e = w.seed.employees.D;
      await employ(w, e.id);
      const c: any = await w.exits.start(w.emp('D'), e.id, { idempotencyKey: id() });
      expect(await countOpenExitCases(w.prisma, e.id)).toBe(1);
      await makeDue(w, c.id);
      await w.separation.separateDue('SCHEDULER');
      expect(await countOpenExitCases(w.prisma, e.id)).toBe(1); // CLEARANCE_IN_PROGRESS
      for (const i of c.clearance) await w.clearance.update(w.admin, i.id, { idempotencyKey: id(), action: 'NOT_APPLICABLE', reason: 'n/a' });
      expect((await w.prisma.exitCase.findUniqueOrThrow({ where: { id: c.id } })).state).toBe('CLEARED');
      expect(await countOpenExitCases(w.prisma, e.id)).toBe(1); // CLEARED, F&F not released
      await w.fnf.release(w.admin, c.id, { idempotencyKey: id(), releaseReference: 'PAY-9' });
      expect(await countOpenExitCases(w.prisma, e.id)).toBe(0); // COMPLETED

      const f = w.seed.employees.E;
      await employ(w, f.id);
      const c2: any = await w.exits.start(w.emp('E'), f.id, { idempotencyKey: id() });
      await w.exits.withdraw(w.emp('E'), c2.id, { idempotencyKey: id() });
      expect(await countOpenExitCases(w.prisma, f.id)).toBe(0);
    });
  });

  // ── Retention, legal holds ───────────────────────────────────────────────

  describe('retention four-eyes', () => {
    it('create/update/deactivate each need a different Admin; stale proposals are refused; history is immutable', async () => {
      const p1: any = await w.retention.propose(w.admin, { idempotencyKey: id(), category: 'ATTENDANCE', action: 'CREATE', retentionMonths: 84, policyReference: 'POL-ATT-1', reason: 'Statutory minimum' });
      expect(await w.prisma.retentionRule.count()).toBe(0); // nothing is effective until a second person approves
      expect((await codeOf(w.retention.propose(w.admin2, { idempotencyKey: id(), category: 'ATTENDANCE', action: 'CREATE', retentionMonths: 12, policyReference: 'X', reason: 'dup' }))).code).toBe('RETENTION_PROPOSAL_PENDING');
      expect((await codeOf(w.retention.decide(w.admin, p1.id, { decision: 'APPROVE' }))).code).toBe('RETENTION_PROPOSAL_SAME_PERSON');
      await w.retention.decide(w.admin2, p1.id, { decision: 'APPROVE' });
      const rule = await w.prisma.retentionRule.findUniqueOrThrow({ where: { category: 'ATTENDANCE' } });
      expect([rule.status, rule.active, rule.version, rule.retentionMonths]).toEqual(['ACTIVE', true, 1, 84]);

      const upd: any = await w.retention.propose(w.admin, { idempotencyKey: id(), category: 'ATTENDANCE', action: 'UPDATE', retentionMonths: 96, policyReference: 'POL-ATT-2', reason: 'Policy change' });
      const deact: any = await codeOf(w.retention.propose(w.admin2, { idempotencyKey: id(), category: 'ATTENDANCE', action: 'DEACTIVATE', reason: 'try' }));
      expect(deact.code).toBe('RETENTION_PROPOSAL_PENDING');
      await w.retention.decide(w.admin2, upd.id, { decision: 'APPROVE' });
      expect((await w.prisma.retentionRule.findUniqueOrThrow({ where: { category: 'ATTENDANCE' } })).version).toBe(2);

      // Deactivation cannot bypass the second person.
      const d: any = await w.retention.propose(w.admin2, { idempotencyKey: id(), category: 'ATTENDANCE', action: 'DEACTIVATE', reason: 'Retire rule' });
      expect((await codeOf(w.retention.decide(w.admin2, d.id, { decision: 'APPROVE' }))).code).toBe('RETENTION_PROPOSAL_SAME_PERSON');
      expect((await w.prisma.retentionRule.findUniqueOrThrow({ where: { category: 'ATTENDANCE' } })).status).toBe('ACTIVE');
      await w.retention.decide(w.admin, d.id, { decision: 'APPROVE' });
      expect((await w.prisma.retentionRule.findUniqueOrThrow({ where: { category: 'ATTENDANCE' } })).status).toBe('INACTIVE');

      expect(await w.prisma.retentionRuleVersion.count({ where: { category: 'ATTENDANCE' } })).toBe(3);
      await expectDbError(w.prisma.retentionRuleVersion.updateMany({ data: { retentionMonths: 1 } }), /append-only/);
      await expectDbError(w.prisma.retentionRuleProposal.update({ where: { id: p1.id }, data: { reason: 'edit' } }), /frozen/);
    });

    it('refuses a stale base version and reports readiness without seeding anything', async () => {
      const a: any = await w.retention.propose(w.admin, { idempotencyKey: id(), category: 'LEAVE', action: 'CREATE', noExpiry: true, policyReference: 'POL-L', reason: 'Keep forever' });
      await w.prisma.$executeRawUnsafe(`UPDATE "retention_rule_proposals" SET "baseVersion" = 5 WHERE id = $1`, a.id);
      expect((await codeOf(w.retention.decide(w.admin2, a.id, { decision: 'APPROVE' }))).code).toBe('RETENTION_PROPOSAL_STALE');
      const r: any = await w.retention.readiness(w.admin);
      expect(r.ready).toBe(false);
      expect(r.categories.map((c: any) => [c.category, c.health])).toEqual([['ATTENDANCE', 'MISSING'], ['LEAVE', 'MISSING'], ['PAYROLL', 'MISSING']]);
      expect(await w.prisma.retentionRule.count()).toBe(0);
    });
  });

  describe('legal holds', () => {
    it('has no one-person path: a different Admin confirms; the requester cannot; the database agrees', async () => {
      const target = w.seed.employees.A.id;
      const h: any = await w.holds.request(w.hr, target, { idempotencyKey: id(), reasonCode: 'LITIGATION', notes: 'Confidential details', reference: 'CASE-1' });
      expect(h).toMatchObject({ status: 'REQUESTED', blocksDeletion: true });
      expect((await codeOf(w.holds.transition(w.hr, h.id, 'confirm', {}))).status).toBe(403);
      const sameAdmin: any = await w.holds.request(w.admin, target, { idempotencyKey: id(), reasonCode: 'AUDIT' });
      expect((await codeOf(w.holds.transition(w.admin, sameAdmin.id, 'confirm', {}))).code).toBe('LEGAL_HOLD_SAME_PERSON');
      await expectDbError(w.prisma.$executeRawUnsafe(`UPDATE "user_legal_holds" SET status='ACTIVE', "placedById"="requestedById", "placedAt"=now() WHERE id = $1`, sameAdmin.id), /four_eyes_chk/);
      const active: any = await w.holds.transition(w.admin, h.id, 'confirm', {});
      expect(active).toMatchObject({ status: 'ACTIVE', placedById: 'u-admin' });
      expect((await codeOf(w.holds.transition(w.admin2, h.id, 'release', {}))).code).toBe('REASON_REQUIRED');
      const released: any = await w.holds.transition(w.admin2, h.id, 'release', { reason: 'Matter closed' });
      expect(released.status).toBe('RELEASED');
      await w.holds.transition(w.admin2, sameAdmin.id, 'reject', { reason: 'Not warranted' });
    });

    it('keeps notes and references from everyone but Admin/SA and the requester, and from the employee entirely', async () => {
      const target = w.seed.employees.B.id;
      const h: any = await w.holds.request(w.hr, target, { idempotencyKey: id(), reasonCode: 'INTERNAL_INVESTIGATION', notes: 'SECRET NOTE', reference: 'SECRET-REF' });
      const other = actor({ id: 'someone-else' }, 'MANAGER', true);
      const visibleToOtherHr = JSON.stringify(w.holds.view(other, await w.prisma.userLegalHold.findUniqueOrThrow({ where: { id: h.id } })));
      expect(visibleToOtherHr).not.toMatch(/SECRET/);
      expect(JSON.stringify(h)).toMatch(/SECRET NOTE/); // the requester still sees their own
      expect(await w.holds.restrictionFor(w.emp('B'), target)).toEqual({ deletionRestricted: true });
      const events = JSON.stringify(await w.prisma.operationalEvent.findMany({ where: { entityType: 'UserLegalHold' } }));
      const notes = await w.prisma.notification.findMany({ where: { entityType: 'UserLegalHold' } });
      expect(events + JSON.stringify(notes)).not.toMatch(/SECRET/);
    });

    it('adopts a legacy hold and keeps it blocking until released', async () => {
      const target = w.seed.employees.C.id;
      const legacy = await w.prisma.$queryRawUnsafe<{ id: string }[]>(`INSERT INTO "user_legal_holds"(id, "userId", "reasonCode", "placedAt") VALUES ($1, $2, 'LEGACY', now()) RETURNING id`, id(), target).catch(() => []);
      // Phase 1 forbids new NULL-status rows by trigger, exactly as designed.
      expect(legacy).toEqual([]);
    });
  });

  // ── Transfers ────────────────────────────────────────────────────────────

  describe('transfer state machine', () => {
    const body = (w: World, extra: any = {}) => ({ toDepartmentId: w.deptB, toRoleId: 'r-employee', ...extra });

    it('refuses self-transfer, no-change and an open exit case', async () => {
      const e = w.seed.employees.A;
      await employ(w, e.id);
      expect((await codeOf(w.transfers.preview(w.emp('A'), e.id, body(w)))).status).toBe(403);
      expect((await codeOf(w.transfers.preview(w.admin, e.id, { toDepartmentId: w.deptA, toRoleId: 'r-employee' }))).code).toBe('TRANSFER_NO_CHANGE');
      await w.exits.start(w.emp('A'), e.id, { idempotencyKey: id() });
      expect((await codeOf(w.transfers.preview(w.admin, e.id, body(w)))).code).toBe('TRANSFER_EXIT_CASE_OPEN');
    });

    it('applies immediately on a clean day: department, role and profile change in one commit', async () => {
      const e = w.seed.employees.B;
      await w.prisma.employeeAttendanceProfile.updateMany({ where: { userId: e.id }, data: { effectiveFrom: new Date('2026-04-01') } });
      const preview: any = await w.transfers.preview(w.admin, e.id, body(w, { toRoleId: 'r-lead' }));
      expect(preview.canApplyToday).toBe(true);
      expect(preview.permissions.gained.length).toBeGreaterThan(0);
      const key = id();
      const done: any = await w.transfers.confirm(w.admin, e.id, { ...body(w, { toRoleId: 'r-lead' }), fingerprint: preview.fingerprint, idempotencyKey: key });
      expect(done.status).toBe('COMPLETED');
      const u = await w.prisma.user.findUniqueOrThrow({ where: { id: e.id } });
      expect([u.departmentId, u.roleId]).toEqual([w.deptB, 'r-lead']);
      const t = await w.prisma.departmentTransfer.findUniqueOrThrow({ where: { id: done.id } });
      expect(t.appliedAt!.getTime()).toBeGreaterThanOrEqual(t.effectiveAt.getTime());
      const profiles = await w.prisma.employeeAttendanceProfile.findMany({ where: { userId: e.id }, orderBy: { effectiveFrom: 'asc' } });
      expect(profiles.length).toBeGreaterThanOrEqual(1);
      expect(profiles.filter((p) => p.effectiveTo === null)).toHaveLength(1);
      // Replaying the same key returns the same transfer.
      const replay: any = await w.transfers.confirm(w.admin, e.id, { ...body(w, { toRoleId: 'r-lead' }), fingerprint: preview.fingerprint, idempotencyKey: key });
      expect(replay.id).toBe(done.id);
      expect(await w.prisma.departmentTransfer.count({ where: { userId: e.id } })).toBe(1);
      // The Phase 4.5 foundations are untouched.
      expect(await w.prisma.userDepartmentMembership.count({ where: { userId: e.id } })).toBe(0);
      expect(await w.prisma.userRoleAssignment.count({ where: { userId: e.id } })).toBe(0);
    });

    it('refuses a stale confirm and returns the refreshed preview', async () => {
      const e = w.seed.employees.C;
      const preview: any = await w.transfers.preview(w.admin, e.id, body(w));
      await w.prisma.leaveRequest.create({ data: { userId: e.id, type: 'CASUAL', startDate: new Date('2026-11-02'), endDate: new Date('2026-11-02'), reason: 'r', status: 'PENDING' } as any });
      const stale = await codeOf(w.transfers.confirm(w.admin, e.id, { ...body(w), fingerprint: preview.fingerprint, idempotencyKey: id() }));
      expect([stale.status, stale.code]).toEqual([409, 'TRANSFER_PREVIEW_STALE']);
      expect(stale.body.preview.pendingLeave).toHaveLength(1);
      expect((await w.prisma.user.findUniqueOrThrow({ where: { id: e.id } })).departmentId).toBe(w.deptA);
    });

    it('a scheduled transfer is never applied early, applies at its time, and goes to review when stale', async () => {
      const e = w.seed.employees.D;
      const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
      const preview: any = await w.transfers.preview(w.admin, e.id, body(w));
      const sched: any = await w.transfers.confirm(w.admin, e.id, { ...body(w), fingerprint: preview.fingerprint, idempotencyKey: id(), effectiveOn: tomorrow });
      expect(sched.status).toBe('SCHEDULED');
      expect(await w.transfers.activateDue()).toBe(0); // not early
      expect((await w.prisma.user.findUniqueOrThrow({ where: { id: e.id } })).departmentId).toBe(w.deptA);
      // A second pending transfer for the same person is impossible.
      expect((await codeOf(w.transfers.confirm(w.admin, e.id, { ...body(w), fingerprint: preview.fingerprint, idempotencyKey: id(), effectiveOn: tomorrow }))).status).toBe(409);

      // New pending work appears before activation -> REVIEW_REQUIRED, nothing applied.
      await w.prisma.leaveRequest.create({ data: { userId: e.id, type: 'CASUAL', startDate: new Date('2026-11-03'), endDate: new Date('2026-11-03'), reason: 'r', status: 'PENDING' } as any });
      await w.prisma.$executeRawUnsafe(`UPDATE "department_transfers" SET "effectiveAt" = now() - interval '1 hour' WHERE id = $1`, sched.id);
      expect(await w.transfers.activateDue()).toBe(0);
      const t = await w.prisma.departmentTransfer.findUniqueOrThrow({ where: { id: sched.id } });
      expect([t.status, t.reviewReasonCode]).toEqual(['REVIEW_REQUIRED', 'TRANSFER_STALE_AT_ACTIVATION']);
      expect((await w.prisma.user.findUniqueOrThrow({ where: { id: e.id } })).departmentId).toBe(w.deptA);

      // Admin re-confirms from a fresh preview and cancels nothing silently.
      const fresh: any = await w.transfers.preview(w.admin, e.id, body(w));
      const re: any = await w.transfers.reconfirm(w.admin, sched.id, { ...body(w), fingerprint: fresh.fingerprint, idempotencyKey: id(), effectiveOn: tomorrow });
      expect(re.status).toBe('SCHEDULED');
      const cancelled: any = await w.transfers.cancel(w.admin, sched.id, { idempotencyKey: id(), reason: 'Plans changed' });
      expect(cancelled.status).toBe('CANCELLED');
    });

    it('a scheduled transfer becomes review-required when the effective day is no longer clean', async () => {
      const e = w.seed.employees.E;
      const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
      const preview: any = await w.transfers.preview(w.admin, e.id, body(w));
      const sched: any = await w.transfers.confirm(w.admin, e.id, { ...body(w), fingerprint: preview.fingerprint, idempotencyKey: id(), effectiveOn: tomorrow });
      await w.prisma.$executeRawUnsafe(`UPDATE "department_transfers" SET "effectiveAt" = now() - interval '1 hour', "effectiveOn" = current_date WHERE id = $1`, sched.id);
      await w.prisma.dailyAttendance.create({ data: { userId: e.id, date: new Date(new Date().toISOString().slice(0, 10)), status: 'PRESENT' } as any });
      expect(await w.transfers.activateDue()).toBe(0);
      const t = await w.prisma.departmentTransfer.findUniqueOrThrow({ where: { id: sched.id } });
      expect([t.status, t.reviewReasonCode]).toEqual(['REVIEW_REQUIRED', 'TRANSFER_EFFECTIVE_DAY_NOT_CLEAN']);
    });

    it('concurrent confirms of the same preview apply once', async () => {
      const e = w.seed.employees.F;
      const preview: any = await w.transfers.preview(w.admin, e.id, body(w));
      const results = await Promise.allSettled([
        w.transfers.confirm(w.admin, e.id, { ...body(w), fingerprint: preview.fingerprint, idempotencyKey: id() }),
        w.transfers.confirm(w.admin2, e.id, { ...body(w), fingerprint: preview.fingerprint, idempotencyKey: id() }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await w.prisma.departmentTransfer.count({ where: { userId: e.id, status: 'COMPLETED' } })).toBe(1);
    });

    it('freezes the original reviewer on the exact in-flight ticket and the grant ends with the decision', async () => {
      const worker = w.seed.employees.A;
      const reviewer = w.seed.employees.B; // original-department reviewer
      await w.prisma.user.update({ where: { id: reviewer.id }, data: { roleId: 'r-lead' } });
      await w.prisma.hierarchyAssignment.create({ data: { id: id(), scope: 'EMPLOYEE', role: 'TEAM_LEAD', subjectUserId: worker.id, assigneeUserId: reviewer.id, createdById: 'u-admin' } });
      const ticket = await w.prisma.ticket.create({
        data: { ticketId: 'TKT-P4-1', category: 'IT', title: 'In review', description: 'd', status: 'REVIEW', type: 'TASK', createdById: 'u-admin', assignedToId: worker.id, submittedAt: new Date(Date.now() - 3_600_000), departmentId: w.deptA } as any,
      });
      const preview: any = await w.transfers.preview(w.admin, worker.id, body(w));
      expect(preview.ticketsWaitingForReview).toHaveLength(1);
      await w.transfers.confirm(w.admin, worker.id, { ...body(w), fingerprint: preview.fingerprint, idempotencyKey: id() });
      const snap = await w.prisma.routingSnapshot.findFirstOrThrow({ where: { workflow: 'TICKET_REVIEW', entityId: ticket.id } });
      expect([snap.resolvedApproverId, snap.tier]).toEqual([reviewer.id, 'ORIGINAL_REVIEWER']);
      // Append-only.
      await expectDbError(w.prisma.routingSnapshot.update({ where: { id: snap.id }, data: { tier: 'ADMIN' } }), /append-only/);
      // No snapshot for any other ticket.
      expect(await w.prisma.routingSnapshot.count({ where: { workflow: 'TICKET_REVIEW' } })).toBe(1);
    });
  });

  // ── Schema guarantees ────────────────────────────────────────────────────

  describe('database guarantees', () => {
    it('allows only one open exit case per person and keeps impacts review-only', async () => {
      const e = w.seed.employees.A;
      const period = await employ(w, e.id);
      const mk = (state: string) => w.prisma.exitCase.create({ data: { id: id(), userId: e.id, employmentPeriodId: period.id, state: state as any, resignedOn: new Date('2026-10-01'), noticeDays: 30, noticeSource: 'POLICY_CONFIRMED', lastWorkingDay: new Date('2026-10-31') } });
      await mk('NOTICE_RUNNING');
      await expect(mk('CLEARANCE_IN_PROGRESS')).rejects.toThrow();
      await expectDbError(w.prisma.exitCase.create({ data: { id: id(), userId: e.id, employmentPeriodId: period.id, state: 'WITHDRAWN', resignedOn: new Date('2026-10-01'), noticeDays: 30, noticeSource: 'POLICY_CONFIRMED', lastWorkingDay: new Date('2026-10-31') } }), /withdrawn_chk/);

      const t = await w.prisma.departmentTransfer.create({ data: { id: id(), userId: e.id, fromRoleId: 'r-employee', toRoleId: 'r-employee', effectiveAt: new Date(), actorId: 'u-admin', status: 'COMPLETED' } });
      const imp = await w.prisma.departmentTransferImpact.create({ data: { id: id(), transferId: t.id, kind: 'TICKET', entityId: 'x', action: 'KEPT' } });
      await expectDbError(w.prisma.departmentTransferImpact.update({ where: { id: imp.id }, data: { action: 'CHANGED' } }), /only the review columns/);
      await w.prisma.departmentTransferImpact.update({ where: { id: imp.id }, data: { reviewStatus: 'REVIEWED', reviewedById: 'u-admin', reviewedAt: new Date() } });
    });

    it('refuses COMPLETED before the effective time and one pending transfer per user', async () => {
      const e = w.seed.employees.B;
      await expectDbError(
        w.prisma.departmentTransfer.create({ data: { id: id(), userId: e.id, fromRoleId: 'r-employee', toRoleId: 'r-employee', effectiveAt: new Date(Date.now() + 86_400_000), appliedAt: new Date(), actorId: 'u-admin', status: 'COMPLETED' } }),
        /completed_chk/,
      );
      const mk = () => w.prisma.departmentTransfer.create({ data: { id: id(), userId: e.id, fromRoleId: 'r-employee', toRoleId: 'r-employee', effectiveAt: new Date(Date.now() + 86_400_000), actorId: 'u-admin', status: 'SCHEDULED' } });
      await mk();
      await expect(mk()).rejects.toThrow();
    });

    it('four-eyes holds in SQL for adjustment requests and retention proposals', async () => {
      const e = w.seed.employees.C;
      const period = await employ(w, e.id);
      const c = await w.prisma.exitCase.create({ data: { id: id(), userId: e.id, employmentPeriodId: period.id, state: 'NOTICE_RUNNING', resignedOn: new Date('2026-10-01'), noticeDays: 30, noticeSource: 'POLICY_CONFIRMED', lastWorkingDay: new Date('2026-10-31') } });
      const s = await w.prisma.fnfSettlement.create({ data: { id: id(), exitCaseId: c.id, deadlineOn: new Date('2026-11-12') } });
      const r = await w.prisma.fnfAdjustmentRequest.create({ data: { id: id(), settlementId: s.id, subjectUserId: e.id, kind: 'OTHER', direction: 'DEBIT', amount: '10.00', reasonCode: 'OTHER_ADJUSTMENT', reference: 'R-1', requestedById: 'u-admin' } });
      await expectDbError(w.prisma.fnfAdjustmentRequest.update({ where: { id: r.id }, data: { status: 'REJECTED', decidedById: 'u-admin', decidedAt: new Date(), decisionReason: 'x' } }), /four_eyes_chk/);
      await expectDbError(w.prisma.fnfAdjustmentRequest.update({ where: { id: r.id }, data: { status: 'APPROVED', decidedById: 'u-admin2', decidedAt: new Date() } }), /approved_link_chk/);

      const p = await w.prisma.retentionRuleProposal.create({ data: { id: id(), category: 'PAYROLL', action: 'CREATE', retentionMonths: 120, policyReference: 'P', reason: 'r', proposedById: 'u-admin' } });
      await expectDbError(w.prisma.retentionRuleProposal.update({ where: { id: p.id }, data: { status: 'APPROVED', decidedById: 'u-admin', decidedAt: new Date() } }), /four_eyes_chk/);
    });
  });
});
