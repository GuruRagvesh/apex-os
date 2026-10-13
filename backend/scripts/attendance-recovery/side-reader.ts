/**
 * Reads one database's attendance for a date range and turns it into the
 * EXISTING AttendanceDayBundle (buildDayBundle). Read-only: the only database
 * handle used is a ReadOnlyDb, and every query names its columns.
 *
 * This mirrors RecoveryReadService.currentBundles grouping on purpose, but with
 * explicit column lists so a restored backup whose schema predates today's
 * Prisma schema can still be read. A column the database lacks fails loudly
 * (Prisma names it); nothing is defaulted or invented.
 */
import { formatInTimeZone } from 'date-fns-tz';
import { buildDayBundle, type BundleLookups } from '../../src/modules/platform/attendance/recovery/bundle-builder';
import { indexPolicies, type PolicyVersionRow } from '../../src/modules/platform/attendance/recovery/policy-map';
import { buildEmployeeIndex, type EmployeeIndex } from '../../src/modules/platform/attendance/recovery/identity-map';
import type { ReferenceContext } from '../../src/modules/platform/attendance/recovery/reference-check';
import { bundleKey, type AttendanceDayBundle, type PolicyReference, type RecoveryTombstone } from '../../src/modules/platform/attendance/recovery/recovery.types';
import type { ReadOnlyDb } from './read-only-db';

const cols = <T extends string>(...names: T[]): Record<T, true> => Object.fromEntries(names.map((n) => [n, true])) as Record<T, true>;

export const USER_SELECT = cols('id', 'employeeId', 'name', 'departmentId');
export const POLICY_SELECT = cols('id', 'policyKey', 'version', 'status', 'effectiveFrom', 'effectiveTo');
export const DA_SELECT = cols(
  'id', 'userId', 'date', 'status', 'punchInAt', 'punchOutAt', 'workedMinutes', 'breakMinutes', 'lateMinutes',
  'leaveDeducted', 'lwpDeducted', 'calculationReason', 'locked', 'lockedAt', 'policyVersion', 'evaluationState',
  'evaluatorVersion', 'resolverVersion', 'evaluatedAt', 'exceptionFlags', 'sourceFingerprint', 'employeeProfileId',
  'attendancePolicyId', 'shiftPolicyId', 'holidayCalendarId', 'weeklyOffPolicyId', 'holidayId', 'businessDayOverrideId',
  'leaveRequestId', 'punchInEvidenceId', 'punchOutEvidenceId', 'workSessionIds', 'revision', 'lastRegularizationId',
);
export const WORK_SESSION_SELECT = cols(
  'id', 'userId', 'date', 'loginAt', 'startWorkAt', 'logoutAt', 'status', 'totalLoggedMinutes', 'totalBreakMinutes',
  'totalIdleMinutes', 'totalWorkMinutes', 'leaveId', 'autoClosed', 'autoClosedAt', 'closureReason', 'continuationOfSessionId',
);
export const BREAK_LOG_SELECT = cols(
  'id', 'userId', 'workSessionId', 'breakType', 'estimatedMinutes', 'startAt', 'endAt', 'durationMinutes',
  'autoDetected', 'note', 'reason', 'source',
);
export const PUNCH_EVIDENCE_SELECT = cols(
  'id', 'userId', 'type', 'businessDate', 'serverOccurredAt', 'clientCapturedAt', 'receivedAt', 'latitude', 'longitude',
  'accuracyMeters', 'locationVerification', 'attendanceLocationId', 'distanceFromLocationMeters', 'geofenceRadiusMeters',
  'accuracyThresholdMeters', 'photoAssetId', 'photoObjectKey', 'photoHash', 'photoVerification', 'source', 'deviceMetadata',
  'ipAddress', 'workSessionId', 'employeeProfileId', 'shiftPolicyId', 'attendancePolicyId', 'contextResolverVersion', 'idempotencyKey',
);
export const REGULARIZATION_SELECT = cols(
  'id', 'userId', 'date', 'requestType', 'reason', 'requestedPunchIn', 'requestedPunchOut', 'basedOnFingerprint',
  'proposedStatus', 'status', 'managerApproverId', 'managerDecisionAt', 'hrApproverId', 'hrDecisionAt', 'createdById',
  'entrySource', 'recoveryReason', 'employeeInformedAt', 'actorRoleAtEntry', 'originalPunchIn', 'originalPunchOut',
);

