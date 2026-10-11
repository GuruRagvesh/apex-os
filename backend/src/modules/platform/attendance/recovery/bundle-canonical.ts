import { createHash } from 'crypto';
import { RECOVERY_SCHEMA_VERSION, type AttendanceDayBundle } from './recovery.types';

/**
 * Canonical form and hash of an AttendanceDayBundle.
 *
 * The same logical day must always produce the same SHA-256, wherever it was
 * read from and in whatever order its rows arrived. So the canonical form:
 *
 *   - lists every field of every record explicitly (missing → null), so a
 *     source that omits a null and one that writes it agree;
 *   - normalises instants to ISO-8601 UTC and business dates to YYYY-MM-DD;
 *   - sorts child records by their stable key (sessions, breaks and
 *     regularizations by id; punch evidence by idempotencyKey) and set-like
 *     arrays (exceptionFlags, workSessionIds, leaveReferences) by value;
 *   - sorts object keys recursively, including inside JSON device metadata;
 *   - EXCLUDES provenance and bundleVersion (where a bundle came from, and which
 *     stored revision it is, are not attendance facts).
 *
 * schemaVersion IS included: a future format must never hash equal to this one.
 *
 * Every value that cannot be represented exactly raises CanonicalizationError,
 * which the recovery-file validator turns into INVALID_BUNDLE. Nothing is
 * coerced into a plausible value.
 */

export type FieldKind =
  | 'string'
  | 'int'
  | 'float'
  | 'bool'
  | 'datetime'
  | 'date'
  | 'json'
  | 'stringSet'
  | 'policyRef';

interface FieldSpec {
  kind: FieldKind;
  nullable: boolean;
}
const f = (kind: FieldKind, nullable = true): FieldSpec => ({ kind, nullable });

export const DAILY_ATTENDANCE_FIELDS: Record<string, FieldSpec> = {
  date: f('date', false), status: f('string', false), punchInAt: f('datetime'), punchOutAt: f('datetime'),
  workedMinutes: f('int', false), breakMinutes: f('int', false), lateMinutes: f('int', false),
  leaveDeducted: f('float', false), lwpDeducted: f('float', false), calculationReason: f('string'),
  locked: f('bool', false), lockedAt: f('datetime'), policyVersion: f('string'),
  evaluationState: f('string', false), evaluatorVersion: f('int', false), resolverVersion: f('int'),
  evaluatedAt: f('datetime'), exceptionFlags: f('stringSet', false), sourceFingerprint: f('string'),
  employeeProfileId: f('string'), holidayCalendarReference: f('policyRef'), weeklyOffPolicyId: f('string'),
  holidayId: f('string'), businessDayOverrideId: f('string'), leaveRequestId: f('string'),
  punchInEvidenceKey: f('string'), punchOutEvidenceKey: f('string'), workSessionIds: f('stringSet', false),
  revision: f('int', false), lastRegularizationId: f('string'),
};

export const WORK_SESSION_FIELDS: Record<string, FieldSpec> = {
  id: f('string', false), date: f('date', false), loginAt: f('datetime'), startWorkAt: f('datetime'),
  logoutAt: f('datetime'), status: f('string', false), totalLoggedMinutes: f('int', false),
  totalBreakMinutes: f('int', false), totalIdleMinutes: f('int', false), totalWorkMinutes: f('int', false),
  leaveId: f('string'), autoClosed: f('bool', false), autoClosedAt: f('datetime'), closureReason: f('string'),
  continuationOfSessionId: f('string'),
};

export const BREAK_LOG_FIELDS: Record<string, FieldSpec> = {
  id: f('string', false), workSessionId: f('string', false), breakType: f('string', false),
  estimatedMinutes: f('int'), startAt: f('datetime', false), endAt: f('datetime'), durationMinutes: f('int'),
  autoDetected: f('bool', false), note: f('string'), reason: f('string'), source: f('string'),
};

export const PUNCH_EVIDENCE_FIELDS: Record<string, FieldSpec> = {
  idempotencyKey: f('string', false), type: f('string', false), businessDate: f('date', false),
  serverOccurredAt: f('datetime', false), clientCapturedAt: f('datetime'), receivedAt: f('datetime', false),
  latitude: f('float'), longitude: f('float'), accuracyMeters: f('float'), locationVerification: f('string', false),
  attendanceLocationId: f('string'), distanceFromLocationMeters: f('float'), geofenceRadiusMeters: f('int'),
  accuracyThresholdMeters: f('int'), photoAssetId: f('string'), photoObjectKey: f('string'), photoHash: f('string'),
  photoVerification: f('string', false), source: f('string', false), deviceMetadata: f('json'), ipAddress: f('string'),
  workSessionId: f('string'), employeeProfileId: f('string'), shiftPolicyReference: f('policyRef'),
  attendancePolicyReference: f('policyRef'), contextResolverVersion: f('int'),
};

