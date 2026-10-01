import { createHash } from 'crypto';
import {
  FINGERPRINT_VERSION,
  buildDailyRow,
  buildMonthlySummary,
  canonicalFingerprint,
  isCurrentFingerprintVersion,
  type DayInput,
  type ReportEmployee,
} from '../../src/modules/platform/attendance/canonical/attendance-report';

/**
 * THE MONTH-CLOSE FINGERPRINT.
 *
 * It answers one question: has the attendance changed since HR approved it. It
 * previously hashed payroll-aggregation's own rows -- the output of a second,
 * independent attendance engine -- so the guard protecting a finalized month
 * was anchored to a different interpretation from the one the console showed.
 *
 * Now it hashes canonical facts, and it is VERSIONED, because changing what is
 * hashed invalidates every stored value. A bare comparison would then report
 * "attendance has changed" for a month whose attendance is untouched and which
 * cannot be re-finalized.
 */

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

const EMP: ReportEmployee = {
  userId: 'u-1',
  name: 'Rahul',
  employeeId: 'TE-014',
  department: 'Engineering',
  designation: 'Software Engineer',
  employeeType: 'Full-time',
};

const fmt = (d: Date) => d.toISOString().slice(11, 16);

const day = (over: Partial<DayInput> = {}): DayInput => ({
  date: '2026-09-14',
  employment: { employedOnDate: true, reason: 'EMPLOYED' },
  workingDay: true,
  inExtract: true,
  official: null,
  rawPunches: [
    { type: 'PUNCH_IN', occurredAt: new Date('2026-09-14T04:11:00.000Z') },
    { type: 'PUNCH_OUT', occurredAt: new Date('2026-09-14T13:29:00.000Z') },
  ],
  workSessions: [],
  leave: null,
  compOff: false,
  regularization: null,
  requiredMinutes: 540,
  arrivalThreshold: '09:30',
  arrivalGraceMinutes: 0,
  arrivalMinutes: null,
  ...over,
});

const report = (days: DayInput[] = [day()], employee = EMP) => {
  const dailyRows = days.map((d) => buildDailyRow(employee, d, fmt));
  return {
    month: '2026-09',
    dailyRows,
    summaryRows: [buildMonthlySummary(employee, dailyRows)],
  };
};

const fp = (input = report()) => canonicalFingerprint(input, sha);

