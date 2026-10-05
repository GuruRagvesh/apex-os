/**
 * Comp off: who may decide, and how long a credit can live.
 *
 * Pure. No Prisma, no clock, no Nest. The two things worth being certain about
 * are an authority question and a date question, and both are decidable from
 * their arguments.
 *
 * TWO UNITS, AND WHICH ONE APPLIES IS A PROPERTY OF THE POLICY.
 *
 * Management approved calendar months: one month by default, two months from
 * the original grant as the absolute ceiling. A 5 September grant therefore
 * expires 5 October and can never outlive 5 November.
 *
 * The shipped schema predates that decision. LeavePolicy.compOffExpiryDays is
 * a DAYS field defaulting to 30, and the existing grant path adds days. Those
 * two rules agree for a 30-day month and disagree elsewhere -- 5 August plus
 * thirty days is 4 September, not 5 September.
 *
 * So the old field is not reinterpreted. A policy carrying the new month fields
 * uses calendar months; a policy without them keeps doing exactly what it does
 * today. Nothing already granted moves, because a stored expiry is authoritative
 * and this module never recomputes one.
 */

export const COMP_OFF_UNIT_NOTE =
  'Comp off validity is configured in calendar months on current policy ' +
  'versions. Older policies still carry a days-based expiry, which is left ' +
  'alone: thirty days and one month coincide only for a 30-day month.';

// ─────────────────────────────────────────────────────────────────────────────
// Authority
// ─────────────────────────────────────────────────────────────────────────────

export type CompOffDecision = 'APPROVE_REQUEST' | 'APPROVE_EXTENSION';

export type AuthorityRefusal =
  | 'SELF_DECISION'
  | 'NOT_THE_MANAGER'
  | 'NO_MANAGER_CONFIGURED'
  | 'NOT_AUTHORISED';

export interface DecisionActor {
  id: string;
  isAdmin: boolean;
  isHrOrAdmin: boolean;
}

export interface RequestSubject {
  employeeId: string;
  /** From EmployeeAttendanceProfile, not the free-text name on User. */
  reportingManagerId: string | null;
}

export interface AuthorityVerdict {
  allowed: boolean;
  refusal: AuthorityRefusal | null;
  reason: string | null;
}

export const REFUSAL_REASON: Record<AuthorityRefusal, string> = {
  SELF_DECISION: 'You cannot decide your own comp off request.',
  NOT_THE_MANAGER: 'Only this employee’s reporting manager can decide this request.',
  NO_MANAGER_CONFIGURED:
    'This employee has no reporting manager on record. HR must set one before ' +
    'the request can be decided.',
  NOT_AUTHORISED: 'You are not authorised to decide comp off requests.',
};

const allow = (): AuthorityVerdict => ({ allowed: true, refusal: null, reason: null });
const refuse = (refusal: AuthorityRefusal): AuthorityVerdict => ({
  allowed: false,
  refusal,
  reason: REFUSAL_REASON[refusal],
});

/**
 * May this actor decide this comp off?
 *
 * SELF-DECISION IS REFUSED BEFORE ANYTHING ELSE, and refused even for an
 * administrator. Owning the request is never authority over it, and an admin
 * who is also somebody's manager must still not approve their own -- otherwise
 * the safeguard evaporates for exactly the people with the most authority.
 *
 * The APPROVAL of a request is the direct manager's. Extension additionally
 * admits an administrator, because a credit may need extending long after the
 * manager who approved it has moved on, and management said so explicitly.
 *
 * HR is deliberately NOT an approver here. HR is notified of the outcome; the
 * decision belongs to the person who knows whether the work was done.
 */
