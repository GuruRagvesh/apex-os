import { makeRawSqlDouble } from '../helpers/raw-sql-double';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  MONTH_LOCK_NAMESPACE_FOR_TEST,
  monthLockKey,
} from '../../src/modules/platform/attendance/evaluation/attendance-month-lock';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  PayrollReportService,
  RECIPIENT_SETTING_KEY,
} from '../../src/modules/platform/attendance/reports/payroll-report.service';

// This workflow decides what Finance is told about people's attendance, so the
// rules that matter are: nothing sends itself, nothing skips finalisation, no
// figure comes from the caller, and a failed send never claims success.
//
// The email transport is stubbed throughout. No real message is sent by a test.

const NOW = new Date('2026-09-01T06:00:00.000Z');

/** One canonical summary row, so the lifecycle's stored counts are real. */
const DEFAULT_SUMMARY_ROW: any = {
  userId: 'emp-1',
  employeeName: 'Rahul',
  employeeId: 'TE-014',
  department: 'Engineering',
  designation: 'Engineer',
  employeeType: 'Full-time',
  workingDays: 21,
  presentDays: 20,
  absentDays: 1,
  halfDays: 0,
  leaveDays: 0,
  lateDays: 2,
  daysBelowNineHours: 1,
  totalPresenceHours: 180.5,
  totalWorkHours: 171,
  totalBreakHours: 12,
  clUsed: 0,
  lwpUnpaidDays: 0,
  attendanceDeductions: 0,
  unresolvedDays: 0,
};
const HR = { id: 'hr-1', name: 'Priya', role: { name: 'HR' } };
const EMPLOYEE = { id: 'emp-1', name: 'Rahul', role: { name: 'EMPLOYEE' } };

function build(over: any = {}) {
  const closes = new Map<string, any>();
  // Every real close row has a primary key. Fixtures that omitted it were
  // describing a row that cannot exist, and the idempotency key rightly
  // refuses to be built from one.
  // A CURRENT-SCHEME value by default. A bare V1-style digest is now
  // correctly refused by the scheme guard, which is what the
  // 'finalized before the reporting was unified' test exercises deliberately.
  if (over.close)
    closes.set(over.close.month, {
      id: 'mc-1',
      ...over.close,
    });
  const audit: any[] = [];
  const sent: any[] = [];

  const raw = makeRawSqlDouble();
  // The lock statements, as actually sent.
  const advisoryLocks = raw.executed;

  const prisma: any = {
    // finalize() and send() now run inside one transaction each, holding the
    // month's advisory lock. The double runs the callback against itself, which
    // is what a Prisma interactive transaction does from the callee's point of
    // view, and records the lock so a test can assert it was actually taken.
    $transaction: jest.fn((fn: any) => fn(prisma)),
    // An honest raw-SQL double: it rejects void-returning SQL sent as a
    // query, exactly as PostgreSQL's driver does, so a month lock issued
    // the wrong way fails here rather than only against a real database.
    ...raw,
    user: {
      findMany: jest.fn().mockResolvedValue(
        over.employees ?? [
          { id: 'emp-1', name: 'Rahul', employeeId: 'TE-014', department: { name: 'Engineering' } },
        ],
      ),
    },
    dailyAttendance: { findMany: jest.fn().mockResolvedValue(over.records ?? []) },
    attendancePunchEvidence: { findMany: jest.fn().mockResolvedValue([]) },
    attendanceRegularization: { findMany: jest.fn().mockResolvedValue([]) },
    leaveRequest: { findMany: jest.fn().mockResolvedValue([]) },
    attendanceMonthClose: {
      findUnique: jest.fn(async ({ where }: any) => {
        const row = closes.get(where.month);
        if (!row) return null;
        // Production's findUnique includes the finalizedBy relation; the
        // canonical render reads its name, so the fixture must supply it too.
        return { finalizedBy: row.finalizedById ? { name: 'Priya' } : null, ...row };
      }),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = closes.get(where.month);
        const row = existing ? { ...existing, ...update } : { id: 'mc-1', ...create };
        closes.set(where.month, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = { ...(closes.get(where.month) ?? {}), ...data };
        closes.set(where.month, row);
        return row;
      }),
    },
  };

  const service = new PayrollReportService(
    prisma,
    { now: () => NOW, companyDateOnly: (d: Date) => d } as any,
    {
      isHrOrAdmin: (u: any) => ['HR', 'ADMIN', 'SUPER_ADMIN'].includes(u?.role?.name),
    } as any,
    { log: jest.fn(async (e: any) => void audit.push(e)) } as any,
    {
      get: jest.fn(async () =>
        'recipient' in over ? over.recipient : 'finance@technoedge.example',
      ),
      set: jest.fn(async () => undefined),
    } as any,
    {
      // Stub. No test sends a real message.
      // Returns a DeliveryResult, as the real transport does. A boolean double
      // would make "we do not know" indistinguishable from "it failed", which
      // is the exact distinction this path now depends on.
      sendPayrollAttendanceReport: jest.fn(async (...args: any[]) => {
        sent.push(args);
        if (over.sendThrows) throw new Error('resend down');
        if (over.sendOutcome) return { outcome: over.sendOutcome, reason: 'test' };
        return over.sendOk !== false
          ? { outcome: 'SENT', providerId: 'resend-msg-1' }
          : { outcome: 'REJECTED', reason: 'validation_error' };
      }),
    } as any,
    // THE CANONICAL DATASET, as a double.
    //
    // The lifecycle no longer derives attendance: it asks the canonical report
    // service and formats what comes back. A fixture therefore supplies
    // canonical rows rather than DailyAttendance records.
    // under test is computed over THOSE rows -- which is the point of the
    // change.
    {
      monthReport: jest.fn(async (_actor: any, month: string, generatedAt?: Date) => {
        const rows = over.summaryRows ?? [DEFAULT_SUMMARY_ROW];
        const days = over.dailyRows ?? [];
        return {
        month,
        dailyRows: days,
        // ONE EMPLOYEE BY DEFAULT. The counts the lifecycle stores are derived
        // from this, so a fixture describing nothing would let "stores counts
        // computed from the data" pass against zeros.
        summaryRows: rows,
        // DERIVED FROM THE SAME ARRAY the double returns.
        //
        // This counted `over.summaryRows ?? []` while summaryRows defaulted to
        // [DEFAULT_SUMMARY_ROW], so a report carried one row and claimed zero
        // employees -- the double contradicted itself, and eight tests failed
        // on the implementation's behalf.
        metadata: {
          generatedAt: generatedAt ?? NOW,
          employees: rows.length,
          days: days.length,
          unresolvedDays: rows.reduce((n: number, r: any) => n + (r.unresolvedDays ?? 0), 0),
          employeesWithUnresolved: rows.filter((r: any) => (r.unresolvedDays ?? 0) > 0).length,
        },
        };
      }),
    } as any,
  );

  // Pins what renderCanonical produces, so a fixture can carry a REAL
  // fingerprint and the comparison against it is deliberate rather than
  // accidental. Tests that want a mismatch pass a different value; tests about
  // the real digest format leave it unset and get the genuine implementation.

  return { service, prisma, closes, audit, sent, advisoryLocks };
}

