import { createHash } from 'crypto';
import { canonicalBundle, CanonicalizationError, hashCanonical } from './bundle-canonical';
import {
  bundleKey,
  RECOVERY_SCHEMA_VERSION,
  RECOVERY_SOURCE_TYPES,
  type AttendanceDayBundle,
  type RecoveryProvenance,
} from './recovery.types';

/**
 * The Apex Historical Recovery file: a JSON document of AttendanceDayBundles.
 *
 *   {
 *     "format": "apex-os.attendance-recovery",
 *     "schemaVersion": 1,
 *     "source": { "sourceType": "R2_BACKUP_RECOVERY", "sourceId": "...", "sourceBackupKey": "..." },
 *     "bundles": [ { "employeeId": "...", "businessDate": "YYYY-MM-DD", ... } ]
 *   }
 *
 * This reads and checks STRUCTURE only; it consults no database. Every bundle is
 * canonicalised strictly — an unknown field, a wrong type, an instant without a
 * UTC offset — and checked for internal consistency. Anything wrong makes that
 * bundle INVALID with a reason code; nothing is repaired or defaulted.
 *
 * Parsing is not applying. Nothing here writes.
 */

export const RECOVERY_DOCUMENT_FORMAT = 'apex-os.attendance-recovery';
export const MAX_RECOVERY_DOCUMENT_BYTES = 50 * 1024 * 1024;
export const MAX_RECOVERY_BUNDLES = 100_000;

const BUNDLE_KEYS = new Set([
  'schemaVersion', 'bundleVersion', 'employeeId', 'businessDate', 'dailyAttendance', 'workSessions', 'breakLogs',
  'punchEvidence', 'regularizations', 'leaveReferences', 'attendancePolicyReference', 'shiftPolicyReference',
  'provenance', 'bundleHash',
]);

export interface ParsedBundle {
  index: number;
  key: string | null;
  bundle: AttendanceDayBundle | null;
  hash: string | null;
  problems: string[];
}

export interface ParsedRecoveryDocument {
  sourceFileSha256: string;
  byteSize: number;
  fileProblems: string[];
  source: RecoveryProvenance | null;
  bundles: ParsedBundle[];
}

function provenanceProblems(p: any): string[] {
  if (!p || typeof p !== 'object') return ['PROVENANCE_MISSING'];
  if (!RECOVERY_SOURCE_TYPES.includes(p.sourceType)) return ['PROVENANCE_SOURCE_TYPE_INVALID'];
  return [];
}

function structuralProblems(b: AttendanceDayBundle): string[] {
  const out: string[] = [];
  const dup = (ids: string[], label: string) => {
    if (new Set(ids).size !== ids.length) out.push(`DUPLICATE_${label}`);
  };
  const sessionIds = b.workSessions.map((s) => s.id);
  dup(sessionIds, 'WORK_SESSION_ID');
  dup(b.breakLogs.map((x) => x.id), 'BREAK_LOG_ID');
  dup(b.punchEvidence.map((x) => x.idempotencyKey), 'EVIDENCE_IDEMPOTENCY_KEY');
  dup(b.regularizations.map((x) => x.id), 'REGULARIZATION_ID');

  const sessions = new Set(sessionIds);
  const evidence = new Set(b.punchEvidence.map((e) => e.idempotencyKey));
  const leaves = new Set(b.leaveReferences);
  if (b.breakLogs.some((x) => !sessions.has(x.workSessionId))) out.push('BREAK_LOG_SESSION_NOT_IN_BUNDLE');
  if (b.punchEvidence.some((e) => e.businessDate !== b.businessDate)) out.push('EVIDENCE_DATE_MISMATCH');
  if (b.regularizations.some((g) => g.date !== b.businessDate)) out.push('REGULARIZATION_DATE_MISMATCH');
  if (b.workSessions.some((s) => s.leaveId && !leaves.has(s.leaveId))) out.push('LEAVE_REFERENCE_UNDECLARED');
  const da = b.dailyAttendance;
  if (da) {
    if (da.date !== b.businessDate) out.push('DAILY_ATTENDANCE_DATE_MISMATCH');
    if (da.workSessionIds.some((id) => !sessions.has(id))) out.push('DAILY_ATTENDANCE_SESSION_NOT_IN_BUNDLE');
    for (const k of [da.punchInEvidenceKey, da.punchOutEvidenceKey]) {
      if (k && !evidence.has(k)) out.push('DAILY_ATTENDANCE_EVIDENCE_NOT_IN_BUNDLE');
    }
    if (da.leaveRequestId && !leaves.has(da.leaveRequestId)) out.push('LEAVE_REFERENCE_UNDECLARED');
  }
  if (!da && !b.workSessions.length && !b.punchEvidence.length && !b.regularizations.length) out.push('EMPTY_BUNDLE');
  return [...new Set(out)];
}

