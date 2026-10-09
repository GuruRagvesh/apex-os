/**
 * Attendance recovery — Phase 1 foundation. Pure; no database, no R2.
 *
 * Numbered to the Phase 1 requirement list (R1..R25) so each requirement can be
 * found by its number.
 */
import { buildDayBundle, type BundleLookups } from '../../src/modules/platform/attendance/recovery/bundle-builder';
import { bundleHash, canonicalBundle, CanonicalizationError, diffCanonical } from '../../src/modules/platform/attendance/recovery/bundle-canonical';
import { buildEmployeeIndex, resolveEmployee } from '../../src/modules/platform/attendance/recovery/identity-map';
import { indexPolicies, resolvePolicyReference, type PolicyVersionRow } from '../../src/modules/platform/attendance/recovery/policy-map';
import { classifyDay, legacySessionOnlyMonths, type ClassifyInput } from '../../src/modules/platform/attendance/recovery/reconcile-classify';
import { dayWindow, recoveryWindowBlockers } from '../../src/modules/platform/attendance/recovery/safety-window';
import { matchingTombstones } from '../../src/modules/platform/attendance/recovery/tombstone';
import { DEFAULT_DAMAGE_LIMITS, evaluateDamage, sanitizeDamageLimits } from '../../src/modules/platform/attendance/recovery/damage-limits';
import { readRecoveryConfig, ATTENDANCE_RECOVERY_DEFAULTS } from '../../src/modules/platform/attendance/recovery/recovery-flags';
import { parseRecoveryDocument } from '../../src/modules/platform/attendance/recovery/recovery-document';
import {
  assessRecoverySourceRepeat,
  importClassOf,
  recoveryActionOf,
  validateRecoveryDocument,
  type RecoveryValidationContext,
} from '../../src/modules/platform/attendance/recovery/recovery-validation';
import type { AttendanceDayBundle, BundleDailyAttendance, BundleWorkSession } from '../../src/modules/platform/attendance/recovery/recovery.types';

// ── fixtures ────────────────────────────────────────────────────────────────
const DATE = '2026-08-12';
const TODAY = '2026-10-09';

function da(over: Partial<BundleDailyAttendance> = {}): BundleDailyAttendance {
  return {
    date: DATE, status: 'PRESENT', punchInAt: '2026-08-12T04:30:00.000Z', punchOutAt: '2026-08-12T13:30:00.000Z',
    workedMinutes: 480, breakMinutes: 60, lateMinutes: 0, leaveDeducted: 0, lwpDeducted: 0, calculationReason: null,
    locked: false, lockedAt: null, policyVersion: null, evaluationState: 'FINALIZED', evaluatorVersion: 1, resolverVersion: null,
    evaluatedAt: '2026-08-13T00:00:00.000Z', exceptionFlags: [], sourceFingerprint: null, employeeProfileId: null,
    holidayCalendarReference: null, weeklyOffPolicyId: null, holidayId: null, businessDayOverrideId: null, leaveRequestId: null,
    punchInEvidenceKey: 'in-1', punchOutEvidenceKey: 'out-1', workSessionIds: ['s1'], revision: 1, lastRegularizationId: null,
    ...over,
  };
}
function ws(id: string, over: Partial<BundleWorkSession> = {}): BundleWorkSession {
  return {
    id, date: DATE, loginAt: '2026-08-12T04:30:00.000Z', startWorkAt: '2026-08-12T04:30:00.000Z', logoutAt: '2026-08-12T13:30:00.000Z',
    status: 'LOGGED_OUT', totalLoggedMinutes: 540, totalBreakMinutes: 60, totalIdleMinutes: 0, totalWorkMinutes: 480,
    leaveId: null, autoClosed: false, autoClosedAt: null, closureReason: null, continuationOfSessionId: null, ...over,
  };
}
const ev = (key: string, type: string, at: string) => ({
  idempotencyKey: key, type, businessDate: DATE, serverOccurredAt: at, clientCapturedAt: null, receivedAt: at,
  latitude: null, longitude: null, accuracyMeters: null, locationVerification: 'PENDING', attendanceLocationId: null,
  distanceFromLocationMeters: null, geofenceRadiusMeters: null, accuracyThresholdMeters: null, photoAssetId: null,
  photoObjectKey: null, photoHash: null, photoVerification: 'PENDING', source: 'WEB', deviceMetadata: { ua: 'x', screen: { w: 1, h: 2 } },
  ipAddress: null, workSessionId: 's1', employeeProfileId: null, shiftPolicyReference: null, attendancePolicyReference: null,
  contextResolverVersion: null,
});
function bundle(over: Partial<AttendanceDayBundle> = {}): AttendanceDayBundle {
  return {
    schemaVersion: 1, bundleVersion: 1, employeeId: 'TE-001', businessDate: DATE,
    dailyAttendance: da(),
    workSessions: [ws('s1')],
    breakLogs: [{ id: 'b1', workSessionId: 's1', breakType: 'LUNCH', estimatedMinutes: null, startAt: '2026-08-12T07:30:00.000Z', endAt: '2026-08-12T08:30:00.000Z', durationMinutes: 60, autoDetected: false, note: null, reason: null, source: null }],
    punchEvidence: [ev('in-1', 'PUNCH_IN', '2026-08-12T04:30:00.000Z'), ev('out-1', 'PUNCH_OUT', '2026-08-12T13:30:00.000Z')],
    regularizations: [],
    leaveReferences: [],
    attendancePolicyReference: { policyKey: 'default', version: 3 },
    shiftPolicyReference: { policyKey: 'general', version: 2 },
    provenance: { sourceType: 'LIVE', sourceId: 'database' },
    ...over,
  };
}
const NO_REFS = { missing: [], review: [] };
function input(over: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    employeeId: 'TE-001', businessDate: DATE, current: null, recovery: bundle(),
    identity: { state: 'RESOLVED', userId: 'u1' }, references: NO_REFS, tombstones: [],
    companyToday: TODAY, monthCloseStatus: null, ...over,
  };
}

