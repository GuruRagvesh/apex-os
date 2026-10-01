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

/**
 * The requirement to use when the caller does not know the real one.
 *
 * A FALLBACK, NOT THE RULE, and the rename is the point. The real requirement
 * is per employee-day -- shift first, then attendance policy, then this -- and
 * the backend resolves it that way in resolveRequiredPresence(). This constant
 * is the last of those three, sitting in React because GET /attendance/daily
 * does not yet return the resolved figure.
 *
 * Anyone who HAS the real requirement passes it in. When the My Attendance
 * dashboard serves a backend-resolved requirement, this and the comparison
 * below both go: classification belongs on the server, with the rows it
 * classified. Until then this is a labelled fallback rather than a second
 * opinion pretending to be the rule.
 */
export const FALLBACK_REQUIRED_PRESENCE_MINUTES = 540;

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
  /**
   * The resolved requirement for THIS day, when the caller knows it.
   * Omitted falls back to the company figure -- see the constant above.
   */
  requiredMinutes?: number | null;
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

/**
 * Exact elapsed seconds, floored. The figure the REQUIREMENT is judged on.
 *
 * SEPARATE FROM minutesBetween ON PURPOSE, AND THIS WAS A LIVE DEFECT.
 *
 * minutesBetween rounds, which is right for display -- it is the figure of
 * record the backend also shows. It is wrong for a comparison: a presence of
 * 08:59:59 is 539.98 minutes, rounds to 540, and the day was reported as having
 * MET the nine-hour requirement one second short. Every employee a second under
 * passed.
 *
 * Floor, and never round, so the classification cannot credit time that was not
 * spent. This mirrors presenceSeconds() in the backend primitives, which is the
 * one that decides; these two must not disagree.
 */
function secondsBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor(ms / 1000));
}

export function assessPresence(input: PresenceInput): PresenceAssessment {
  // Policy definition. Deliberately the ONLY thing that feeds presence.
  const presenceMinutes = minutesBetween(input.punchInAt, input.punchOutAt);
  // The same span, unrounded, for the comparison below.
  const presenceSeconds = secondsBetween(input.punchInAt, input.punchOutAt);
  const requiredMinutes =
    typeof input.requiredMinutes === 'number' && input.requiredMinutes > 0
      ? input.requiredMinutes
      : FALLBACK_REQUIRED_PRESENCE_MINUTES;
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
    requiredMinutes,
    // Unknown stays unknown: an incomplete day has not failed the requirement,
    // it simply has not answered it yet.
    //
    // JUDGED ON SECONDS, DISPLAYED IN MINUTES. presenceMinutes is what the
    // employee reads; presenceSeconds is what decides. Comparing the rounded
    // figure is the defect described at secondsBetween().
    meetsRequirement:
      presenceSeconds === null ? null : presenceSeconds >= requiredMinutes * 60,
    workedMinutes: input.workedMinutes,
    sessionSpanMinutes,
    sessionCount: input.sessionCount,
    unevidencedSessions: input.unevidencedSessions,
    coverage,
    evidenceMismatch,
  };
}
