import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as ExcelJS from 'exceljs';
import { ConfigService } from '@nestjs/config';
import { TVAService } from '../../src/common/services/tva.service';
import {
  MAX_IMPORT_ROWS,
  extractRows,
  findDuplicateKeys,
  type Cell,
} from '../../src/modules/platform/attendance/import/import-rows';
import {
  normalizeDate,
  normalizeRow,
  normalizeTime,
  type EmployeeRef,
  type NormalizeContext,
} from '../../src/modules/platform/attendance/import/import-normalize';
import {
  buildErrorFileRows,
  classifyRow,
  summarise,
  type ClassifyContext,
} from '../../src/modules/platform/attendance/import/import-classify';
import {
  IMPORT_TEMPLATE_FILENAME,
  buildImportTemplate,
} from '../../src/modules/platform/attendance/import/import-template';
import { AttendanceImportService } from '../../src/modules/platform/attendance/import/attendance-import.service';

/**
 * Phase 3. Reading an attendance file and saying what it would do.
 *
 * Everything here is zero-write by construction, and the last suite proves it
 * by inspecting the source rather than trusting the intent.
 */

const tva = new TVAService({ get: () => undefined } as unknown as ConfigService);
const TODAY = '2026-09-01';

const employee = (over: Partial<EmployeeRef> = {}): EmployeeRef => ({
  id: 'u1',
  employeeId: 'TE-014',
  name: 'Ajay Singh',
  joiningDate: new Date('2025-01-06T00:00:00.000Z'),
  lastWorkingDate: null,
  ...over,
});

const context = (over: Partial<NormalizeContext> = {}): NormalizeContext => ({
  mode: 'CURRENT_CORRECTION',
  employeesByEmployeeId: new Map([['TE-014', employee()]]),
  companyToday: TODAY,
  toCompanyInstant: (d, hhmm) => tva.companyInstantAt(d, hhmm)!,
  ...over,
});

const HEADER = ['Employee ID', 'Employee Name', 'Date', 'Status', 'Punch In', 'Punch Out', 'Half Day', 'Leave Type', 'Reason'];
const REASON = 'Office internet outage — attendance could not be recorded.';

const sheet = (...rows: Cell[][]): Cell[][] => [HEADER, ...rows];
const line = (over: Partial<Record<string, Cell>> = {}): Cell[] => [
  over.id ?? 'TE-014',
  over.name ?? 'Ajay Singh',
  over.date ?? '2026-08-14',
  over.status ?? 'PRESENT',
  over.in ?? '09:38',
  over.out ?? '18:42',
  over.half ?? '',
  over.leave ?? '',
  over.reason ?? REASON,
];

const one = (over: Partial<Record<string, Cell>> = {}, ctx = context()) =>
  normalizeRow(extractRows(sheet(line(over))).rows[0], ctx);

