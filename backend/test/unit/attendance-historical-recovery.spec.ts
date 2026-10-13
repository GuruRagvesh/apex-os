/**
 * RECOVERY_IMPORT — historical attendance FACT recovery (insert-only). Pure; no database, no network.
 *
 *   H1   needs no historical policy coverage; the evaluator is never involved
 *   H2   both punches survive exactly
 *   H3   one punch stays one punch and is the ONLY thing flagged Missing Punch
 *   H4   no native PunchEvidence does not make a two-punch day "missing"
 *   H5   an existing Apex day is never duplicated; a different one is a conflict
 *   H6   a second import inserts nothing (the stored row reads back to the same hash)
 *   H7   the applier inserts only, refuses unless every guard passes, never overwrites
 *   H8   no update / delete / upsert / session / break / evidence / R2 / evaluator anywhere in the new code
 *   H9   staging cannot use the production backup bucket; every recovery flag defaults OFF
 *   H10  the existing payroll aggregation consumes a recovered day
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  COMPANY_UTC_OFFSET,
  HISTORICAL_RECOVERY_REASON,
  HISTORICAL_SOURCE_LABEL,
  companyInstant,
  durationSeconds,
  hasExactlyOnePunch,
  historicalFingerprint,
  isHistoricalRecovery,
  toDailyAttendanceCreate,
  toHistoricalDay,
  type HistoricalSourceRow,
} from '../../src/modules/platform/attendance/recovery/historical-recovery';
import {
  HISTORICAL_APPLY_CONFIRM_PHRASE,
  HistoricalApplyRefused,
  applyHistoricalRecovery,
  type HistoricalApplyGuard,
} from '../../scripts/attendance-recovery-apply/historical-recovery-apply';
import { readRecoveryConfig } from '../../src/modules/platform/attendance/recovery/recovery-flags';
import { resolveRecoveryVaultConfig } from '../../src/modules/platform/attendance/recovery/recovery-vault-config';
import { buildDayBundle } from '../../src/modules/platform/attendance/recovery/bundle-builder';
import { bundleHash } from '../../src/modules/platform/attendance/recovery/bundle-canonical';
import type { AttendanceDayBundle } from '../../src/modules/platform/attendance/recovery/recovery.types';
import type { ReferenceContext } from '../../src/modules/platform/attendance/recovery/reference-check';
import { presenceMinutes, summarise, toRegisterRow, type DayFacts } from '../../src/modules/platform/attendance/reports/payroll-aggregation';
import { reconcile, type ReconcileInput } from '../../scripts/attendance-recovery/reconcile-report';

const row = (over: Partial<HistoricalSourceRow> = {}): HistoricalSourceRow => ({
  recoveryKey: 'K-2026-04-03-OWN0024', employeeId: 'OWN0024', businessDate: '2026-04-03', sourceStatus: 'Present',
  punchIn: '10:13', punchOut: '19:07', hoursWorked: '08:54:36', lateArrival: '00:00:00', ...over,
});
const day = (over: Partial<HistoricalSourceRow> = {}) => {
  const r = toHistoricalDay(row(over), { sourceFileSha256: 'f'.repeat(64) });
  if (!r.bundle) throw new Error(`unexpected problems ${r.problems}`);
  return r.bundle;
};

const lookups = { employeeIdByUserId: new Map([['u-24', 'OWN0024']]), attendancePolicyKeyById: new Map(), shiftPolicyKeyById: new Map(), holidayCalendarKeyById: new Map() };
/** What the database would hold after the insert, read back through the same builder the rest of the system uses. */
const readBack = (b: AttendanceDayBundle): AttendanceDayBundle => {
  const create = toDailyAttendanceCreate('u-24', b.dailyAttendance!);
  return buildDayBundle({
    ownerUserId: 'u-24', employeeId: 'OWN0024', businessDate: b.businessDate,
    rows: { dailyAttendance: { id: 'row-1', createdAt: new Date(), updatedAt: new Date(), ...create }, workSessions: [], breakLogs: [], punchEvidence: [], regularizations: [] },
    lookups, provenance: { sourceType: 'LIVE', sourceId: 'database' },
  }).bundle;
};

