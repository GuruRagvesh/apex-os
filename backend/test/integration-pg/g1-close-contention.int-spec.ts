/**
 * Items 12-13: an import correction against the payroll close.
 *
 * This is the pairing the whole month lock exists for. Finance is told a month
 * is closed and given a fingerprinted report; a correction that commits behind
 * that statement makes the report untrue with nothing to show it happened.
 *
 * NO EMAIL LEAVES THIS PROCESS. The mail transport is substituted, and the
 * substitute records what it was asked to send so a test can assert delivery
 * was attempted -- but the DATABASE path, including the lock, is entirely real.
 */

import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { CommonModule } from '../../src/common/common.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PayrollReportModule } from '../../src/modules/platform/attendance/reports/payroll-report.module';
import {
  PayrollReportService,
  RECIPIENT_SETTING_KEY,
} from '../../src/modules/platform/attendance/reports/payroll-report.service';
import { AttendanceReportService } from '../../src/modules/platform/attendance/canonical/attendance-report.service';
import { EmailService } from '../../src/modules/platform/email/email.service';
import { AttendanceImportModule } from '../../src/modules/platform/attendance/import/attendance-import.module';
import { AttendanceImportService } from '../../src/modules/platform/attendance/import/attendance-import.service';
import { AttendanceImportApplyService } from '../../src/modules/platform/attendance/import/attendance-import-apply.service';
import { DailyAttendanceEvaluatorService } from '../../src/modules/platform/attendance/evaluation/daily-attendance-evaluator.service';
import { BackupVaultService } from '../../src/modules/platform/backup-vault/backup-vault.service';
import { assertIsolatedDatabase, assertServerIdentity } from './db-guard';
import {
  RecordingVault,
  seedCompany,
  Seed,
  givenAttendance,
  csvFile,
  rawClient,
  DATE,
  MONTH,
} from './harness';
import { monthLockKey } from '../../src/modules/platform/attendance/evaluation/attendance-month-lock';

const NAMESPACE = 4271;
const KEY = monthLockKey(MONTH);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Records what would have been sent. Nothing leaves the process. */
class SilentMail {
  readonly sent: any[] = [];
  async sendPayrollAttendanceReport(...args: any[]) {
    this.sent.push(args);
    // The transport reports a classified DeliveryResult, not a boolean.
    return { outcome: 'SENT' as const, providerId: 'silent-mail' };
  }
  async sendEmail(...args: any[]) {
    this.sent.push(args);
    return true;
  }
}

