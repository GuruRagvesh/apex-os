import {
  RECOVERY_SCHEMA_VERSION,
  type AttendanceDayBundle,
  type BundleBreakLog,
  type BundleDailyAttendance,
  type BundlePunchEvidence,
  type BundleRegularization,
  type BundleWorkSession,
  type PolicyReference,
  type RecoveryProvenance,
} from './recovery.types';

/**
 * Stored database rows → AttendanceDayBundle. Pure; reads nothing, writes nothing.
 *
 * Translations, and nothing else:
 *   User UUID          → employeeId          (owner and every actor reference)
 *   policy UUID        → { policyKey, version }
 *   evidence row id    → idempotencyKey      (the evidence natural key)
 *
 * Anything that cannot be translated is REPORTED as a problem, never guessed:
 * an owner mismatch, an actor without an employeeId, a policy id that is not in
 * the lookup. A bundle with problems must not be treated as a faithful copy.
 */

export interface BundleLookups {
  /** User.id → employeeId (null when the user has none). */
  employeeIdByUserId: Map<string, string | null>;
  attendancePolicyKeyById: Map<string, PolicyReference>;
  shiftPolicyKeyById: Map<string, PolicyReference>;
  holidayCalendarKeyById: Map<string, PolicyReference>;
}

export interface DayRows {
  dailyAttendance: any | null;
  workSessions: any[];
  breakLogs: any[];
  punchEvidence: any[];
  regularizations: any[];
}