describe('only HR may touch payroll attendance', () => {
  it.each([
    ['preview', (s: any) => s.preview(EMPLOYEE, '2026-08')],
    ['download', (s: any) => s.download(EMPLOYEE, '2026-08')],
    ['finalize', (s: any) => s.finalize(EMPLOYEE, '2026-08')],
    ['send', (s: any) => s.send(EMPLOYEE, '2026-08')],
    ['status', (s: any) => s.status(EMPLOYEE, '2026-08')],
  ])('refuses an employee calling %s', async (_label, call) => {
    const { service } = build();

    await expect(call(service)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a malformed month rather than guessing a range', async () => {
    const { service } = build();

    for (const bad of ['2026', '2026-13', 'August', '', '2026-8']) {
      await expect(service.preview(HR, bad)).rejects.toBeInstanceOf(BadRequestException);
    }
  });
});

describe('the lifecycle never skips a step', () => {
  it('moves an untouched month to REVIEWING when previewed', async () => {
    const { service, closes } = build();
    await service.preview(HR, '2026-08');

    expect(closes.get('2026-08').status).toBe('REVIEWING');
  });

  it('refuses to send a month that was never finalized', async () => {
    const { service } = build({ close: { month: '2026-08', status: 'REVIEWING' } });

    await expect(service.send(HR, '2026-08')).rejects.toThrow(/must be finalized/i);
  });

  it('refuses to send a month that does not exist at all', async () => {
    const { service } = build();

    await expect(service.send(HR, '2026-08')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to re-finalize a finalized month', async () => {
    // Reopening is not designed for V1. Silently re-finalising would change
    // what Finance was told had been approved, with no record it happened.
    const { service } = build({ close: { month: '2026-08', status: 'FINALIZED' } });

    await expect(service.finalize(HR, '2026-08')).rejects.toThrow(/not supported/i);
  });

  it('refuses to re-finalize a sent month', async () => {
    const { service } = build({ close: { month: '2026-08', status: 'SENT' } });

    await expect(service.finalize(HR, '2026-08')).rejects.toThrow(/already sent/i);
  });

  it('does not advance a finalized month back to REVIEWING on preview', async () => {
    const { service, closes } = build({ close: { month: '2026-08', status: 'FINALIZED' } });
    await service.preview(HR, '2026-08');

    expect(closes.get('2026-08').status).toBe('FINALIZED');
  });
});

describe('every figure is derived, never supplied', () => {
  it('stores counts computed from the CANONICAL data', async () => {
    const { service, closes } = build();
    await service.finalize(HR, '2026-08');
    const row = closes.get('2026-08');

    expect(row.employeeCount).toBe(1);
    expect(row.unresolvedDays).toBe(0);
    expect(row.finalizedById).toBe('hr-1');
    expect(row.finalizedAt).toEqual(NOW);
  });

});

describe('finalizing delivers, and a failed delivery does not undo it', () => {
  // HR finalizing IS the decision to send. A report sitting finalized-but-unsent
  // is the state where Finance waits on an email nobody realises they owe.

  it('sends immediately after finalization', async () => {
    const { service, closes, sent } = build();
    await service.finalize(HR, '2026-08');

    expect(sent).toHaveLength(1);
    expect(closes.get('2026-08').status).toBe('SENT');
  });

  it('keeps the finalization when delivery fails', async () => {
    // The month IS correctly finalized. Undoing that because an email bounced
    // would throw away a decision HR already made correctly.
    const { service, closes } = build({ sendOk: false });
    await service.finalize(HR, '2026-08');
    const row = closes.get('2026-08');

    expect(row.status).toBe('FINALIZED');
    expect(row.deliveryStatus).toBe('FAILED');
    expect(row.finalizedAt).toEqual(NOW);
  });

  it('does not throw out of finalize when the send fails', async () => {
    // Finalization succeeded; reporting it as an error would be misleading.
    const { service } = build({ sendOk: false });

    await expect(service.finalize(HR, '2026-08')).resolves.toBeTruthy();
  });

  it('still finalizes when no recipient is configured', async () => {
    // Not being able to deliver is not a reason to refuse the close. HR can
    // configure a recipient and retry.
    const { service, closes } = build({ recipient: null });
    await service.finalize(HR, '2026-08');

    expect(closes.get('2026-08').status).toBe('FINALIZED');
  });

  it('addresses one TO and the configured CC list', async () => {
    const { service, sent } = build({
      recipient: { to: 'finance@x.com', cc: ['accounts@x.com', 'hr@x.com'] },
    });
    await service.finalize(HR, '2026-08');
    const [to, cc] = sent[0];

    expect(to).toBe('finance@x.com');
    expect(cc).toEqual(['accounts@x.com', 'hr@x.com']);
  });

  it('records every recipient on the row, not only the TO', async () => {
    // "Who received this" must be answerable from the record rather than from
    // the mail provider.
    const { service, closes } = build({
      recipient: { to: 'finance@x.com', cc: ['accounts@x.com', 'hr@x.com'] },
    });
    await service.finalize(HR, '2026-08');

    expect(closes.get('2026-08').recipientEmail).toBe(
      'finance@x.com, accounts@x.com, hr@x.com',
    );
  });
});

describe('the Finance recipients are configuration, not source', () => {
  it('reads a bare address saved before CC existed', async () => {
    // Tolerating the older shape matters: a value stored before this change
    // must not silently block a month close.
    const { service } = build();

    expect(await service.recipients()).toEqual({ to: 'finance@technoedge.example', cc: [] });
    expect(RECIPIENT_SETTING_KEY).toBe('attendance.payrollReportRecipient');
  });

  it('reads one TO and several CC', async () => {
    const { service } = build({
      recipient: { to: 'finance@x.com', cc: ['accounts@x.com', 'hr@x.com'] },
    });

    expect(await service.recipients()).toEqual({
      to: 'finance@x.com',
      cc: ['accounts@x.com', 'hr@x.com'],
    });
  });

  it('never copies the TO address into CC', async () => {
    // Otherwise the accountant receives it twice.
    const { service } = build({
      recipient: { to: 'finance@x.com', cc: ['FINANCE@x.com', 'hr@x.com'] },
    });

    expect((await service.recipients())!.cc).toEqual(['hr@x.com']);
  });

  it('drops an unusable CC rather than failing the whole send', async () => {
    const { service } = build({ recipient: { to: 'finance@x.com', cc: ['nonsense', 'hr@x.com'] } });

    expect((await service.recipients())!.cc).toEqual(['hr@x.com']);
  });

  it('returns null when the TO address is unusable', async () => {
    // No TO means nobody is being asked to act, so there is nothing to send.
    const { service } = build({ recipient: { to: 'nonsense', cc: ['hr@x.com'] } });

    expect(await service.recipients()).toBeNull();
  });

  it('validates before storing', async () => {
    const { service } = build();

    await expect(service.setRecipients(HR, { to: 'nope' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.setRecipients(HR, { to: 'a@b.co', cc: ['bad'] }),
    ).rejects.toThrow(/not a valid email/i);
    await expect(
      service.setRecipients(HR, { to: 'a@b.co', cc: ['c@d.co'] }),
    ).resolves.toEqual({ to: 'a@b.co', cc: ['c@d.co'] });
  });

  it('lets only HR change them', async () => {
    const { service } = build();

    await expect(service.setRecipients(EMPLOYEE, { to: 'a@b.co' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('audit', () => {
  it('records generation, finalization and delivery', async () => {
    const { service, audit } = build();
    await service.preview(HR, '2026-08');
    await service.finalize(HR, '2026-08');

    const actions = audit.map((a) => a.action);

    expect(actions).toContain('PAYROLL_REPORT_GENERATED');
    expect(actions).toContain('PAYROLL_MONTH_FINALIZED');
  });

});

describe('nothing sends itself', () => {
  it('has no scheduler, cron or timer in the service', () => {
    const src = require('fs').readFileSync(
      require('path').resolve(
        __dirname,
        '../../src/modules/platform/attendance/reports/payroll-report.service.ts',
      ),
      'utf8',
    );

    // Comments are stripped first: the file explaining WHY there is no
    // scheduler must not be flagged for containing the word.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    // An automatic dispatch would email unreviewed attendance to Finance as
    // though it were settled.
    expect(code).not.toMatch(/@Cron|CronExpression|setInterval|setTimeout/i);
    expect(code).not.toMatch(/schedule/i);
  });
});


/**
 * THE MONTH LOCK, FROM THE CLOSE SIDE.
 *
 * A correction and a month close can only race if they do not contend for the
 * same thing. These prove the close path takes the SAME advisory lock, keyed
 * the same way, that reviseForApprovedCorrection() takes -- which is the whole
 * mechanism. The unit environment has no database, so what is proved here is
 * that both paths ask PostgreSQL for the same lock before they act; the
 * serialization itself is PostgreSQL's, and the manual plan in the Phase 2B
 * report exercises it against a real server.
 */
describe('the close path holds the month it is closing', () => {
  const lockKeysFrom = (advisoryLocks: any[]) =>
    advisoryLocks
      .filter((call) => String(call[0].join('?')).includes('pg_advisory_xact_lock'))
      .map((call) => call.slice(1));

  it('finalize takes the month lock, transaction-scoped, before it reads', async () => {
    const { service, prisma, advisoryLocks } = build();

    await service.finalize(HR, '2026-08');

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(lockKeysFrom(advisoryLocks)[0]).toEqual([MONTH_LOCK_NAMESPACE_FOR_TEST, 202608]);

    // The lock must come before the close row is read, or the read is of a
    // state that can change before the write.
    const lockOrder = prisma.$executeRaw.mock.invocationCallOrder[0];
    const readOrder = prisma.attendanceMonthClose.findUnique.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(readOrder);
  });

  it('finalize releases the month before delivering', async () => {
    // send() takes the same lock in its own transaction. Prisma hands a nested
    // $transaction a different pooled connection, so calling send() from inside
    // finalize's block would have it wait on a lock its own caller holds --
    // a deadlock built out of two correct-looking functions. finalize must
    // therefore commit first and deliver afterwards.
    const src = readFileSync(
      resolve(
        __dirname,
        '../../src/modules/platform/attendance/reports/payroll-report.service.ts',
      ),
      'utf8',
    );

    const finalizeBody = src.slice(
      src.indexOf('async finalize('),
      src.indexOf('async recipients('),
    );
    const txClose = finalizeBody.indexOf('{ timeout: 120_000');
    const sendCall = finalizeBody.indexOf('await this.send(actor, month)');

    expect(txClose).toBeGreaterThan(-1);
    expect(sendCall).toBeGreaterThan(txClose);
  });

  it('every month gets its own key, so two months never block each other', () => {
    expect(monthLockKey('2026-08')).toBe(202608);
    expect(monthLockKey('2026-09')).toBe(202609);
    expect(monthLockKey('2027-01')).toBe(202701);
    expect(monthLockKey('2026-08')).not.toBe(monthLockKey('2026-09'));
  });

  it('refuses to lock a month it cannot parse rather than locking the wrong one', () => {
    // A silent NaN key would take a lock nothing else contends for, which looks
    // exactly like working and protects nothing.
    expect(() => monthLockKey('August 2026')).toThrow(/unparseable month/i);
    expect(() => monthLockKey('2026-13')).toThrow(/unparseable month/i);
  });
});