export const REGULARIZATION_FIELDS: Record<string, FieldSpec> = {
  id: f('string', false), date: f('date', false), requestType: f('string', false), reason: f('string', false),
  requestedPunchIn: f('datetime'), requestedPunchOut: f('datetime'), basedOnFingerprint: f('string'),
  proposedStatus: f('string'), status: f('string', false), managerApproverEmployeeId: f('string'),
  managerDecisionAt: f('datetime'), hrApproverEmployeeId: f('string'), hrDecisionAt: f('datetime'),
  createdByEmployeeId: f('string'), entrySource: f('string', false), recoveryReason: f('string'),
  employeeInformedAt: f('datetime'), actorRoleAtEntry: f('string'), originalPunchIn: f('datetime'),
  originalPunchOut: f('datetime'),
};

export class CanonicalizationError extends Error {
  constructor(readonly path: string, readonly problem: string) {
    super(`${path}: ${problem}`);
    this.name = 'CanonicalizationError';
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Recursively key-sorted copy of a JSON value. */
export function sortJson(value: unknown, path = 'json'): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((v, i) => sortJson(v, `${path}[${i}]`));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) out[k] = sortJson((value as any)[k], `${path}.${k}`);
    return out;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CanonicalizationError(path, 'non-finite number');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function canonValue(spec: FieldSpec, v: unknown, path: string): unknown {
  if (v === null || v === undefined) {
    if (!spec.nullable) throw new CanonicalizationError(path, 'required value missing');
    return spec.kind === 'stringSet' ? [] : null;
  }
  switch (spec.kind) {
    case 'string':
      if (typeof v !== 'string') throw new CanonicalizationError(path, 'expected text');
      return v;
    case 'int':
      if (typeof v !== 'number' || !Number.isInteger(v)) throw new CanonicalizationError(path, 'expected whole number');
      return Object.is(v, -0) ? 0 : v;
    case 'float':
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new CanonicalizationError(path, 'expected number');
      return Object.is(v, -0) ? 0 : v;
    case 'bool':
      if (typeof v !== 'boolean') throw new CanonicalizationError(path, 'expected true/false');
      return v;
    case 'datetime': {
      const d = v instanceof Date ? v : typeof v === 'string' ? new Date(v) : null;
      if (!d || Number.isNaN(d.getTime())) throw new CanonicalizationError(path, 'expected an ISO-8601 instant');
      if (typeof v === 'string' && !/T.*(Z|[+-]\d{2}:\d{2})$/.test(v)) {
        throw new CanonicalizationError(path, 'instant must carry an explicit UTC offset');
      }
      return d.toISOString();
    }
    case 'date': {
      if (v instanceof Date) {
        if (Number.isNaN(v.getTime())) throw new CanonicalizationError(path, 'invalid date');
        return v.toISOString().slice(0, 10);
      }
      if (typeof v !== 'string' || !isRealDate(v)) throw new CanonicalizationError(path, 'expected YYYY-MM-DD');
      return v;
    }
    case 'json':
      return sortJson(v, path);
    case 'stringSet': {
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new CanonicalizationError(path, 'expected a list of text');
      return [...new Set(v as string[])].sort();
    }
    case 'policyRef': {
      const r = v as any;
      if (typeof r !== 'object' || typeof r.policyKey !== 'string' || !r.policyKey || !Number.isInteger(r.version)) {
        throw new CanonicalizationError(path, 'expected { policyKey, version }');
      }
      return { policyKey: r.policyKey, version: r.version };
    }
    default:
      throw new CanonicalizationError(path, 'unknown field kind');
  }
}

/** Every field of the spec, in key order; unknown fields are refused when `strict`. */
export function canonicalRecord(
  spec: Record<string, FieldSpec>,
  rec: Record<string, unknown>,
  path: string,
  strict = false,
): Record<string, unknown> {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) throw new CanonicalizationError(path, 'expected a record');
  if (strict) {
    const unknown = Object.keys(rec).filter((k) => !(k in spec));
    if (unknown.length) throw new CanonicalizationError(path, `unknown field(s): ${unknown.sort().join(', ')}`);
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(spec).sort()) out[k] = canonValue(spec[k], rec[k], `${path}.${k}`);
  return out;
}

