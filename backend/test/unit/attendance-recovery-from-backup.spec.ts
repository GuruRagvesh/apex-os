/**
 * September recovery DRY RUN tooling. Pure; no database, no network.
 *
 * Proves: the exact active staging database is the only accepted target;
 * production and legacy staging are refused before anything is opened; every
 * employee-day lands in exactly one bucket; and the tool has no write path.
 */
import * as fs from 'fs';
import * as path from 'path';
import { checkRecoveryTargets, checkSourceUrl } from '../../scripts/attendance-recovery/recovery-targets';
import { READABLE_MODELS, readOnlyFrom } from '../../scripts/attendance-recovery/read-only-db';
import { BUCKETS, bucketOf, compareRegisters, reconcile, registerFor, type ReconcileInput } from '../../scripts/attendance-recovery/reconcile-report';
import * as selects from '../../scripts/attendance-recovery/side-reader';
import type { ReferenceContext } from '../../src/modules/platform/attendance/recovery/reference-check';
import type { AttendanceDayBundle, BundleDailyAttendance } from '../../src/modules/platform/attendance/recovery/recovery.types';

const STAGING = 'postgresql://someuser:somepassword@dpg-db2v0som7kps73ceebd0-a.oregon-postgres.render.com/apex_db_dugl_ngz6';
const PROD = 'postgresql://someuser:somepassword@dpg-d8259omk1jcs73e37fbg-a.oregon-postgres.render.com/apex_db_dugl';
const LEGACY = 'postgresql://someuser:somepassword@dpg-d95pamvaqgkc73fdurig-a.oregon-postgres.render.com/apex_os_staging_db';
const SOURCE = 'postgresql://someuser:somepassword@127.0.0.1:5432/apex_restore_test';
const TODAY = '2026-10-09';
const env = (over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({
  APP_ENV: 'staging', STAGING_DATABASE_URL: STAGING, SOURCE_DATABASE_URL: SOURCE, FROM_DATE: '2026-09-01', TO_DATE: '2026-09-30', ...over,
}) as NodeJS.ProcessEnv;

describe('recovery targets — what may be read and compared', () => {
  it('accepts the exact active staging database with a local disposable source', () => {
    const r = checkRecoveryTargets(env(), TODAY);
    expect(r).toEqual({
      ok: true,
      staging: { host: 'dpg-db2v0som7kps73ceebd0-a.oregon-postgres.render.com', database: 'apex_db_dugl_ngz6' },
      source: { host: '127.0.0.1', database: 'apex_restore_test' },
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });

  it.each([
    ['production as target', { STAGING_DATABASE_URL: PROD }, 'PRODUCTION_DATABASE'],
    ['production host with the staging db name', { STAGING_DATABASE_URL: PROD.replace('apex_db_dugl', 'apex_db_dugl_ngz6') }, 'PRODUCTION_DATABASE'],
    ['staging host with the production db name', { STAGING_DATABASE_URL: STAGING.replace('apex_db_dugl_ngz6', 'apex_db_dugl') }, 'PRODUCTION_DATABASE'],
    ['legacy staging as target', { STAGING_DATABASE_URL: LEGACY }, 'LEGACY_STAGING_NOT_ACTIVE'],
    ['unknown Render database', { STAGING_DATABASE_URL: 'postgresql://u:p@dpg-abcabcabcabcabcabcab-a.oregon-postgres.render.com/x' }, 'UNKNOWN_DATABASE_HOST'],
    ['malformed target url', { STAGING_DATABASE_URL: 'not a url' }, 'URL_MALFORMED'],
    ['target url missing', { STAGING_DATABASE_URL: undefined }, 'URL_NOT_SET'],
    ['APP_ENV missing', { APP_ENV: undefined }, 'APP_ENV_NOT_STAGING'],
    ['APP_ENV=production', { APP_ENV: 'production' }, 'APP_ENV_NOT_STAGING'],
    ['internal staging url', { STAGING_DATABASE_URL: STAGING.replace('.oregon-postgres.render.com', '') }, 'INTERNAL_URL'],
  ])('refuses %s', (_label, over, code) => {
    const r = checkRecoveryTargets(env(over), TODAY);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(code);
  });

  it.each([
    ['production as source', PROD, 'SOURCE_NOT_LOCAL'],
    ['active staging as source', STAGING, 'SOURCE_NOT_LOCAL'],
    ['legacy staging as source', LEGACY, 'SOURCE_NOT_LOCAL'],
    ['a local database that is not the restore target', 'postgresql://u:p@localhost:5432/apex_db_dugl', 'SOURCE_NOT_DISPOSABLE'],
    ['a local look-alike name', 'postgresql://u:p@localhost:5432/apex_restore_test_x/../apex_db_dugl', 'SOURCE_NOT_DISPOSABLE'],
    ['a non-PostgreSQL source', 'mysql://u:p@127.0.0.1/apex_restore_test', 'SOURCE_NOT_POSTGRESQL'],
    ['a malformed source', 'not a url', 'SOURCE_MALFORMED'],
  ])('refuses %s', (_label, url, code) => {
    expect(checkSourceUrl(url).code).toBe(code);
    expect(checkRecoveryTargets(env({ SOURCE_DATABASE_URL: url }), TODAY).code).toBe(code);
  });

  it('accepts apex_restore_test with a suffix, on localhost', () => {
    expect(checkSourceUrl('postgresql://u:p@localhost:5432/apex_restore_test_0910').ok).toBe(true);
  });

  it.each([
    ['dates missing', { FROM_DATE: undefined }, 'DATES_MISSING'],
    ['dates not real', { TO_DATE: '2026-09-31' }, 'DATES_INVALID'],
    ['range inverted', { FROM_DATE: '2026-09-30', TO_DATE: '2026-09-01' }, 'DATE_RANGE_INVERTED'],
    ['range too long', { FROM_DATE: '2026-01-01' }, 'DATE_RANGE_TOO_LONG'],
    ['today', { TO_DATE: '2026-10-09' }, 'DATE_NOT_HISTORICAL'],
    ['yesterday (still settling)', { TO_DATE: '2026-10-08' }, 'DATE_NOT_HISTORICAL'],
    ['the future', { TO_DATE: '2026-11-01' }, 'DATE_NOT_HISTORICAL'],
    ['DRY_RUN=false: there is no apply path', { DRY_RUN: 'false' }, 'APPLY_NOT_AVAILABLE'],
    ['DRY_RUN unrecognised', { DRY_RUN: 'maybe' }, 'DRY_RUN_INVALID'],
  ])('refuses %s', (_label, over, code) => {
    expect(checkRecoveryTargets(env(over), TODAY).code).toBe(code);
  });

  it('accepts the last fully historical day and an explicit DRY_RUN=true', () => {
    expect(checkRecoveryTargets(env({ TO_DATE: '2026-10-07', DRY_RUN: 'true' }), TODAY).ok).toBe(true);
  });

  it('never returns a username, password or full URL', () => {
    for (const e of [env(), env({ STAGING_DATABASE_URL: PROD }), env({ STAGING_DATABASE_URL: LEGACY }), env({ SOURCE_DATABASE_URL: PROD })]) {
      expect(JSON.stringify(checkRecoveryTargets(e, TODAY))).not.toMatch(/someuser|somepassword|postgresql:\/\//);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

const day = (date: string, over: Partial<BundleDailyAttendance> = {}): BundleDailyAttendance => ({
  date, status: 'PRESENT', punchInAt: `${date}T04:00:00.000Z`, punchOutAt: `${date}T13:30:00.000Z`, workedMinutes: 480, breakMinutes: 30,
  lateMinutes: 0, leaveDeducted: 0, lwpDeducted: 0, calculationReason: null, locked: true, lockedAt: `${date}T18:00:00.000Z`, policyVersion: null,
  evaluationState: 'FINALIZED', evaluatorVersion: 1, resolverVersion: null, evaluatedAt: `${date}T18:00:00.000Z`, exceptionFlags: [],
  sourceFingerprint: null, employeeProfileId: null, holidayCalendarReference: null, weeklyOffPolicyId: null, holidayId: null,
  businessDayOverrideId: null, leaveRequestId: null, punchInEvidenceKey: null, punchOutEvidenceKey: null, workSessionIds: [],
  revision: 0, lastRegularizationId: null, ...over,
});

const bundle = (employeeId: string, date: string, over: Partial<AttendanceDayBundle> = {}, daOver: Partial<BundleDailyAttendance> = {}): AttendanceDayBundle => ({
  schemaVersion: 1, bundleVersion: 1, employeeId, businessDate: date,
  dailyAttendance: day(date, daOver),
  workSessions: [{
    id: `ws-${employeeId}-${date}`, date, loginAt: `${date}T04:00:00.000Z`, startWorkAt: `${date}T04:00:00.000Z`, logoutAt: `${date}T13:30:00.000Z`,
    status: 'LOGGED_OUT', totalLoggedMinutes: 570, totalBreakMinutes: 30, totalIdleMinutes: 0, totalWorkMinutes: 480, leaveId: null,
    autoClosed: false, autoClosedAt: null, closureReason: null, continuationOfSessionId: null,
  }],
  breakLogs: [], punchEvidence: [], regularizations: [], leaveReferences: [],
  attendancePolicyReference: null, shiftPolicyReference: null,
  provenance: { sourceType: 'LIVE', sourceId: 'test' },
  ...over,
});

const refCtx = (employees = ['E1', 'E2']): ReferenceContext => ({
  employeeIndex: new Map(employees.map((e, i) => [e, [`u${i}`]])),
  attendancePolicies: new Map(), shiftPolicies: new Map(), holidayCalendars: new Map(), existingLeaveIds: new Set(),
  existingIds: { weeklyOffPolicy: new Set(), holiday: new Set(), businessDayOverride: new Set(), employeeProfile: new Set(), attendanceLocation: new Set(), workSession: new Set(), regularization: new Set() },
});

const input = (source: AttendanceDayBundle[], target: AttendanceDayBundle[], over: Partial<ReconcileInput> = {}): ReconcileInput => {
  const m = (bs: AttendanceDayBundle[]) => new Map(bs.map((b) => [`${b.employeeId}|${b.businessDate}`, b]));
  const ctx = refCtx();
  return {
    companyToday: TODAY, source: m(source), sourceProblems: new Map(), target: m(target), targetEmployeeIndex: ctx.employeeIndex,
    referenceContext: ctx, tombstones: [], monthClose: new Map(), idCollisions: new Map(), ...over,
  };
};
const bucketFor = (r: ReturnType<typeof reconcile>, key: string) => r.verdicts.find((v) => v.key === key)!.bucket;

describe('September reconciliation — every employee-day lands in exactly one bucket', () => {
  it('IDENTICAL: the same day on both sides is a no-op', () => {
    const r = reconcile(input([bundle('E1', '2026-09-03')], [bundle('E1', '2026-09-03')]));
    expect(bucketFor(r, 'E1|2026-09-03')).toBe('IDENTICAL');
    expect(r.wouldInsert).toEqual({ dailyAttendance: 0, workSessions: 0, breakLogs: 0, punchEvidence: 0, regularizations: 0 });
  });

  it('SOURCE_ONLY: present in the backup, absent from staging → eligible, counted by table', () => {
    const b = bundle('E1', '2026-09-03', {
      breakLogs: [{ id: 'b1', workSessionId: 'ws-E1-2026-09-03', breakType: 'LUNCH', estimatedMinutes: 30, startAt: '2026-09-03T07:00:00.000Z', endAt: '2026-09-03T07:30:00.000Z', durationMinutes: 30, autoDetected: false, note: null, reason: null, source: null }],
    });
    const r = reconcile(input([b], []));
    expect(bucketFor(r, 'E1|2026-09-03')).toBe('SOURCE_ONLY');
    expect(r.wouldInsert).toEqual({ dailyAttendance: 1, workSessions: 1, breakLogs: 1, punchEvidence: 0, regularizations: 0 });
  });

  it('TARGET_ONLY: staging holds a day the backup lacks → preserved, never inserted from nowhere', () => {
    const r = reconcile(input([], [bundle('E1', '2026-09-03')]));
    expect(bucketFor(r, 'E1|2026-09-03')).toBe('TARGET_ONLY');
    expect(r.wouldInsert.dailyAttendance).toBe(0);
  });

  it('DIFFERENT: both sides hold the day with different content → conflict, nothing proposed, differing fields named', () => {
    const r = reconcile(input([bundle('E1', '2026-09-03', {}, { workedMinutes: 480 })], [bundle('E1', '2026-09-03', {}, { workedMinutes: 120 })]));
    expect(bucketFor(r, 'E1|2026-09-03')).toBe('DIFFERENT');
    expect(r.wouldInsert.dailyAttendance).toBe(0);
    expect(Object.keys(r.differingFieldCounts).join(' ')).toContain('workedMinutes');
  });

  it('INVALID_REFERENCE: a leave the staging database does not hold → not insertable', () => {
    const r = reconcile(input([bundle('E1', '2026-09-03', { leaveReferences: ['leave-1'] }, { leaveRequestId: 'leave-1', status: 'LEAVE' })], []));
    expect(bucketFor(r, 'E1|2026-09-03')).toBe('INVALID_REFERENCE');
    expect(r.reasonCounts['INVALID_REFERENCE:LEAVE_REQUEST_MISSING']).toBe(1);
    expect(r.wouldInsert.dailyAttendance).toBe(0);
  });

  it('INVALID_REFERENCE: an employee who does not exist in staging', () => {
    const r = reconcile(input([bundle('E9', '2026-09-03')], []));
    expect(bucketFor(r, 'E9|2026-09-03')).toBe('INVALID_REFERENCE');
  });

  it('INVALID_REFERENCE: a structurally broken source bundle (owner mismatch)', () => {
    const r = reconcile(input([bundle('E1', '2026-09-03')], [], { sourceProblems: new Map([['E1|2026-09-03', ['OWNER_MISMATCH:workSession:x']]]) }));
    expect(bucketFor(r, 'E1|2026-09-03')).toBe('INVALID_REFERENCE');
  });

  it.each([
    ['not finalized in the source', () => input([bundle('E1', '2026-09-03', {}, { evaluationState: 'CALCULATED', locked: false })], [])],
    ['an open session in the source', () => input([bundle('E1', '2026-09-03', { workSessions: [{ ...bundle('E1', '2026-09-03').workSessions[0], logoutAt: null }] })], [])],
    ['tombstoned on purpose', () => input([bundle('E1', '2026-09-03')], [], { tombstones: [{ id: 't', employeeId: 'E1', businessDate: '2026-09-03', recordType: 'DAY', recordId: null, reason: 'removed' }] })],
    ['a closed month', () => input([bundle('E1', '2026-09-03')], [], { monthClose: new Map([['2026-09', 'FINALIZED']]) })],
    ['a session id already used under another day', () => input([bundle('E1', '2026-09-03')], [], { idCollisions: new Map([['E1|2026-09-03', ['WorkSession:ws-E1-2026-09-03']]]) })],
  ])('SOURCE_ONLY_BLOCKED: %s → visible with its reason, not inserted', (_label, build) => {
    const r = reconcile(build());
    expect(bucketFor(r, 'E1|2026-09-03')).toBe('SOURCE_ONLY_BLOCKED');
    expect(r.wouldInsert.dailyAttendance).toBe(0);
    expect(Object.keys(r.reasonCounts).length).toBeGreaterThan(0);
  });

  it('counts add up: every key is in exactly one bucket', () => {
    const r = reconcile(input(
      [bundle('E1', '2026-09-01'), bundle('E1', '2026-09-02'), bundle('E1', '2026-09-03', {}, { workedMinutes: 1 }), bundle('E2', '2026-09-01')],
      [bundle('E1', '2026-09-01'), bundle('E1', '2026-09-03'), bundle('E2', '2026-09-09')],
    ));
    expect(BUCKETS.reduce((n, b) => n + r.buckets[b], 0)).toBe(r.verdicts.length);
    expect(r.buckets).toMatchObject({ IDENTICAL: 1, SOURCE_ONLY: 2, DIFFERENT: 1, TARGET_ONLY: 1 });
  });

  it('is idempotent: once staging holds the source days, a second dry run proposes nothing', () => {
    const source = [bundle('E1', '2026-09-01'), bundle('E1', '2026-09-02'), bundle('E2', '2026-09-01')];
    const first = reconcile(input(source, [bundle('E1', '2026-09-01')]));
    expect(first.buckets.SOURCE_ONLY).toBe(2);
    const second = reconcile(input(source, source));
    expect(second.buckets.SOURCE_ONLY).toBe(0);
    expect(second.buckets.IDENTICAL).toBe(3);
    expect(second.wouldInsert).toEqual({ dailyAttendance: 0, workSessions: 0, breakLogs: 0, punchEvidence: 0, regularizations: 0 });
  });

  it('never proposes an update or a delete, whatever the data', () => {
    const r = reconcile(input([bundle('E1', '2026-09-03', {}, { workedMinutes: 1 })], [bundle('E1', '2026-09-03'), bundle('E2', '2026-09-04')]));
    expect(r.wouldUpdate).toBe(0);
    expect(r.wouldDelete).toBe(0);
    expect(r.buckets.DIFFERENT).toBe(1);
    expect(r.buckets.TARGET_ONLY).toBe(1);
  });

  it('a whole month present in the source and absent from staging is a HARD_STOP, not a quiet bulk insert', () => {
    const source = Array.from({ length: 5 }, (_, i) => bundle('E1', `2026-09-0${i + 1}`));
    expect(reconcile(input(source, [])).damage.decision).toBe('HARD_STOP');
  });

  it('maps every classifier state to a bucket', () => {
    expect(bucketOf({ state: 'IN_SYNC' })).toBe('IDENTICAL');
    expect(bucketOf({ state: 'RECOVERY_ONLY' })).toBe('SOURCE_ONLY');
    expect(bucketOf({ state: 'PRODUCTION_ONLY' })).toBe('TARGET_ONLY');
    expect(bucketOf({ state: 'DIFFERENT' })).toBe('DIFFERENT');
    expect(bucketOf({ state: 'MISSING_REFERENCE' })).toBe('INVALID_REFERENCE');
    expect(bucketOf({ state: 'INVALID_BUNDLE' })).toBe('INVALID_REFERENCE');
    expect(bucketOf({ state: 'LEGACY_FORMAT' })).toBe('SOURCE_ONLY_BLOCKED');
    expect(bucketOf({ state: 'MANUAL_REVIEW' })).toBe('SOURCE_ONLY_BLOCKED');
  });
});

describe('Monthly Register comparison — the same summarise() the register uses', () => {
  const side = (bundles: AttendanceDayBundle[]) => ({
    bundles: new Map(bundles.map((b) => [`${b.employeeId}|${b.businessDate}`, b])),
    users: [{ id: 'u0', employeeId: 'E1', name: 'Aniket Phapale', departmentId: 'd1' }],
    departmentNameById: new Map([['d1', 'Sales']]),
    leaveTypeById: new Map<string, string>(),
  });
  const days = (n: number, status = 'PRESENT') => Array.from({ length: n }, (_, i) => bundle('E1', `2026-09-${String(i + 1).padStart(2, '0')}`, {}, { status }));

  it('shows 18 present in the backup against 6 in staging, and names the field that differs', () => {
    const source = registerFor(side([...days(18), ...days(3).map((b, i) => bundle('E1', `2026-09-2${i}`, {}, { status: 'ABSENT', punchInAt: null, punchOutAt: null }))]));
    const target = registerFor(side(days(6)));
    expect(source.get('E1')!.present).toBe(18);
    expect(source.get('E1')!.absent).toBe(3);
    expect(target.get('E1')!.present).toBe(6);
    const [delta] = compareRegisters(source, target);
    expect(delta.name).toBe('Aniket Phapale');
    expect(delta.mismatchedFields).toEqual(expect.arrayContaining(['present', 'absent', 'workingDays', 'presenceMinutes']));
  });

  it('identical registers compare equal, and a missing employee is null, not zero', () => {
    const a = registerFor(side(days(4)));
    expect(compareRegisters(a, a)[0].mismatchedFields).toEqual([]);
    const [delta] = compareRegisters(a, new Map());
    expect(delta.target).toBeNull();
    expect(delta.mismatchedFields.length).toBeGreaterThan(0);
  });

  it('presence is punch-out minus punch-in, as in the register', () => {
    expect(registerFor(side(days(2))).get('E1')!.presenceMinutes).toBe(2 * 570);
  });
});

describe('read-only guarantee', () => {
  it('ReadOnlyDb exposes findMany and nothing else', () => {
    const db = readOnlyFrom({ user: { findMany: jest.fn().mockResolvedValue([]) } });
    expect(Object.keys(db)).toEqual(['findMany']);
  });

  it('refuses a model outside the allow-list and a read with no explicit select', async () => {
    const find = jest.fn().mockResolvedValue([]);
    const db = readOnlyFrom({ user: { findMany: find }, secretTable: { findMany: find } });
    await expect(db.findMany('secretTable' as any, { select: { id: true } })).rejects.toThrow(/not readable/);
    await expect(db.findMany('user', {} as any)).rejects.toThrow(/explicit select/);
    await expect(db.findMany('user', { select: {} })).rejects.toThrow(/explicit select/);
    expect(find).not.toHaveBeenCalled();
    await db.findMany('user', { select: { id: true } });
    expect(find).toHaveBeenCalledWith({ select: { id: true } });
  });

  it('only attendance reference tables are readable', () => {
    expect(READABLE_MODELS).not.toContain('notification');
    expect(READABLE_MODELS).not.toContain('appSetting');
    expect(READABLE_MODELS).toContain('dailyAttendance');
  });

  const dir = path.join(__dirname, '../../scripts');
  const files = [
    path.join(dir, 'attendance-recovery-from-backup.ts'),
    ...fs.readdirSync(path.join(dir, 'attendance-recovery')).map((f) => path.join(dir, 'attendance-recovery', f)),
  ];
  const code = (f: string) => fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

  it('no source file has a create / update / upsert / delete / raw-SQL / transaction call', () => {
    for (const f of files) {
      const c = code(f);
      expect({ f: path.basename(f), hit: c.match(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/) }).toEqual({ f: path.basename(f), hit: null });
      expect({ f: path.basename(f), hit: c.match(/\$(executeRaw|queryRaw|executeRawUnsafe|queryRawUnsafe|transaction)/) }).toEqual({ f: path.basename(f), hit: null });
      expect({ f: path.basename(f), hit: c.match(/\b(db push|seed|DROP|TRUNCATE|INSERT INTO)\b/) }).toEqual({ f: path.basename(f), hit: null });
      // No process can be spawned, so `prisma migrate` / `db push` / psql are unreachable.
      expect({ f: path.basename(f), hit: c.match(/child_process|spawn|execSync|execFile|\bexec\(/) }).toEqual({ f: path.basename(f), hit: null });
    }
  });

  it('only borrows the identity guard from the migration helper, and importing it runs nothing', () => {
    const targets = code(path.join(dir, 'attendance-recovery', 'recovery-targets.ts'));
    expect(targets).toMatch(/import \{ checkStagingIdentity, type StagingRefusal \} from '\.\.\/staging-recovery-migrate';/);
    expect(fs.readFileSync(path.join(dir, 'staging-recovery-migrate.ts'), 'utf8')).toMatch(/if \(require\.main === module\)/);
  });

  it('the only database client constructed is the one inside openReadOnlyDb', () => {
    const holders = files.filter((f) => /new PrismaClient\(/.test(code(f))).map((f) => path.basename(f));
    expect(holders).toEqual(['read-only-db.ts']);
  });

  it('every column bundle-builder reads is selected, so no bundle field is silently lost', () => {
    const builder = code(path.join(__dirname, '../../src/modules/platform/attendance/recovery/bundle-builder.ts'));
    const byVar: Record<string, Record<string, true>> = {
      da: selects.DA_SELECT, s: selects.WORK_SESSION_SELECT, b: selects.BREAK_LOG_SELECT, e: selects.PUNCH_EVIDENCE_SELECT, g: selects.REGULARIZATION_SELECT,
    };
    const missing: string[] = [];
    for (const m of builder.matchAll(/\b(da|s|b|e|g)\??\.([A-Za-z]+)\b/g)) {
      const [, v, prop] = m;
      if (!(prop in byVar[v])) missing.push(`${v}.${prop}`);
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});