export interface BuiltBundle {
  bundle: AttendanceDayBundle;
  problems: string[];
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
const day = (d: Date | string) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

export function buildDayBundle(input: {
  ownerUserId: string;
  employeeId: string;
  businessDate: string;
  rows: DayRows;
  lookups: BundleLookups;
  provenance: RecoveryProvenance;
  bundleVersion?: number;
}): BuiltBundle {
  const { rows, lookups, ownerUserId } = input;
  const problems: string[] = [];
  const owned = (label: string, r: any) => {
    if (r.userId !== ownerUserId) problems.push(`OWNER_MISMATCH:${label}`);
  };
  const actor = (label: string, userId: string | null | undefined): string | null => {
    if (!userId) return null;
    const emp = lookups.employeeIdByUserId.get(userId);
    if (!emp) { problems.push(`UNRESOLVED_ACTOR:${label}`); return null; }
    return emp;
  };
  const ref = (label: string, map: Map<string, PolicyReference>, id: string | null | undefined): PolicyReference | null => {
    if (!id) return null;
    const r = map.get(id);
    if (!r) { problems.push(`UNRESOLVED_POLICY:${label}`); return null; }
    return { policyKey: r.policyKey, version: r.version };
  };

  const evidenceKeyById = new Map<string, string>(rows.punchEvidence.map((e) => [e.id, e.idempotencyKey]));
  const evidenceKey = (label: string, id: string | null | undefined): string | null => {
    if (!id) return null;
    const k = evidenceKeyById.get(id);
    if (!k) { problems.push(`EVIDENCE_NOT_IN_DAY:${label}`); return null; }
    return k;
  };

  let dailyAttendance: BundleDailyAttendance | null = null;
  let attendancePolicyReference: PolicyReference | null = null;
  let shiftPolicyReference: PolicyReference | null = null;
  const da = rows.dailyAttendance;
  if (da) {
    owned('dailyAttendance', da);
    if (day(da.date) !== input.businessDate) problems.push('DATE_MISMATCH:dailyAttendance');
    attendancePolicyReference = ref('dailyAttendance.attendancePolicyId', lookups.attendancePolicyKeyById, da.attendancePolicyId);
    shiftPolicyReference = ref('dailyAttendance.shiftPolicyId', lookups.shiftPolicyKeyById, da.shiftPolicyId);
    dailyAttendance = {
      date: day(da.date),
      status: da.status,
      punchInAt: iso(da.punchInAt),
      punchOutAt: iso(da.punchOutAt),
      workedMinutes: da.workedMinutes,
      breakMinutes: da.breakMinutes,
      lateMinutes: da.lateMinutes,
      leaveDeducted: da.leaveDeducted,
      lwpDeducted: da.lwpDeducted,
      calculationReason: da.calculationReason ?? null,
      locked: da.locked,
      lockedAt: iso(da.lockedAt),
      policyVersion: da.policyVersion ?? null,
      evaluationState: da.evaluationState,
      evaluatorVersion: da.evaluatorVersion,
      resolverVersion: da.resolverVersion ?? null,
      evaluatedAt: iso(da.evaluatedAt),
      exceptionFlags: [...(da.exceptionFlags ?? [])],
      sourceFingerprint: da.sourceFingerprint ?? null,
      employeeProfileId: da.employeeProfileId ?? null,
      holidayCalendarReference: ref('dailyAttendance.holidayCalendarId', lookups.holidayCalendarKeyById, da.holidayCalendarId),
      weeklyOffPolicyId: da.weeklyOffPolicyId ?? null,
      holidayId: da.holidayId ?? null,
      businessDayOverrideId: da.businessDayOverrideId ?? null,
      leaveRequestId: da.leaveRequestId ?? null,
      punchInEvidenceKey: evidenceKey('dailyAttendance.punchInEvidenceId', da.punchInEvidenceId),
      punchOutEvidenceKey: evidenceKey('dailyAttendance.punchOutEvidenceId', da.punchOutEvidenceId),
      workSessionIds: [...(da.workSessionIds ?? [])],
      revision: da.revision,
      lastRegularizationId: da.lastRegularizationId ?? null,
    };
  }

  const workSessions: BundleWorkSession[] = rows.workSessions.map((s) => {
    owned(`workSession:${s.id}`, s);
    return {
      id: s.id,
      date: day(s.date),
      loginAt: iso(s.loginAt),
      startWorkAt: iso(s.startWorkAt),
      logoutAt: iso(s.logoutAt),
      status: s.status,
      totalLoggedMinutes: s.totalLoggedMinutes,
      totalBreakMinutes: s.totalBreakMinutes,
      totalIdleMinutes: s.totalIdleMinutes,
      totalWorkMinutes: s.totalWorkMinutes,
      leaveId: s.leaveId ?? null,
      autoClosed: s.autoClosed,
      autoClosedAt: iso(s.autoClosedAt),
      closureReason: s.closureReason ?? null,
      continuationOfSessionId: s.continuationOfSessionId ?? null,
    };
  });

  const breakLogs: BundleBreakLog[] = rows.breakLogs.map((b) => {
    owned(`breakLog:${b.id}`, b);
    return {
      id: b.id,
      workSessionId: b.workSessionId,
      breakType: b.breakType,
      estimatedMinutes: b.estimatedMinutes ?? null,
      startAt: iso(b.startAt) as string,
      endAt: iso(b.endAt),
      durationMinutes: b.durationMinutes ?? null,
      autoDetected: b.autoDetected,
      note: b.note ?? null,
      reason: b.reason ?? null,
      source: b.source ?? null,
    };
  });

  const punchEvidence: BundlePunchEvidence[] = rows.punchEvidence.map((e) => {
    owned(`punchEvidence:${e.idempotencyKey}`, e);
    return {
      idempotencyKey: e.idempotencyKey,
      type: e.type,
      businessDate: day(e.businessDate),
      serverOccurredAt: iso(e.serverOccurredAt) as string,
      clientCapturedAt: iso(e.clientCapturedAt),
      receivedAt: iso(e.receivedAt) as string,
      latitude: e.latitude ?? null,
      longitude: e.longitude ?? null,
      accuracyMeters: e.accuracyMeters ?? null,
      locationVerification: e.locationVerification,
      attendanceLocationId: e.attendanceLocationId ?? null,
      distanceFromLocationMeters: e.distanceFromLocationMeters ?? null,
      geofenceRadiusMeters: e.geofenceRadiusMeters ?? null,
      accuracyThresholdMeters: e.accuracyThresholdMeters ?? null,
      photoAssetId: e.photoAssetId ?? null,
      photoObjectKey: e.photoObjectKey ?? null,
      photoHash: e.photoHash ?? null,
      photoVerification: e.photoVerification,
      source: e.source,
      deviceMetadata: e.deviceMetadata ?? null,
      ipAddress: e.ipAddress ?? null,
      workSessionId: e.workSessionId ?? null,
      employeeProfileId: e.employeeProfileId ?? null,
      shiftPolicyReference: ref(`punchEvidence:${e.idempotencyKey}.shiftPolicyId`, lookups.shiftPolicyKeyById, e.shiftPolicyId),
      attendancePolicyReference: ref(`punchEvidence:${e.idempotencyKey}.attendancePolicyId`, lookups.attendancePolicyKeyById, e.attendancePolicyId),
      contextResolverVersion: e.contextResolverVersion ?? null,
    };
  });

  const regularizations: BundleRegularization[] = rows.regularizations.map((g) => {
    owned(`regularization:${g.id}`, g);
    return {
      id: g.id,
      date: day(g.date),
      requestType: g.requestType,
      reason: g.reason,
      requestedPunchIn: iso(g.requestedPunchIn),
      requestedPunchOut: iso(g.requestedPunchOut),
      basedOnFingerprint: g.basedOnFingerprint ?? null,
      proposedStatus: g.proposedStatus ?? null,
      status: g.status,
      managerApproverEmployeeId: actor(`regularization:${g.id}.managerApproverId`, g.managerApproverId),
      managerDecisionAt: iso(g.managerDecisionAt),
      hrApproverEmployeeId: actor(`regularization:${g.id}.hrApproverId`, g.hrApproverId),
      hrDecisionAt: iso(g.hrDecisionAt),
      createdByEmployeeId: actor(`regularization:${g.id}.createdById`, g.createdById),
      entrySource: g.entrySource,
      recoveryReason: g.recoveryReason ?? null,
      employeeInformedAt: iso(g.employeeInformedAt),
      actorRoleAtEntry: g.actorRoleAtEntry ?? null,
      originalPunchIn: iso(g.originalPunchIn),
      originalPunchOut: iso(g.originalPunchOut),
    };
  });

  const leaveReferences = [...new Set([da?.leaveRequestId, ...rows.workSessions.map((s) => s.leaveId)].filter(Boolean) as string[])].sort();

  return {
    bundle: {
      schemaVersion: RECOVERY_SCHEMA_VERSION,
      bundleVersion: input.bundleVersion ?? 1,
      employeeId: input.employeeId,
      businessDate: input.businessDate,
      dailyAttendance,
      workSessions,
      breakLogs,
      punchEvidence,
      regularizations,
      leaveReferences,
      attendancePolicyReference,
      shiftPolicyReference,
      provenance: input.provenance,
    },
    problems,
  };
}
