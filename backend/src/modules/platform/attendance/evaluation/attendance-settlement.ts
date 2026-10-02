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
 * OPEN, REVIEWING and REOPENED are NOT settled. REVIEWING means somebody has
 * begun the close and is looking at it; correcting a month under review is the
 * point of reviewing it. REOPENED means a finalized month was deliberately
 * unsealed by a named person in order to be corrected -- refusing corrections
 * in that state would make the reopen pointless.
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
 * INDIVIDUAL_REVIEW is refused by both month states: FINALIZED_MONTH and
 * SENT_MONTH. It is still permitted past a LOCKED_DAY or a FINALIZED_DAY, which
 * are per-employee-day operational states inside a month that is still open.
 *
 * THE LINE IS DRAWN AT FINALIZATION, AND IT USED TO BE DRAWN AT DELIVERY.
 *
 * The previous rule let a reviewed correction rewrite a FINALIZED month, and it
 * was not careless -- it rested on a specific compensating control, which the
 * comment here named: send() re-rendered the month and refused to deliver a
 * report whose data no longer matched a fingerprint captured at finalization.
 * A corrected-but-unsent month therefore could not reach Finance stale. Given
 * that chain, allowing the correction was the better trade, because it let HR
 * repair a month without a separate reopen workflow.
 *
 * THAT CHAIN HAS BEEN REMOVED. The fingerprint is gone by explicit product
 * decision, and with it the only thing that noticed a post-finalization
 * change. Leaving this rule as it was would have left corrections permitted in
 * a finalized month with nothing downstream to catch them -- the one
 * combination the old design never had. The guard did not break; the thing it
 * depended on was deleted from underneath it.
 *
 * So finalization itself is now the seal. A FINALIZED month must be explicitly
 * REOPENED -- by HR or an Admin, with a stated reason, recorded on the close --
 * before its attendance can change, and re-finalized afterwards before Finance
 * can be sent anything. The protection is business state a person can read,
 * which is what was asked for in place of a hash.
 *
 * SENT stays refused for its own independent reason, and reopening a sent
 * month remains the more consequential act: Finance is already holding the
 * report, so a correction there does not repair a month, it makes Apex OS
 * disagree with a document somebody is working from. The reopen path treats it
 * as such rather than refusing it outright, because amending a sent month is a
 * real need -- it simply must be deliberate and recorded.
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

  // FINALIZATION IS THE LINE, not delivery. Both month-level states refuse;
  // the day-level ones do not, because a finalized day inside an open month is
  // an operational state HR is expected to be able to revisit.
  //
  // Written as an allow-list of what a reviewed correction may pass -- the day
  // states -- rather than a deny-list of month states, so a SETTLEMENT REASON
  // ADDED LATER REFUSES BY DEFAULT instead of being waved through by a filter
  // that had never heard of it. The previous deny-list is precisely how this
  // rule came to permit a correction the removed fingerprint was supposed to
  // catch.
  const PASSABLE_BY_REVIEW: SettlementReason[] = ['LOCKED_DAY', 'FINALIZED_DAY'];
  return reasons.filter((reason) => !PASSABLE_BY_REVIEW.includes(reason));
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
      // NOT "by a bulk correction" any more: a reviewed individual correction
      // is refused by a finalized month too, and telling HR their change was
      // blocked as a bulk operation would send them looking for a batch they
      // never ran.
      `Attendance for ${businessDate} cannot be changed. ` +
        describeBlocked(reasons) +
        ' Reopen the month to correct it.',
    );
    this.name = 'SettledAttendanceError';
    this.businessDate = businessDate;
    this.reasons = reasons;
  }
}
