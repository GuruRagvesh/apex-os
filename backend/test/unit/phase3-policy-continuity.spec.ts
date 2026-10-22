import {
  POLICY_BASELINE_DATE,
  policyHealthDedupeKey,
  previousCompanyDate,
  resolveContinuousPolicy,
} from '../../src/modules/platform/attendance/policy/policy-continuity';

const v = (id: string, effectiveFrom: string, effectiveTo: string | null = null, version = 1) => ({ id, effectiveFrom, effectiveTo, version });

describe('Phase 3 policy continuity resolver', () => {
  it('baseline: a date on/after 1 Dec 2020 before the first version applies that version and warns', () => {
    const r = resolveContinuousPolicy([v('p1', '2021-04-01')], '2020-12-15');
    expect(r.policy?.id).toBe('p1');
    expect(r.health).toBe('MISSING_BASELINE');
    expect(r.rangeFrom).toBe(POLICY_BASELINE_DATE);
    expect(r.rangeTo).toBe('2021-03-31');
  });

  it('nothing is applicable before the company baseline', () => {
    const r = resolveContinuousPolicy([v('p1', '2020-01-01')], '2020-11-30');
    expect(r.policy).toBeNull();
    expect(r.health).toBeNull();
  });

  it('a future version never governs before its effective date', () => {
    const current = v('p1', '2026-04-01', '2026-11-30');
    const future = v('p2', '2026-12-01', null, 2);
    expect(resolveContinuousPolicy([current, future], '2026-11-30').policy?.id).toBe('p1');
    expect(resolveContinuousPolicy([current, future], '2026-12-01').policy?.id).toBe('p2');
  });

  it('a gap continues the most recent earlier version and reports the gap range', () => {
    const r = resolveContinuousPolicy([v('p1', '2026-01-01', '2026-03-31'), v('p2', '2026-05-01', null, 2)], '2026-04-15');
    expect(r.policy?.id).toBe('p1');
    expect(r.health).toBe('GAP');
    expect([r.rangeFrom, r.rangeTo]).toEqual(['2026-04-01', '2026-04-30']);
  });

  it('an overlap uses the latest effectiveFrom, then the higher version', () => {
    const r = resolveContinuousPolicy([v('p1', '2026-01-01'), v('p2', '2026-06-01', null, 2)], '2026-07-01');
    expect(r.policy?.id).toBe('p2');
    expect(r.health).toBe('OVERLAP');
    const tie = resolveContinuousPolicy([v('a', '2026-06-01', null, 1), v('b', '2026-06-01', null, 3)], '2026-07-01');
    expect(tie.policy?.id).toBe('b');
  });

  it('no version at all is POLICY_SETUP_PENDING material, never an exception', () => {
    const r = resolveContinuousPolicy([], '2026-07-01');
    expect(r.policy).toBeNull();
    expect(r.health).toBe('NO_POLICY');
  });

  it('a successor closes its predecessor on the previous company date', () => {
    expect(previousCompanyDate('2026-12-01')).toBe('2026-11-30');
    expect(previousCompanyDate('2027-01-01')).toBe('2026-12-31');
  });

  it('health dedupe keys are stable for the same finding', () => {
    const r = resolveContinuousPolicy([v('p2', '2026-05-01'), v('p1', '2026-01-01', '2026-03-31')], '2026-04-15');
    expect(policyHealthDedupeKey('LEAVE_POLICY', r)).toBe(policyHealthDedupeKey('LEAVE_POLICY', { ...r, involvedIds: [...r.involvedIds].reverse() }));
  });
});