export function mayDecide(
  actor: DecisionActor | null | undefined,
  subject: RequestSubject,
  decision: CompOffDecision,
): AuthorityVerdict {
  if (!actor?.id) return refuse('NOT_AUTHORISED');

  // First, and for everybody.
  if (actor.id === subject.employeeId) return refuse('SELF_DECISION');

  const isManager =
    Boolean(subject.reportingManagerId) && subject.reportingManagerId === actor.id;

  if (decision === 'APPROVE_EXTENSION' && actor.isAdmin) return allow();
  if (isManager) return allow();

  if (!subject.reportingManagerId) return refuse('NO_MANAGER_CONFIGURED');
  return refuse('NOT_THE_MANAGER');
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * A request is decided once.
 *
 * An approved request must never quietly become rejected: a credit has already
 * been granted against it, and reversing the request without reversing the
 * credit would leave an entitlement nothing accounts for.
 */
export function mayTransition(from: string, to: RequestStatus): boolean {
  return from === 'PENDING' && (to === 'APPROVED' || to === 'REJECTED');
}

// ─────────────────────────────────────────────────────────────────────────────
// Expiry
// ─────────────────────────────────────────────────────────────────────────────

export interface CompOffValidityPolicy {
  /** VNext. Calendar months a credit lives by default. */
  defaultValidityMonths?: number | null;
  /** VNext. Absolute calendar months from the GRANT date, extensions included. */
  maximumTotalValidityMonths?: number | null;
  /** LeavePolicy.compOffExpiryDays. Days a credit lives by default. */
  defaultValidityDays?: number | null;
  /**
   * Absolute DAYS from the grant date, extensions included.
   *
   * ADDED SO THE COMPANY RULE CAN BE STATED AT ALL. The agreed figures are 45
   * days default and 60 days maximum, and months cannot express 45 days. The
   * DAYS unit previously had a default and no ceiling, so expiryCeiling
   * returned null for it and every extension was refused with
   * NO_MAXIMUM_CONFIGURED -- the rule was not merely unset, it was
   * inexpressible.
   *
   * Still optional, and still NOT an unlimited ceiling when absent: a policy
   * that never configured one has an absent rule, and mayExtend refuses rather
   * than inventing a limit.
   */
  maximumTotalValidityDays?: number | null;
}

/**
 * The company comp off validity, in days.
 *
 * ONE PLACE. The default was written as a bare `?? 30` in defaultExpiry here
 * and again twice in CompOffService, so three copies of one entitlement rule
 * could drift apart with nothing to catch it. A policy row still overrides
 * these; they are what applies when none is configured.
 */
export const COMP_OFF_DEFAULT_VALIDITY_DAYS = 45;
export const COMP_OFF_MAXIMUM_VALIDITY_DAYS = 60;

export type ValidityUnit = 'MONTHS' | 'DAYS' | 'INVALID';

export type PolicyProblem =
  /** One month field set and not the other. */
  | 'PARTIAL_MONTH_CONFIGURATION'
  | 'DEFAULT_MONTHS_NOT_POSITIVE'
  | 'MAXIMUM_MONTHS_NOT_POSITIVE'
  | 'MAXIMUM_BELOW_DEFAULT'
  | 'LEGACY_DAYS_NOT_POSITIVE'
  | 'MAXIMUM_DAYS_NOT_POSITIVE'
  | 'MAXIMUM_DAYS_BELOW_DEFAULT';

export interface ValidityResolution {
  unit: ValidityUnit;
  problems: PolicyProblem[];
  reason: string | null;
}

export const POLICY_PROBLEM_REASON: Record<PolicyProblem, string> = {
  PARTIAL_MONTH_CONFIGURATION:
    'Comp off validity is half configured: set both the default and the maximum ' +
    'in months, or neither.',
  DEFAULT_MONTHS_NOT_POSITIVE: 'Default comp off validity must be at least one month.',
  MAXIMUM_MONTHS_NOT_POSITIVE: 'Maximum comp off validity must be at least one month.',
  MAXIMUM_BELOW_DEFAULT:
    'Maximum comp off validity cannot be shorter than the default validity.',
  LEGACY_DAYS_NOT_POSITIVE: 'Comp off expiry days must be a positive number.',
  MAXIMUM_DAYS_NOT_POSITIVE: 'Maximum comp off validity must be at least one day.',
  MAXIMUM_DAYS_BELOW_DEFAULT:
    'Maximum comp off validity cannot be shorter than the default validity.',
};

/**
 * Which arithmetic this policy asks for, and whether it asks coherently.
 *
 * BOTH MONTH FIELDS OR NEITHER. Half a configuration is INVALID and is never
 * completed from the legacy days field: somebody who sets a one-month default
 * and forgets the maximum has stated an intention about months, and quietly
 * answering the other half from a thirty-day column mixes two policy
 * generations inside a single credit. The likely result is a default measured
 * in months and a ceiling measured in days, which nobody would ever write down
 * and nobody would notice.
 *
 * A maximum shorter than the default is refused too. It would make every credit
 * born already past its ceiling and therefore un-extendable from the moment it
 * was granted.
 */
export function resolveValidity(policy: CompOffValidityPolicy): ValidityResolution {
  const hasDefault = typeof policy.defaultValidityMonths === 'number';
  const hasMaximum = typeof policy.maximumTotalValidityMonths === 'number';
  const problems: PolicyProblem[] = [];

  const fail = (): ValidityResolution => ({
    unit: 'INVALID',
    problems,
    reason: problems.map((p) => POLICY_PROBLEM_REASON[p]).join(' '),
  });

  if (hasDefault !== hasMaximum) {
    problems.push('PARTIAL_MONTH_CONFIGURATION');
    return fail();
  }

  if (hasDefault && hasMaximum) {
    const def = policy.defaultValidityMonths as number;
    const max = policy.maximumTotalValidityMonths as number;
    if (!Number.isInteger(def) || def <= 0) problems.push('DEFAULT_MONTHS_NOT_POSITIVE');
    if (!Number.isInteger(max) || max <= 0) problems.push('MAXIMUM_MONTHS_NOT_POSITIVE');
    if (problems.length === 0 && max < def) problems.push('MAXIMUM_BELOW_DEFAULT');
    if (problems.length > 0) return fail();
    return { unit: 'MONTHS', problems: [], reason: null };
  }

  // Neither month field: the policy is expressed in days.
  const days = policy.defaultValidityDays;
  if (days !== null && days !== undefined && (!Number.isInteger(days) || days <= 0)) {
    problems.push('LEGACY_DAYS_NOT_POSITIVE');
    return fail();
  }

  // The day ceiling is validated exactly as the month one is. A maximum below
  // the default would make every credit born past its ceiling and therefore
  // un-extendable from the moment it was granted.
  const maxDays = policy.maximumTotalValidityDays;
  if (maxDays !== null && maxDays !== undefined) {
    if (!Number.isInteger(maxDays) || maxDays <= 0) {
      problems.push('MAXIMUM_DAYS_NOT_POSITIVE');
      return fail();
    }
    const effectiveDefault = days ?? COMP_OFF_DEFAULT_VALIDITY_DAYS;
    if (maxDays < effectiveDefault) {
      problems.push('MAXIMUM_DAYS_BELOW_DEFAULT');
      return fail();
    }
  }

  return { unit: 'DAYS', problems: [], reason: null };
}

/** Convenience for callers that only need the unit. */
export function validityUnit(policy: CompOffValidityPolicy): ValidityUnit {
  return resolveValidity(policy).unit;
}

export function addDays(from: Date, days: number): Date {
  const out = new Date(from.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/**
 * Calendar months, with the month-end case handled rather than left to
 * JavaScript.
 *
 * setUTCMonth OVERFLOWS: 31 January plus one month becomes 3 March, because
 * February has no 31st and the excess spills forward. A comp off granted on the
 * 31st would then outlive one granted on the 28th, which is not a rule anybody
 * wrote. The day is clamped to the last day of the target month instead, so
 * 31 January plus one month is 28 February -- or the 29th in a leap year.
 */
export function addMonths(from: Date, months: number): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth();
  const day = from.getUTCDate();

  const targetMonthStart = new Date(Date.UTC(year, month + months, 1));
  const lastDayOfTarget = new Date(
    Date.UTC(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth() + 1, 0),
  ).getUTCDate();

  return new Date(
    Date.UTC(
      targetMonthStart.getUTCFullYear(),
      targetMonthStart.getUTCMonth(),
      Math.min(day, lastDayOfTarget),
    ),
  );
}

/**
 * When a credit granted today would expire.
 *
 * MEASURED FROM THE GRANT, not from the day the work was done. A request for
 * work on 10 August approved on 5 September is valid from 5 September --
 * management said validity starts when the credit is granted, and dating it
 * from the worked day would silently shorten every credit by however long the
 * approval took.
 *
 * Returns NULL for an incoherent policy rather than guessing. A caller that
 * ignored that would be granting a credit whose expiry nobody could defend.
 */
export function defaultExpiry(grantedOn: Date, policy: CompOffValidityPolicy): Date | null {
  const resolution = resolveValidity(policy);
  if (resolution.unit === 'INVALID') return null;
  return resolution.unit === 'MONTHS'
    ? addMonths(grantedOn, policy.defaultValidityMonths as number)
    : addDays(grantedOn, policy.defaultValidityDays ?? COMP_OFF_DEFAULT_VALIDITY_DAYS);
}

/**
 * The furthest an expiry may ever be pushed.
 *
 * MEASURED FROM THE GRANT DATE. Computing it from the CURRENT expiry is the
 * mistake that makes the ceiling meaningless: each extension would move the
 * baseline, and a credit could be walked forward indefinitely one extension at
 * a time. Management's rule is a total, not an increment.
 *
 * Returns NULL only when the policy configures no maximum at all. That is not
 * an unlimited ceiling -- it is an absent rule, and mayExtend refuses rather
 * than inventing one.
 */
export function expiryCeiling(grantedOn: Date, policy: CompOffValidityPolicy): Date | null {
  const unit = resolveValidity(policy).unit;
  if (unit === 'MONTHS') {
    return addMonths(grantedOn, policy.maximumTotalValidityMonths as number);
  }
  if (unit === 'DAYS' && typeof policy.maximumTotalValidityDays === 'number') {
    return addDays(grantedOn, policy.maximumTotalValidityDays);
  }
  return null;
}

export type ExtensionRefusal =
  | 'NOT_LATER_THAN_CURRENT'
  | 'BEYOND_MAXIMUM_VALIDITY'
  | 'NO_MAXIMUM_CONFIGURED'
  | 'CREDIT_ALREADY_USED'
  | 'CREDIT_EXPIRED'
  | 'CREDIT_CANCELLED'
  | 'MALFORMED_DATE';

export interface ExtensionVerdict {
  allowed: boolean;
  refusal: ExtensionRefusal | null;
  reason: string | null;
  /** The latest date this extension could have asked for, or null if unruled. */
  ceiling: Date | null;
}

export interface CreditFacts {
  status: string;
  /** The date the credit was granted from -- the ceiling's origin. */
  grantedOn: Date;
  currentExpiry: Date;
}

/**
 * May this credit's expiry move to the proposed date?
 *
 * An extension moves an expiry FORWARD and never past the ceiling. Equality
 * with the current expiry is refused as well as a date before it: an extension
 * that changes nothing is not an extension, and recording one would put a
 * decision in the audit trail that had no effect.
 *
 * A used credit cannot be extended, because the entitlement is spent and
 * lengthening its life would imply it could be spent again.
 */
export function mayExtend(
  credit: CreditFacts,
  proposedExpiry: Date,
  policy: CompOffValidityPolicy,
): ExtensionVerdict {
  const ceiling = expiryCeiling(credit.grantedOn, policy);

  const verdict = (refusal: ExtensionRefusal | null, reason: string | null): ExtensionVerdict => ({
    allowed: refusal === null,
    refusal,
    reason,
    ceiling,
  });

  // An absent maximum is an unwritten rule, not permission. Extending under a
  // policy that never defined a ceiling would let this feature invent one, and
  // an incoherent policy is refused for the same reason rather than being
  // half-honoured.
  if (ceiling === null) {
    const resolution = resolveValidity(policy);
    return verdict(
      'NO_MAXIMUM_CONFIGURED',
      resolution.unit === 'INVALID'
        ? `${resolution.reason} A credit cannot be extended until this is corrected.`
        : 'This leave policy does not define a maximum comp off validity. HR must ' +
          'set one before a credit can be extended.',
    );
  }

  if (!(proposedExpiry instanceof Date) || Number.isNaN(proposedExpiry.getTime())) {
    return verdict('MALFORMED_DATE', 'The new expiry date could not be read.');
  }
  if (credit.status === 'USED') {
    return verdict('CREDIT_ALREADY_USED', 'This comp off has already been taken.');
  }
  if (credit.status === 'EXPIRED') {
    return verdict('CREDIT_EXPIRED', 'This comp off has already expired.');
  }
  if (credit.status === 'CANCELLED') {
    return verdict('CREDIT_CANCELLED', 'This comp off has been cancelled.');
  }
  if (proposedExpiry.getTime() <= credit.currentExpiry.getTime()) {
    return verdict(
      'NOT_LATER_THAN_CURRENT',
      'An extension must move the expiry later than it is now.',
    );
  }
  if (proposedExpiry.getTime() > ceiling.getTime()) {
    return verdict(
      'BEYOND_MAXIMUM_VALIDITY',
      `A comp off cannot be valid beyond ${ceiling.toISOString().slice(0, 10)}, ` +
        `which is ${policy.maximumTotalValidityMonths} months from the date it ` +
        'was granted.',
    );
  }

  return verdict(null, null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Eligibility
// ─────────────────────────────────────────────────────────────────────────────

export type EligibilityRefusal =
  | 'BEFORE_JOINING'
  | 'AFTER_LEAVING'
  | 'UNKNOWN_JOINING_DATE';

/**
 * Was this person employed on the day they are claiming for?
 *
 * The same rule the attendance evaluator applies, for the same reason: a
 * credit earned on a day somebody was not employed is not a credit, and a
 * missing joining date is a master-data problem rather than a licence to
 * assume.
 */
export function claimEligibility(
  workedOn: Date,
  joiningDate: Date | null,
  lastWorkingDate: Date | null,
): EligibilityRefusal | null {
  if (!joiningDate) return 'UNKNOWN_JOINING_DATE';
  const day = utcDay(workedOn);
  if (day < utcDay(joiningDate)) return 'BEFORE_JOINING';
  if (lastWorkingDate && day > utcDay(lastWorkingDate)) return 'AFTER_LEAVING';
  return null;
}

function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