const sortBy = <T>(rows: T[], key: (r: T) => string) =>
  [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

/** The hashed content of a bundle. */
export function canonicalBundle(bundle: AttendanceDayBundle, strict = false): Record<string, unknown> {
  if (typeof bundle.employeeId !== 'string' || !bundle.employeeId.trim()) throw new CanonicalizationError('employeeId', 'required');
  if (typeof bundle.businessDate !== 'string' || !isRealDate(bundle.businessDate)) throw new CanonicalizationError('businessDate', 'expected YYYY-MM-DD');
  const list = (v: unknown, path: string): any[] => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) throw new CanonicalizationError(path, 'expected a list');
    return v;
  };
  const sessions = list(bundle.workSessions, 'workSessions').map((r, i) => canonicalRecord(WORK_SESSION_FIELDS, r, `workSessions[${i}]`, strict));
  const breaks = list(bundle.breakLogs, 'breakLogs').map((r, i) => canonicalRecord(BREAK_LOG_FIELDS, r, `breakLogs[${i}]`, strict));
  const evidence = list(bundle.punchEvidence, 'punchEvidence').map((r, i) => canonicalRecord(PUNCH_EVIDENCE_FIELDS, r, `punchEvidence[${i}]`, strict));
  const regs = list(bundle.regularizations, 'regularizations').map((r, i) => canonicalRecord(REGULARIZATION_FIELDS, r, `regularizations[${i}]`, strict));
  const leaves = list(bundle.leaveReferences, 'leaveReferences');
  if (leaves.some((x) => typeof x !== 'string' || !x)) throw new CanonicalizationError('leaveReferences', 'expected a list of ids');
  return {
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    employeeId: bundle.employeeId,
    businessDate: bundle.businessDate,
    dailyAttendance: bundle.dailyAttendance ? canonicalRecord(DAILY_ATTENDANCE_FIELDS, bundle.dailyAttendance as any, 'dailyAttendance', strict) : null,
    workSessions: sortBy(sessions, (r) => r.id as string),
    breakLogs: sortBy(breaks, (r) => r.id as string),
    punchEvidence: sortBy(evidence, (r) => r.idempotencyKey as string),
    regularizations: sortBy(regs, (r) => r.id as string),
    leaveReferences: [...new Set(leaves as string[])].sort(),
    attendancePolicyReference: canonValue(f('policyRef'), bundle.attendancePolicyReference, 'attendancePolicyReference'),
    shiftPolicyReference: canonValue(f('policyRef'), bundle.shiftPolicyReference, 'shiftPolicyReference'),
  };
}

/** JSON with object keys sorted at every level; arrays keep their (already canonical) order. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function hashCanonical(canonical: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(canonical)).digest('hex');
}

export function bundleHash(bundle: AttendanceDayBundle): string {
  return hashCanonical(canonicalBundle(bundle));
}

/**
 * Paths that differ between two canonical bundles — names only, never values,
 * so a diff can be logged or shown without exposing attendance data.
 */
export function diffCanonical(a: Record<string, any>, b: Record<string, any>): string[] {
  const out: string[] = [];
  const fieldsOf = (x: any, y: any, prefix: string) => {
    for (const k of new Set([...Object.keys(x ?? {}), ...Object.keys(y ?? {})])) {
      if (stableStringify(x?.[k]) !== stableStringify(y?.[k])) out.push(`${prefix}.${k}`);
    }
  };
  if (!!a.dailyAttendance !== !!b.dailyAttendance) out.push(a.dailyAttendance ? 'dailyAttendance:-' : 'dailyAttendance:+');
  else if (a.dailyAttendance) fieldsOf(a.dailyAttendance, b.dailyAttendance, 'dailyAttendance');
  const keyed: Array<[string, string]> = [['workSessions', 'id'], ['breakLogs', 'id'], ['punchEvidence', 'idempotencyKey'], ['regularizations', 'id']];
  for (const [list, key] of keyed) {
    const am = new Map((a[list] ?? []).map((r: any) => [r[key], r]));
    const bm = new Map((b[list] ?? []).map((r: any) => [r[key], r]));
    for (const [k, r] of am) {
      if (!bm.has(k)) out.push(`${list}[${k}]:-`);
      else fieldsOf(r, bm.get(k), `${list}[${k}]`);
    }
    for (const k of bm.keys()) if (!am.has(k)) out.push(`${list}[${k}]:+`);
  }
  for (const k of ['leaveReferences', 'attendancePolicyReference', 'shiftPolicyReference']) {
    if (stableStringify(a[k]) !== stableStringify(b[k])) out.push(k);
  }
  return out;
}
