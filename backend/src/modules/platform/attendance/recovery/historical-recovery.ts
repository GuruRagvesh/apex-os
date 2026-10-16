import { createHash } from 'crypto';
import {
  RECOVERY_SCHEMA_VERSION,
  type AttendanceDayBundle,
  type BundleDailyAttendance,
} from './recovery.types';

/**
 * Historical attendance FACTS for RECOVERY_IMPORT. Pure: reads nothing, writes
 * nothing, imports no evaluator, no policy service, no vault.
 *
 * WHY THIS EXISTS INSTEAD OF HISTORICAL_MIGRATION
 *
 * HISTORICAL_MIGRATION turns a spreadsheet row into a correction and then asks
 * the ordinary evaluator to re-judge the day. For a period that predates the
 * company's attendance/shift policy and the employee's attendance profile, the
 * evaluator correctly answers NOT_EMPLOYED / CONTEXT_BLOCKED and produces no
 * official day. Backdating policies to make it say yes would invent history.
 *
 * Here the external evidence IS the record. A row becomes the DailyAttendance
 * bundle the recovery foundation already defines, carrying exactly what the
 * source states, and is marked as recovered so nobody mistakes it for a day
 * Apex OS captured live.
 *
 * WHAT IS STORED, AND WHAT IS NOT INVENTED
 *
 *   status          the source status (only PRESENT is recoverable in Wave 1)
 *   punch in / out  the source timestamps, exactly; company-local -> instant
 *   worked minutes  the source "Hours Worked", rounded to the minute
 *   break minutes   0 -- the source has no break data. The column cannot hold
 *                   "unknown", so the marker (calculationReason) is what tells a
 *                   reader the 0 means "not recorded"
 *   late minutes    the source "Late Arrival", NEVER recomputed from a current
 *                   shift. The source had no shift ("No Shift"), so a 0 means
 *                   "not assessed" under the same marker
 *   missing punch   true only when EXACTLY ONE punch exists. Two real punches
 *                   are not "missing" merely because no native PunchEvidence
 *                   row exists -- there is none, and none is fabricated
 *
 * WHAT IS DELIBERATELY NOT CREATED: WorkSession, BreakLog, PunchEvidence,
 * AttendanceRegularization. They would each claim Apex OS observed something it
 * did not. Notes and punch locations have no column on DailyAttendance, so they
 * stay in the recovery manifest, not in the database.
 *
 * IDEMPOTENCY. Every field here is deterministic from the source row. Nothing
 * depends on when the import runs (no clock, no random id), so the same row
 * always yields the same bundle hash, and reading the stored row back yields it
 * again: a second import classifies IN_SYNC.
 */

/** The marker. Lives in calculationReason, NOT in exceptionFlags: any flag not in
 * NON_REVIEW_FLAGS would put every recovered day in HR's exception queue. */
export const HISTORICAL_RECOVERY_REASON = 'HISTORICAL_RECOVERY_IMPORT';

/** What the Daily export's "Data Source" column says for a recovered day. */
export const HISTORICAL_SOURCE_LABEL = 'SalaryBox Historical Recovery';

/** evaluatorVersion for a day no evaluator produced. The column default is 1; 0 says "none". */
export const HISTORICAL_EVALUATOR_VERSION = 0;

export const HISTORICAL_SOURCE_ID = 'salarybox-historical-attendance-apr-aug-2026';

/** Company time has no DST; the same fixed offset the rest of the tooling uses. */
export const COMPANY_UTC_OFFSET = '+05:30';

export interface HistoricalSourceRow {
  /** Stable key from the source workbook. Identity of the row, independent of the file version. */
  recoveryKey: string;
  /** Approved Employee Master id (OWN####). */
  employeeId: string;
  /** yyyy-MM-dd */
  businessDate: string;
  /** SalaryBox status text: Present / Absent / Holiday / Week Off. */
  sourceStatus: string;
  /** HH:mm (24h, company-local) or null. */
  punchIn: string | null;
  punchOut: string | null;
  /** HH:MM:SS exactly as supplied, or null. */
  hoursWorked: string | null;
  lateArrival: string | null;
}

