import {
  COMP_OFF_DEFAULT_VALIDITY_DAYS,
  COMP_OFF_MAXIMUM_VALIDITY_DAYS,
  COMP_OFF_UNIT_NOTE,
  POLICY_PROBLEM_REASON,
  resolveValidity,
  addDays,
  addMonths,
  validityUnit,
  claimEligibility,
  defaultExpiry,
  expiryCeiling,
  mayDecide,
  mayExtend,
  mayTransition,
  type CompOffValidityPolicy,
  type DecisionActor,
} from '../../src/modules/operations/leave/comp-off-workflow';

/**
 * Comp off authority and validity.
 *
 * The policy fixture is deliberately NOT the approved default. Management
 * approved 1 and 2 months; these are 2 and 5, so a hardcoded default cannot
 * pass for a configuration lookup.
 */

const POLICY: CompOffValidityPolicy = {
  defaultValidityMonths: 2,
  maximumTotalValidityMonths: 5,
};

/** A policy version issued before the month decision. Days, as it always was. */
const LEGACY: CompOffValidityPolicy = { defaultValidityDays: 21 };

const GRANTED = new Date(Date.UTC(2026, 8, 5)); // 5 September 2026

const employee = { employeeId: 'emp-1', reportingManagerId: 'mgr-1' };
const actor = (id: string, over: Partial<DecisionActor> = {}): DecisionActor => ({
  id, isAdmin: false, isHrOrAdmin: false, ...over,
});

const MANAGER = actor('mgr-1');
const OTHER_MANAGER = actor('mgr-2');
const ADMIN = actor('adm-1', { isAdmin: true, isHrOrAdmin: true });
const HR = actor('hr-1', { isHrOrAdmin: true });
const OPERATOR = actor('komal');

