/**
 * Attendance recovery — domain types (Phase 1: foundation only).
 *
 * The unit of recovery is ONE EMPLOYEE ON ONE BUSINESS DATE. Tables are never
 * synchronised independently: a day's DailyAttendance means nothing without the
 * sessions, breaks, punch evidence and corrections that produced it, so they
 * travel, hash and classify together as an AttendanceDayBundle.
 *
 * Identity inside a bundle is the employee's business identifier (`employeeId`)
 * and the business date — never a database UUID of the User. Historic UUIDs are
 * not a valid identity mapping across environments or after a restore.
 *
 * Nothing in this module writes attendance. Classification only ever yields a
 * proposal; the action vocabulary deliberately contains no UPDATE and no DELETE.
 */

/** Format of the canonical bundle. Part of the hash: a new format never collides with an old one. */
export const RECOVERY_SCHEMA_VERSION = 1 as const;

export interface PolicyReference {
  policyKey: string;
  version: number;
}

/** DailyAttendance as carried in a bundle. Owner, row id and bookkeeping timestamps are not part of it. */
export interface BundleDailyAttendance {
  date: string; // YYYY-MM-DD
  status: string;
  punchInAt: string | null;
  punchOutAt: string | null;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  leaveDeducted: number;
  lwpDeducted: number;
  calculationReason: string | null;
  locked: boolean;
  lockedAt: string | null;
  policyVersion: string | null;
  evaluationState: string;
  evaluatorVersion: number;
  resolverVersion: number | null;
  evaluatedAt: string | null;
  exceptionFlags: string[];
  sourceFingerprint: string | null;
  employeeProfileId: string | null;
  holidayCalendarReference: PolicyReference | null;
  weeklyOffPolicyId: string | null;
  holidayId: string | null;
  businessDayOverrideId: string | null;
  leaveRequestId: string | null;
  /** Evidence is referenced by its natural key, not by a generated row id. */
  punchInEvidenceKey: string | null;
  punchOutEvidenceKey: string | null;
  workSessionIds: string[];
  revision: number;
  lastRegularizationId: string | null;
}

export interface BundleWorkSession {
  id: string;
  date: string;
  loginAt: string | null;
  startWorkAt: string | null;
  logoutAt: string | null;
  status: string;
  totalLoggedMinutes: number;
  totalBreakMinutes: number;
  totalIdleMinutes: number;
  totalWorkMinutes: number;
  leaveId: string | null;
  autoClosed: boolean;
  autoClosedAt: string | null;
  closureReason: string | null;
  continuationOfSessionId: string | null;
}

export interface BundleBreakLog {
  id: string;
  workSessionId: string;
  breakType: string;
  estimatedMinutes: number | null;
  startAt: string;
  endAt: string | null;
  durationMinutes: number | null;
  autoDetected: boolean;
  note: string | null;
  reason: string | null;
  source: string | null;
}

export interface BundlePunchEvidence {
  /** Natural key, unique per employee. */
  idempotencyKey: string;
  type: string;
  businessDate: string;
  serverOccurredAt: string;
  clientCapturedAt: string | null;
  receivedAt: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  locationVerification: string;
  attendanceLocationId: string | null;
  distanceFromLocationMeters: number | null;
  geofenceRadiusMeters: number | null;
  accuracyThresholdMeters: number | null;
  photoAssetId: string | null;
  photoObjectKey: string | null;
  photoHash: string | null;
  photoVerification: string;
  source: string;
  deviceMetadata: unknown;
  ipAddress: string | null;
  workSessionId: string | null;
  employeeProfileId: string | null;
  shiftPolicyReference: PolicyReference | null;
  attendancePolicyReference: PolicyReference | null;
  contextResolverVersion: number | null;
}

export interface BundleRegularization {
  id: string;
  date: string;
  requestType: string;
  reason: string;
  requestedPunchIn: string | null;
  requestedPunchOut: string | null;
  basedOnFingerprint: string | null;
  proposedStatus: string | null;
  status: string;
  /** Actors are carried by employeeId, never by User UUID. */
  managerApproverEmployeeId: string | null;
  managerDecisionAt: string | null;
  hrApproverEmployeeId: string | null;
  hrDecisionAt: string | null;
  createdByEmployeeId: string | null;
  entrySource: string;
  recoveryReason: string | null;
  employeeInformedAt: string | null;
  actorRoleAtEntry: string | null;
  originalPunchIn: string | null;
  originalPunchOut: string | null;
}