// ════════════════════════════════════════════════════════════════════════════
describe('reading the file', () => {
  it('1. finds the header even when something sits above it', () => {
    const out = extractRows([['Attendance for August'], [], HEADER, line()]);
    expect(out.headerRow).toBe(2);
    expect(out.rows).toHaveLength(1);
    // 1-based, matching what the spreadsheet shows the operator.
    expect(out.rows[0].rowNumber).toBe(4);
  });

  it('2. refuses an empty file', () => {
    expect(extractRows([]).problems[0].code).toBe('EMPTY_FILE');
    expect(extractRows([[], ['']]).problems[0].code).toBe('EMPTY_FILE');
  });

  it('3. refuses a header with no rows under it', () => {
    expect(extractRows([HEADER]).problems[0].code).toBe('EMPTY_FILE');
  });

  it('4. refuses a file with no recognisable header', () => {
    expect(extractRows([['a', 'b'], ['c', 'd']]).problems[0].code).toBe('MISSING_HEADER');
  });

  it('5. names the columns it is missing', () => {
    const out = extractRows([['Employee ID', 'Reason'], ['TE-014', 'x']]);
    expect(out.problems[0].code).toBe('MISSING_REQUIRED_COLUMNS');
    expect(out.problems[0].message).toContain('date');
    expect(out.problems[0].message).toContain('status');
  });

  it('6. refuses a monthly-totals file by name, not as a missing column', () => {
    // "Ajay = 21 present, 2 absent" cannot become days without inventing which
    // 21 days those were. Saying "your file has no Date column" would be true
    // and useless.
    const out = extractRows([
      ['Employee ID', 'Employee Name', 'Present Days', 'Absent Days', 'Half Days'],
      ['TE-014', 'Ajay Singh', 21, 2, 1],
    ]);

    expect(out.problems[0].code).toBe('AGGREGATE_ONLY_HISTORY_UNSUPPORTED');
    expect(out.rows).toEqual([]);
  });

  it('7. skips blank lines inside the table', () => {
    expect(extractRows([HEADER, line(), [], ['', '', ''], line({ date: '2026-08-15' })]).rows).toHaveLength(2);
  });

  it('8. stops at the row limit rather than reading an unbounded file', () => {
    const many = Array.from({ length: MAX_IMPORT_ROWS + 5 }, () => line());
    const out = extractRows([HEADER, ...many]);
    expect(out.problems.some((p) => p.code === 'TOO_MANY_ROWS')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('dates are never guessed', () => {
  it('9. accepts the canonical form', () => {
    expect(normalizeDate(null, '2026-08-14').businessDate).toBe('2026-08-14');
  });

  it('10. accepts a real date cell', () => {
    expect(normalizeDate(new Date('2026-08-14T00:00:00.000Z'), '').businessDate).toBe('2026-08-14');
  });

  it('11. accepts an Excel serial', () => {
    // 46248 is 2026-08-14 on Excel's 1899-12-30 epoch.
    expect(normalizeDate(46248, '').businessDate).toBe('2026-08-14');
  });

  it('12. REFUSES an ambiguous separated date instead of picking a reading', () => {
    // 01/02/26 is 1 February here, 2 January in the US, and 26 February 2001
    // to a minority of systems. A guess produces attendance for a day the
    // employee was somewhere else, and every later check would pass.
    for (const value of ['01/02/26', '1/2/2026', '01.02.2026', '2026/02/01']) {
      const out = normalizeDate(null, value);
      expect([value, out.problem?.code]).toEqual([value, 'DATE_AMBIGUOUS']);
    }
  });

  it('13. refuses a date that does not exist', () => {
    expect(normalizeDate(null, '2026-02-30').problem?.code).toBe('DATE_UNPARSEABLE');
    expect(normalizeDate(null, 'last Tuesday').problem?.code).toBe('DATE_UNPARSEABLE');
  });

  it('14. refuses a day that has not happened', () => {
    expect(one({ date: '2026-12-01' }).problems.map((p) => p.code)).toContain('DATE_IN_FUTURE');
  });

  it('15. refuses a date outside employment', () => {
    const before = one({ date: '2024-06-03' });
    expect(before.problems.map((p) => p.code)).toContain('DATE_BEFORE_EMPLOYMENT');

    const left = context({
      employeesByEmployeeId: new Map([['TE-014', employee({ lastWorkingDate: new Date('2026-07-31T00:00:00.000Z') })]]),
    });
    expect(one({ date: '2026-08-14' }, left).problems.map((p) => p.code)).toContain('DATE_AFTER_EMPLOYMENT');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('times', () => {
  it('16. reads text and Excel fractions alike', () => {
    expect(normalizeTime(null, '09:38').hhmm).toBe('09:38');
    expect(normalizeTime(null, '9:38').hhmm).toBe('09:38');
    // 0.4 of a day is 09:36.
    expect(normalizeTime(0.4, '').hhmm).toBe('09:36');
    expect(normalizeTime(null, '').hhmm).toBeUndefined();
  });

  it('17. refuses a time that does not exist', () => {
    expect(normalizeTime(null, '25:30').problem?.code).toBe('TIME_UNPARSEABLE');
    expect(normalizeTime(null, '09:75').problem?.code).toBe('TIME_UNPARSEABLE');
    expect(normalizeTime(null, 'morning').problem?.code).toBe('TIME_UNPARSEABLE');
  });

  it('18. refuses a punch out earlier in the day than the punch in', () => {
    const codes = one({ in: '18:30', out: '09:41' }).problems.map((p) => p.code);
    expect(codes).toContain('CROSS_MIDNIGHT_UNSUPPORTED');
  });

  it('19. normalizes into COMPANY time, not UTC', () => {
    const row = one();
    // 09:38 IST is 04:08 UTC. Reading it as UTC would put the punch five and a
    // half hours out and make an on-time arrival look late.
    expect(row.proposal!.proposedPunchIn!.toISOString()).toBe('2026-08-14T04:08:00.000Z');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('identity is the Employee ID', () => {
  it('20. resolves by ID and reports a name mismatch as a warning only', () => {
    const row = one({ name: 'A. Singh' });

    expect(row.proposal!.userId).toBe('u1');
    expect(row.problems).toEqual([]);
    expect(row.warnings.map((w) => w.code)).toEqual(['EMPLOYEE_NAME_MISMATCH']);
  });

  it('21. an unknown ID is INVALID, never matched by name', () => {
    const row = one({ id: 'TE-999', name: 'Ajay Singh' });

    expect(row.proposal).toBeNull();
    expect(row.problems.map((p) => p.code)).toContain('EMPLOYEE_UNKNOWN');
  });

  it('22. two employees sharing a name is irrelevant', () => {
    const ctx = context({
      employeesByEmployeeId: new Map([
        ['TE-014', employee({ id: 'u1', employeeId: 'TE-014', name: 'Ajay Singh' })],
        ['TE-088', employee({ id: 'u2', employeeId: 'TE-088', name: 'Ajay Singh' })],
      ]),
    });

    expect(one({ id: 'TE-014' }, ctx).proposal!.userId).toBe('u1');
    expect(one({ id: 'TE-088' }, ctx).proposal!.userId).toBe('u2');
  });

  it('23. a missing ID is INVALID', () => {
    expect(one({ id: '' }).problems.map((p) => p.code)).toContain('EMPLOYEE_ID_MISSING');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('status shape', () => {
  it('24. accepts only statuses the attendance engine holds', () => {
    for (const status of ['PRESENT', 'ABSENT']) {
      expect(one({ status, in: '', out: '' }, context({ mode: 'HISTORICAL_MIGRATION' })).problems).toEqual([]);
    }
    expect(one({ status: 'WORKED_FROM_HOME' }).problems.map((p) => p.code)).toContain('STATUS_UNKNOWN');
    expect(one({ status: '' }).problems.map((p) => p.code)).toContain('STATUS_MISSING');
  });

  it('25. a half day must say which half, and only a half day may', () => {
    expect(one({ status: 'HALF_DAY', half: '' }).problems.map((p) => p.code)).toContain('HALF_DAY_SESSION_REQUIRED');
    expect(one({ status: 'HALF_DAY', half: 'MORNING' }).problems.map((p) => p.code)).toContain('HALF_DAY_SESSION_UNKNOWN');
    expect(one({ status: 'PRESENT', half: 'FIRST_HALF' }).problems.map((p) => p.code)).toContain('HALF_DAY_SESSION_UNEXPECTED');
    expect(one({ status: 'HALF_DAY', half: 'FIRST_HALF', out: '13:40' }).problems).toEqual([]);
  });

  it('26. a leave type belongs only on a leave row', () => {
    expect(one({ status: 'LEAVE', leave: 'HOLIDAY_LEAVE', in: '', out: '' }).problems.map((p) => p.code))
      .toContain('LEAVE_TYPE_UNKNOWN');
    expect(one({ status: 'PRESENT', leave: 'CASUAL' }).problems.map((p) => p.code))
      .toContain('LEAVE_TYPE_UNEXPECTED');
    expect(one({ status: 'LEAVE', leave: 'CASUAL', in: '', out: '' }).problems).toEqual([]);
  });

  it('27. every row needs a real reason', () => {
    expect(one({ reason: '' }).problems.map((p) => p.code)).toContain('REASON_TOO_SHORT');
    expect(one({ reason: 'fixed' }).problems.map((p) => p.code)).toContain('REASON_TOO_SHORT');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('historical present without punch times', () => {
  const historical = context({ mode: 'HISTORICAL_MIGRATION' });

  it('28. a historical migration may record PRESENT with no times', () => {
    const row = one({ status: 'PRESENT', in: '', out: '' }, historical);

    expect(row.problems).toEqual([]);
    expect(row.proposal!.proposedStatus).toBe('PRESENT');
    // NOT 09:30 and 18:30. The times were never kept, and inventing them would
    // manufacture an on-time arrival nobody recorded.
    expect(row.proposal!.proposedPunchIn).toBeNull();
    expect(row.proposal!.proposedPunchOut).toBeNull();
  });

  it('29. a CURRENT correction may not — the manual recovery bar applies', () => {
    const row = one({ status: 'PRESENT', in: '', out: '' });

    expect(row.problems.map((p) => p.code)).toContain('PUNCH_TIMES_REQUIRED');
    expect(row.proposal).toBeNull();
  });

  it('30. nothing in a proposal can carry evidence, whatever the file says', () => {
    const row = one({ status: 'PRESENT', in: '', out: '' }, historical);
    const keys = Object.keys(row.proposal!);

    for (const forbidden of ['latitude', 'longitude', 'accuracy', 'photo', 'device', 'deviceId']) {
      expect(keys.some((k) => k.toLowerCase().includes(forbidden))).toBe(false);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('classification', () => {
  const key = 'u1|2026-08-14';

  const classifyContext = (over: Partial<ClassifyContext> = {}): ClassifyContext => ({
    currentByKey: new Map(),
    monthStatusByMonth: new Map([['2026-08', 'OPEN']]),
    openCorrections: new Set(),
    approvedLeaveByKey: new Map(),
    duplicateRows: new Map(),
    ...over,
  });

  const current = (over: any = {}) => ({
    status: 'PRESENT',
    punchInAt: new Date('2026-08-14T04:08:00.000Z'),
    punchOutAt: new Date('2026-08-14T13:12:00.000Z'),
    evaluationState: 'CALCULATED',
    locked: false,
    hasEvidence: true,
    ...over,
  });

  it('31. no record yet is NEW', () => {
    expect(classifyRow(one(), classifyContext()).classification).toBe('NEW');
  });

  it('32. the same day already recorded is MATCH', () => {
    const out = classifyRow(one(), classifyContext({ currentByKey: new Map([[key, current()]]) }));
    expect(out.classification).toBe('MATCH');
  });

  it('33. a different punch time is CHANGE, and shows both sides', () => {
    const out = classifyRow(
      one({ in: '09:41' }),
      classifyContext({ currentByKey: new Map([[key, current()]]) }),
    );

    expect(out.classification).toBe('CHANGE');
    expect(out.current!.punchIn).toBe('2026-08-14T04:08:00.000Z');
    expect(out.proposed!.punchIn).toBe('2026-08-14T04:11:00.000Z');
  });

  it('34. PRESENT agrees with a LATE record rather than proposing to rewrite it', () => {
    // The evaluator classifies a late arrival as LATE. A spreadsheet saying
    // PRESENT is agreeing, not contradicting, and treating it as CHANGE would
    // generate thousands of proposals to rewrite records that are already right.
    const out = classifyRow(
      one(),
      classifyContext({ currentByKey: new Map([[key, current({ status: 'LATE' })]]) }),
    );
    expect(out.classification).toBe('MATCH');
  });

  it('35. A FILE WITH LESS DETAIL NEVER PROPOSES TO ERASE EVIDENCE', () => {
    // Historical files routinely say "present" and nothing else for days on
    // which Apex OS holds real punch evidence. Calling that a CHANGE would
    // propose replacing the better record with the poorer one -- thousands of
    // silent evidence deletions dressed up as a reconciliation.
    const out = classifyRow(
      one({ in: '', out: '' }, context({ mode: 'HISTORICAL_MIGRATION' })),
      classifyContext({ currentByKey: new Map([[key, current({ hasEvidence: true })]]) }),
    );

    expect(out.classification).toBe('MATCH');
    expect(out.current!.hasEvidence).toBe(true);
  });

  it('36. an invalid row is INVALID and is never compared to anything', () => {
    const out = classifyRow(one({ date: '01/02/26' }), classifyContext());
    expect(out.classification).toBe('INVALID');
    expect(out.current).toBeNull();
  });

  it.each([
    ['a locked day', { currentByKey: new Map([[key, current({ locked: true })]]) }, 'LOCKED_DAY'],
    ['a finalized day', { currentByKey: new Map([[key, current({ evaluationState: 'FINALIZED' })]]) }, 'FINALIZED_DAY'],
    ['a finalized month', { monthStatusByMonth: new Map([['2026-08', 'FINALIZED']]) }, 'FINALIZED_MONTH'],
    ['a sent month', { monthStatusByMonth: new Map([['2026-08', 'SENT']]) }, 'SENT_MONTH'],
  ])('37. %s is a CONFLICT', (_label, over, code) => {
    const out = classifyRow(one(), classifyContext(over as any));

    expect(out.classification).toBe('CONFLICT');
    expect(out.conflicts.map((c) => c.code)).toContain(code);
  });

  it('38. a REVIEWING or OPEN month is not a conflict on its own', () => {
    for (const status of ['OPEN', 'REVIEWING']) {
      const out = classifyRow(one(), classifyContext({ monthStatusByMonth: new Map([['2026-08', status]]) }));
      expect([status, out.classification]).toEqual([status, 'NEW']);
    }
  });

  it('39. a correction already under review is a CONFLICT', () => {
    const out = classifyRow(one(), classifyContext({ openCorrections: new Set([key]) }));

    expect(out.classification).toBe('CONFLICT');
    expect(out.conflicts.map((c) => c.code)).toContain('OPEN_CORRECTION');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('leave authority is never manufactured by a spreadsheet', () => {
  const key = 'u1|2026-08-14';
  const ctx = (over: Partial<ClassifyContext> = {}): ClassifyContext => ({
    currentByKey: new Map(),
    monthStatusByMonth: new Map([['2026-08', 'OPEN']]),
    openCorrections: new Set(),
    approvedLeaveByKey: new Map(),
    duplicateRows: new Map(),
    ...over,
  });

  it.each(['LEAVE', 'LWP'])('40. %s with no approved leave is a CONFLICT', (status) => {
    const row = one({ status, in: '', out: '', leave: status === 'LEAVE' ? 'CASUAL' : '' });
    const out = classifyRow(row, ctx());

    // Attendance saying LEAVE while the leave module says the leave never
    // existed is the exact divergence this import must not create.
    expect(out.classification).toBe('CONFLICT');
    expect(out.conflicts.map((c) => c.code)).toContain('MISSING_AUTHORITATIVE_LEAVE');
  });

  it('41. LEAVE backed by an approved leave proceeds', () => {
    const row = one({ status: 'LEAVE', in: '', out: '', leave: 'CASUAL' });
    const out = classifyRow(row, ctx({ approvedLeaveByKey: new Map([[key, { kind: 'PAID', leaveType: 'CASUAL' }]]) }));

    expect(out.classification).toBe('NEW');
  });

  it('42. a leave fact of NONE is no leave at all', () => {
    const row = one({ status: 'LEAVE', in: '', out: '', leave: 'CASUAL' });
    const out = classifyRow(row, ctx({ approvedLeaveByKey: new Map([[key, { kind: 'NONE' }]]) }));

    expect(out.classification).toBe('CONFLICT');
  });

  it('43. the refusal tells HR where to fix it', () => {
    const row = one({ status: 'LEAVE', in: '', out: '', leave: 'CASUAL' });
    const errors = buildErrorFileRows([classifyRow(row, ctx())]);

    expect(errors[0].errorCode).toBe('MISSING_AUTHORITATIVE_LEAVE');
    expect(errors[0].suggestedFix).toMatch(/leave migration|Record the leave/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('duplicates are never resolved by choosing one', () => {
  it('44. finds repeated employee-days', () => {
    const found = findDuplicateKeys([
      { rowNumber: 2, employeeKey: 'u1', businessDate: '2026-08-14' },
      { rowNumber: 9, employeeKey: 'u1', businessDate: '2026-08-14' },
      { rowNumber: 3, employeeKey: 'u1', businessDate: '2026-08-15' },
    ]);

    expect([...found.keys()]).toEqual(['u1|2026-08-14']);
    expect(found.get('u1|2026-08-14')).toEqual([2, 9]);
  });

  it('45. identical repeats are INVALID, not silently de-duplicated', () => {
    const out = classifyRow(one(), {
      currentByKey: new Map(),
      monthStatusByMonth: new Map(),
      openCorrections: new Set(),
      approvedLeaveByKey: new Map(),
      duplicateRows: new Map([['u1|2026-08-14', { rows: [2, 9], conflicting: false }]]),
    });

    expect(out.classification).toBe('INVALID');
    expect(out.errors.map((e) => e.code)).toContain('DUPLICATE_EMPLOYEE_DAY');
  });

  it('46. disagreeing repeats say so explicitly', () => {
    const out = classifyRow(one(), {
      currentByKey: new Map(),
      monthStatusByMonth: new Map(),
      openCorrections: new Set(),
      approvedLeaveByKey: new Map(),
      duplicateRows: new Map([['u1|2026-08-14', { rows: [2, 9], conflicting: true }]]),
    });

    expect(out.errors.map((e) => e.code)).toContain('DUPLICATE_CONFLICTING_EMPLOYEE_DAY');
    expect(out.errors.find((e) => e.code === 'DUPLICATE_CONFLICTING_EMPLOYEE_DAY')!.message).toContain('2, 9');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the summary and the error file', () => {
  const classified = (classification: any, extra: any = {}) => ({
    rowNumber: 1, classification, employeeId: 'TE-014', employeeName: 'Ajay Singh',
    businessDate: '2026-08-14', errors: [], warnings: [], conflicts: [], settlementReasons: [],
    current: null, proposed: null, ...extra,
  });

  it('47. counts every class', () => {
    const s = summarise([
      classified('NEW'), classified('NEW'), classified('MATCH'),
      classified('CHANGE'), classified('CONFLICT'), classified('INVALID'),
    ] as any);

    expect(s).toMatchObject({ totalRows: 6, newRows: 2, matchRows: 1, changeRows: 1, conflictRows: 1, invalidRows: 1 });
  });

  it('48. a batch with known problems is NOT approvable', () => {
    // One button that applies 4,000 rows while quietly skipping 30 bad ones is
    // how an operator learns months later that a fortnight went missing.
    expect(summarise([classified('NEW'), classified('MATCH')] as any).approvable).toBe(true);
    expect(summarise([classified('NEW'), classified('INVALID')] as any).approvable).toBe(false);
    expect(summarise([classified('NEW'), classified('CONFLICT')] as any).approvable).toBe(false);
    expect(summarise([]).approvable).toBe(false);
  });

  it('49. the error file carries codes beside the sentences', () => {
    const rows = buildErrorFileRows([classifyRow(one({ date: '01/02/26' }), {
      currentByKey: new Map(), monthStatusByMonth: new Map(), openCorrections: new Set(),
      approvedLeaveByKey: new Map(), duplicateRows: new Map(),
    })]);

    expect(rows[0]).toMatchObject({ errorCode: 'DATE_AMBIGUOUS', field: 'Date', value: '01/02/26' });
    // Nothing downstream should have to parse English to know what happened.
    expect(rows[0].suggestedFix).toContain('yyyy-MM-dd');
  });

  it('50. only failing rows reach the error file', () => {
    expect(buildErrorFileRows([classified('NEW'), classified('MATCH')] as any)).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the template', () => {
  const wb = () => buildImportTemplate(new Date('2026-09-01T00:00:00.000Z'));

  it('51. has the nine columns the parser reads, in order', () => {
    const sheetOne = wb().getWorksheet('Attendance Import')!;
    expect(sheetOne.getRow(1).values).toEqual([undefined, ...HEADER]);
  });

  it('52. formats the fragile columns as text', () => {
    // Excel turns 2026-08-14 into a locale-formatted serial and strips leading
    // zeros from an employee ID given the chance.
    const sheetOne = wb().getWorksheet('Attendance Import')!;
    for (const col of [1, 3, 5, 6]) expect(sheetOne.getColumn(col).numFmt).toBe('@');
  });

  it('53. explains itself on a Reference sheet', () => {
    const ref = wb().getWorksheet('Reference')!;
    const text: string[] = [];
    ref.eachRow((r) => r.eachCell((c) => text.push(String(c.value ?? ''))));
    const all = text.join(' ');

    expect(all).toContain('yyyy-MM-dd');
    expect(all).toContain('FIRST_HALF');
    expect(all).toMatch(/cannot create leave/i);
    expect(all).toMatch(/no columns for location, photo/i);
  });

  it('54. opens, and carries no formulas', async () => {
    const buffer = await wb().xlsx.writeBuffer();
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(buffer as any);

    let formulas = 0;
    for (const s of reopened.worksheets) {
      s.eachRow((r) => r.eachCell((c) => { if ((c.value as any)?.formula) formulas += 1; }));
    }
    expect(formulas).toBe(0);
    expect(IMPORT_TEMPLATE_FILENAME).toBe('Apex_OS_Attendance_Import_Template.xlsx');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('PHASE 3 WRITES NOTHING', () => {
  const source = (file: string) =>
    readFileSync(resolve(__dirname, '../../src/modules/platform/attendance/import', file), 'utf8');

  const FILES = [
    'attendance-import.service.ts',
    'import-rows.ts',
    'import-normalize.ts',
    'import-classify.ts',
    'import-template.ts',
  ];

  it('55. no import module calls an authoritative writer', () => {
    // The guarantee the whole phase rests on, checked against the source rather
    // than trusted from the intent. Phase 4 persists batches and Phase 5
    // applies; until then the most this code may do is describe a change.
    for (const file of FILES) {
      const src = source(file);
      for (const writer of [
        'dailyAttendance.create', 'dailyAttendance.update', 'dailyAttendance.upsert',
        'attendanceRegularization.create', 'attendanceRegularization.update',
        'attendanceMonthClose.create', 'attendanceMonthClose.update', 'attendanceMonthClose.upsert',
        'leaveRequest.create', 'leaveRequest.update',
        'appSetting.create', 'appSetting.update', 'appSetting.upsert',
        'reviseForApprovedCorrection', '$executeRaw',
      ]) {
        expect([file, writer, src.includes(writer)]).toEqual([file, writer, false]);
      }
    }
  });

  it('56. the service reads in bulk, never per row', () => {
    const src = source('attendance-import.service.ts');

    // Each lookup appears exactly once: employees, attendance, month closes and
    // open corrections are fetched for the whole file and compared in memory.
    for (const query of [
      'this.prisma.user.findMany',
      'this.prisma.dailyAttendance.findMany',
      'this.prisma.attendanceMonthClose.findMany',
      'this.prisma.attendanceRegularization.findMany',
    ]) {
      expect([query, src.split(query).length - 1]).toEqual([query, 1]);
    }
  });

  it('57. an operator prepares but never approves', () => {
    const src = source('attendance-import.service.ts');

    expect(src).toMatch(/isAttendanceDataOperator/);
    // The approve gate must not admit the operator flag.
    const approve = src.slice(src.indexOf('assertMayApprove'), src.indexOf('assertMayApprove') + 400);
    expect(approve).not.toContain('isAttendanceDataOperator');
    expect(approve).toContain('isHrOrAdmin');
  });

  it('58. Phase 3 touched no schema', () => {
    const schema = readFileSync(resolve(__dirname, '../../prisma/schema.prisma'), 'utf8');
    expect(schema).not.toContain('AttendanceImportBatch');
    expect(schema).not.toContain('isAttendanceDataOperator');
  });
});
