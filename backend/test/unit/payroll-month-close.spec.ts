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
const HR = { id: 'hr-1', name: 'Priya', role: { name: 'HR' } };
const EMPLOYEE = { id: 'emp-1', name: 'Rahul', role: { name: 'EMPLOYEE' } };

function build(over: any = {}) {
  const closes = new Map<string, any>();
  if (over.close) closes.set(over.close.month, { ...over.close });
  const audit: any[] = [];
  const sent: any[] = [];

  const prisma: any = {
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
      findUnique: jest.fn(async ({ where }: any) => closes.get(where.month) ?? null),
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
      sendPayrollAttendanceReport: jest.fn(async (...args: any[]) => {
        sent.push(args);
        if (over.sendThrows) throw new Error('resend down');
        return over.sendOk !== false;
      }),
    } as any,
  );

  return { service, prisma, closes, audit, sent };
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
  it('stores counts computed from the data', async () => {
    const { service, closes } = build();
    await service.finalize(HR, '2026-08');
    const row = closes.get('2026-08');

    expect(row.employeeCount).toBe(1);
    expect(row.unresolvedDays).toBe(0);
    expect(row.finalizedById).toBe('hr-1');
    expect(row.finalizedAt).toEqual(NOW);
  });

  it('records a hash and size of the exact workbook', async () => {
    const { service, closes } = build();
    await service.finalize(HR, '2026-08');
    const row = closes.get('2026-08');

    expect(row.reportSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.reportByteSize).toBeGreaterThan(0);
  });

  it('accepts no count, hash or total from the caller', () => {
    // finalize takes only the actor and the month. Anything else would let the
    // number that justifies a payroll run be supplied by the thing it justifies.
    expect(PayrollReportService.prototype.finalize.length).toBe(2);
    expect(PayrollReportService.prototype.send.length).toBe(2);
  });
});

describe('sending is explicit and honest', () => {
  const finalized = {
    month: '2026-08',
    status: 'FINALIZED',
    employeeCount: 1,
    unresolvedDays: 0,
    employeesWithUnresolved: 0,
    reportSha256: null,
    finalizedBy: { name: 'Priya' },
  };

  it('delivers and records the recipient at send time', async () => {
    // Copied onto the row so changing the setting next month cannot rewrite
    // who an already-sent report went to.
    const { service, closes, sent } = build({ close: finalized });
    await service.send(HR, '2026-08');
    const row = closes.get('2026-08');

    expect(sent).toHaveLength(1);
    expect(row.status).toBe('SENT');
    expect(row.recipientEmail).toBe('finance@technoedge.example');
    expect(row.deliveryStatus).toBe('SENT');
    expect(row.sentAt).toEqual(NOW);
  });

  it('never records SENT when delivery failed', async () => {
    const { service, closes } = build({ close: finalized, sendOk: false });

    await expect(service.send(HR, '2026-08')).rejects.toThrow(/could not be delivered/i);
    const row = closes.get('2026-08');

    expect(row.status).toBe('FINALIZED');
    expect(row.deliveryStatus).toBe('FAILED');
    expect(row.sentAt).toBeUndefined();
  });

  it('treats a thrown transport error as a failure, not a success', async () => {
    const { service, closes } = build({ close: finalized, sendThrows: true });

    await expect(service.send(HR, '2026-08')).rejects.toThrow(/could not be delivered/i);
    expect(closes.get('2026-08').deliveryStatus).toBe('FAILED');
  });

  it('allows a retry of the same finalized month', async () => {
    const { service, closes } = build({ close: { ...finalized, deliveryStatus: 'FAILED' } });
    await service.send(HR, '2026-08');

    expect(closes.get('2026-08').status).toBe('SENT');
  });

  it('refuses when no Finance recipient is configured', async () => {
    const { service } = build({ close: finalized, recipient: null });

    await expect(service.send(HR, '2026-08')).rejects.toThrow(/no finance recipient/i);
  });

  it('refuses an invalid configured address rather than attempting it', async () => {
    const { service } = build({ close: finalized, recipient: 'not-an-email' });

    await expect(service.send(HR, '2026-08')).rejects.toThrow(/no finance recipient/i);
  });

  it('refuses to send data that changed since finalization', async () => {
    // The stored hash is what makes this detectable. Delivering a materially
    // different file under the old approval would misrepresent what HR agreed.
    const { service } = build({
      close: { ...finalized, reportSha256: 'a'.repeat(64) },
    });

    await expect(service.send(HR, '2026-08')).rejects.toThrow(/no longer matches/i);
  });
});

describe('the Finance recipient is configuration, not source', () => {
  it('reads from the settings key', async () => {
    const { service } = build();

    expect(await service.recipient()).toBe('finance@technoedge.example');
    expect(RECIPIENT_SETTING_KEY).toBe('attendance.payrollReportRecipient');
  });

  it('validates before storing', async () => {
    const { service } = build();

    await expect(service.setRecipient(HR, 'nope')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.setRecipient(HR, 'a@b.co')).resolves.toEqual({ recipient: 'a@b.co' });
  });

  it('lets only HR change it', async () => {
    const { service } = build();

    await expect(service.setRecipient(EMPLOYEE, 'a@b.co')).rejects.toBeInstanceOf(
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

  it('records a failed send as a failure', async () => {
    const { service, audit } = build({
      close: { month: '2026-08', status: 'FINALIZED', finalizedBy: { name: 'Priya' } },
      sendOk: false,
    });

    await expect(service.send(HR, '2026-08')).rejects.toBeTruthy();
    expect(audit.map((a) => a.action)).toContain('PAYROLL_REPORT_SEND_FAILED');
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