export type RecoverySourceType =
  | 'LIVE'
  | 'HISTORICAL_IMPORT'
  | 'R2_BACKUP_RECOVERY'
  | 'MANUAL_REGULARIZATION'
  | 'SYSTEM_RECOVERY';

export const RECOVERY_SOURCE_TYPES: readonly RecoverySourceType[] = [
  'LIVE', 'HISTORICAL_IMPORT', 'R2_BACKUP_RECOVERY', 'MANUAL_REGULARIZATION', 'SYSTEM_RECOVERY',
];

/**
 * Where a bundle came from. NOT part of the hash: the same attendance read from
 * the live database and from a backup is the same attendance.
 */
export interface RecoveryProvenance {
  sourceType: RecoverySourceType;
  sourceId: string | null;
  sourceFileSha256?: string | null;
  sourceBackupKey?: string | null;
  importBatchId?: string | null;
  requestedById?: string | null;
  approvedById?: string | null;
  performedAt?: string | null;
  beforeHash?: string | null;
  afterHash?: string | null;
}

export interface AttendanceDayBundle {
  schemaVersion: typeof RECOVERY_SCHEMA_VERSION;
  /**
   * Revision of this logical bundle in an append-only store. NOT part of the
   * hash: revision 3 of an unchanged day hashes exactly like revision 1.
   */
  bundleVersion: number;
  employeeId: string;
  businessDate: string;
  dailyAttendance: BundleDailyAttendance | null;
  workSessions: BundleWorkSession[];
  breakLogs: BundleBreakLog[];
  punchEvidence: BundlePunchEvidence[];
  regularizations: BundleRegularization[];
  /** LeaveRequest ids the day relies on. Leave is reference-only: never created by recovery. */
  leaveReferences: string[];
  attendancePolicyReference: PolicyReference | null;
  shiftPolicyReference: PolicyReference | null;
  provenance: RecoveryProvenance;
}

/** The eight locked reconciliation states. */
export type ReconciliationState =
  | 'IN_SYNC'
  | 'PRODUCTION_ONLY'
  | 'RECOVERY_ONLY'
  | 'DIFFERENT'
  | 'MISSING_REFERENCE'
  | 'INVALID_BUNDLE'
  | 'LEGACY_FORMAT'
  | 'MANUAL_REVIEW';

export type LegacySubtype = 'LEGACY_SESSION_ONLY' | 'SESSION_WITHOUT_DAILY_ATTENDANCE';

/**
 * What the classifier proposes. There is no UPDATE and no DELETE in this
 * vocabulary, by construction. RECOVERY_PREVIEW is a preview, not an insert:
 * Phase 1 never writes, and auto-repair is off.
 */
export type ProposedAction =
  | 'NO_ACTION'
  | 'MIRROR_CANDIDATE'
  | 'RECOVERY_PREVIEW'
  | 'MANUAL_REVIEW'
  | 'REJECT';

export type RecoveryEligibility = 'AUTO_REPAIR_ELIGIBLE' | 'NOT_ELIGIBLE' | 'NOT_APPLICABLE';

export type DayWindow = 'LIVE' | 'SETTLING' | 'HISTORICAL';

export interface DayClassification {
  employeeId: string;
  businessDate: string;
  state: ReconciliationState;
  legacySubtype?: LegacySubtype;
  eligibility: RecoveryEligibility;
  action: ProposedAction;
  /** Machine-readable reason codes; never values. */
  reasons: string[];
  /** Paths of fields that differ (names only, never values). */
  differingFields: string[];
  currentHash: string | null;
  recoveryHash: string | null;
}

export type TombstoneRecordType =
  | 'DAY'
  | 'DAILY_ATTENDANCE'
  | 'WORK_SESSION'
  | 'BREAK_LOG'
  | 'PUNCH_EVIDENCE'
  | 'REGULARIZATION';

export interface RecoveryTombstone {
  id: string;
  employeeId: string;
  businessDate: string;
  recordType: TombstoneRecordType;
  /** For PUNCH_EVIDENCE this is the idempotencyKey (the natural key). Null = every record of that type. */
  recordId: string | null;
  reason: string;
}

export function bundleKey(employeeId: string, businessDate: string): string {
  return `${employeeId}|${businessDate}`;
}