const CHUNK = 1000;
export const dateOnly = (d: string) => new Date(`${d}T00:00:00.000Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export const companyTimezone = (env: NodeJS.ProcessEnv = process.env) => env.COMPANY_TIMEZONE || 'Asia/Kolkata';
export const companyBusinessDate = (d: Date, tz: string) => formatInTimeZone(d, tz, 'yyyy-MM-dd');

async function byIds(db: ReadOnlyDb, model: Parameters<ReadOnlyDb['findMany']>[0], field: string, ids: Iterable<string>, select: Record<string, true>, where: Record<string, unknown> = {}): Promise<any[]> {
  const list = [...new Set([...ids].filter(Boolean))];
  const out: any[] = [];
  for (let i = 0; i < list.length; i += CHUNK) {
    out.push(...(await db.findMany(model, { select, where: { ...where, [field]: { in: list.slice(i, i + CHUNK) } } })));
  }
  return out;
}

export interface UserRow { id: string; employeeId: string | null; name: string; departmentId: string | null }

export interface Side {
  users: UserRow[];
  departmentNameById: Map<string, string>;
  policies: { attendance: PolicyVersionRow[]; shift: PolicyVersionRow[]; holidayCalendar: PolicyVersionRow[] };
  lookups: BundleLookups;
  bundles: Map<string, AttendanceDayBundle>;
  problems: Map<string, string[]>;
  unkeyedUserIds: string[];
  leaveTypeById: Map<string, string>;
  /** Raw stored row counts for the range, before grouping into days. */
  rows: { dailyAttendance: number; workSessions: number; breakLogs: number; punchEvidence: number; regularizations: number };
}

function policyRows(rows: any[], tz: string): PolicyVersionRow[] {
  return rows.map((r) => ({
    id: r.id,
    policyKey: r.policyKey,
    version: r.version,
    status: String(r.status),
    effectiveFrom: companyBusinessDate(r.effectiveFrom, tz),
    effectiveTo: r.effectiveTo ? companyBusinessDate(r.effectiveTo, tz) : null,
  }));
}

export async function readSide(db: ReadOnlyDb, from: string, to: string, provenanceId: string, tz: string): Promise<Side> {
  const users: UserRow[] = await db.findMany('user', { select: USER_SELECT });
  const departments = await db.findMany('department', { select: cols('id', 'name') });
  const [att, shift, cal] = await Promise.all([
    db.findMany('attendancePolicy', { select: POLICY_SELECT }),
    db.findMany('shiftPolicy', { select: POLICY_SELECT }),
    db.findMany('holidayCalendar', { select: POLICY_SELECT }),
  ]);
  const policies = { attendance: policyRows(att, tz), shift: policyRows(shift, tz), holidayCalendar: policyRows(cal, tz) };
  const keyMap = (rows: PolicyVersionRow[]) => new Map<string, PolicyReference>(rows.map((r) => [r.id, { policyKey: r.policyKey, version: r.version }]));
  const lookups: BundleLookups = {
    employeeIdByUserId: new Map(users.map((u) => [u.id, u.employeeId])),
    attendancePolicyKeyById: keyMap(policies.attendance),
    shiftPolicyKeyById: keyMap(policies.shift),
    holidayCalendarKeyById: keyMap(policies.holidayCalendar),
  };

  const range = { gte: dateOnly(from), lte: dateOnly(to) };
  const da = await db.findMany('dailyAttendance', { select: DA_SELECT, where: { date: range } });
  let sessions = await db.findMany('workSession', { select: WORK_SESSION_SELECT, where: { date: range } });
  const known = new Set(sessions.map((s) => s.id));
  sessions = sessions.concat(await byIds(db, 'workSession', 'id', da.flatMap((r) => r.workSessionIds).filter((id: string) => !known.has(id)), WORK_SESSION_SELECT));
  const breaks = await byIds(db, 'breakLog', 'workSessionId', sessions.map((s) => s.id), BREAK_LOG_SELECT);
  const evidence = await db.findMany('attendancePunchEvidence', { select: PUNCH_EVIDENCE_SELECT, where: { businessDate: range } });
  const regs = await db.findMany('attendanceRegularization', { select: REGULARIZATION_SELECT, where: { date: range } });
  const leaves = await byIds(db, 'leaveRequest', 'id', da.map((r) => r.leaveRequestId).filter(Boolean), cols('id', 'type'));

  type Rows = { userId: string; date: string; da: any; s: any[]; b: any[]; e: any[]; g: any[] };
  const days = new Map<string, Rows>();
  const at = (userId: string, date: string) => {
    const k = `${userId}|${date}`;
    if (!days.has(k)) days.set(k, { userId, date, da: null, s: [], b: [], e: [], g: [] });
    return days.get(k)!;
  };
  const sessionHome = new Map<string, string>();
  for (const r of da) {
    at(r.userId, ymd(r.date)).da = r;
    for (const sid of r.workSessionIds) if (!sessionHome.has(sid)) sessionHome.set(sid, `${r.userId}|${ymd(r.date)}`);
  }
  const sessionDay = new Map<string, Rows>();
  for (const s of sessions) {
    const home = sessionHome.get(s.id);
    const rows = home ? days.get(home)! : at(s.userId, ymd(s.date));
    rows.s.push(s);
    sessionDay.set(s.id, rows);
  }
  for (const b of breaks) sessionDay.get(b.workSessionId)?.b.push(b);
  for (const e of evidence) at(e.userId, ymd(e.businessDate)).e.push(e);
  for (const g of regs) at(g.userId, ymd(g.date)).g.push(g);

  const bundles = new Map<string, AttendanceDayBundle>();
  const problems = new Map<string, string[]>();
  const unkeyed = new Set<string>();
  for (const rows of days.values()) {
    if (rows.date < from || rows.date > to) continue;
    const employeeId = lookups.employeeIdByUserId.get(rows.userId);
    if (!employeeId) { unkeyed.add(rows.userId); continue; }
    const built = buildDayBundle({
      ownerUserId: rows.userId,
      employeeId,
      businessDate: rows.date,
      rows: { dailyAttendance: rows.da, workSessions: rows.s, breakLogs: rows.b, punchEvidence: rows.e, regularizations: rows.g },
      lookups,
      provenance: { sourceType: 'R2_BACKUP_RECOVERY', sourceId: provenanceId },
    });
    const key = bundleKey(employeeId, rows.date);
    bundles.set(key, built.bundle);
    if (built.problems.length) problems.set(key, built.problems);
  }

  return {
    users,
    departmentNameById: new Map(departments.map((d: any) => [d.id, d.name])),
    policies,
    lookups,
    bundles,
    problems,
    unkeyedUserIds: [...unkeyed].sort(),
    leaveTypeById: new Map(leaves.map((l: any) => [l.id, String(l.type)])),
    rows: { dailyAttendance: da.length, workSessions: sessions.length, breakLogs: breaks.length, punchEvidence: evidence.length, regularizations: regs.length },
  };
}

export interface TargetFacts {
  referenceContext: ReferenceContext;
  employeeIndex: EmployeeIndex;
  tombstones: RecoveryTombstone[];
  /** True when the tombstone table does not exist in the target: none could have been recorded, but apply must not rely on that. */
  tombstoneTableAbsent: boolean;
  monthClose: Map<string, string>;
  /** Source ids already used in the target under some other day, per source bundle key. */
  idCollisions: Map<string, string[]>;
}

/** Facts about the TARGET needed to judge the SOURCE bundles: everything they reference must already exist. */
export async function readTargetFacts(db: ReadOnlyDb, target: Side, sourceBundles: Map<string, AttendanceDayBundle>, from: string, to: string): Promise<TargetFacts> {
  const bundles = [...sourceBundles.values()];
  const ids = (pick: (b: AttendanceDayBundle) => Array<string | null | undefined>) => new Set(bundles.flatMap(pick).filter(Boolean) as string[]);
  const existing = async (model: Parameters<ReadOnlyDb['findMany']>[0], wanted: Set<string>) =>
    new Set((await byIds(db, model, 'id', wanted, cols('id'))).map((r) => r.id as string));

  const leaveIds = ids((b) => b.leaveReferences);
  const sessionIds = ids((b) => [...b.workSessions.map((s) => s.id), ...b.workSessions.map((s) => s.continuationOfSessionId), ...b.punchEvidence.map((e) => e.workSessionId)]);
  const regIds = ids((b) => [...b.regularizations.map((g) => g.id), b.dailyAttendance?.lastRegularizationId]);

  const referenceContext: ReferenceContext = {
    employeeIndex: buildEmployeeIndex(target.users),
    attendancePolicies: indexPolicies(target.policies.attendance),
    shiftPolicies: indexPolicies(target.policies.shift),
    holidayCalendars: indexPolicies(target.policies.holidayCalendar),
    existingLeaveIds: await existing('leaveRequest', leaveIds),
    existingIds: {
      weeklyOffPolicy: await existing('weeklyOffPolicy', ids((b) => [b.dailyAttendance?.weeklyOffPolicyId])),
      holiday: await existing('holiday', ids((b) => [b.dailyAttendance?.holidayId])),
      businessDayOverride: await existing('businessDayOverride', ids((b) => [b.dailyAttendance?.businessDayOverrideId])),
      employeeProfile: await existing('employeeAttendanceProfile', ids((b) => [b.dailyAttendance?.employeeProfileId, ...b.punchEvidence.map((e) => e.employeeProfileId)])),
      attendanceLocation: await existing('attendanceLocation', ids((b) => b.punchEvidence.map((e) => e.attendanceLocationId))),
      workSession: await existing('workSession', sessionIds),
      regularization: await existing('attendanceRegularization', regIds),
    },
  };

  // Ids a source-only day would insert that the target already holds under another day.
  const takenSessions = new Set((await byIds(db, 'workSession', 'id', ids((b) => b.workSessions.map((s) => s.id)), cols('id'))).map((r) => r.id as string));
  const takenBreaks = new Set((await byIds(db, 'breakLog', 'id', ids((b) => b.breakLogs.map((x) => x.id)), cols('id'))).map((r) => r.id as string));
  const takenRegs = new Set((await byIds(db, 'attendanceRegularization', 'id', ids((b) => b.regularizations.map((g) => g.id)), cols('id'))).map((r) => r.id as string));
  const evidenceRows = await byIds(db, 'attendancePunchEvidence', 'idempotencyKey', ids((b) => b.punchEvidence.map((e) => e.idempotencyKey)), cols('userId', 'idempotencyKey'));
  const takenEvidence = new Set<string>();
  for (const r of evidenceRows) {
    const emp = target.lookups.employeeIdByUserId.get(r.userId);
    if (emp) takenEvidence.add(`${emp}|${r.idempotencyKey}`);
  }
  const idCollisions = new Map<string, string[]>();
  for (const [key, b] of sourceBundles) {
    if (target.bundles.has(key)) continue; // only a source-only day inserts anything
    const hit = [
      ...b.workSessions.filter((s) => takenSessions.has(s.id)).map((s) => `WorkSession:${s.id}`),
      ...b.breakLogs.filter((x) => takenBreaks.has(x.id)).map((x) => `BreakLog:${x.id}`),
      ...b.regularizations.filter((g) => takenRegs.has(g.id)).map((g) => `AttendanceRegularization:${g.id}`),
      ...b.punchEvidence.filter((e) => takenEvidence.has(`${b.employeeId}|${e.idempotencyKey}`)).map((e) => `AttendancePunchEvidence:${e.idempotencyKey}`),
    ];
    if (hit.length) idCollisions.set(key, hit);
  }

  let tombstones: RecoveryTombstone[] = [];
  let tombstoneTableAbsent = false;
  try {
    const rows = await byIds(
      db, 'attendanceRecoveryTombstone', 'employeeId', new Set(bundles.map((b) => b.employeeId)),
      cols('id', 'employeeId', 'businessDate', 'recordType', 'recordId', 'reason'),
      { businessDate: { gte: dateOnly(from), lte: dateOnly(to) } },
    );
    tombstones = rows.map((t) => ({ id: t.id, employeeId: t.employeeId, businessDate: ymd(t.businessDate), recordType: t.recordType, recordId: t.recordId ?? null, reason: t.reason }));
  } catch (err: any) {
    // P2021: the table does not exist (the recovery migrations are not applied to this database yet).
    if (err?.code !== 'P2021') throw err;
    tombstoneTableAbsent = true;
  }

  const months = [...new Set(bundles.map((b) => b.businessDate.slice(0, 7)))];
  const closes = await byIds(db, 'attendanceMonthClose', 'month', months, cols('month', 'status'));

  return {
    referenceContext,
    employeeIndex: referenceContext.employeeIndex,
    tombstones,
    tombstoneTableAbsent,
    monthClose: new Map(closes.map((c: any) => [c.month, String(c.status)])),
    idCollisions,
  };
}
