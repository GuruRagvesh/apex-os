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