const refCtx = (): ReferenceContext => ({
  employeeIndex: new Map([['OWN0024', ['u-24']]]), attendancePolicies: new Map(), shiftPolicies: new Map(), holidayCalendars: new Map(), existingLeaveIds: new Set(),
  existingIds: { weeklyOffPolicy: new Set(), holiday: new Set(), businessDayOverride: new Set(), employeeProfile: new Set(), attendanceLocation: new Set(), workSession: new Set(), regularization: new Set() },
});
const plan = (source: AttendanceDayBundle[], target: AttendanceDayBundle[], over: Partial<ReconcileInput> = {}) => {
  const m = (bs: AttendanceDayBundle[]) => new Map(bs.map((b) => [`${b.employeeId}|${b.businessDate}`, b]));
  const ctx = refCtx();
  return reconcile({ companyToday: '2026-10-09', source: m(source), sourceProblems: new Map(), target: m(target), targetEmployeeIndex: ctx.employeeIndex, referenceContext: ctx, tombstones: [], monthClose: new Map(), idCollisions: new Map(), ...over });
};

describe('H1 policy independence', () => {
  it('builds a valid recovered day for a date long before any attendance policy existed', () => {
    const b = day({ businessDate: '2026-04-03' });
    expect(b.dailyAttendance).toMatchObject({ status: 'PRESENT', calculationReason: HISTORICAL_RECOVERY_REASON, evaluatorVersion: 0, policyVersion: null, employeeProfileId: null, resolverVersion: null });
    expect(b.attendancePolicyReference).toBeNull();
    expect(b.shiftPolicyReference).toBeNull();
    expect(b.dailyAttendance!.holidayCalendarReference).toBeNull();
  });

  it('is classified SOURCE_ONLY (eligible) with no policy, profile or employment-timeline input at all', () => {
    const r = plan([day()], []);
    expect(r.buckets.SOURCE_ONLY).toBe(1);
    expect(r.wouldInsert).toEqual({ dailyAttendance: 1, workSessions: 0, breakLogs: 0, punchEvidence: 0, regularizations: 0 });
  });

  it('never reads the current shift: lateness is the SOURCE value, and "No Shift" zero is stored as stored', () => {
    expect(day({ punchIn: '12:30', lateArrival: '00:00:00' }).dailyAttendance!.lateMinutes).toBe(0); // not recomputed from a 10:00 shift
    expect(day({ lateArrival: '00:25:00' }).dailyAttendance!.lateMinutes).toBe(25);
  });

  it('does not convert a historical Present into anything else', () => {
    expect(day().dailyAttendance!.status).toBe('PRESENT');
  });
});

describe('H2 both punches survive exactly', () => {
  it('stores the company-local wall clock as the exact instant', () => {
    const d = day({ punchIn: '10:13', punchOut: '19:07' }).dailyAttendance!;
    expect(d.punchInAt).toBe('2026-04-03T04:43:00.000Z'); // 10:13 +05:30
    expect(d.punchOutAt).toBe('2026-04-03T13:37:00.000Z');
    expect(companyInstant('2026-04-03', '10:13', COMPANY_UTC_OFFSET)).toBe(d.punchInAt);
  });

  it('keeps source Hours Worked (rounded to the minute) rather than recomputing it', () => {
    expect(day({ hoursWorked: '08:54:36' }).dailyAttendance!.workedMinutes).toBe(535);
    expect(day({ hoursWorked: '09:05:24' }).dailyAttendance!.workedMinutes).toBe(545);
    expect(durationSeconds('08:54:36')).toBe(32076);
  });

  it('records no break time it was never given: 0 under the recovery marker, no BreakLog', () => {
    const b = day();
    expect(b.dailyAttendance!.breakMinutes).toBe(0);
    expect(b.breakLogs).toEqual([]);
  });
});

