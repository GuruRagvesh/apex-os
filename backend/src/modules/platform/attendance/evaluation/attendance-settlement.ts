/**
 * When an attendance day is settled, and who is still allowed to change it.
 *
 * Two independent facts settle a day, and they do NOT move together:
 *
 *   THE DAY    DailyAttendance.locked / evaluationState = FINALIZED.
 *              Written together, atomically, by exactly one method --
 *              DailyAttendanceEvaluatorService.finalize(). Per-employee-day.
 *
 *   THE MONTH  AttendanceMonthClose.status = FINALIZED or SENT.
 *              Written by the payroll close. It does NOT touch the day rows.
 *
 * That second point is the whole reason this module exists. A day inside a
 * month already finalized and sent to Finance still reads locked:false,
 * evaluationState:CALCULATED -- perfectly open at the row level. Anything that
 * checked only the day would walk into a closed period and find nothing in its
 * way.
 *
 * OPEN and REVIEWING are NOT settled. REVIEWING means somebody has begun the
 * close and is looking at it; correcting a month under review is the point of
 * reviewing it.
 *
 * Pure and dependency-free: these decide whether a financially settled period
 * can be rewritten, and that should be provable without a database.
 */

export type SettlementReason =
  | 'LOCKED_DAY'
  | 'FINALIZED_DAY'
  | 'FINALIZED_MONTH'
  | 'SENT_MONTH';

/**
 * Who is asking to change a settled day.
 *
 * The distinction is the point. A deliberately reviewed one-person correction
 * and a six-thousand-row spreadsheet do not carry the same risk, and giving
 * them the same authority would mean either blocking HR from work they are
 * supposed to do, or letting one click rewrite a closed quarter.
 */
export type CorrectionAuthority = 'INDIVIDUAL_REVIEW' | 'BULK_IMPORT';

export interface SettlementFacts {
  /** The official record, or null when the day has never been evaluated. */
  day: { locked?: boolean | null; evaluationState?: string | null } | null;
  /** The close row for the day's business month, or null when none exists. */
  monthClose: { status?: string | null } | null;
}

/** Human-readable, and deliberately free of any import or UI vocabulary. */
export const SETTLEMENT_MESSAGE: Record<SettlementReason, string> = {
  LOCKED_DAY: 'This day is locked.',
  FINALIZED_DAY: 'This day has been finalized.',
  FINALIZED_MONTH: 'This month has been finalized for payroll.',
  SENT_MONTH: 'This month has already been sent to Finance.',
};

/**
 * Everything that makes this employee-day settled, whoever is asking.
 *
 * Returns all of them rather than the first: a day can be individually
 * finalized inside a month that is also sent, and a caller reporting why a row
 * was refused should be able to say so.
 */
export function describeSettlement(facts: SettlementFacts): SettlementReason[] {
  const reasons: SettlementReason[] = [];

  if (facts.day?.locked === true) reasons.push('LOCKED_DAY');
  if (facts.day?.evaluationState === 'FINALIZED') reasons.push('FINALIZED_DAY');

  // Independent of the day. See the note at the top.
  if (facts.monthClose?.status === 'FINALIZED') reasons.push('FINALIZED_MONTH');
  if (facts.monthClose?.status === 'SENT') reasons.push('SENT_MONTH');

  return reasons;
}

/**
 * Which of those reasons actually refuse THIS caller.
 *
 * BULK_IMPORT is refused by every one of them. No batch approval carries enough
 * authority to rewrite a financially settled period, and a bulk operation that
 * could would be one click away from silently changing what Finance was told.
 *
 * INDIVIDUAL_REVIEW is refused by exactly one: SENT_MONTH.
 *
 * The line is drawn at delivery, not at finalization. Before the report leaves,
 * a reviewed correction is the sanctioned way to repair a month, and the
 * existing chain holds -- send() re-renders and refuses to deliver a report
 * whose data no longer matches the fingerprint captured at finalization, so a
 * corrected-but-unsent month cannot reach Finance stale. A locked day or a
 * finalized month is therefore still correctable by a human who reviewed it.
 *
 * Once the month is SENT, that chain has nothing left to catch: Finance is
 * holding the report, and no later check re-examines a report that has gone. A
 * correction after that point does not repair the month, it makes Apex OS
 * disagree with a document somebody is already working from -- silently, and
 * with no record on the Finance side that anything moved.
 *
 * Reopening a sent month is a real need and a separate, explicit workflow:
 * amend the report, tell Finance, record that it happened. It is not something
 * an ordinary correction should be able to do as a side effect.
 */
export function settlementBlocking(
  reasons: SettlementReason[],
  authority: CorrectionAuthority,
): SettlementReason[] {
  // Written as "only INDIVIDUAL_REVIEW is permissive" rather than "only
  // BULK_IMPORT is refused", so that a caller which grows a third authority and
  // forgets to classify it is refused rather than quietly waved through. The
  // permissive branch is the one that has to be asked for by name.
  if (authority !== 'INDIVIDUAL_REVIEW') return reasons;

  // Delivery is the line. Everything short of it stays correctable.
  return reasons.filter((reason) => reason === 'SENT_MONTH');
}

/**
 * The whole question in one call, for callers that only want a verdict.
 *
 * `blocked` is what refuses this caller; `reasons` is everything that is true
 * about the day, so a preview can explain a state it is nevertheless allowed to
 * change.
 */
export function assessSettlement(
  facts: SettlementFacts,
  authority: CorrectionAuthority,
): { settled: boolean; reasons: SettlementReason[]; blocked: SettlementReason[] } {
  const reasons = describeSettlement(facts);
  return {
    settled: reasons.length > 0,
    reasons,
    blocked: settlementBlocking(reasons, authority),
  };
}

/** `2026-08-29` -> `2026-08`, the key AttendanceMonthClose is stored under. */
export function businessMonthOf(businessDate: string): string {
  return businessDate.slice(0, 7);
}

/** One sentence naming every reason, for an error a person has to act on. */
export function describeBlocked(blocked: SettlementReason[]): string {
  return blocked.map((r) => SETTLEMENT_MESSAGE[r]).join(' ');
}

/**
 * A refusal a person can act on.
 *
 * Its own class so a caller can tell "this period is closed" from an ordinary
 * failure: the importer marks such a row CONFLICT and carries on with the
 * batch, where a genuine error would stop it.
 */
export class SettledAttendanceError extends Error {
  readonly businessDate: string;
  readonly reasons: SettlementReason[];

  constructor(businessDate: string, reasons: SettlementReason[]) {
    super(
      `Attendance for ${businessDate} cannot be changed by a bulk correction. ` +
        describeBlocked(reasons),
    );
    this.name = 'SettledAttendanceError';
    this.businessDate = businessDate;
    this.reasons = reasons;
  }
}
