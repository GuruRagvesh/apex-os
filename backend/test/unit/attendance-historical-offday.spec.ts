/**
 * RECOVERY_IMPORT — historical NON-WORKING days (company holiday / weekly off). Pure; no database, no network.
 *
 *   O1  a Holiday / Week Off source row becomes a locked, FINALIZED, marker-carrying day with no punches and no hours
 *   O2  the builder refuses a row that is not what the caller says it is, or that carries attendance facts
 *   O3  it is insert-only and idempotent: SOURCE_ONLY when Apex is silent, DIFFERENT when Apex holds a day, IN_SYNC on a re-read
 *   O4  the export prints an off day as an off day: no "Short by 9:00", no "Not recorded", and no fake "below 9 hours"
 */
import { buildDayBundle } from '../../src/modules/platform/attendance/recovery/bundle-builder';
import { bundleHash } from '../../src/modules/platform/attendance/recovery/bundle-canonical';
import type { AttendanceDayBundle } from '../../src/modules/platform/attendance/recovery/recovery.types';
import type { ReferenceContext } from '../../src/modules/platform/attendance/recovery/reference-check';
import { HISTORICAL_RECOVERY_REASON, toDailyAttendanceCreate, toHistoricalDay, toHistoricalOffDay, type HistoricalSourceRow } from '../../src/modules/platform/attendance/recovery/historical-recovery';
import { DAILY_COLUMNS, HISTORICAL_RECOVERY_REASON as EXPORT_REASON, SUMMARY_COLUMNS, dailyRow, summaryRow, type AdminDay, type AdminEmployee } from '../../src/modules/platform/attendance/reports/attendance-admin-export';
import type { DayFacts } from '../../src/modules/platform/attendance/reports/payroll-aggregation';
import { reconcile } from '../../scripts/attendance-recovery/reconcile-report';

const row = (over: Partial<HistoricalSourceRow> = {}): HistoricalSourceRow => ({
  recoveryKey: 'K-2026-05-01-OWN0024', employeeId: 'OWN0024', businessDate: '2026-05-01', sourceStatus: 'Holiday',
  punchIn: null, punchOut: null, hoursWorked: null, lateArrival: null, ...over,
});
const off = (kind: 'HOLIDAY' | 'WEEKLY_OFF' = 'HOLIDAY', over: Partial<HistoricalSourceRow> = {}) => {
  const r = toHistoricalOffDay(row(kind === 'WEEKLY_OFF' ? { sourceStatus: 'Week Off', ...over } : over), kind, { sourceFileSha256: 'f'.repeat(64) });
  if (!r.bundle) throw new Error(`unexpected problems ${r.problems}`);
  return r.bundle;
};

describe('O1 a recovered non-working day', () => {
  it.each([['HOLIDAY', 'Holiday'], ['WEEKLY_OFF', 'Week Off']] as const)('%s: no punches, no hours, locked, finalized, marked as recovered', (kind, _sourceText) => {
    const d = off(kind).dailyAttendance!;
    expect(d).toMatchObject({ status: kind, punchInAt: null, punchOutAt: null, workedMinutes: 0, breakMinutes: 0, lateMinutes: 0, leaveDeducted: 0, lwpDeducted: 0, calculationReason: HISTORICAL_RECOVERY_REASON, locked: true, evaluationState: 'FINALIZED', evaluatorVersion: 0, exceptionFlags: [] });
  });

  it('creates no session, break, punch evidence, regularization or leave reference', () => {
    const b = off();
    expect([b.workSessions, b.breakLogs, b.punchEvidence, b.regularizations, b.leaveReferences]).toEqual([[], [], [], [], []]);
  });

  it('is deterministic: the same row always gives the same hash', () => {
    expect(bundleHash(off())).toBe(bundleHash(off()));
    expect(bundleHash(off('HOLIDAY'))).not.toBe(bundleHash(off('WEEKLY_OFF')));
  });
});