describe('H3 / H4 missing-punch semantics', () => {
  it('two real punches are NOT a missing punch, with no native PunchEvidence behind them', () => {
    const b = day();
    expect(b.punchEvidence).toEqual([]); // none fabricated
    expect(hasExactlyOnePunch(b.dailyAttendance!)).toBe(false);
    expect(b.dailyAttendance!.exceptionFlags).toEqual([]); // so HR's exception queue is not flooded
    expect(b.dailyAttendance!.evaluationState).toBe('FINALIZED');
  });

  it('exactly one punch keeps that one punch and is flagged Missing Punch (and unresolved)', () => {
    const b = day({ punchOut: null, hoursWorked: '00:00:00' });
    expect(b.dailyAttendance).toMatchObject({ punchInAt: '2026-04-03T04:43:00.000Z', punchOutAt: null, exceptionFlags: ['MISSING_PUNCH'], evaluationState: 'NEEDS_REVIEW', workedMinutes: 0 });
    expect(hasExactlyOnePunch(b.dailyAttendance!)).toBe(true);
  });

  it('a punch-out alone also keeps the real punch and invents no punch-in', () => {
    const b = day({ punchIn: null });
    expect(b.dailyAttendance).toMatchObject({ punchInAt: null, punchOutAt: '2026-04-03T13:37:00.000Z', exceptionFlags: ['MISSING_PUNCH'] });
  });

  it.each([
    ['an inverted pair', { punchIn: '19:07', punchOut: '10:13' }, 'PUNCH_OUT_NOT_AFTER_PUNCH_IN'],
    ['a punch recorded twice (same minute in and out)', { punchIn: '09:47', punchOut: '09:47' }, 'PUNCH_OUT_NOT_AFTER_PUNCH_IN'],
    ['Present with no punch at all', { punchIn: null, punchOut: null }, 'PRESENT_WITHOUT_ANY_PUNCH'],
    ['an unreadable time', { punchIn: '25:99' }, 'PUNCH_TIME_UNPARSEABLE'],
    ['a status this wave does not recover', { sourceStatus: 'Absent' }, 'STATUS_NOT_RECOVERABLE_IN_THIS_WAVE'],
    ['Holiday', { sourceStatus: 'Holiday' }, 'STATUS_NOT_RECOVERABLE_IN_THIS_WAVE'],
    ['an impossible date', { businessDate: '2026-02-30' }, 'DATE_UNPARSEABLE'],
  ])('refuses %s rather than guessing', (_label, over, problem) => {
    const r = toHistoricalDay(row(over as any));
    expect(r.bundle).toBeNull();
    expect(r.problems).toContain(problem);
  });
});

describe('H5 existing Apex records win', () => {
  const apexOwn = (date = '2026-04-03'): AttendanceDayBundle => ({
    ...day({ businessDate: date }),
    dailyAttendance: null,
    workSessions: [{ id: 'ws-1', date, loginAt: `${date}T04:00:00.000Z`, startWorkAt: `${date}T04:00:00.000Z`, logoutAt: `${date}T13:00:00.000Z`, status: 'LOGGED_OUT', totalLoggedMinutes: 540, totalBreakMinutes: 30, totalIdleMinutes: 0, totalWorkMinutes: 510, leaveId: null, autoClosed: false, autoClosedAt: null, closureReason: null, continuationOfSessionId: null }],
    provenance: { sourceType: 'LIVE', sourceId: 'database' },
  });

  it('a day Apex already holds with its own sessions is a conflict, never inserted, never merged', () => {
    const r = plan([day()], [apexOwn()]);
    expect(r.buckets.DIFFERENT).toBe(1);
    expect(r.buckets.SOURCE_ONLY).toBe(0);
    expect(r.wouldInsert.dailyAttendance).toBe(0);
  });

  it('an Apex daily record that disagrees is a conflict and is not overwritten', () => {
    const apex = readBack(day({ hoursWorked: '04:00:00' }));
    const r = plan([day()], [apex]);
    expect(r.buckets.DIFFERENT).toBe(1);
    expect(r.wouldInsert.dailyAttendance).toBe(0);
    expect(r.wouldUpdate).toBe(0);
    expect(r.wouldDelete).toBe(0);
  });

  it('an Apex-only day is preserved', () => {
    const r = plan([], [apexOwn('2026-05-04')]);
    expect(r.buckets.TARGET_ONLY).toBe(1);
    expect(r.wouldInsert.dailyAttendance).toBe(0);
  });
});