export function parseRecoveryDocument(buffer: Buffer): ParsedRecoveryDocument {
  const sourceFileSha256 = createHash('sha256').update(buffer).digest('hex');
  const result: ParsedRecoveryDocument = { sourceFileSha256, byteSize: buffer.byteLength, fileProblems: [], source: null, bundles: [] };
  if (buffer.byteLength > MAX_RECOVERY_DOCUMENT_BYTES) { result.fileProblems.push('FILE_TOO_LARGE'); return result; }

  let doc: any;
  try { doc = JSON.parse(buffer.toString('utf8')); } catch { result.fileProblems.push('NOT_JSON'); return result; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) { result.fileProblems.push('NOT_A_RECOVERY_DOCUMENT'); return result; }
  if (doc.format !== RECOVERY_DOCUMENT_FORMAT) result.fileProblems.push('UNKNOWN_FORMAT');
  if (doc.schemaVersion !== RECOVERY_SCHEMA_VERSION) result.fileProblems.push('UNSUPPORTED_SCHEMA_VERSION');
  const sourceIssues = provenanceProblems(doc.source);
  result.fileProblems.push(...sourceIssues.map((p) => `SOURCE_${p}`));
  if (!Array.isArray(doc.bundles)) result.fileProblems.push('BUNDLES_NOT_A_LIST');
  else if (doc.bundles.length > MAX_RECOVERY_BUNDLES) result.fileProblems.push('TOO_MANY_BUNDLES');
  if (result.fileProblems.length) return result;
  result.source = doc.source as RecoveryProvenance;

  const seen = new Map<string, number[]>();
  doc.bundles.forEach((raw: any, index: number) => {
    const problems: string[] = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      result.bundles.push({ index, key: null, bundle: null, hash: null, problems: ['NOT_A_BUNDLE'] });
      return;
    }
    const unknown = Object.keys(raw).filter((k) => !BUNDLE_KEYS.has(k));
    if (unknown.length) problems.push('UNKNOWN_BUNDLE_FIELD');
    if ((raw.schemaVersion ?? RECOVERY_SCHEMA_VERSION) !== RECOVERY_SCHEMA_VERSION) problems.push('UNSUPPORTED_BUNDLE_SCHEMA_VERSION');
    if (raw.provenance !== undefined) problems.push(...provenanceProblems(raw.provenance));

    const bundle: AttendanceDayBundle = {
      schemaVersion: RECOVERY_SCHEMA_VERSION,
      bundleVersion: Number.isInteger(raw.bundleVersion) && raw.bundleVersion > 0 ? raw.bundleVersion : 1,
      employeeId: typeof raw.employeeId === 'string' ? raw.employeeId.trim() : raw.employeeId,
      businessDate: raw.businessDate,
      dailyAttendance: raw.dailyAttendance ?? null,
      workSessions: raw.workSessions ?? [],
      breakLogs: raw.breakLogs ?? [],
      punchEvidence: raw.punchEvidence ?? [],
      regularizations: raw.regularizations ?? [],
      leaveReferences: raw.leaveReferences ?? [],
      attendancePolicyReference: raw.attendancePolicyReference ?? null,
      shiftPolicyReference: raw.shiftPolicyReference ?? null,
      provenance: (raw.provenance ?? doc.source) as RecoveryProvenance,
    };

    let canonical: Record<string, unknown> | null = null;
    try {
      canonical = canonicalBundle(bundle, true);
    } catch (e) {
      if (e instanceof CanonicalizationError) problems.push(`INVALID_FIELD:${e.path}`);
      else throw e;
    }
    let hash: string | null = null;
    let key: string | null = null;
    if (canonical) {
      // Work on the canonical values from here on, so every later check sees normalised data.
      Object.assign(bundle, {
        dailyAttendance: canonical.dailyAttendance,
        workSessions: canonical.workSessions,
        breakLogs: canonical.breakLogs,
        punchEvidence: canonical.punchEvidence,
        regularizations: canonical.regularizations,
        leaveReferences: canonical.leaveReferences,
        attendancePolicyReference: canonical.attendancePolicyReference,
        shiftPolicyReference: canonical.shiftPolicyReference,
      });
      hash = hashCanonical(canonical);
      key = bundleKey(bundle.employeeId, bundle.businessDate);
      problems.push(...structuralProblems(bundle));
      if (raw.bundleHash !== undefined && raw.bundleHash !== hash) problems.push('BUNDLE_HASH_MISMATCH');
      seen.set(key, [...(seen.get(key) ?? []), index]);
    }
    result.bundles.push({ index, key, bundle: canonical ? bundle : null, hash, problems });
  });

  for (const [, indexes] of seen) {
    if (indexes.length > 1) for (const i of indexes) result.bundles[i].problems.push('DUPLICATE_BUNDLE_KEY');
  }
  return result;
}
