/**
 * The rules every attendance correction obeys, whoever is making it.
 *
 * One employee-day corrected by hand, an employee's approved request, and a row
 * out of a six-month spreadsheet are the same operation with different
 * paperwork. This module is that operation: validate a proposal against the
 * official record, then build the correction row that will carry it.
 *
 * Pure and dependency-free on purpose. These are the rules that decide whether
 * a punch time is believable, and they should be provable without a database,
 * a clock, or a Nest module graph standing in the way.
 *
 * WHAT THIS MODULE DELIBERATELY CANNOT DO
 *
 * It cannot produce evidence. There is no latitude, longitude, accuracy, photo
 * or device field anywhere in what it builds, because a correction is somebody
 * asserting a fact rather than a device recording one -- and a manufactured
 * coordinate is indistinguishable from a real one once it is stored.
 */

/** An employee arguing about their own day. Low bar: they are reporting, not deciding. */
export const MIN_REASON_EMPLOYEE_REQUEST = 5;

/**
 * Somebody entering attendance ON BEHALF of an employee -- manual recovery, or
 * an imported row. Higher bar, because this is the durable answer to "why does
 * this day say something the punch record never said".
 */
export const MIN_REASON_ENTERED_CORRECTION = 10;

export type CorrectionProblemCode =
  | 'REASON_TOO_SHORT'
  | 'NOTHING_PROPOSED'
  | 'PUNCH_OUT_BEFORE_PUNCH_IN'
  | 'PUNCH_IN_ALREADY_EXISTS'
  | 'PUNCH_OUT_ALREADY_EXISTS';

export interface CorrectionProblem {
  code: CorrectionProblemCode;
  message: string;
}

/** What is being asserted about the day. */
export interface CorrectionProposal {
  punchInAt: Date | null;
  punchOutAt: Date | null;
  /**
   * An explicit official status, for corrections no punch time can express --
   * an approved absence, a leave day, a historical PRESENT whose times were
   * never recorded.
   */
  proposedStatus: string | null;
  reason: string;
}

/** The official record as it stands, or null when the day has never been evaluated. */
export interface OfficialSnapshot {
  punchInAt: Date | null;
  punchOutAt: Date | null;
  status: string | null;
  sourceFingerprint: string | null;
}

export interface ValidateOptions {
  /** MIN_REASON_* — which bar applies to this actor. */
  minReasonLength: number;
  /**
   * Whether the proposal is knowingly replacing punch times that already exist.
   *
   * Without it, adding a punch on top of one already recorded would leave two
   * authoritative answers for one moment, so it is refused and the actor is
   * routed to a correction instead.
   */
  correctExisting?: boolean;
  /**
   * Company-local wall clock for an instant, used only to make a refusal
   * readable ("a punch in already exists at 09:52"). Injected rather than
   * imported so this module stays free of timezone machinery.
   */
  formatTime?: (at: Date) => string;
}

/**
 * Every row-level rule, returned together rather than thrown one at a time.
 *
 * A caller correcting one day wants the first problem as an exception; a caller
 * validating four thousand rows wants all of them on the row so the operator
 * can fix a spreadsheet in one pass instead of discovering faults one upload at
 * a time. Returning a list serves both; only the single-day caller throws.
 */
export function validateCorrectionProposal(
  proposal: CorrectionProposal,
  official: OfficialSnapshot | null,
  options: ValidateOptions,
): CorrectionProblem[] {
  const problems: CorrectionProblem[] = [];
  const clock = options.formatTime ?? ((at: Date) => at.toISOString());

  if (!proposal.reason || proposal.reason.trim().length < options.minReasonLength) {
    problems.push({
      code: 'REASON_TOO_SHORT',
      message:
        options.minReasonLength >= MIN_REASON_ENTERED_CORRECTION
          ? 'Explain what happened. This is the durable record of why attendance was entered by hand.'
          : 'Please explain what needs correcting',
    });
  }

  // A correction that proposes nothing is not a correction.
  if (!proposal.punchInAt && !proposal.punchOutAt && !proposal.proposedStatus) {
    problems.push({
      code: 'NOTHING_PROPOSED',
      message: 'Provide the punch in or punch out time being recorded, or the status being granted',
    });
  }

  // A day cannot end before it starts. Nothing enforced this before: an
  // inverted pair reached the evaluator and became a nonsensical presence on a
  // record that feeds payroll.
  if (
    proposal.punchInAt &&
    proposal.punchOutAt &&
    proposal.punchOutAt.getTime() <= proposal.punchInAt.getTime()
  ) {
    problems.push({
      code: 'PUNCH_OUT_BEFORE_PUNCH_IN',
      message: `Punch out (${clock(proposal.punchOutAt)}) must be after punch in (${clock(proposal.punchInAt)})`,
    });
  }

  if (!options.correctExisting) {
    if (proposal.punchInAt && official?.punchInAt) {
      problems.push({
        code: 'PUNCH_IN_ALREADY_EXISTS',
        message: `A punch in already exists at ${clock(official.punchInAt)}. Correct it instead of adding another.`,
      });
    }
    if (proposal.punchOutAt && official?.punchOutAt) {
      problems.push({
        code: 'PUNCH_OUT_ALREADY_EXISTS',
        message: `A punch out already exists at ${clock(official.punchOutAt)}. Correct it instead of adding another.`,
      });
    }
  }

  return problems;
}

export interface BuildCorrectionInput {
  userId: string;
  /** Company business date encoded the way the schema's @db.Date column expects. */
  date: Date;
  proposal: CorrectionProposal;
  official: OfficialSnapshot | null;
  entrySource: string;
  requestType: string;
  /** Who is entering this, when it is not the employee themselves. */
  createdById: string | null;
  /** The role they held AT ENTRY, not the one they hold when it is read back. */
  actorRoleAtEntry: string | null;
  recoveryReason?: string | null;
  employeeInformedAt?: Date | null;
}

/**
 * The correction row, built once so every caller stores the same facts.
 *
 * Two of these fields are the reason this function exists rather than each
 * caller assembling its own object:
 *
 *   originalPunchIn / originalPunchOut  captured HERE, from the official record
 *     as it stands right now. The moment the correction is applied the previous
 *     value exists nowhere else, and this row has to be able to say
 *     18:04 -> 18:31 on its own six months later, in front of a payroll query.
 *
 *   basedOnFingerprint  the official result this proposal was argued against.
 *     Compared again at approval, so a correction written against a stale view
 *     of the day cannot quietly overwrite a newer one.
 *
 * Both are easy to forget and impossible to reconstruct afterwards.
 */
export function buildCorrectionRecord(input: BuildCorrectionInput) {
  return {
    userId: input.userId,
    date: input.date,
    requestType: input.requestType,
    reason: input.proposal.reason.trim(),

    requestedPunchIn: input.proposal.punchInAt,
    requestedPunchOut: input.proposal.punchOutAt,
    proposedStatus: input.proposal.proposedStatus,

    originalPunchIn: input.official?.punchInAt ?? null,
    originalPunchOut: input.official?.punchOutAt ?? null,
    basedOnFingerprint: input.official?.sourceFingerprint ?? null,

    entrySource: input.entrySource,
    createdById: input.createdById,
    actorRoleAtEntry: input.actorRoleAtEntry,
    recoveryReason: input.recoveryReason ?? null,
    employeeInformedAt: input.employeeInformedAt ?? null,
  };
}