export type HistoricalRowProblem =
  | 'STATUS_NOT_RECOVERABLE_IN_THIS_WAVE'
  | 'DATE_UNPARSEABLE'
  | 'PUNCH_TIME_UNPARSEABLE'
  | 'PUNCH_OUT_NOT_AFTER_PUNCH_IN'
  | 'PRESENT_WITHOUT_ANY_PUNCH'
  | 'DURATION_UNPARSEABLE';

export interface HistoricalDayResult {
  bundle: AttendanceDayBundle | null;
  problems: HistoricalRowProblem[];
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const HMS_RE = /^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/;

function isRealDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Seconds in an `HH:MM:SS` / `H:MM` duration, or null. */
export function durationSeconds(text: string | null | undefined): number | null {
  if (text == null || String(text).trim() === '') return null;
  const m = HMS_RE.exec(String(text).trim());
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
}

/** Company-local wall clock on a business date -> the instant, as ISO-8601 UTC. */
export function companyInstant(businessDate: string, hhmm: string, offset: string = COMPANY_UTC_OFFSET): string {
  return new Date(`${businessDate}T${hhmm}:00${offset}`).toISOString();
}

/** Deterministic, content-free digest binding a stored day to its source row. */
export function historicalFingerprint(recoveryKey: string): string {
  return createHash('sha256').update(`salarybox-historical-recovery|${recoveryKey}`).digest('hex');
}

/** True only for EXACTLY ONE punch. Two punches, or none, are not a "missing" punch. */
export function hasExactlyOnePunch(day: Pick<BundleDailyAttendance, 'punchInAt' | 'punchOutAt'>): boolean {
  return (day.punchInAt === null) !== (day.punchOutAt === null);
}

/** Is this stored/bundled day a recovered historical fact? */
export function isHistoricalRecovery(day: { calculationReason: string | null }): boolean {
  return day.calculationReason === HISTORICAL_RECOVERY_REASON;
}

export function toHistoricalDay(
  row: HistoricalSourceRow,
  provenance: { sourceFileSha256?: string | null; importBatchId?: string | null } = {},
): HistoricalDayResult {
  const problems: HistoricalRowProblem[] = [];

  if (!isRealDate(row.businessDate)) problems.push('DATE_UNPARSEABLE');
  if (row.sourceStatus.trim().toLowerCase() !== 'present') problems.push('STATUS_NOT_RECOVERABLE_IN_THIS_WAVE');

  const inOk = row.punchIn === null || HHMM_RE.test(row.punchIn);
  const outOk = row.punchOut === null || HHMM_RE.test(row.punchOut);
  if (!inOk || !outOk) problems.push('PUNCH_TIME_UNPARSEABLE');
  if (inOk && outOk && row.punchIn && row.punchOut && row.punchOut <= row.punchIn) {
    // Same-day HH:mm compare is exact. A punch-out that is earlier is an inverted pair or an
    // overnight shift; one that is the SAME minute is a punch recorded twice, not a day of
    // zero length. None of them is stored as a guess.
    problems.push('PUNCH_OUT_NOT_AFTER_PUNCH_IN');
  }
  if (row.punchIn === null && row.punchOut === null && problems.length === 0) problems.push('PRESENT_WITHOUT_ANY_PUNCH');

  const workedSeconds = durationSeconds(row.hoursWorked);
  const lateSeconds = durationSeconds(row.lateArrival);
  if ((row.hoursWorked != null && workedSeconds === null) || (row.lateArrival != null && lateSeconds === null)) {
    problems.push('DURATION_UNPARSEABLE');
  }
  if (problems.length) return { bundle: null, problems };

  const punchInAt = row.punchIn ? companyInstant(row.businessDate, row.punchIn) : null;
  const punchOutAt = row.punchOut ? companyInstant(row.businessDate, row.punchOut) : null;
  const onePunch = (punchInAt === null) !== (punchOutAt === null);

  const dailyAttendance: BundleDailyAttendance = {
    date: row.businessDate,
    status: 'PRESENT',
    punchInAt,
    punchOutAt,
    workedMinutes: workedSeconds === null ? 0 : Math.round(workedSeconds / 60),
    breakMinutes: 0,
    lateMinutes: lateSeconds === null ? 0 : Math.round(lateSeconds / 60),
    leaveDeducted: 0,
    lwpDeducted: 0,
    calculationReason: HISTORICAL_RECOVERY_REASON,
    // Locked so the ordinary evaluator never recalculates a recovered fact. Only an
    // audited correction may revise it, like any other settled day.
    locked: true,
    lockedAt: null,
    policyVersion: null,
    // An honest unresolved day for one punch; a settled fact for two.
    evaluationState: onePunch ? 'NEEDS_REVIEW' : 'FINALIZED',
    evaluatorVersion: HISTORICAL_EVALUATOR_VERSION,
    resolverVersion: null,
    evaluatedAt: null,
    exceptionFlags: onePunch ? ['MISSING_PUNCH'] : [],
    sourceFingerprint: historicalFingerprint(row.recoveryKey),
    employeeProfileId: null,
    holidayCalendarReference: null,
    weeklyOffPolicyId: null,
    holidayId: null,
    businessDayOverrideId: null,
    leaveRequestId: null,
    punchInEvidenceKey: null,
    punchOutEvidenceKey: null,
    workSessionIds: [],
    revision: 0,
    lastRegularizationId: null,
  };

  return {
    problems: [],
    bundle: {
      schemaVersion: RECOVERY_SCHEMA_VERSION,
      bundleVersion: 1,
      employeeId: row.employeeId,
      businessDate: row.businessDate,
      dailyAttendance,
      // Nothing here claims Apex OS observed the day.
      workSessions: [],
      breakLogs: [],
      punchEvidence: [],
      regularizations: [],
      leaveReferences: [],
      attendancePolicyReference: null,
      shiftPolicyReference: null,
      provenance: {
        sourceType: 'HISTORICAL_IMPORT',
        sourceId: HISTORICAL_SOURCE_ID,
        sourceFileSha256: provenance.sourceFileSha256 ?? null,
        importBatchId: provenance.importBatchId ?? null,
      },
    },
  };
}

export type HistoricalOffKind = 'HOLIDAY' | 'WEEKLY_OFF';
export type HistoricalOffProblem = 'DATE_UNPARSEABLE' | 'OFF_DAY_STATUS_MISMATCH' | 'OFF_DAY_CARRIES_ATTENDANCE_FACTS';

const OFF_SOURCE_STATUS: Record<HistoricalOffKind, string> = { HOLIDAY: 'holiday', WEEKLY_OFF: 'week off' };

/**
 * A NON-WORKING day the source states (Holiday / Week Off). Whether a given source row is allowed to become
 * one is decided by the CALLER from evidence (the Apex holiday calendar; a weekly-off rule shown to be in
 * force; a one-off company closure). This function only refuses a row that is not what the caller says:
 *
 *   - the source status must be the matching one (a "Holiday" row cannot be stored as a weekly off), and
 *   - it must carry no punch and no hours: a holiday on which someone punched is a worked day, not an off day.
 *
 * Like a recovered Present day: no work session, break, punch evidence or lateness is invented; the day is
 * locked, FINALIZED, evaluatorVersion 0, and carries the same recovery marker. Zero worked/break/late minutes
 * on a non-working day mean "no work expected", and the export prints them blank.
 */
export function toHistoricalOffDay(
  row: HistoricalSourceRow,
  kind: HistoricalOffKind,
  provenance: { sourceFileSha256?: string | null; importBatchId?: string | null } = {},
): { bundle: AttendanceDayBundle | null; problems: HistoricalOffProblem[] } {
  const problems: HistoricalOffProblem[] = [];
  if (!isRealDate(row.businessDate)) problems.push('DATE_UNPARSEABLE');
  if (row.sourceStatus.trim().toLowerCase() !== OFF_SOURCE_STATUS[kind]) problems.push('OFF_DAY_STATUS_MISMATCH');
  const hasFacts = row.punchIn !== null || row.punchOut !== null || (durationSeconds(row.hoursWorked) ?? 0) > 0;
  if (hasFacts) problems.push('OFF_DAY_CARRIES_ATTENDANCE_FACTS');
  if (problems.length) return { bundle: null, problems };

  const dailyAttendance: BundleDailyAttendance = {
    date: row.businessDate,
    status: kind,
    punchInAt: null,
    punchOutAt: null,
    workedMinutes: 0,
    breakMinutes: 0,
    lateMinutes: 0,
    leaveDeducted: 0,
    lwpDeducted: 0,
    calculationReason: HISTORICAL_RECOVERY_REASON,
    locked: true,
    lockedAt: null,
    policyVersion: null,
    evaluationState: 'FINALIZED',
    evaluatorVersion: HISTORICAL_EVALUATOR_VERSION,
    resolverVersion: null,
    evaluatedAt: null,
    exceptionFlags: [],
    sourceFingerprint: historicalFingerprint(row.recoveryKey),
    employeeProfileId: null,
    holidayCalendarReference: null,
    weeklyOffPolicyId: null,
    holidayId: null,
    businessDayOverrideId: null,
    leaveRequestId: null,
    punchInEvidenceKey: null,
    punchOutEvidenceKey: null,
    workSessionIds: [],
    revision: 0,
    lastRegularizationId: null,
  };
  return {
    problems: [],
    bundle: {
      schemaVersion: RECOVERY_SCHEMA_VERSION,
      bundleVersion: 1,
      employeeId: row.employeeId,
      businessDate: row.businessDate,
      dailyAttendance,
      workSessions: [],
      breakLogs: [],
      punchEvidence: [],
      regularizations: [],
      leaveReferences: [],
      attendancePolicyReference: null,
      shiftPolicyReference: null,
      provenance: { sourceType: 'HISTORICAL_IMPORT', sourceId: HISTORICAL_SOURCE_ID, sourceFileSha256: provenance.sourceFileSha256 ?? null, importBatchId: provenance.importBatchId ?? null },
    },
  };
}

/** The columns a recovered day is inserted with. Insert data only: no id, no timestamps. */
export function toDailyAttendanceCreate(userId: string, day: BundleDailyAttendance) {
  return {
    userId,
    date: new Date(`${day.date}T00:00:00.000Z`),
    status: day.status as any,
    punchInAt: day.punchInAt ? new Date(day.punchInAt) : null,
    punchOutAt: day.punchOutAt ? new Date(day.punchOutAt) : null,
    workedMinutes: day.workedMinutes,
    breakMinutes: day.breakMinutes,
    lateMinutes: day.lateMinutes,
    leaveDeducted: day.leaveDeducted,
    lwpDeducted: day.lwpDeducted,
    calculationReason: day.calculationReason,
    locked: day.locked,
    lockedAt: day.lockedAt ? new Date(day.lockedAt) : null,
    policyVersion: day.policyVersion,
    evaluationState: day.evaluationState as any,
    evaluatorVersion: day.evaluatorVersion,
    resolverVersion: day.resolverVersion,
    evaluatedAt: day.evaluatedAt ? new Date(day.evaluatedAt) : null,
    exceptionFlags: [...day.exceptionFlags],
    sourceFingerprint: day.sourceFingerprint,
    employeeProfileId: null,
    attendancePolicyId: null,
    attendancePolicyVersion: null,
    shiftPolicyId: null,
    shiftPolicyVersion: null,
    holidayCalendarId: null,
    weeklyOffPolicyId: null,
    holidayId: null,
    businessDayOverrideId: null,
    leaveRequestId: null,
    punchInEvidenceId: null,
    punchOutEvidenceId: null,
    workSessionIds: [] as string[],
    revision: day.revision,
    lastRegularizationId: null,
  };
}
