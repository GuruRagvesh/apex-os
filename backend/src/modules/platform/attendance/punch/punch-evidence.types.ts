/**
 * Punch Evidence contract (PE-1).
 *
 * Raw fact only. This layer records THAT a punch happened, with everything
 * needed to explain it later. It never decides Present, Absent, Half Day,
 * Leave, LWP, or any payroll consequence.
 *
 * Append-only: create and read. There is no update or delete path, at the
 * service or the database.
 */

/** AppSetting key holding the PE feature flags. */
export const ATTENDANCE_V2_SETTING_KEY = 'attendance_v2';

/** Safe default: the punch pipeline is OFF until deliberately enabled. */
export const ATTENDANCE_V2_DEFAULTS = {
  punchEvidenceEnabled: false,
  /**
   * LH-1. When on, leave duration and paid-leave allocation are answered by the
   * attendance foundation (business calendar + versioned LeavePolicy) instead
   * of the leave module's own hardcoded holiday list, `workingDays` setting and
   * role quota table. Off by default so live leave behaviour is unchanged.
   */
  leaveAuthorityEnabled: false,
  /**
   * LH-2. Turns on the Manager -> HR approval chain and funding settlement.
   * Off means one approver still moves a request straight to APPROVED, exactly
   * as production behaves today.
   */
  leaveApprovalEnabled: false,
  /**
   * AR-1. Employee-raised attendance corrections with Manager -> HR review.
   * Off means the endpoints refuse and no correction can alter an official fact.
   */
  regularizationEnabled: false,
  /**
   * SS-1. Shadow mode: the evaluator runs for real, but its answer is recorded
   * for comparison only. Nothing about legacy Workday or Leave changes.
   */
  shadowEnabled: false,
  /** SS-1. Lets the scheduler run evaluation at all. */
  automaticEvaluationEnabled: false,
  /**
   * SS-1. Permits evaluateAndPersist() to write the official record. With this
   * off, evaluation is diagnostic: results are computed and reported, never
   * stored. Still never touches payroll either way.
   */
  officialWriteEnabled: false,
};

/**
 * Everything a client is permitted to submit.
 *
 * Note what is absent: userId, businessDate, serverOccurredAt, receivedAt, any
 * policy id, and both verification states. Those are server-authoritative and
 * are derived backend-side -- accepting them from a caller would let a device
 * choose its own business date or declare its own location "VERIFIED".
 */
export interface SubmitPunchEvidenceInput {
  type: 'PUNCH_IN' | 'PUNCH_OUT';
  idempotencyKey: string;
  clientCapturedAt?: string | Date | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
  source?: 'WEB' | 'PWA' | 'MOBILE';
  deviceMetadata?: Record<string, any> | null;
  /** Opaque id returned by POST /attendance/punch-photo. */
  photoAssetId?: string | null;
}

/**
 * Why an attendance location could not be resolved for a punch.
 *
 * Same integrity philosophy as BL-5: with no assignment and several active
 * locations, the server refuses rather than picking one. Attaching an employee
 * to an arbitrary office would make the geofence meaningless.
 */
export type PunchLocationBlockingReason =
  | 'MISSING_ATTENDANCE_LOCATION'
  | 'AMBIGUOUS_ATTENDANCE_LOCATION';

export class PunchLocationConfigurationError extends Error {
  constructor(readonly reason: PunchLocationBlockingReason) {
    super(
      reason === 'AMBIGUOUS_ATTENDANCE_LOCATION'
        ? 'Several active attendance locations exist and this employee is assigned to none. ' +
          'HR must assign one before punches can be recorded.'
        : 'No active attendance location is configured for this employee. ' +
          'HR must configure one before punches can be recorded.',
    );
    this.name = 'PunchLocationConfigurationError';
  }
}