// ════════════════════════════════════════════════════════════════════════════
describe('3. the fingerprint is deterministic', () => {
  it('is identical for identical facts', () => {
    expect(fp()).toBe(fp());
  });

  it('is version-prefixed', () => {
    expect(fp()).toMatch(/^v2:[0-9a-f]{64}$/);
    expect(fp().startsWith(`${FINGERPRINT_VERSION}:`)).toBe(true);
  });

  it('DOES NOT READ THE CLOCK', () => {
    // A fingerprint that moved with time would make a finalized month fail its
    // own guard on the next send.
    const src = require('fs').readFileSync(
      require('path').resolve(
        __dirname,
        '../../src/modules/platform/attendance/canonical/attendance-report.ts',
      ),
      'utf8',
    );
    const fn = src.slice(src.indexOf('export function canonicalFingerprint'));
    const body = fn.slice(0, fn.indexOf(String.fromCharCode(10) + '}'));

    expect(body).not.toMatch(/new Date\(\)|Date\.now\(\)/);
  });

  it('DOES NOT DEPEND ON THE ORDER ROWS ARRIVE IN', () => {
    // The database returns employees in whatever order it likes; the hash must
    // not. Sorted internally by userId|date.
    const a = report([day({ date: '2026-09-01' }), day({ date: '2026-09-02' })]);
    const b = report([day({ date: '2026-09-02' }), day({ date: '2026-09-01' })]);

    expect(fp(a)).toBe(fp(b));
  });

  it('is not a hash of the workbook bytes', () => {
    // An XLSX is a ZIP whose entry headers carry clock timestamps, so two
    // renders of identical data differ by bytes. The question is about DATA.
    const src = require('fs').readFileSync(
      require('path').resolve(
        __dirname,
        '../../src/modules/platform/attendance/canonical/attendance-report.ts',
      ),
      'utf8',
    );
    expect(src).not.toMatch(/canonicalFingerprint[\s\S]{0,400}writeBuffer/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('4. it changes when the attendance meaningfully changes', () => {
  it.each([
    // A genuine status change. `workingDay: false` alone does NOT change it,
    // and that is correct: somebody who worked on a weekly off is still
    // Present, so no attendance outcome moved.
    ['the status', { rawPunches: [], workingDay: false }],
    ['a punch time', { rawPunches: [{ type: 'PUNCH_IN', occurredAt: new Date('2026-09-14T05:00:00.000Z') }] }],
    ['approved leave', { leave: { type: 'CASUAL', isHalfDay: false } }],
    ['a half day', { leave: { type: 'CASUAL', isHalfDay: true } }],
    ['lateness', { arrivalMinutes: 11 * 60 }],
    ['the requirement', { requiredMinutes: 480 }],
    ['employment', { employment: { employedOnDate: false, reason: 'BEFORE_JOINING' } }],
    ['a pending correction', { regularization: { status: 'PENDING' as const, invalid: false } }],
  ])('changes when %s changes', (_label, over) => {
    expect(fp(report([day(over as Partial<DayInput>)]))).not.toBe(fp());
  });

  it('changes when the month changes', () => {
    expect(fp({ ...report(), month: '2026-10' })).not.toBe(fp());
  });

  it('changes when an employee is added', () => {
    const two = report();
    const other = buildDailyRow({ ...EMP, userId: 'u-2', name: 'Anita' }, day(), fmt);

    expect(fp({ ...two, dailyRows: [...two.dailyRows, other] })).not.toBe(fp());
  });

  it('changes when a summary figure changes', () => {
    const base = report();
    const bumped = {
      ...base,
      summaryRows: [{ ...base.summaryRows[0], absentDays: base.summaryRows[0].absentDays + 1 }],
    };

    expect(fp(bumped)).not.toBe(fp(base));
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('5. formatting-only changes do not affect it', () => {
  it('IGNORES A FIELD OUTSIDE THE FROZEN KEY SET', () => {
    // The key lists are frozen rather than read from the row, so adding a
    // reporting column cannot silently invalidate every stored fingerprint and
    // make finalized months refuse to send.
    const base = report();
    const withExtra = {
      ...base,
      dailyRows: [{ ...base.dailyRows[0], someNewReportingColumn: 'anything' } as any],
    };

    expect(fp(withExtra)).toBe(fp(base));
  });

  it('ignores the raw companion values, which are presentation aids', () => {
    const base = report();
    const altered = {
      ...base,
      dailyRows: [{ ...base.dailyRows[0], raw: { ...base.dailyRows[0].raw, presenceMinutes: 1 } }],
    };

    expect(fp(altered)).toBe(fp(base));
  });

  it('ignores userId, which is identity rather than attendance', () => {
    // The row is keyed on it for sorting, but a reassigned internal id is not an
    // attendance change. employeeId -- the human identifier -- IS hashed.
    const base = report();
    const moved = { ...base, dailyRows: [{ ...base.dailyRows[0], userId: 'u-renamed' }] };

    expect(fp(moved)).toBe(fp(base));
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('6-7. legacy V1 fingerprints are recognised, not misread', () => {
  it('RECOGNISES THE CURRENT SCHEME', () => {
    expect(isCurrentFingerprintVersion(fp())).toBe(true);
    expect(isCurrentFingerprintVersion(`v2:${'f'.repeat(64)}`)).toBe(true);
  });

  it('DOES NOT MISTAKE A V1 DIGEST FOR A CURRENT ONE', () => {
    // A bare 64-hex digest is what the retired scheme stored. It cannot be
    // compared to a v2 value, and treating it as one would report an attendance
    // change that did not happen -- for a month that cannot be re-finalized.
    expect(isCurrentFingerprintVersion('a'.repeat(64))).toBe(false);
    expect(isCurrentFingerprintVersion('fp-report')).toBe(false);
    expect(isCurrentFingerprintVersion('v1:' + 'a'.repeat(64))).toBe(false);
  });

  it('treats an absent fingerprint as not-current rather than throwing', () => {
    expect(isCurrentFingerprintVersion(null)).toBe(false);
    expect(isCurrentFingerprintVersion(undefined)).toBe(false);
    expect(isCurrentFingerprintVersion('')).toBe(false);
  });

  it('A SCHEME CHANGE IS DISTINGUISHABLE FROM AN ATTENDANCE CHANGE', () => {
    // The two failures the lifecycle must never conflate. Both are "stored does
    // not equal computed", and only one of them means the attendance moved.
    const computed = fp();
    const legacyStored = 'a'.repeat(64);
    const currentButDifferent = `v2:${'b'.repeat(64)}`;

    expect(computed).not.toBe(legacyStored);
    expect(computed).not.toBe(currentButDifferent);

    // And the version check is what separates them.
    expect(isCurrentFingerprintVersion(legacyStored)).toBe(false);
    expect(isCurrentFingerprintVersion(currentButDifferent)).toBe(true);
  });
});