describe('an import correction against the payroll close', () => {
  let moduleRef: any;
  let prisma: PrismaService;
  let imports: AttendanceImportService;
  let apply: AttendanceImportApplyService;
  let evaluator: DailyAttendanceEvaluatorService;
  let payroll: PayrollReportService;
  let mail: SilentMail;
  let observer: PrismaClient;
  let seed: Seed;

  beforeAll(async () => {
    assertIsolatedDatabase();
    mail = new SilentMail();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        CommonModule,
        AttendanceImportModule,
        PayrollReportModule,
      ],
    })
      .overrideProvider(BackupVaultService)
      .useValue(new RecordingVault())
      .overrideProvider(EmailService)
      .useValue(mail)
      .compile();

    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
    await assertServerIdentity(prisma as any);

    imports = moduleRef.get(AttendanceImportService);
    apply = moduleRef.get(AttendanceImportApplyService);
    evaluator = moduleRef.get(DailyAttendanceEvaluatorService);
    payroll = moduleRef.get(PayrollReportService);
    observer = rawClient();
    await observer.$connect();
  });

  afterAll(async () => {
    await observer?.$disconnect();
    await prisma?.$disconnect();
    await moduleRef?.close();
  });

  beforeEach(async () => {
    seed = await seedCompany(prisma);
    await prisma.appSetting.upsert({
      where: { key: RECIPIENT_SETTING_KEY },
      create: {
        key: RECIPIENT_SETTING_KEY,
        value: { to: 'finance@integration.invalid', cc: [] } as any,
      },
      update: { value: { to: 'finance@integration.invalid', cc: [] } as any },
    });
    mail.sent.length = 0;
  });

  async function lockRows() {
    return observer.$queryRawUnsafe<any[]>(
      `SELECT pid, granted FROM pg_locks
       WHERE locktype='advisory' AND classid=${NAMESPACE} AND objid=${KEY}
       ORDER BY granted DESC`,
    );
  }

  async function approvedChange(letter: string, employeeId: string) {
    await givenAttendance(prisma, seed.employees[letter].id, DATE);
    const batch = await imports.upload(seed.actors.operator, {
      buffer: csvFile([
        { employeeId, date: DATE, status: 'PRESENT', punchIn: '09:35', punchOut: '19:05' },
      ]),
      fileName: 'against-close.csv',
      mode: 'CURRENT_CORRECTION',
    });
    await apply.approve(seed.actors.hr, batch.id);
    return batch;
  }

  it('12a. finalize waits while a correction holds the month', async () => {
    const batch = await approvedChange('B', 'TE-011');

    // A correction takes the month and is held there.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let correctionDone = false;
    const correction = (async () => {
      const reg = await prisma.attendanceRegularization.create({
        data: {
          userId: seed.employees.B.id,
          date: new Date(`${DATE}T00:00:00.000Z`),
          requestType: 'MISSING_PUNCH',
          reason: 'Correction holding the month',
          requestedPunchOut: new Date('2026-08-14T13:35:00.000Z'),
          status: 'HR_APPROVED',
          hrDecisionAt: new Date(),
        } as any,
      });
      await prisma.$transaction(
        async (tx) => {
          await evaluator.reviseForApprovedCorrection(tx as any, seed.employees.B.id, DATE, reg.id, {
            authority: 'BULK_IMPORT',
          });
          await gate;
        },
        { timeout: 90000 },
      );
      correctionDone = true;
    })();

    for (let i = 0; i < 100; i++) {
      if ((await lockRows()).some((r) => r.granted)) break;
      await sleep(60);
    }
    expect((await lockRows()).some((r) => r.granted)).toBe(true);

    // Finance tries to close the month underneath it.
    let finalizeDone = false;
    const finalize = payroll.finalize(seed.actors.hr, MONTH).then(() => {
      finalizeDone = true;
    });

    // It must be waiting on the same lock, not proceeding.
    for (let i = 0; i < 100; i++) {
      if ((await lockRows()).length >= 2) break;
      await sleep(60);
    }
    const contended = await lockRows();
    expect(contended.length).toBeGreaterThanOrEqual(2);
    expect(contended.some((r) => !r.granted)).toBe(true);
    expect(finalizeDone).toBe(false);

    release();
    await correction;
    await finalize;
    expect(correctionDone).toBe(true);
    expect(finalizeDone).toBe(true);

    // The close saw the corrected value, because it could not run before it.
    const close = await prisma.attendanceMonthClose.findUnique({ where: { month: MONTH } });
    // finalize() delivers as well as closes -- it commits the close first and
    // then sends, because a nested transaction would take a second pooled
    // connection and deadlock against its own month lock. Either terminal
    // status means the month is settled.
    expect(['FINALIZED', 'SENT']).toContain(close!.status);
    const day = await prisma.dailyAttendance.findFirst({ where: { userId: seed.employees.B.id } });
    expect(day!.punchOutAt?.toISOString()).toBe('2026-08-14T13:35:00.000Z');

    // And the batch that was approved before the close is now refused.
    const out = await apply.apply(seed.actors.admin, batch.id);
    expect(out.applied).toBe(0);
  });

  it('12b. once the month is FINALIZED, a bulk import cannot write behind it', async () => {
    const batch = await approvedChange('B', 'TE-011');
    await payroll.finalize(seed.actors.hr, MONTH);

    const day = await prisma.dailyAttendance.findFirst({ where: { userId: seed.employees.B.id } });
    const revisionAtClose = day!.revision;

    const out = await apply.apply(seed.actors.admin, batch.id);
    expect(out.applied).toBe(0);
    expect(out.stale + out.failed).toBe(1);

    const after = await prisma.dailyAttendance.findFirst({ where: { userId: seed.employees.B.id } });
    expect(after!.revision).toBe(revisionAtClose);
    expect(await prisma.attendanceRegularization.count()).toBe(0);
  });

  it('12c. the other ordering: finalize holds the month, and the import waits then refuses', async () => {
    // The mirror of 12a, and the scenario the lock exists to prevent: a close
    // completing while a correction is in flight, so the correction lands
    // behind a month Finance has already been told about.
    const batch = await approvedChange('B', 'TE-011');

    // Pause finalize INSIDE its transaction, after it has taken the lock and
    // written FINALIZED but before it commits.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const realRender = (payroll as any).renderCanonical.bind(payroll);
    const spy = jest
      .spyOn(payroll as any, 'renderCanonical')
      .mockImplementation(async (month: any) => {
        const rendered = await realRender(month);
        await gate;
        return rendered;
      });

    let finalizeDone = false;
    const finalize = payroll.finalize(seed.actors.hr, MONTH).then(() => {
      finalizeDone = true;
    });

    for (let i = 0; i < 100; i++) {
      if ((await lockRows()).some((r) => r.granted)) break;
      await sleep(60);
    }
    expect((await lockRows()).some((r) => r.granted)).toBe(true);

    // The import now tries to correct a day in that month.
    let applyDone = false;
    const applying = apply.apply(seed.actors.admin, batch.id).then((r) => {
      applyDone = true;
      return r;
    });

    // It must be waiting on the same lock object, not proceeding.
    for (let i = 0; i < 100; i++) {
      if ((await lockRows()).length >= 2) break;
      await sleep(60);
    }
    const contended = await lockRows();
    expect(contended.length).toBeGreaterThanOrEqual(2);
    expect(contended.some((r) => !r.granted)).toBe(true);
    expect(applyDone).toBe(false);
    expect(finalizeDone).toBe(false);

    release();
    await finalize;
    const out = await applying;
    spy.mockRestore();

    // The close completed, and the correction that was queued behind it did
    // NOT write. It saw a settled month the moment it got the lock.
    expect(finalizeDone).toBe(true);
    const close = await prisma.attendanceMonthClose.findUnique({ where: { month: MONTH } });
    expect(['FINALIZED', 'SENT']).toContain(close!.status);

    expect(out.applied).toBe(0);
    expect(await prisma.attendanceRegularization.count()).toBe(0);
    const day = await prisma.dailyAttendance.findFirst({ where: { userId: seed.employees.B.id } });
    expect(day!.revision).toBe(1);
    expect(day!.punchOutAt?.toISOString()).toBe('2026-08-14T13:10:00.000Z');
  });

  it('13. send holds the month across its staleness check, and SENT is absolute', async () => {
    const batch = await approvedChange('B', 'TE-011');
    // finalize() delivers the report itself once the close has committed. No
    // mail leaves the process; the database path is real.
    await payroll.finalize(seed.actors.hr, MONTH);
    expect(mail.sent.length).toBe(1);

    const close = await prisma.attendanceMonthClose.findUnique({ where: { month: MONTH } });
    expect(close!.status).toBe('SENT');

    // A second, explicit send is refused rather than delivering a duplicate.
    await expect(payroll.send(seed.actors.hr, MONTH)).rejects.toThrow(/already been sent/);
    expect(mail.sent.length).toBe(1);

    // A SENT month refuses every authority, including an individual review --
    // the one settlement reason that is never relaxed.
    const out = await apply.apply(seed.actors.admin, batch.id);
    expect(out.applied).toBe(0);

    const reg = await prisma.attendanceRegularization.create({
      data: {
        userId: seed.employees.B.id,
        date: new Date(`${DATE}T00:00:00.000Z`),
        requestType: 'MISSING_PUNCH',
        reason: 'An individual review after the report went to Finance',
        requestedPunchOut: new Date('2026-08-14T13:50:00.000Z'),
        status: 'HR_APPROVED',
        hrDecisionAt: new Date(),
      } as any,
    });
    await expect(
      prisma.$transaction(async (tx) => {
        await evaluator.reviseForApprovedCorrection(tx as any, seed.employees.B.id, DATE, reg.id, {
          authority: 'INDIVIDUAL_REVIEW',
        });
      }),
    ).rejects.toThrow();

    const day = await prisma.dailyAttendance.findFirst({ where: { userId: seed.employees.B.id } });
    expect(day!.punchOutAt?.toISOString()).toBe('2026-08-14T13:10:00.000Z');
  });

  /**
   * Captures the `generatedAt` handed to the canonical report, and lets the
   * real one run underneath so the close still gets genuine totals.
   *
   * finalize() renders twice -- once inside its transaction, once more when it
   * delivers after commit -- and BOTH must describe the same instant, which is
   * the whole premise of "finalization and delivery must describe the same
   * DATA". So every captured value is asserted, not just the first.
   */
  function captureGeneratedAt() {
    const service: any = moduleRef.get(AttendanceReportService);
    const real = service.monthReport.bind(service);
    const seen: Array<Date | undefined> = [];
    const spy = jest
      .spyOn(service, 'monthReport')
      .mockImplementation(async (...args: any[]) => {
        seen.push(args[2]);
        return real(...args);
      });
    return { seen, restore: () => spy.mockRestore() };
  }

  it('12d. finalize renders with the finalizedAt it just wrote, not the epoch', async () => {
    // THE TRANSACTION-VISIBILITY REGRESSION, PINNED AGAINST REAL POSTGRESQL.
    //
    // finalize() writes the FINALIZED row through `tx` and then renders. While
    // renderCanonical() read the close through the ROOT client, that read ran
    // on a different pooled connection and could not see the uncommitted row:
    // on a first close it returned null and the report was stamped
    // 1970-01-01 by the `?? new Date(0)` fallback.
    //
    // A unit test cannot prove this. The unit suite mocks $transaction as
    // `fn => fn(prisma)`, so tx and the root client are one object and the
    // distinction does not exist. Only a real connection shows it.
    await givenAttendance(prisma, seed.employees.B.id, DATE);

    const captured = captureGeneratedAt();
    try {
      await payroll.finalize(seed.actors.hr, MONTH);
    } finally {
      captured.restore();
    }

    const close = await prisma.attendanceMonthClose.findUnique({ where: { month: MONTH } });
    expect(close?.finalizedAt).toBeTruthy();

    expect(captured.seen.length).toBeGreaterThan(0);
    for (const at of captured.seen) {
      expect(at).toBeInstanceOf(Date);
      // Said explicitly rather than left implied by the equality below: the
      // epoch is the exact value the fallback produced, and naming it here is
      // what makes a future reader understand what this test is guarding.
      expect(at!.getTime()).not.toBe(0);
      expect(at!.toISOString()).toBe(close!.finalizedAt!.toISOString());
    }
  });

  it('12e. a re-finalize after reopen renders with the new finalizedAt, not the previous one', async () => {
    // The subtler half. Here the root read DID return a row -- the previous
    // committed close -- so the report rendered with the EARLIER finalizedAt
    // and looked entirely plausible while describing the wrong close.
    await givenAttendance(prisma, seed.employees.B.id, DATE);
    await payroll.finalize(seed.actors.hr, MONTH);

    const first = await prisma.attendanceMonthClose.findUnique({ where: { month: MONTH } });
    expect(first!.finalizedAt).toBeTruthy();

    await payroll.reopen(seed.actors.hr, MONTH, 'Reopened to correct a punch for this test');

    const captured = captureGeneratedAt();
    try {
      await payroll.finalize(seed.actors.hr, MONTH);
    } finally {
      captured.restore();
    }

    const second = await prisma.attendanceMonthClose.findUnique({ where: { month: MONTH } });
    expect(second!.finalizedAt!.getTime()).toBeGreaterThan(first!.finalizedAt!.getTime());

    expect(captured.seen.length).toBeGreaterThan(0);
    for (const at of captured.seen) {
      expect(at!.toISOString()).toBe(second!.finalizedAt!.toISOString());
      expect(at!.toISOString()).not.toBe(first!.finalizedAt!.toISOString());
    }
  });

  it('13b. no message was ever handed to a real transport', () => {
    // The suite asserts delivery was ATTEMPTED, against a substitute. If the
    // real EmailService were ever wired in here, this is the guard that says so.
    expect(moduleRef.get(EmailService)).toBe(mail);
    expect(mail).toBeInstanceOf(SilentMail);
  });
});