// ════════════════════════════════════════════════════════════════════════════
describe('nobody decides their own comp off', () => {
  it('1. THE EMPLOYEE CANNOT APPROVE THEIR OWN REQUEST', () => {
    const v = mayDecide(actor('emp-1'), employee, 'APPROVE_REQUEST');
    expect(v.allowed).toBe(false);
    expect(v.refusal).toBe('SELF_DECISION');
  });

  it('2. NOT EVEN WHEN THEY ARE THEIR OWN MANAGER', () => {
    // A data accident, and it must not become authority.
    const v = mayDecide(actor('emp-1'), { employeeId: 'emp-1', reportingManagerId: 'emp-1' },
      'APPROVE_REQUEST');
    expect(v.refusal).toBe('SELF_DECISION');
  });

  it('3. NOT EVEN AS AN ADMINISTRATOR, ON EITHER DECISION', () => {
    // Otherwise the safeguard evaporates for exactly the people with the most
    // authority.
    const self = { employeeId: 'adm-1', reportingManagerId: 'mgr-1' };
    expect(mayDecide(ADMIN, self, 'APPROVE_REQUEST').refusal).toBe('SELF_DECISION');
    expect(mayDecide(ADMIN, self, 'APPROVE_EXTENSION').refusal).toBe('SELF_DECISION');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('approval belongs to the direct manager', () => {
  it('4. the reporting manager may approve', () => {
    expect(mayDecide(MANAGER, employee, 'APPROVE_REQUEST').allowed).toBe(true);
  });

  it('5. AN UNRELATED MANAGER MAY NOT', () => {
    const v = mayDecide(OTHER_MANAGER, employee, 'APPROVE_REQUEST');
    expect(v.allowed).toBe(false);
    expect(v.refusal).toBe('NOT_THE_MANAGER');
  });

  it('6. an administrator may NOT approve the initial request', () => {
    // The decision belongs to the person who knows whether the work was done.
    // Extension is where administrative authority was granted, not approval.
    expect(mayDecide(ADMIN, employee, 'APPROVE_REQUEST').allowed).toBe(false);
  });

  it('7. HR MAY NOT APPROVE EITHER — HR is notified, not consulted', () => {
    expect(mayDecide(HR, employee, 'APPROVE_REQUEST').allowed).toBe(false);
    expect(mayDecide(HR, employee, 'APPROVE_EXTENSION').allowed).toBe(false);
  });

  it('8. a data operator may not', () => {
    expect(mayDecide(OPERATOR, employee, 'APPROVE_REQUEST').allowed).toBe(false);
  });

  it('9. NO MANAGER ON RECORD IS ITS OWN ANSWER', () => {
    // Distinct from "you are not the manager": HR must fix master data, and
    // saying the wrong one sends somebody to argue with the wrong person.
    const v = mayDecide(MANAGER, { employeeId: 'emp-1', reportingManagerId: null },
      'APPROVE_REQUEST');
    expect(v.refusal).toBe('NO_MANAGER_CONFIGURED');
    expect(v.reason).toMatch(/HR must set one/i);
  });

  it('10. an absent actor decides nothing', () => {
    expect(mayDecide(null, employee, 'APPROVE_REQUEST').refusal).toBe('NOT_AUTHORISED');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('extension additionally admits an administrator', () => {
  it('11. an administrator may approve an extension', () => {
    // A credit may need extending long after the approving manager has moved on.
    expect(mayDecide(ADMIN, employee, 'APPROVE_EXTENSION').allowed).toBe(true);
  });

  it('12. and so may the manager', () => {
    expect(mayDecide(MANAGER, employee, 'APPROVE_EXTENSION').allowed).toBe(true);
  });

  it('13. but an unrelated non-admin manager still may not', () => {
    expect(mayDecide(OTHER_MANAGER, employee, 'APPROVE_EXTENSION').allowed).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('a request is decided once', () => {
  it('14. pending may become approved or rejected', () => {
    expect(mayTransition('PENDING', 'APPROVED')).toBe(true);
    expect(mayTransition('PENDING', 'REJECTED')).toBe(true);
  });

  it('15. AN APPROVED REQUEST NEVER BECOMES REJECTED', () => {
    // A credit has already been granted against it; reversing the request
    // without reversing the credit leaves an entitlement nothing accounts for.
    expect(mayTransition('APPROVED', 'REJECTED')).toBe(false);
    expect(mayTransition('REJECTED', 'APPROVED')).toBe(false);
    expect(mayTransition('APPROVED', 'APPROVED')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('validity is calendar months, from the grant', () => {
  it('16. the unit is a property of the POLICY, not a constant', () => {
    expect(validityUnit(POLICY)).toBe('MONTHS');
    expect(validityUnit(LEGACY)).toBe('DAYS');
    expect(COMP_OFF_UNIT_NOTE).toMatch(/calendar months/i);
  });

  it('17. MANAGEMENT’S WORKED EXAMPLE, with the approved defaults', () => {
    // 5 Sep grant, 1 month default, 2 month ceiling.
    const approved: CompOffValidityPolicy = {
      defaultValidityMonths: 1, maximumTotalValidityMonths: 2,
    };
    expect(defaultExpiry(GRANTED, approved).toISOString().slice(0, 10)).toBe('2026-10-05');
    expect(expiryCeiling(GRANTED, approved)!.toISOString().slice(0, 10)).toBe('2026-11-05');
  });

  it('18. default expiry uses the CONFIGURED months', () => {
    // 5 Sep + 2 months = 5 Nov, not 5 Oct.
    expect(defaultExpiry(GRANTED, POLICY).toISOString().slice(0, 10)).toBe('2026-11-05');
  });

  it('19. THE CEILING IS MEASURED FROM THE GRANT DATE', () => {
    // 5 Sep + 5 months = 5 Feb.
    expect(expiryCeiling(GRANTED, POLICY)!.toISOString().slice(0, 10)).toBe('2027-02-05');
  });

  it('20. A LEGACY POLICY KEEPS DOING EXACTLY WHAT IT DID', () => {
    // Reinterpreting compOffExpiryDays as months would silently move the
    // expiry of every credit granted under it.
    expect(defaultExpiry(GRANTED, LEGACY).toISOString().slice(0, 10)).toBe('2026-09-26');
  });

  it('21. AND A LEGACY POLICY HAS NO CEILING — an absent rule, not an open one', () => {
    // It never defined a maximum. Inventing one here would be this feature
    // writing policy.
    expect(expiryCeiling(GRANTED, LEGACY)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('calendar month arithmetic', () => {
  it('22. THE MONTH END IS CLAMPED, NOT OVERFLOWED', () => {
    // setUTCMonth would make 31 January plus one month into 3 March, so a comp
    // off granted on the 31st would outlive one granted on the 28th. Nobody
    // wrote that rule.
    expect(addMonths(new Date(Date.UTC(2026, 0, 31)), 1).toISOString().slice(0, 10))
      .toBe('2026-02-28');
  });

  it('23. and a leap February takes the 29th', () => {
    expect(addMonths(new Date(Date.UTC(2028, 0, 31)), 1).toISOString().slice(0, 10))
      .toBe('2028-02-29');
  });

  it('24. 31 May plus one month is 30 June', () => {
    expect(addMonths(new Date(Date.UTC(2026, 4, 31)), 1).toISOString().slice(0, 10))
      .toBe('2026-06-30');
  });

  it('25. an ordinary date keeps its day of month', () => {
    expect(addMonths(new Date(Date.UTC(2026, 8, 5)), 2).toISOString().slice(0, 10))
      .toBe('2026-11-05');
  });

  it('26. and it crosses a year boundary', () => {
    expect(addMonths(new Date(Date.UTC(2026, 10, 15)), 3).toISOString().slice(0, 10))
      .toBe('2027-02-15');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('extension cannot outrun the ceiling', () => {
  const credit = (over: any = {}) => ({
    status: 'AVAILABLE',
    grantedOn: GRANTED,
    currentExpiry: defaultExpiry(GRANTED, POLICY), // 5 Nov
    ...over,
  });

  // Grant 5 Sep, default +2 months = 5 Nov, ceiling +5 months = 5 Feb 2027.
  it('27. a later date within the ceiling is allowed', () => {
    expect(mayExtend(credit(), new Date(Date.UTC(2026, 11, 10)), POLICY).allowed).toBe(true);
  });

  it('28. the ceiling date ITSELF is allowed', () => {
    expect(mayExtend(credit(), new Date(Date.UTC(2027, 1, 5)), POLICY).allowed).toBe(true);
  });

  it('29. ONE DAY BEYOND IS REFUSED', () => {
    const v = mayExtend(credit(), new Date(Date.UTC(2027, 1, 6)), POLICY);
    expect(v.allowed).toBe(false);
    expect(v.refusal).toBe('BEYOND_MAXIMUM_VALIDITY');
    expect(v.reason).toMatch(/2027-02-05/);
    expect(v.reason).toMatch(/5 months from the date it was granted/i);
  });

  it('40. REPEATED EXTENSIONS CANNOT WALK PAST THE CEILING', () => {
    // The mistake this guards: computing the ceiling from the CURRENT expiry
    // would move the baseline each time, and a credit could be extended
    // forever one step at a time.
    let expiry = defaultExpiry(GRANTED, POLICY); // 5 Nov
    for (const target of [Date.UTC(2026, 11, 1), Date.UTC(2027, 0, 10), Date.UTC(2027, 1, 5)]) {
      const v = mayExtend(credit({ currentExpiry: expiry }), new Date(target), POLICY);
      expect(v.allowed).toBe(true);
      expiry = new Date(target);
    }
    const past = mayExtend(credit({ currentExpiry: expiry }),
      new Date(Date.UTC(2027, 1, 6)), POLICY);
    expect(past.refusal).toBe('BEYOND_MAXIMUM_VALIDITY');
  });

  it('41. an extension must move FORWARD', () => {
    expect(mayExtend(credit(), new Date(Date.UTC(2026, 9, 20)), POLICY).refusal)
      .toBe('NOT_LATER_THAN_CURRENT');
  });

  it('42. AN EXTENSION TO THE SAME DATE IS NOT AN EXTENSION', () => {
    // Recording one would put a decision in the audit trail that had no effect.
    expect(mayExtend(credit(), defaultExpiry(GRANTED, POLICY), POLICY).refusal)
      .toBe('NOT_LATER_THAN_CURRENT');
  });

  it('43. a spent credit cannot be extended', () => {
    // Lengthening its life would imply it could be spent again.
    expect(mayExtend(credit({ status: 'USED' }), new Date(Date.UTC(2026, 11, 10)), POLICY).refusal)
      .toBe('CREDIT_ALREADY_USED');
  });

  it('44. nor an expired or cancelled one', () => {
    expect(mayExtend(credit({ status: 'EXPIRED' }), new Date(Date.UTC(2026, 11, 10)), POLICY).refusal)
      .toBe('CREDIT_EXPIRED');
    expect(mayExtend(credit({ status: 'CANCELLED' }), new Date(Date.UTC(2026, 11, 10)), POLICY).refusal)
      .toBe('CREDIT_CANCELLED');
  });

  it('35. a malformed date is refused, never coerced', () => {
    expect(mayExtend(credit(), new Date('not a date'), POLICY).refusal).toBe('MALFORMED_DATE');
  });

  it('36. A LEGACY POLICY REFUSES EXTENSION RATHER THAN INVENTING A CEILING', () => {
    const v = mayExtend(credit(), new Date(Date.UTC(2026, 11, 10)), LEGACY);
    expect(v.allowed).toBe(false);
    expect(v.refusal).toBe('NO_MAXIMUM_CONFIGURED');
    expect(v.ceiling).toBeNull();
    expect(v.reason).toMatch(/HR must set one/i);
  });

  it('37. every verdict carries the ceiling, so a screen can explain itself', () => {
    for (const status of ['AVAILABLE', 'USED', 'EXPIRED']) {
      const v = mayExtend(credit({ status }), new Date(Date.UTC(2026, 11, 10)), POLICY);
      expect(v.ceiling!.toISOString().slice(0, 10)).toBe('2027-02-05');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the claimed day must fall inside employment', () => {
  const joined = new Date(Date.UTC(2026, 5, 15));
  const left = new Date(Date.UTC(2026, 8, 30));

  it('30. a day before joining cannot earn a comp off', () => {
    expect(claimEligibility(new Date(Date.UTC(2026, 5, 14)), joined, null)).toBe('BEFORE_JOINING');
  });

  it('31. nor one after leaving', () => {
    expect(claimEligibility(new Date(Date.UTC(2026, 9, 1)), joined, left)).toBe('AFTER_LEAVING');
  });

  it('32. both boundary days are working days', () => {
    expect(claimEligibility(joined, joined, left)).toBeNull();
    expect(claimEligibility(left, joined, left)).toBeNull();
  });

  it('33. a missing joining date is a master-data problem, not a licence', () => {
    expect(claimEligibility(new Date(Date.UTC(2026, 5, 20)), null, null))
      .toBe('UNKNOWN_JOINING_DATE');
  });

  it('34. an ordinary day for a current employee is fine', () => {
    expect(claimEligibility(new Date(Date.UTC(2026, 7, 1)), joined, null)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('day arithmetic, for legacy policies', () => {
  it('38. adding days crosses month ends correctly', () => {
    // 5 Aug + 30 = 4 Sep, NOT 5 Sep. Precisely why the unit is worth naming.
    expect(addDays(new Date(Date.UTC(2026, 7, 5)), 30).toISOString().slice(0, 10))
      .toBe('2026-09-04');
  });

  it('39. and leap days', () => {
    expect(addDays(new Date(Date.UTC(2028, 1, 20)), 10).toISOString().slice(0, 10))
      .toBe('2028-03-01');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('a half-configured policy is INVALID, never a fallback', () => {
  const held = (currentExpiry: Date) => ({
    status: 'AVAILABLE', grantedOn: GRANTED, currentExpiry,
  });

  /**
   * The dangerous shape. Somebody sets the default in months and leaves the
   * maximum empty. Answering the missing half from compOffExpiryDays would
   * produce a credit whose default is measured in months and whose ceiling is
   * measured in days — a rule nobody wrote and nobody would spot.
   */

  it('40. DEFAULT MONTHS WITHOUT A MAXIMUM IS REFUSED, NOT COMPLETED FROM DAYS', () => {
    const half: CompOffValidityPolicy = {
      defaultValidityMonths: 1,
      defaultValidityDays: 21, // present, and deliberately NOT used
    };
    const resolution = resolveValidity(half);
    expect(resolution.unit).toBe('INVALID');
    expect(resolution.problems).toEqual(['PARTIAL_MONTH_CONFIGURATION']);

    // The specific failure being guarded: it must NOT quietly become 26 Sep.
    expect(defaultExpiry(GRANTED, half)).toBeNull();
    expect(expiryCeiling(GRANTED, half)).toBeNull();
  });

  it('41. A MAXIMUM WITHOUT A DEFAULT IS REFUSED THE SAME WAY', () => {
    const half: CompOffValidityPolicy = {
      maximumTotalValidityMonths: 2,
      defaultValidityDays: 21, // again present, again not consulted
    };
    expect(resolveValidity(half).unit).toBe('INVALID');
    expect(defaultExpiry(GRANTED, half)).toBeNull();

    // The ceiling must key on COHERENCE, not merely on the maximum field being
    // populated. Reading the field alone would hand mayExtend a real ceiling
    // and let a credit be extended under a policy nobody finished writing.
    expect(expiryCeiling(GRANTED, half)).toBeNull();
    expect(mayExtend(held(new Date(Date.UTC(2026, 9, 5))),
      new Date(Date.UTC(2026, 10, 1)), half).refusal).toBe('NO_MAXIMUM_CONFIGURED');
  });

  it('42. zero or negative months are refused', () => {
    expect(resolveValidity({ defaultValidityMonths: 0, maximumTotalValidityMonths: 2 })
      .problems).toContain('DEFAULT_MONTHS_NOT_POSITIVE');
    expect(resolveValidity({ defaultValidityMonths: 1, maximumTotalValidityMonths: -1 })
      .problems).toContain('MAXIMUM_MONTHS_NOT_POSITIVE');
  });

  it('43. A MAXIMUM SHORTER THAN THE DEFAULT IS REFUSED', () => {
    // Every credit would be born already past its own ceiling.
    const inverted: CompOffValidityPolicy = {
      defaultValidityMonths: 3, maximumTotalValidityMonths: 2,
    };
    expect(resolveValidity(inverted).problems).toEqual(['MAXIMUM_BELOW_DEFAULT']);
    expect(defaultExpiry(GRANTED, inverted)).toBeNull();
  });

  it('44. equal default and maximum is valid — it means “no extensions”', () => {
    const rigid: CompOffValidityPolicy = {
      defaultValidityMonths: 2, maximumTotalValidityMonths: 2,
    };
    expect(resolveValidity(rigid).unit).toBe('MONTHS');
    expect(defaultExpiry(GRANTED, rigid)!.toISOString().slice(0, 10)).toBe('2026-11-05');
    // The ceiling equals the default expiry, so nothing later can be asked for.
    const expiry = defaultExpiry(GRANTED, rigid)!;
    expect(mayExtend(held(expiry), addDays(expiry, 1), rigid).refusal)
      .toBe('BEYOND_MAXIMUM_VALIDITY');
  });

  it('45. a nonsense legacy days value is refused rather than defaulted to 30', () => {
    expect(resolveValidity({ defaultValidityDays: 0 }).problems)
      .toEqual(['LEGACY_DAYS_NOT_POSITIVE']);
  });

  it('46. AN INCOHERENT POLICY CANNOT BE EXTENDED, and says why', () => {
    const half: CompOffValidityPolicy = { defaultValidityMonths: 1 };
    const verdict = mayExtend(
      held(new Date(Date.UTC(2026, 9, 5))), new Date(Date.UTC(2026, 11, 1)), half);
    expect(verdict.allowed).toBe(false);
    expect(verdict.refusal).toBe('NO_MAXIMUM_CONFIGURED');
    // The message must name the real problem, not the legacy “no ceiling” one.
    expect(verdict.reason).toMatch(/half configured/i);
  });

  it('47. every problem code carries a message a human can act on', () => {
    for (const [code, message] of Object.entries(POLICY_PROBLEM_REASON)) {
      expect(message.length).toBeGreaterThan(20);
      expect(message).not.toMatch(/undefined|null/);
      expect(code).toMatch(/^[A-Z_]+$/);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// The company rule: 45 days by default, 60 days at the very most
// ════════════════════════════════════════════════════════════════════════════
//
// Expressed in DAYS, which is why the days unit needed a ceiling at all. It had
// a default and no maximum, so expiryCeiling returned null for it and mayExtend
// refused every extension with NO_MAXIMUM_CONFIGURED -- the company rule was
// not merely unconfigured, it could not be written down.
//
// The ceiling is measured from the GRANT, never from the current expiry. That
// distinction is the whole value of a maximum: measured from the last
// extension, a credit could be walked forward indefinitely, one extension at a
// time, and never breach anything.
describe('comp off validity in days: 45 default, 60 maximum', () => {
  const COMPANY: CompOffValidityPolicy = {
    defaultValidityDays: COMP_OFF_DEFAULT_VALIDITY_DAYS,
    maximumTotalValidityDays: COMP_OFF_MAXIMUM_VALIDITY_DAYS,
  };

  it('the approved figures are 45 and 60', () => {
    // Pinned out loud. Changing the company rule should have to change a test
    // that states it, not slip through as an edited literal.
    expect(COMP_OFF_DEFAULT_VALIDITY_DAYS).toBe(45);
    expect(COMP_OFF_MAXIMUM_VALIDITY_DAYS).toBe(60);
  });

  it('GRANT + 45 DAYS is the default expiry', () => {
    expect(defaultExpiry(GRANTED, COMPANY)).toEqual(addDays(GRANTED, 45));
  });

  it('GRANT + 60 DAYS is the ceiling, measured from the grant', () => {
    expect(expiryCeiling(GRANTED, COMPANY)).toEqual(addDays(GRANTED, 60));
  });

  it('ALLOWS an extension to exactly 60 days', () => {
    const verdict = mayExtend(
      { status: 'AVAILABLE', grantedOn: GRANTED, currentExpiry: addDays(GRANTED, 45) },
      addDays(GRANTED, 60),
      COMPANY,
    );

    // Inclusive: the maximum is reachable, not merely approachable.
    expect(verdict.allowed).toBe(true);
    expect(verdict.refusal).toBeNull();
  });

  it('REFUSES an extension to 61 days', () => {
    const verdict = mayExtend(
      { status: 'AVAILABLE', grantedOn: GRANTED, currentExpiry: addDays(GRANTED, 45) },
      addDays(GRANTED, 61),
      COMPANY,
    );

    expect(verdict.allowed).toBe(false);
    expect(verdict.refusal).toBe('BEYOND_MAXIMUM_VALIDITY');
    expect(verdict.ceiling).toEqual(addDays(GRANTED, 60));
  });

  it('MEASURES THE CEILING FROM THE GRANT, not from the latest expiry', () => {
    // A credit already extended to day 60. A further extension must be
    // refused, because the ceiling has not moved with it. Measured from the
    // current expiry this would read as "60 + 60", and the limit would mean
    // nothing.
    const verdict = mayExtend(
      { status: 'AVAILABLE', grantedOn: GRANTED, currentExpiry: addDays(GRANTED, 60) },
      addDays(GRANTED, 75),
      COMPANY,
    );

    expect(verdict.refusal).toBe('BEYOND_MAXIMUM_VALIDITY');
    expect(verdict.ceiling).toEqual(addDays(GRANTED, 60));
  });

  it('still refuses an extension when no maximum is configured', () => {
    // An absent ceiling is an unwritten rule, not permission. A days policy
    // with no maximum must not fall back to 60.
    const noCeiling: CompOffValidityPolicy = { defaultValidityDays: 45 };

    expect(expiryCeiling(GRANTED, noCeiling)).toBeNull();
    expect(
      mayExtend(
        { status: 'AVAILABLE', grantedOn: GRANTED, currentExpiry: addDays(GRANTED, 45) },
        addDays(GRANTED, 50),
        noCeiling,
      ).refusal,
    ).toBe('NO_MAXIMUM_CONFIGURED');
  });

  it('falls back to 45 days when the policy configures no default', () => {
    expect(defaultExpiry(GRANTED, {})).toEqual(addDays(GRANTED, 45));
    // And specifically NOT the 30 that used to be written inline here and
    // twice more in CompOffService.
    expect(defaultExpiry(GRANTED, {})).not.toEqual(addDays(GRANTED, 30));
  });

  it('A CONFIGURED POLICY STILL WINS over the company figures', () => {
    const configured: CompOffValidityPolicy = {
      defaultValidityDays: 10,
      maximumTotalValidityDays: 20,
    };

    expect(defaultExpiry(GRANTED, configured)).toEqual(addDays(GRANTED, 10));
    expect(expiryCeiling(GRANTED, configured)).toEqual(addDays(GRANTED, 20));
  });

  it('refuses a day maximum shorter than the day default', () => {
    // Every credit would be born past its ceiling and un-extendable from the
    // moment it was granted.
    const upsideDown: CompOffValidityPolicy = {
      defaultValidityDays: 45,
      maximumTotalValidityDays: 30,
    };

    const resolution = resolveValidity(upsideDown);
    expect(resolution.unit).toBe('INVALID');
    expect(resolution.problems).toContain('MAXIMUM_DAYS_BELOW_DEFAULT');
  });

  it('refuses a day maximum that is not a positive whole number', () => {
    for (const bad of [0, -5, 2.5]) {
      const resolution = resolveValidity({ defaultValidityDays: 45, maximumTotalValidityDays: bad });
      expect(resolution.unit).toBe('INVALID');
      expect(resolution.problems).toContain('MAXIMUM_DAYS_NOT_POSITIVE');
    }
  });

  it('does not let a days maximum leak into a months policy', () => {
    // Months win when both month fields are set; a stray days maximum must not
    // silently become the ceiling for a month-based policy.
    const mixed: CompOffValidityPolicy = {
      defaultValidityMonths: 2,
      maximumTotalValidityMonths: 5,
      maximumTotalValidityDays: 60,
    };

    expect(validityUnit(mixed)).toBe('MONTHS');
    expect(expiryCeiling(GRANTED, mixed)).toEqual(addMonths(GRANTED, 5));
  });
});
