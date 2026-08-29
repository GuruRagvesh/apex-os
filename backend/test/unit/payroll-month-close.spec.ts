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

  it('records a fingerprint of the data and the size of the workbook', async () => {
    // reportSha256 is the V1 column name. Its value is a digest of the
    // canonical Attendance DATA, not of the .xlsx -- see the guards at the
    // bottom of this file.
    const { service, closes } = build();
    await service.finalize(HR, '2026-08');
    const row = closes.get('2026-08');

    expect(row.reportSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.reportByteSize).toBeGreaterThan(0);
  });

  it('accepts no count, fingerprint or total from the caller', () => {
    // finalize takes only the actor and the month. Anything else would let the
    // number that justifies a payroll run be supplied by the thing it justifies.
    expect(PayrollReportService.prototype.finalize.length).toBe(2);
    expect(PayrollReportService.prototype.send.length).toBe(2);
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
    // The stored data fingerprint is what makes this detectable. Delivering
    // materially different attendance under the old approval would
    // misrepresent what HR agreed to.
    const { service } = build({
      close: { ...finalized, reportSha256: 'a'.repeat(64) },
    });

    await expect(service.send(HR, '2026-08')).rejects.toThrow(/no longer matches/i);
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

describe('the stored digest is never presented as a file hash', () => {
  // Since 372909a the value is a digest of the canonical Attendance DATA, not
  // of the .xlsx: an XLSX is a ZIP whose entry headers carry clock timestamps,
  // so file digests are not reproducible and hashing them made delivery refuse
  // itself at random. The column keeps its V1 name because renaming it costs a
  // migration for no behavioural gain -- which is exactly why the name must
  // never escape this module. Somebody auditing a payroll dispute a year from
  // now must not read "sha256" and conclude it identifies the attachment.

  const read = (rel: string) =>
    require('fs').readFileSync(require('path').resolve(__dirname, '../..', rel), 'utf8');

  const SURFACE = [
    'prisma/schema.prisma',
    'src/modules/platform/attendance/reports/payroll-report.service.ts',
    'src/modules/platform/attendance/reports/payroll-workbook.ts',
    '../frontend/components/attendance/payroll-api.ts',
    '../frontend/components/attendance/PayrollMonthClose.tsx',
  ];

  it('exposes reportDataFingerprint, and never the raw column name', async () => {
    const { service } = build();
    const preview: any = await service.preview(HR, '2026-08');
    const finalized: any = await service.finalize(HR, '2026-08');
    const status: any = await service.status(HR, '2026-08');

    for (const shape of [preview, finalized, status]) {
      expect(shape.reportDataFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect('reportSha256' in shape).toBe(false);
    }
  });

  it('renames at the boundary rather than leaking the column through send', async () => {
    const { service } = build({
      close: { month: '2026-08', status: 'FINALIZED', finalizedById: 'hr-1' },
    });
    const sentRow: any = await service.send(HR, '2026-08');

    expect('reportSha256' in sentRow).toBe(false);
    expect(sentRow).toHaveProperty('reportDataFingerprint');
  });

  it('does not repeat any of the specific untrue claims it used to make', () => {
    // Literal strings, not patterns: each of these was written here once and
    // was false. A pattern broad enough to catch every phrasing also flags the
    // sentences that correctly deny the claim, so this guards the known
    // regressions and the identifier tests above guard the contract.
    const UNTRUE = [
      'Identifies the exact workbook Finance received',
      'hash of the exact workbook',
      'byte-identical workbooks',
      'the bytes are reproducible',
      'Present only so the caller can show it',
    ];

    for (const rel of SURFACE) {
      const src = read(rel);
      for (const claim of UNTRUE) {
        expect({ file: rel, claim, present: src.includes(claim) }).toEqual({
          file: rel,
          claim,
          present: false,
        });
      }
    }
  });

  it('labels it truthfully in the HR close record', () => {
    const ui = read('../frontend/components/attendance/PayrollMonthClose.tsx');

    expect(ui.includes('Attendance data fingerprint')).toBe(true);
    // "Report reference" read as though it pointed at the file itself.
    expect(ui.includes('Report reference')).toBe(false);
  });

  it('still records the real workbook size, which IS about the file', async () => {
    // reportByteSize keeps its plain meaning: the size of the .xlsx built and
    // sent. Only the digest changed meaning.
    const { service, closes } = build();
    await service.finalize(HR, '2026-08');
    const { buffer } = await service.download(HR, '2026-08');

    expect(closes.get('2026-08').reportByteSize).toBe(buffer.length);
  });
});
