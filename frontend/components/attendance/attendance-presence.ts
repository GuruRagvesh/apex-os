/**
 * The three duration measures of a day, kept permanently apart.
 *
 * ATTENDANCE PRESENCE is the only one the 540-minute requirement applies to,
 * and it is defined by policy as:
 *
 *   presenceMinutes = attendance punch out − attendance punch in
 *
 * Nothing else counts toward it. Workday sessions that carry no punch evidence
 * are NOT added in — that would silently grant official presence to activity
 * nobody evidenced, which is the opposite of what the evidence requirement is
 * for. An earlier version of the UI compared 540 against the Workday session
 * span instead, which quietly redefined the policy while appearing to be a
 * labelling fix.
 *
 * WORKDAY SESSION SPAN and WORKED MINUTES are operational facts. They explain
 * what the employee did; they never decide whether attendance was sufficient.
 *
 * When Workday activity exists outside the evidenced span, that is a real
 * discrepancy and is surfaced as one — the evaluator already routes such days
 * to review, and the UI's job is to explain why, not to reconcile it away.
 */

export const REQUIRED_PRESENCE_MINUTES = 540;

export type EvidenceCoverage = 'FULL' | 'PARTIAL' | 'NONE';

export interface PresenceInput {
  /** Attendance punch in, ISO. */
  punchInAt: string | null;
  /** Attendance punch out, ISO. */
  punchOutAt: string | null;
  /** Effective work summed across Workday sessions, breaks excluded. */
  workedMinutes: number;
  /** First Workday session start, ISO. */
  firstSessionStart: string | null;
  /** Last Workday session end, ISO. Null while a session is open. */
  lastSessionEnd: string | null;
  sessionCount: number;
  /** Sessions with no punch evidence attached to them. */
  unevidencedSessions: number;
}

export interface PresenceAssessment {
  /** Punch out − punch in. Null until BOTH punches exist. */
  presenceMinutes: number | null;
  requiredMinutes: number;
  /** Null while presence is unknown — an absent answer, not a failing one. */
  meetsRequirement: boolean | null;
  /** Operational only. Never compared against the requirement. */
  workedMinutes: number;
  sessionSpanMinutes: number | null;
  sessionCount: number;
  unevidencedSessions: number;
  coverage: EvidenceCoverage;
  /** True when Workday activity sits outside the evidenced attendance span. */
  evidenceMismatch: boolean;
}

function minutesBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round(ms / 60000));
}

export function assessPresence(input: PresenceInput): PresenceAssessment {
  // Policy definition. Deliberately the ONLY thing that feeds presence.
  const presenceMinutes = minutesBetween(input.punchInAt, input.punchOutAt);
  const sessionSpanMinutes = minutesBetween(input.firstSessionStart, input.lastSessionEnd);

  const coverage: EvidenceCoverage =
    input.sessionCount === 0
      ? 'NONE'
      : input.unevidencedSessions === 0
        ? 'FULL'
        : input.unevidencedSessions >= input.sessionCount
          ? 'NONE'
          : 'PARTIAL';

  // Workday activity that began before the first punch is the common shape:
  // sessions started before the evidence-backed path was used that day.
  const startedBeforeEvidence =
    !!input.firstSessionStart &&
    !!input.punchInAt &&
    new Date(input.firstSessionStart).getTime() < new Date(input.punchInAt).getTime();

  const evidenceMismatch =
    input.sessionCount > 0 && (input.unevidencedSessions > 0 || startedBeforeEvidence);

  return {
    presenceMinutes,
    requiredMinutes: REQUIRED_PRESENCE_MINUTES,
    // Unknown stays unknown: an incomplete day has not failed the requirement,
    // it simply has not answered it yet.
    meetsRequirement:
      presenceMinutes === null ? null : presenceMinutes >= REQUIRED_PRESENCE_MINUTES,
    workedMinutes: input.workedMinutes,
    sessionSpanMinutes,
    sessionCount: input.sessionCount,
    unevidencedSessions: input.unevidencedSessions,
    coverage,
    evidenceMismatch,
  };
}