/**
 * Raised when a normal employee punch arrives with no usable GPS.
 *
 * PE-1 accepted evidence without coordinates because it was a pure evidence
 * layer. From PE-2 the employee self-punch flow requires location: a punch with
 * no position cannot be geofenced, and Apex attendance requires it. HR manual
 * correction is a separate workflow.
 */
export class PunchLocationRequiredError extends Error {
  constructor() {
    super('Location is required to punch. Enable location access and try again.');
    this.name = 'PunchLocationRequiredError';
  }
}

export class PunchFeatureDisabledError extends Error {
  constructor() {
    super('Attendance punch evidence is not enabled.');
    this.name = 'PunchFeatureDisabledError';
  }
}

/**
 * Raised when the daily context will not permit a normal employee punch.
 *
 * Carries the machine-readable applicability and any blocking reasons so the
 * caller learns WHY, and HR can act on a configuration gap rather than guess.
 */
export class PunchNotApplicableError extends Error {
  constructor(
    readonly applicability: string,
    readonly blockingReasons: string[] = [],
  ) {
    super(
      applicability === 'BLOCKED'
        ? `Attendance configuration is incomplete for this date (${blockingReasons.join(', ')}). ` +
          `HR review is required before punches can be recorded.`
        : `Punch is not applicable for this employee on this date (${applicability}).`,
    );
    this.name = 'PunchNotApplicableError';
  }
}

/**
 * Raised when the daily context says attendance is REQUIRED but no attendance
 * policy resolved.
 *
 * BL-5 should make this state unreachable -- REQUIRED already implies a
 * resolved policy. This is defence in depth: without it, a null policy would
 * read as geoFenceEnabled === false and quietly downgrade an office punch to
 * NOT_ENFORCED. Failing loudly is the only safe interpretation.
 */
export class PunchContextInvariantError extends Error {
  constructor() {
    super(
      'Attendance context reported REQUIRED without a resolved attendance policy. ' +
        'This is a configuration invariant violation and requires HR review.',
    );
    this.name = 'PunchContextInvariantError';
  }
}

export class PunchPhotoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PunchPhotoValidationError';
  }
}

/** Why a staged capture cannot back this punch. */
export type PunchPhotoRejection =
  | 'PHOTO_REQUIRED'
  | 'PHOTO_NOT_FOUND'
  | 'PHOTO_EXPIRED'
  | 'PHOTO_ALREADY_USED';

export class PunchPhotoRequiredError extends Error {
  constructor(readonly rejection: PunchPhotoRejection) {
    super(
      {
        PHOTO_REQUIRED: 'A live photo is required to punch.',
        PHOTO_NOT_FOUND: 'That photo is not available for this punch.',
        PHOTO_EXPIRED: 'That photo has expired. Please retake it and try again.',
        PHOTO_ALREADY_USED: 'That photo has already been used for another punch.',
      }[rejection],
    );
    this.name = 'PunchPhotoRequiredError';
  }
}

/**
 * Raised when a PUNCH_OUT arrives with no open workday to close.
 *
 * Deliberately a rejection rather than a fabricated session: inventing a
 * workday to close would put a made-up start time into payroll-relevant
 * evidence. Missing-punch correction is a separate, audited workflow.
 */
export class PunchNoOpenWorkdayError extends Error {
  constructor() {
    super(
      'There is no open workday to punch out of. ' +
        'If you forgot to punch in, raise a correction request.',
    );
    this.name = 'PunchNoOpenWorkdayError';
  }
}

export class PunchValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PunchValidationError';
  }
}

/**
 * Raised when an idempotency key is reused with materially different evidence.
 *
 * Returning the original silently would hide a real client bug; creating a
 * second record would defeat the key. Rejecting is the only honest option.
 */
export class PunchIdempotencyConflictError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(
      `Idempotency key ${idempotencyKey} was already used for a different punch. ` +
        `Reusing a key requires an identical submission.`,
    );
    this.name = 'PunchIdempotencyConflictError';
  }
}