describe('O2 refusals', () => {
  it('refuses a Week Off row presented as a holiday, and a Holiday row presented as a weekly off', () => {
    expect(toHistoricalOffDay(row({ sourceStatus: 'Week Off' }), 'HOLIDAY').problems).toContain('OFF_DAY_STATUS_MISMATCH');
    expect(toHistoricalOffDay(row({ sourceStatus: 'Holiday' }), 'WEEKLY_OFF').problems).toContain('OFF_DAY_STATUS_MISMATCH');
  });

  it('never converts Absent or Present into an off day', () => {
    expect(toHistoricalOffDay(row({ sourceStatus: 'Absent' }), 'WEEKLY_OFF').bundle).toBeNull();
    expect(toHistoricalOffDay(row({ sourceStatus: 'Present', punchIn: '10:00', punchOut: '19:00' }), 'HOLIDAY').bundle).toBeNull();
  });

  it('refuses an off-day row that carries a punch or hours: that is a worked day, not an off day', () => {
    expect(toHistoricalOffDay(row({ punchIn: '10:00' }), 'HOLIDAY').problems).toContain('OFF_DAY_CARRIES_ATTENDANCE_FACTS');
    expect(toHistoricalOffDay(row({ hoursWorked: '08:00:00' }), 'HOLIDAY').problems).toContain('OFF_DAY_CARRIES_ATTENDANCE_FACTS');
    expect(toHistoricalOffDay(row({ hoursWorked: '00:00:00' }), 'HOLIDAY').bundle).not.toBeNull(); // an explicit zero is not a worked day
  });

  it('refuses an impossible date', () => {
    expect(toHistoricalOffDay(row({ businessDate: '2026-02-30' }), 'HOLIDAY').problems).toContain('DATE_UNPARSEABLE');
  });

  it('the Present builder still refuses these statuses (the two paths cannot be mixed up)', () => {
    expect(toHistoricalDay(row({ sourceStatus: 'Holiday' })).problems).toContain('STATUS_NOT_RECOVERABLE_IN_THIS_WAVE');
    expect(toHistoricalDay(row({ sourceStatus: 'Week Off' })).problems).toContain('STATUS_NOT_RECOVERABLE_IN_THIS_WAVE');
  });
});

describe('O3 insert-only and idempotent', () => {
  const lookups = { employeeIdByUserId: new Map([['u-24', 'OWN0024']]), attendancePolicyKeyById: new Map(), shiftPolicyKeyById: new Map(), holidayCalendarKeyById: new Map() };
  const readBack = (b: AttendanceDayBundle): AttendanceDayBundle => buildDayBundle({
    ownerUserId: 'u-24', employeeId: 'OWN0024', businessDate: b.businessDate,
    rows: { dailyAttendance: { id: 'row-1', createdAt: new Date(), updatedAt: new Date(), ...toDailyAttendanceCreate('u-24', b.dailyAttendance!) }, workSessions: [], breakLogs: [], punchEvidence: [], regularizations: [] },
    lookups, provenance: { sourceType: 'LIVE', sourceId: 'database' },
  }).bundle;
  const ctx = (): ReferenceContext => ({
    employeeIndex: new Map([['OWN0024', ['u-24']]]), attendancePolicies: new Map(), shiftPolicies: new Map(), holidayCalendars: new Map(), existingLeaveIds: new Set(),
    existingIds: { weeklyOffPolicy: new Set(), holiday: new Set(), businessDayOverride: new Set(), employeeProfile: new Set(), attendanceLocation: new Set(), workSession: new Set(), regularization: new Set() },
  });
  const plan = (source: AttendanceDayBundle[], target: AttendanceDayBundle[]) => {
    const m = (bs: AttendanceDayBundle[]) => new Map(bs.map((b) => [`${b.employeeId}|${b.businessDate}`, b]));
    const c = ctx();
    return reconcile({ companyToday: '2026-10-09', source: m(source), sourceProblems: new Map(), target: m(target), targetEmployeeIndex: c.employeeIndex, referenceContext: c, tombstones: [], monthClose: new Map(), idCollisions: new Map() });
  };

  it('is SOURCE_ONLY (eligible) when Apex holds nothing for that employee-day', () => {
    const r = plan([off()], []);
    expect(r.buckets.SOURCE_ONLY).toBe(1);
    expect(r.wouldInsert.dailyAttendance).toBe(1);
  });

  it('reads back to the SAME hash: a second import is IDENTICAL and inserts nothing', () => {
    const b = off();
    expect(bundleHash(readBack(b))).toBe(bundleHash(b));
    const r = plan([b], [readBack(b)]);
    expect(r.buckets.SOURCE_ONLY ?? 0).toBe(0);
    expect(r.wouldInsert.dailyAttendance).toBe(0);
  });

  it('never overwrites: where Apex already holds a different day the source is a conflict, not an insert', () => {
    const apexDay = day('PRESENT');
    const r = plan([off()], [apexDay]);
    expect(r.buckets.SOURCE_ONLY ?? 0).toBe(0);
    expect(r.buckets.DIFFERENT).toBe(1);
    expect(r.wouldInsert.dailyAttendance).toBe(0);
  });
  const day = (status: 'PRESENT'): AttendanceDayBundle => {
    const p = toHistoricalDay(row({ sourceStatus: 'Present', punchIn: '10:00', punchOut: '19:00', hoursWorked: '09:00:00' }));
    return { ...p.bundle!, dailyAttendance: { ...p.bundle!.dailyAttendance!, status, calculationReason: 'COMPLETE_WORKDAY', evaluatorVersion: 1 } };
  };
});