describe('H6 idempotency: a second import inserts nothing', () => {
  it('the stored row reads back to the identical bundle hash', () => {
    for (const b of [day(), day({ punchOut: null, hoursWorked: '00:00:00' }), day({ businessDate: '2026-07-21', punchIn: '09:09', punchOut: '18:30' })]) {
      expect(bundleHash(readBack(b))).toBe(bundleHash(b));
    }
  });

  it('first run proposes the insert; after it, the same source is IN_SYNC and proposes none', () => {
    const src = [day(), day({ businessDate: '2026-04-06', recoveryKey: 'K2' })];
    const first = plan(src, []);
    expect(first.buckets.SOURCE_ONLY).toBe(2);
    const second = plan(src, src.map(readBack));
    expect(second.buckets.IDENTICAL).toBe(2);
    expect(second.buckets.SOURCE_ONLY).toBe(0);
    expect(second.wouldInsert.dailyAttendance).toBe(0);
  });

  it('the fingerprint depends on the source row key only, never on the file, the clock or the run', () => {
    expect(historicalFingerprint('K')).toBe(historicalFingerprint('K'));
    expect(historicalFingerprint('K')).not.toBe(historicalFingerprint('K2'));
    expect(JSON.stringify(day())).toBe(JSON.stringify(day()));
  });
});

describe('H7 the applier', () => {
  const allow = (over: Partial<HistoricalApplyGuard> = {}): HistoricalApplyGuard => ({
    appEnv: 'staging', flags: readRecoveryConfig({ ATTENDANCE_RECOVERY_ENABLED: true }).flags, stagingIdentityProven: true, confirmation: HISTORICAL_APPLY_CONFIRM_PHRASE, ...over,
  });
  const fakeDb = (existing: string[] = [], monthStatus: string | null = null) => {
    const calls: string[] = [];
    const created: any[] = [];
    const tx = {
      $executeRaw: jest.fn(async () => { calls.push('lock'); }),
      attendanceMonthClose: { findUnique: jest.fn(async () => (monthStatus ? { status: monthStatus } : null)) },
      dailyAttendance: {
        findUnique: jest.fn(async (a: any) => (existing.includes(a.where.userId_date.date.toISOString().slice(0, 10)) ? { id: 'x' } : null)),
        create: jest.fn(async (a: any) => { calls.push('create'); created.push(a.data); }),
      },
    };
    return { db: { $transaction: async (fn: any) => fn(tx) } as any, tx, calls, created };
  };
  const inserts = () => [day(), day({ businessDate: '2026-05-04', recoveryKey: 'K2' })].map((bundle) => ({ userId: 'u-24', bundle }));

  it.each([
    ['production', { appEnv: 'production' }, 'APP_ENV_NOT_STAGING'],
    ['APP_ENV unset', { appEnv: undefined }, 'APP_ENV_NOT_STAGING'],
    ['the recovery flag OFF', { flags: readRecoveryConfig(undefined).flags }, 'RECOVERY_NOT_ENABLED'],
    ['staging identity not proven', { stagingIdentityProven: false }, 'STAGING_IDENTITY_NOT_PROVEN'],
    ['no approval phrase', { confirmation: '' }, 'CONFIRMATION_MISSING'],
    ['a near-miss phrase', { confirmation: 'apply staging historical wave 1' }, 'CONFIRMATION_MISSING'],
  ])('refuses with %s, before touching anything', async (_l, over, code) => {
    const f = fakeDb();
    await expect(applyHistoricalRecovery(f.db, inserts(), allow(over as any))).rejects.toMatchObject({ code });
    expect(f.calls).toEqual([]);
  });

  it('inserts exactly the approved days and nothing else', async () => {
    const f = fakeDb();
    const r = await applyHistoricalRecovery(f.db, inserts(), allow());
    expect(r).toMatchObject({ inserted: 2, skippedExisting: 0 });
    expect(f.created).toHaveLength(2);
    expect(f.created[0]).toMatchObject({ userId: 'u-24', calculationReason: HISTORICAL_RECOVERY_REASON, locked: true });
    expect(Object.keys(f.tx.dailyAttendance).sort()).toEqual(['create', 'findUnique']); // no update, upsert or delete exists on the handle
  });

  it('SKIPS (never overwrites) a day that already exists, re-checked inside the transaction', async () => {
    const f = fakeDb(['2026-04-03']);
    const r = await applyHistoricalRecovery(f.db, inserts(), allow());
    expect(r).toMatchObject({ inserted: 1, skippedExisting: 1, skippedKeys: ['OWN0024|2026-04-03'] });
  });

  it('a second apply of the same set inserts zero', async () => {
    const f = fakeDb(['2026-04-03', '2026-05-04']);
    const r = await applyHistoricalRecovery(f.db, inserts(), allow());
    expect(r.inserted).toBe(0);
    expect(f.created).toEqual([]);
  });

  it.each(['FINALIZED', 'SENT'])('refuses a bulk write into a %s month', async (status) => {
    const f = fakeDb([], status);
    await expect(applyHistoricalRecovery(f.db, inserts(), allow())).rejects.toMatchObject({ code: 'MONTH_SETTLED' });
    expect(f.created).toEqual([]);
  });

  it('refuses anything that is not a recovered historical day, and an empty set', async () => {
    const f = fakeDb();
    const live = { userId: 'u-24', bundle: { ...day(), dailyAttendance: { ...day().dailyAttendance!, calculationReason: 'COMPLETE_WORKDAY' } } };
    await expect(applyHistoricalRecovery(f.db, [live], allow())).rejects.toMatchObject({ code: 'NOT_A_RECOVERED_DAY' });
    await expect(applyHistoricalRecovery(f.db, [], allow())).rejects.toMatchObject({ code: 'NOTHING_TO_APPLY' });
    expect(HistoricalApplyRefused).toBeDefined();
  });
});