// ════════════════════════════════════════════════════════════════════════════
describe('Hashing and canonical form', () => {
  it('R1 the same bundle always hashes the same', () => {
    expect(bundleHash(bundle())).toBe(bundleHash(bundle()));
    expect(bundleHash(bundle())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('R2 child order, set order and JSON key order do not change the hash', () => {
    const a = bundle({ workSessions: [ws('s1'), ws('s2')], leaveReferences: [] });
    const b = bundle({
      workSessions: [ws('s2'), ws('s1')],
      punchEvidence: [...bundle().punchEvidence].reverse().map((e) => ({ ...e, deviceMetadata: { screen: { h: 2, w: 1 }, ua: 'x' } })),
      dailyAttendance: da({ exceptionFlags: [] }),
    });
    expect(bundleHash(a)).toBe(bundleHash(b));
    const c = bundle({ dailyAttendance: da({ exceptionFlags: ['B', 'A', 'A'] }) });
    const d = bundle({ dailyAttendance: da({ exceptionFlags: ['A', 'B'] }) });
    expect(bundleHash(c)).toBe(bundleHash(d));
  });

  it('R2 an instant written with an offset hashes like its UTC form; provenance and bundleVersion are not hashed', () => {
    const offset = bundle({ dailyAttendance: da({ punchInAt: '2026-08-12T10:00:00.000+05:30' }) });
    expect(bundleHash(offset)).toBe(bundleHash(bundle()));
    expect(bundleHash(bundle({ bundleVersion: 7, provenance: { sourceType: 'R2_BACKUP_RECOVERY', sourceId: 'x', sourceBackupKey: 'k' } }))).toBe(bundleHash(bundle()));
  });

  it('R3 a meaningful change changes the hash, and the diff names the field (not the value)', () => {
    for (const changed of [
      bundle({ dailyAttendance: da({ status: 'LATE' }) }),
      bundle({ workSessions: [ws('s1', { logoutAt: '2026-08-12T14:00:00.000Z' })] }),
      bundle({ attendancePolicyReference: { policyKey: 'default', version: 4 } }),
      bundle({ leaveReferences: ['leave-1'] }),
    ]) {
      expect(bundleHash(changed)).not.toBe(bundleHash(bundle()));
    }
    const diff = diffCanonical(canonicalBundle(bundle()) as any, canonicalBundle(bundle({ dailyAttendance: da({ status: 'LATE' }) })) as any);
    expect(diff).toEqual(['dailyAttendance.status']);
  });

  it('R3 values that cannot be represented exactly are refused, never coerced', () => {
    expect(() => canonicalBundle(bundle({ dailyAttendance: da({ workedMinutes: 480.5 }) }))).toThrow(CanonicalizationError);
    expect(() => canonicalBundle(bundle({ dailyAttendance: da({ punchInAt: '2026-08-12 10:00' }) }))).toThrow(CanonicalizationError);
    expect(() => canonicalBundle(bundle({ businessDate: '2026-02-30' }))).toThrow(CanonicalizationError);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Identity and policy mapping', () => {
  const index = buildEmployeeIndex([{ id: 'u1', employeeId: 'TE-001' }, { id: 'u2', employeeId: 'TE-002' }, { id: 'u3', employeeId: null }]);

  it('R4 an exact employeeId resolves to exactly one current user', () => {
    expect(resolveEmployee('TE-001', index)).toEqual({ state: 'RESOLVED', userId: 'u1' });
  });
  it('R5 an unknown employeeId is MISSING_REFERENCE, never a near match', () => {
    expect(resolveEmployee('TE-999', index)).toEqual({ state: 'MISSING_REFERENCE' });
    expect(resolveEmployee('te-001', index)).toEqual({ state: 'MISSING_REFERENCE' });
    expect(resolveEmployee('', index)).toEqual({ state: 'MISSING_REFERENCE' });
  });
  it('R6 a duplicated employeeId is CONFLICT', () => {
    const dup = buildEmployeeIndex([{ id: 'u1', employeeId: 'TE-001' }, { id: 'u9', employeeId: 'TE-001' }]);
    expect(resolveEmployee('TE-001', dup)).toEqual({ state: 'CONFLICT', userIds: ['u1', 'u9'] });
  });

  it('R7 policies resolve by (policyKey, version) and the effective window, never by historic id', () => {
    const rows: PolicyVersionRow[] = [
      { id: 'p-new-uuid', policyKey: 'default', version: 3, status: 'SUPERSEDED', effectiveFrom: '2026-07-01', effectiveTo: '2026-09-30' },
      { id: 'p-draft', policyKey: 'default', version: 9, status: 'DRAFT', effectiveFrom: '2026-01-01', effectiveTo: null },
    ];
    const idx = indexPolicies(rows);
    expect(resolvePolicyReference({ policyKey: 'default', version: 3 }, idx, DATE)).toEqual({ state: 'RESOLVED', id: 'p-new-uuid' });
    expect(resolvePolicyReference({ policyKey: 'default', version: 4 }, idx, DATE)).toEqual({ state: 'MISSING_REFERENCE' });
    expect(resolvePolicyReference({ policyKey: 'default', version: 3 }, idx, '2026-10-02')).toEqual({ state: 'NOT_EFFECTIVE_ON_DATE', id: 'p-new-uuid' });
    expect(resolvePolicyReference({ policyKey: 'default', version: 9 }, idx, DATE)).toEqual({ state: 'DRAFT_VERSION', id: 'p-draft' });
  });

  it('R7 the builder translates stored UUIDs into business identity and reports what it cannot translate', () => {
    const lookups: BundleLookups = {
      employeeIdByUserId: new Map([['u1', 'TE-001'], ['u2', 'TE-002']]),
      attendancePolicyKeyById: new Map([['ap-uuid', { policyKey: 'default', version: 3 }]]),
      shiftPolicyKeyById: new Map(),
      holidayCalendarKeyById: new Map(),
    };
    const d = new Date(`${DATE}T00:00:00.000Z`);
    const built = buildDayBundle({
      ownerUserId: 'u1', employeeId: 'TE-001', businessDate: DATE, lookups, provenance: { sourceType: 'LIVE', sourceId: 'db' },
      rows: {
        dailyAttendance: { userId: 'u1', date: d, status: 'PRESENT', workedMinutes: 0, breakMinutes: 0, lateMinutes: 0, leaveDeducted: 0, lwpDeducted: 0, locked: false, evaluationState: 'CALCULATED', evaluatorVersion: 1, exceptionFlags: [], workSessionIds: [], revision: 0, attendancePolicyId: 'ap-uuid', shiftPolicyId: 'unknown-shift', punchInEvidenceId: 'ev-row-1' },
        workSessions: [],
        breakLogs: [],
        punchEvidence: [{ id: 'ev-row-1', userId: 'u1', idempotencyKey: 'k-in', type: 'PUNCH_IN', businessDate: d, serverOccurredAt: d, receivedAt: d, locationVerification: 'PENDING', photoVerification: 'PENDING', source: 'WEB' }],
        regularizations: [{ id: 'g1', userId: 'u2', date: d, requestType: 'MISSING_PUNCH', reason: 'x', status: 'PENDING', entrySource: 'EMPLOYEE_REQUEST', createdById: 'u-gone' }],
      },
    });
    expect(built.bundle.attendancePolicyReference).toEqual({ policyKey: 'default', version: 3 });
    expect(built.bundle.dailyAttendance!.punchInEvidenceKey).toBe('k-in');
    expect(built.problems).toEqual(expect.arrayContaining(['UNRESOLVED_POLICY:dailyAttendance.shiftPolicyId', 'OWNER_MISMATCH:regularization:g1', 'UNRESOLVED_ACTOR:regularization:g1.createdById']));
    expect(JSON.stringify(built.bundle)).not.toMatch(/"userId"/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Classification — the eight states', () => {
  it('R8 IN_SYNC when both sides hash equal', () => {
    const c = classifyDay(input({ current: bundle({ provenance: { sourceType: 'LIVE', sourceId: 'db' } }), recovery: bundle({ provenance: { sourceType: 'R2_BACKUP_RECOVERY', sourceId: 'b' } }) }));
    expect([c.state, c.action]).toEqual(['IN_SYNC', 'NO_ACTION']);
  });

  it('R9 PRODUCTION_ONLY: historical closed day is a mirror candidate; recent day and open session are not', () => {
    expect(classifyDay(input({ current: bundle(), recovery: null }))).toMatchObject({ state: 'PRODUCTION_ONLY', action: 'MIRROR_CANDIDATE' });
    expect(classifyDay(input({ current: bundle({ businessDate: '2026-10-08', dailyAttendance: da({ date: '2026-10-08' }) }), recovery: null, businessDate: '2026-10-08' }))).toMatchObject({ state: 'PRODUCTION_ONLY', action: 'NO_ACTION', reasons: ['NOT_YET_HISTORICAL'] });
    expect(classifyDay(input({ current: bundle({ workSessions: [ws('s1', { logoutAt: null })] }), recovery: null }))).toMatchObject({ action: 'NO_ACTION', reasons: ['OPEN_SESSION'] });
  });

  it('R10 RECOVERY_ONLY after every safety check: eligible, but only a PREVIEW', () => {
    const c = classifyDay(input());
    expect([c.state, c.eligibility, c.action]).toEqual(['RECOVERY_ONLY', 'AUTO_REPAIR_ELIGIBLE', 'RECOVERY_PREVIEW']);
  });

  it('R11 DIFFERENT never overwrites: manual review with field names', () => {
    const c = classifyDay(input({ current: bundle(), recovery: bundle({ dailyAttendance: da({ status: 'LATE', lateMinutes: 12 }) }) }));
    expect([c.state, c.action]).toEqual(['DIFFERENT', 'MANUAL_REVIEW']);
    expect(c.differingFields).toEqual(['dailyAttendance.lateMinutes', 'dailyAttendance.status']);
  });

  it('R12 MISSING_REFERENCE for a missing employee or a missing dependency', () => {
    expect(classifyDay(input({ identity: { state: 'MISSING_REFERENCE' } }))).toMatchObject({ state: 'MISSING_REFERENCE', reasons: ['EMPLOYEE_MISSING'] });
    expect(classifyDay(input({ references: { missing: ['LEAVE_REQUEST_MISSING', 'SHIFT_POLICY_MISSING'], review: [] } }))).toMatchObject({ state: 'MISSING_REFERENCE', eligibility: 'NOT_ELIGIBLE' });
  });

  it('R13 INVALID_BUNDLE rejects a structurally broken recovery bundle', () => {
    expect(classifyDay(input({ recoveryProblems: ['BREAK_LOG_SESSION_NOT_IN_BUNDLE'] }))).toMatchObject({ state: 'INVALID_BUNDLE', action: 'REJECT' });
  });

  it('R14 LEGACY: sessions without DailyAttendance are never synthesized into a day', () => {
    const legacy = bundle({ dailyAttendance: null, businessDate: '2026-07-14', workSessions: [ws('j1', { date: '2026-07-14' })], breakLogs: [], punchEvidence: [] });
    const c = classifyDay(input({ recovery: legacy, businessDate: '2026-07-14', legacyMonth: true }));
    expect([c.state, c.legacySubtype, c.action]).toEqual(['LEGACY_FORMAT', 'LEGACY_SESSION_ONLY', 'MANUAL_REVIEW']);
    expect(c.reasons).toContain('NO_SYNTHESIS');
    expect(legacy.dailyAttendance).toBeNull();
    expect(legacySessionOnlyMonths([
      { month: '2026-07', dailyAttendance: 0, workSessions: 432 },
      { month: '2026-08', dailyAttendance: 70, workSessions: 282 },
      { month: '2026-09', dailyAttendance: 275, workSessions: 505 },
    ])).toEqual(new Set(['2026-07']));
  });

  it('ambiguous employeeId goes to manual review, not to a guess', () => {
    expect(classifyDay(input({ identity: { state: 'CONFLICT', userIds: ['u1', 'u9'] } }))).toMatchObject({ state: 'MANUAL_REVIEW', reasons: ['EMPLOYEE_ID_AMBIGUOUS'] });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Tombstones, safety window, damage limits', () => {
  it('R15 a matching tombstone blocks resurrection', () => {
    const t = (recordType: any, recordId: string | null = null) => ({ id: 't', employeeId: 'TE-001', businessDate: DATE, recordType, recordId, reason: 'duplicate removed by HR' });
    expect(classifyDay(input({ tombstones: [t('DAY')] }))).toMatchObject({ state: 'MANUAL_REVIEW', eligibility: 'NOT_ELIGIBLE', reasons: ['TOMBSTONED', 'TOMBSTONE:DAY'] });
    expect(matchingTombstones(bundle(), [t('WORK_SESSION', 's1')])).toHaveLength(1);
    expect(matchingTombstones(bundle(), [t('WORK_SESSION', 'other')])).toHaveLength(0);
    expect(matchingTombstones(bundle(), [t('PUNCH_EVIDENCE', 'in-1')])).toHaveLength(1);
    expect(matchingTombstones(bundle(), [{ ...t('DAY'), businessDate: '2026-08-13' }])).toHaveLength(0);
  });

  it('R16 an old, finalized day in an open month passes the window', () => {
    expect(dayWindow(DATE, TODAY)).toBe('HISTORICAL');
    expect(recoveryWindowBlockers({ bundle: bundle(), companyToday: TODAY, monthCloseStatus: 'OPEN' })).toEqual([]);
  });

  it('R17 an OLD open session is never eligible (the stale-session auto-close would rewrite it)', () => {
    const open = bundle({ workSessions: [ws('s1', { logoutAt: null, status: 'WORKING' })] });
    expect(recoveryWindowBlockers({ bundle: open, companyToday: TODAY, monthCloseStatus: null })).toEqual(['OPEN_SESSION']);
    expect(classifyDay(input({ recovery: open }))).toMatchObject({ state: 'MANUAL_REVIEW', eligibility: 'NOT_ELIGIBLE' });
  });

  it('R18 today and yesterday are rejected; unfinalized history and payroll-closed months need a human', () => {
    expect(dayWindow('2026-10-09', TODAY)).toBe('LIVE');
    expect(dayWindow('2026-10-08', TODAY)).toBe('SETTLING');
    const at = (d: string) => bundle({ businessDate: d, dailyAttendance: da({ date: d }), punchEvidence: [], workSessions: [ws('s1', { date: d })], breakLogs: [] });
    expect(recoveryWindowBlockers({ bundle: at('2026-10-09'), companyToday: TODAY, monthCloseStatus: null })).toContain('ACTIVE_DAY');
    expect(recoveryWindowBlockers({ bundle: at('2026-10-08'), companyToday: TODAY, monthCloseStatus: null })).toContain('SETTLING_DAY');
    expect(recoveryWindowBlockers({ bundle: bundle({ dailyAttendance: da({ evaluationState: 'CALCULATED' }) }), companyToday: TODAY, monthCloseStatus: null })).toEqual(['NOT_FINALIZED_IN_SOURCE']);
    expect(recoveryWindowBlockers({ bundle: bundle(), companyToday: TODAY, monthCloseStatus: 'SENT' })).toEqual(['MONTH_SETTLED_SENT_MONTH']);
    expect(recoveryWindowBlockers({ bundle: bundle(), companyToday: TODAY, monthCloseStatus: 'FINALIZED' })).toEqual(['MONTH_SETTLED_FINALIZED_MONTH']);
    expect(recoveryWindowBlockers({ bundle: bundle(), companyToday: TODAY, monthCloseStatus: 'REVIEWING' })).toEqual([]);
  });

  it('R19 more than 25 employee-days requires manual approval', () => {
    expect(evaluateDamage({ proposedEmployeeDays: 25, historicalEmployeeDays: 10_000, months: [] }).decision).toBe('OK');
    expect(evaluateDamage({ proposedEmployeeDays: 26, historicalEmployeeDays: 10_000, months: [] })).toMatchObject({ decision: 'MANUAL_APPROVAL_REQUIRED', reasons: ['ABOVE_25_EMPLOYEE_DAYS'] });
  });

  it('R20 hard stop above 5%, on a whole missing month, and with no baseline', () => {
    expect(evaluateDamage({ proposedEmployeeDays: 6, historicalEmployeeDays: 100, months: [] })).toMatchObject({ decision: 'HARD_STOP' });
    expect(evaluateDamage({ proposedEmployeeDays: 3, historicalEmployeeDays: 100, months: [{ month: '2026-08', currentDays: 0, recoveryDays: 3 }] }).reasons).toContain('WHOLE_MONTH_MISSING:2026-08');
    expect(evaluateDamage({ proposedEmployeeDays: 1, historicalEmployeeDays: 0, months: [] })).toMatchObject({ decision: 'HARD_STOP', reasons: ['NO_HISTORICAL_BASELINE'] });
    expect(sanitizeDamageLimits({ manualApprovalAbove: -1, hardStopPercent: 500 })).toEqual(DEFAULT_DAMAGE_LIMITS);
    expect(sanitizeDamageLimits({ manualApprovalAbove: 10, hardStopPercent: 2.5 })).toMatchObject({ manualApprovalAbove: 10, hardStopPercent: 2.5 });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Feature flags (AppSetting)', () => {
  it('every flag defaults OFF; only a literal true turns one on; auto-repair cannot be on alone', () => {
    expect(readRecoveryConfig(undefined).flags).toEqual(ATTENDANCE_RECOVERY_DEFAULTS);
    expect(Object.values(ATTENDANCE_RECOVERY_DEFAULTS).every((v) => v === false)).toBe(true);
    expect(readRecoveryConfig({ ATTENDANCE_RECOVERY_ENABLED: 'true', ATTENDANCE_RECONCILIATION_ENABLED: 1 }).flags.ATTENDANCE_RECOVERY_ENABLED).toBe(false);
    expect(readRecoveryConfig({ ATTENDANCE_AUTO_REPAIR_ENABLED: true }).flags.ATTENDANCE_AUTO_REPAIR_ENABLED).toBe(false);
    expect(readRecoveryConfig({ ATTENDANCE_RECOVERY_ENABLED: true, ATTENDANCE_AUTO_REPAIR_ENABLED: true }).flags.ATTENDANCE_AUTO_REPAIR_ENABLED).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Recovery file validation', () => {
  const doc = (bundles: unknown[], over: Record<string, unknown> = {}) =>
    Buffer.from(JSON.stringify({ format: 'apex-os.attendance-recovery', schemaVersion: 1, source: { sourceType: 'R2_BACKUP_RECOVERY', sourceId: 'backup-1', sourceBackupKey: 'database/daily/x.dump' }, bundles, ...over }));
  const strip = (b: AttendanceDayBundle) => { const { provenance, ...rest } = b; void provenance; return rest; };

  function ctx(over: Partial<RecoveryValidationContext> = {}): RecoveryValidationContext {
    const none = () => new Set<string>();
    return {
      companyToday: TODAY,
      employeeIndex: buildEmployeeIndex([{ id: 'u1', employeeId: 'TE-001' }, { id: 'u2', employeeId: 'TE-002' }]),
      attendancePolicies: indexPolicies([{ id: 'ap', policyKey: 'default', version: 3, status: 'ACTIVE', effectiveFrom: '2026-01-01', effectiveTo: null }]),
      shiftPolicies: indexPolicies([{ id: 'sp', policyKey: 'general', version: 2, status: 'ACTIVE', effectiveFrom: '2026-01-01', effectiveTo: null }]),
      holidayCalendars: indexPolicies([]),
      existingLeaveIds: new Set(['leave-ok']),
      existingIds: { weeklyOffPolicy: none(), holiday: none(), businessDayOverride: none(), employeeProfile: none(), attendanceLocation: none(), workSession: none(), regularization: none() },
      currentBundles: new Map(),
      tombstones: [],
      monthCloseStatus: new Map(),
      takenIds: new Map(),
      historicalEmployeeDays: 10_000,
      currentDaysByMonth: new Map([['2026-08', 900]]),
      priorRecoveryBatches: [],
      ...over,
    };
  }

  it('R21 records the source file SHA-256; an applied repeat is ALREADY_IMPORTED and not classified again', () => {
    const buf = doc([strip(bundle())]);
    const parsed = parseRecoveryDocument(buf);
    expect(parsed.sourceFileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(assessRecoverySourceRepeat(parsed.sourceFileSha256, [{ reference: 'ATI-1', fileSha256: parsed.sourceFileSha256, status: 'APPLIED' }])).toEqual({ state: 'ALREADY_IMPORTED', batches: ['ATI-1'] });
    expect(assessRecoverySourceRepeat(parsed.sourceFileSha256, [{ reference: 'ATI-2', fileSha256: parsed.sourceFileSha256, status: 'READY_FOR_REVIEW' }]).state).toBe('PREVIOUSLY_UPLOADED');
    const r = validateRecoveryDocument(parsed, ctx({ priorRecoveryBatches: [{ reference: 'ATI-1', fileSha256: parsed.sourceFileSha256, status: 'PARTIALLY_APPLIED' }] }));
    expect([r.repeat.state, r.items.length]).toEqual(['ALREADY_IMPORTED', 0]);
  });

  it('identifies new, identical, different, missing employee/policy/leave, legacy, duplicates and invalid structure', () => {
    const identical = bundle({ employeeId: 'TE-002', businessDate: '2026-08-13', dailyAttendance: da({ date: '2026-08-13' }), workSessions: [ws('s9', { date: '2026-08-13' })], breakLogs: [], punchEvidence: [] });
    const identicalCurrent = { ...identical, dailyAttendance: { ...identical.dailyAttendance!, workSessionIds: ['s9'], punchInEvidenceKey: null, punchOutEvidenceKey: null } };
    const different = bundle({ businessDate: '2026-08-14', dailyAttendance: da({ date: '2026-08-14', status: 'LATE' }), punchEvidence: [], workSessions: [ws('s1', { date: '2026-08-14' })], breakLogs: [] });
    const fix = (b: AttendanceDayBundle) => ({ ...b, dailyAttendance: b.dailyAttendance ? { ...b.dailyAttendance, punchInEvidenceKey: null, punchOutEvidenceKey: null } : null });
    const bundles = [
      strip(bundle()), // NEW
      strip(fix(identicalCurrent)), // MATCH
      strip(fix(different)), // CHANGE
      strip({ ...fix(bundle({ businessDate: '2026-08-15', dailyAttendance: da({ date: '2026-08-15' }), punchEvidence: [], workSessions: [ws('s1', { date: '2026-08-15' })], breakLogs: [] })), employeeId: 'TE-404' }), // missing employee
      strip(fix(bundle({ businessDate: '2026-08-17', dailyAttendance: da({ date: '2026-08-17' }), punchEvidence: [], workSessions: [ws('s1', { date: '2026-08-17' })], breakLogs: [], shiftPolicyReference: { policyKey: 'general', version: 99 } }))), // missing policy
      strip(fix(bundle({ businessDate: '2026-08-18', dailyAttendance: da({ date: '2026-08-18', leaveRequestId: 'leave-gone' }), leaveReferences: ['leave-gone'], punchEvidence: [], workSessions: [ws('s1', { date: '2026-08-18' })], breakLogs: [] }))), // missing leave
      strip(bundle({ businessDate: '2026-07-14', dailyAttendance: null, workSessions: [ws('j1', { date: '2026-07-14' })], breakLogs: [], punchEvidence: [] })), // legacy
      { employeeId: 'TE-001', businessDate: '2026-08-19', dailyAttendance: { ...da({ date: '2026-08-19' }), surprise: 1 } }, // unknown field
      { employeeId: 'TE-001', businessDate: '2026-08-20', workSessions: [ws('d1', { date: '2026-08-20' })] }, // duplicate key (1)
      { employeeId: 'TE-001', businessDate: '2026-08-20', workSessions: [ws('d2', { date: '2026-08-20' })] }, // duplicate key (2)
    ];
    const parsed = parseRecoveryDocument(doc(bundles));
    const current = new Map([['TE-002|2026-08-13', fix(identicalCurrent) as AttendanceDayBundle], ['TE-001|2026-08-14', fix(bundle({ businessDate: '2026-08-14', dailyAttendance: da({ date: '2026-08-14' }), punchEvidence: [], workSessions: [ws('s1', { date: '2026-08-14' })], breakLogs: [] }))]]);
    const r = validateRecoveryDocument(parsed, ctx({ currentBundles: current }));
    const byIndex = (i: number) => r.items.find((x) => x.index === i)!;
    expect(byIndex(0)).toMatchObject({ importClass: 'NEW', recoveryAction: 'POTENTIALLY_RECOVERABLE' });
    expect(byIndex(1)).toMatchObject({ importClass: 'MATCH', recoveryAction: 'NO_ACTION' });
    expect(byIndex(2)).toMatchObject({ importClass: 'CHANGE', recoveryAction: 'MANUAL_REVIEW' });
    expect(byIndex(3).classification).toMatchObject({ state: 'MISSING_REFERENCE', reasons: ['EMPLOYEE_MISSING'] });
    expect(byIndex(4).classification).toMatchObject({ state: 'MISSING_REFERENCE', reasons: ['SHIFT_POLICY_MISSING'] });
    expect(byIndex(5).classification).toMatchObject({ state: 'MISSING_REFERENCE', reasons: ['LEAVE_REQUEST_MISSING'] });
    expect(byIndex(6).classification).toMatchObject({ state: 'LEGACY_FORMAT', legacySubtype: 'LEGACY_SESSION_ONLY' });
    expect(byIndex(7)).toMatchObject({ importClass: 'INVALID', recoveryAction: 'REJECT' });
    expect(byIndex(7).classification.reasons[0]).toMatch(/^INVALID_FIELD:dailyAttendance/);
    expect(byIndex(8).classification.reasons).toContain('DUPLICATE_BUNDLE_KEY');
    expect(byIndex(9).classification.reasons).toContain('DUPLICATE_BUNDLE_KEY');
    expect(r.summary).toMatchObject({ employeeDays: 10, newEmployeeDays: 1, identical: 1, missingReferences: 3, invalid: 3, legacy: 1, proposedForInsertion: 1, legacyMonths: ['2026-07'] });
    expect(r.damage.decision).toBe('OK');
  });

  it('a declared hash that does not match, and broken internal references, are INVALID', () => {
    const bad = { ...strip(bundle()), bundleHash: '0'.repeat(64) };
    const brokenBreak = strip(bundle({ breakLogs: [{ ...bundle().breakLogs[0], workSessionId: 'nope' }] }));
    const p = parseRecoveryDocument(doc([bad, { ...brokenBreak, businessDate: '2026-08-21', dailyAttendance: da({ date: '2026-08-21' }), punchEvidence: [], workSessions: [ws('s1', { date: '2026-08-21' })] }]));
    expect(p.bundles[0].problems).toContain('BUNDLE_HASH_MISMATCH');
    expect(p.bundles[1].problems).toContain('BREAK_LOG_SESSION_NOT_IN_BUNDLE');
    expect(parseRecoveryDocument(Buffer.from('not json')).fileProblems).toEqual(['NOT_JSON']);
    expect(parseRecoveryDocument(doc([], { format: 'something-else' })).fileProblems).toContain('UNKNOWN_FORMAT');
  });

  it('an id already used in the target by another day blocks eligibility', () => {
    const parsed = parseRecoveryDocument(doc([strip(bundle())]));
    const r = validateRecoveryDocument(parsed, ctx({ takenIds: new Map([['WorkSession:s1', 'TE-001|2026-08-01']]) }));
    expect(r.items[0].classification).toMatchObject({ state: 'MANUAL_REVIEW', reasons: ['NATURAL_KEY_TAKEN'] });
  });

  it('import classes follow the stricter recovery rule', () => {
    expect(recoveryActionOf('NEW')).toBe('POTENTIALLY_RECOVERABLE');
    expect(recoveryActionOf('MATCH')).toBe('NO_ACTION');
    expect(recoveryActionOf('CHANGE')).toBe('MANUAL_REVIEW');
    expect(recoveryActionOf('CONFLICT')).toBe('MANUAL_REVIEW');
    expect(recoveryActionOf('INVALID')).toBe('REJECT');
    expect(importClassOf({ state: 'RECOVERY_ONLY', eligibility: 'NOT_ELIGIBLE' } as any)).toBe('CONFLICT');
    expect(importClassOf({ state: 'PRODUCTION_ONLY' } as any)).toBe('CONFLICT');
  });
});