describe('O4 the export prints an off day as an off day', () => {
  const TZ = 'Asia/Kolkata';
  const emp = (): AdminEmployee => ({ id: 'u1', employeeId: 'OWN0024', name: 'Charu Kadam', department: 'Sales', designation: 'Executive', employeeType: 'Full-time' });
  const facts = (over: Partial<DayFacts> = {}): DayFacts => ({
    userId: 'u1', date: '2026-05-01', status: 'HOLIDAY', evaluationState: 'FINALIZED', punchInAt: null, punchOutAt: null,
    punchInSource: null, punchOutSource: null, workedMinutes: 0, breakMinutes: 0, lateMinutes: 0, leaveDeducted: 0, lwpDeducted: 0, leaveType: null,
    exceptionFlags: [], regularizationId: null, viaManualRecovery: false, sessionSpanMinutes: null, ...over,
  });
  const offDay = (over: Partial<DayFacts> = {}): AdminDay => ({ employee: emp(), facts: facts(over), calculationReason: EXPORT_REASON, origin: 'DAILY' });
  const cell = (r: Array<string | number>, name: (typeof DAILY_COLUMNS)[number]) => r[DAILY_COLUMNS.indexOf(name)];

  it.each([['HOLIDAY', 'Company holiday'], ['WEEKLY_OFF', 'Weekly off']] as const)('%s row: status shown, no presence/hours/break/late text, honest remark', (status, remark) => {
    const r = dailyRow(offDay({ status }), TZ);
    expect(r).toHaveLength(26);
    expect(cell(r, 'Attendance Status')).toBe(status);
    for (const c of ['Total Presence Time', 'Hours Worked', 'Break Time', 'Late Arrival', '9-Hour Completion / Shortfall'] as const) expect(cell(r, c)).toBe('');
    expect(cell(r, 'Present')).toBe(0);
    expect(cell(r, 'Absent')).toBe(0);
    expect(String(cell(r, 'Remarks / Exception'))).toContain(remark);
    expect(String(cell(r, 'Remarks / Exception'))).toContain('recovered from SalaryBox history');
    expect(cell(r, 'Missing Punch')).toBe('No');
  });

  it('a holiday never counts as a day below 9 hours, a working day or an unresolved day', () => {
    const s = summaryRow(emp(), [offDay({ status: 'HOLIDAY' }), offDay({ status: 'WEEKLY_OFF', date: '2026-05-02' })]);
    expect(s).toHaveLength(SUMMARY_COLUMNS.length);
    expect(s[SUMMARY_COLUMNS.indexOf('Days Below 9 Hours')]).toBe(0);
    expect(s[SUMMARY_COLUMNS.indexOf('Working Days')]).toBe(0);
    expect(s[SUMMARY_COLUMNS.indexOf('Unresolved Days')]).toBe(0);
  });
});