describe('H8 what the new code cannot do', () => {
  const dir = path.join(__dirname, '../../src/modules/platform/attendance/recovery');
  // The pure fact builder lives in the read-only recovery module; the one writer lives in its own
  // scripts/ folder, apart from the read-only dry-run tool, and is not compiled into the application.
  const files = [path.join(dir, 'historical-recovery.ts'), path.join(__dirname, '../../scripts/attendance-recovery-apply/historical-recovery-apply.ts')];
  const code = (f: string) => fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

  it('has no update / upsert / delete / raw SQL (the month advisory lock is taken through the existing lockAttendanceMonth, not written here)', () => {
    for (const f of files) {
      // The one legitimate `.update(` is a crypto digest: createHash('sha256').update(...).
      const c = code(f).replace(/createHash\('sha256'\)\s*\.update\(/g, 'createHash256(');
      expect({ f: path.basename(f), hit: c.match(/\.(update|updateMany|upsert|delete|deleteMany|createMany)\s*\(/) }).toEqual({ f: path.basename(f), hit: null });
      expect({ f: path.basename(f), hit: c.match(/\$queryRaw|\$executeRaw|\$queryRawUnsafe|\$executeRawUnsafe/) }).toEqual({ f: path.basename(f), hit: null });
    }
  });

  it('the applier\'s only write call is dailyAttendance.create, and the type it accepts has no other writer', () => {
    const c = code(files[1]);
    expect((c.match(/\.create\(/g) ?? []).length).toBe(1);
    expect(c).toMatch(/tx\.dailyAttendance\.create\(\{ data: toDailyAttendanceCreate/);
  });

  it('creates no WorkSession, BreakLog, PunchEvidence or Regularization and never calls the evaluator, a policy service or a vault', () => {
    for (const f of files) {
      const c = code(f);
      for (const forbidden of [/workSession\./, /breakLog\./, /attendancePunchEvidence\./, /attendanceRegularization\./, /Evaluator/, /PolicyVersionService/, /DailyContextService/, /EmployeeTimelineService/, /r2-vault|S3Client|putBuffer|ATTENDANCE_RECOVERY_R2|\bR2_/, /BackupVault/]) {
        expect({ f: path.basename(f), pattern: String(forbidden), hit: forbidden.test(c) }).toEqual({ f: path.basename(f), pattern: String(forbidden), hit: false });
      }
    }
  });

  it('keeps the recovery module itself unable to write: the writer is NOT under src/', () => {
    expect(fs.existsSync(path.join(dir, 'historical-recovery-apply.ts'))).toBe(false);
    expect(fs.existsSync(files[1])).toBe(true);
    expect(files[1]).not.toContain(`${path.sep}src${path.sep}`);
  });

  it('is not imported by any controller, service or module: unreachable from the running application', () => {
    const roots = [path.join(__dirname, '../../src')];
    const offenders: string[] = [];
    const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.ts$/.test(e.name) && !/historical-recovery/.test(e.name) && /historical-recovery-apply/.test(fs.readFileSync(p, 'utf8'))) offenders.push(p); } };
    roots.forEach(walk);
    expect(offenders).toEqual([]);
  });
});

describe('H9 R2 safety and flags', () => {
  const env = (over: Record<string, string>) => ({ APP_ENV: 'staging', ATTENDANCE_RECOVERY_R2_ACCOUNT_ID: 'a', ATTENDANCE_RECOVERY_R2_ACCESS_KEY_ID: 'k1', ATTENDANCE_RECOVERY_R2_SECRET_ACCESS_KEY: 's', ...over }) as NodeJS.ProcessEnv;

  it('staging can never use the production backup bucket', () => {
    expect(resolveRecoveryVaultConfig(env({ ATTENDANCE_RECOVERY_R2_BUCKET: 'apex-os-production-backups' })).refusal).toBe('RECOVERY_VAULT_COLLIDES_WITH_BACKUP_VAULT');
    expect(resolveRecoveryVaultConfig(env({ ATTENDANCE_RECOVERY_R2_BUCKET: 'apex-os-attendance-recovery-production' })).refusal).toBe('RECOVERY_VAULT_BUCKET_ENVIRONMENT_MISMATCH');
  });

  it('staging may use only the dedicated staging recovery bucket, with its own credentials', () => {
    expect(resolveRecoveryVaultConfig(env({ ATTENDANCE_RECOVERY_R2_BUCKET: 'apex-os-attendance-recovery-staging' })).ok).toBe(true);
    expect(resolveRecoveryVaultConfig(env({ ATTENDANCE_RECOVERY_R2_BUCKET: 'apex-os-attendance-recovery-staging', R2_ACCESS_KEY_ID: 'k1' })).refusal).toBe('RECOVERY_VAULT_REUSES_BACKUP_CREDENTIALS');
  });

  it('every recovery flag defaults OFF', () => {
    expect(Object.values(readRecoveryConfig(undefined).flags).every((v) => v === false)).toBe(true);
    expect(readRecoveryConfig({ ATTENDANCE_RECOVERY_ENABLED: 'true' }).flags.ATTENDANCE_RECOVERY_ENABLED).toBe(false);
  });
});

describe('H10 the existing payroll aggregation consumes a recovered day', () => {
  const factsOf = (b: AttendanceDayBundle): DayFacts => {
    const d = b.dailyAttendance!;
    return { userId: 'u-24', date: d.date, status: d.status, evaluationState: d.evaluationState, punchInAt: d.punchInAt, punchOutAt: d.punchOutAt, punchInSource: null, punchOutSource: null, workedMinutes: d.workedMinutes, breakMinutes: d.breakMinutes, lateMinutes: d.lateMinutes, leaveDeducted: d.leaveDeducted, lwpDeducted: d.lwpDeducted, leaveType: null, exceptionFlags: d.exceptionFlags, regularizationId: d.lastRegularizationId, viaManualRecovery: false, sessionSpanMinutes: null };
  };
  const meta = { id: 'u-24', employeeId: 'OWN0024', name: 'Charu Kadam', department: 'Sales' };

  it('presence, punches, hours and present-count come out of the unchanged aggregation', () => {
    const f = factsOf(day());
    expect(presenceMinutes(f)).toBe(534); // 10:13 -> 19:07, from the stored punches
    const reg = toRegisterRow(meta, f, 540);
    expect(reg).toMatchObject({ employeeId: 'OWN0024', date: '2026-04-03', status: 'PRESENT', presenceMinutes: 534, requiredMinutes: 540, workedMinutes: 535, breakMinutes: 0, regularized: false, needsReview: false, punchInSource: '—' });
    expect(reg.punchIn).toBe('2026-04-03T04:43:00.000Z');
    expect(summarise(meta, [f])).toMatchObject({ present: 1, absent: 0, workingDays: 1, unresolvedDays: 0, lateDays: 0 });
  });

  it('a one-punch day reads as unresolved with presence not calculable, not as a full day', () => {
    const f = factsOf(day({ punchOut: null, hoursWorked: '00:00:00' }));
    expect(presenceMinutes(f)).toBeNull();
    expect(toRegisterRow(meta, f, 540)).toMatchObject({ presenceMinutes: null, needsReview: true });
    expect(toRegisterRow(meta, f, 540).remarks).toContain('Presence cannot be calculated');
    expect(summarise(meta, [f])).toMatchObject({ present: 1, unresolvedDays: 1 });
  });

  it('is identifiable as recovered, so the export can print its Data Source', () => {
    expect(isHistoricalRecovery(day().dailyAttendance!)).toBe(true);
    expect(HISTORICAL_SOURCE_LABEL).toBe('SalaryBox Historical Recovery');
  });
});
