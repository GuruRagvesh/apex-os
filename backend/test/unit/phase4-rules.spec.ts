import {
  adjustmentProblem as noticeProblem, defaultNotice, lastWorkingDay, separationDueAt, withdrawalClosesAt,
} from '../../src/modules/core/users/transitions/exit/notice';
import { adjustmentProblem, allSettled, evaluateFnf, releaseProblem } from '../../src/modules/core/users/transitions/fnf/fnf-rules';
import {
  calendarFromBasis, fnfDeadline, firstEscalationOn, nextEscalationAfter, FALLBACK_BASIS,
} from '../../src/modules/core/users/transitions/fnf/working-calendar';
import { evidenceRefProblem, CLEARANCE_CATEGORIES, CLEARANCE_DEFAULTS } from '../../src/modules/core/users/transitions/exit/clearance-defaults';
import { requireIdempotencyKey } from '../../src/modules/core/users/transitions/request-keys';
import { permissionDelta, transferFingerprint } from '../../src/modules/core/users/transitions/transfer/transfer-state';
import { ruleHealth, evaluateRetention } from '../../src/modules/core/users/lifecycle/retention';
import { disallowedChangeFields } from '../../src/modules/core/users/change-requests.service';
import { PAYROLL_RULE_PHASE4, ruleVersionFor } from '../../src/modules/platform/attendance/reports/payroll-population';
import { REMEDIATION_REGISTRY, validateRegistry } from '../../src/common/remediation/remediation.registry';

const TZ = 'Asia/Kolkata';
const standard = (computedFor = '2026-10-01') =>
  calendarFromBasis({ source: FALLBACK_BASIS, profileId: null, holidayCalendarId: null, weeklyOffPolicyId: null, holidays: [], weeklyOff: null, computedFor, computedAt: '2026-10-01T00:00:00.000Z' });

describe('Phase 4 notice rules (D2, D3)', () => {
  it('uses 15 calendar days on probation and 30 once confirmed', () => {
    expect(defaultNotice('PROBATION')).toEqual({ noticeDays: 15, noticeSource: 'POLICY_PROBATION' });
    expect(defaultNotice('CONFIRMED')).toEqual({ noticeDays: 30, noticeSource: 'POLICY_CONFIRMED' });
    expect(lastWorkingDay('2026-10-01', 30)).toBe('2026-10-31');
    expect(lastWorkingDay('2026-12-20', 15)).toBe('2027-01-04');
  });

  it('separates at the start of the day AFTER the last working day, in company time', () => {
    // IST is UTC+5:30: LWD 31 Oct ends at 2026-10-31T18:30:00Z.
    expect(separationDueAt('2026-10-31', TZ).toISOString()).toBe('2026-10-31T18:30:00.000Z');
    // Withdrawal closes when the LWD itself starts.
    expect(withdrawalClosesAt('2026-10-31', TZ).toISOString()).toBe('2026-10-30T18:30:00.000Z');
  });

  it('requires a reference for a contract term and a reason for an adjustment or waiver', () => {
    expect(noticeProblem({ source: 'CONTRACT', noticeDays: 60 })).toMatch(/contract reference/i);
    expect(noticeProblem({ source: 'CONTRACT', noticeDays: 60, reference: 'CTR-2026-11' })).toBeNull();
    expect(noticeProblem({ source: 'MANAGEMENT_ADJUSTMENT', noticeDays: 0 })).toMatch(/reason/i);
    expect(noticeProblem({ source: 'MANAGEMENT_ADJUSTMENT', noticeDays: 0, reason: 'Mutual agreement' })).toBeNull();
    expect(noticeProblem({ source: 'POLICY_CONFIRMED', noticeDays: 30 })).toBeTruthy();
    expect(noticeProblem({ source: 'MANAGEMENT_ADJUSTMENT', noticeDays: -1, reason: 'x' })).toBeTruthy();
    expect(noticeProblem({ source: 'MANAGEMENT_ADJUSTMENT', noticeDays: 1000, reason: 'x' })).toBeTruthy();
  });
});

describe('Phase 4 F&F deadline and escalation (Phase 1 §5 examples)', () => {
  const cal = standard();

  it('LWD is not day one: Thu 1 Oct 2026 -> the 8th working day after is Mon 12 Oct', () => {
    // Fri 2 (1), Sat 3 = 1st Saturday (2), Mon 5 (3), Tue 6 (4), Wed 7 (5), Thu 8 (6), Fri 9 (7), Mon 12 (8)
    expect(fnfDeadline(cal, '2026-10-01')).toBe('2026-10-12');
  });

  it('skips 2nd and 4th Saturdays and Sundays; counts 1st/3rd/5th Saturdays', () => {
    // LWD Fri 9 Oct: Sat 10 is the 2nd Saturday (off), Sun off, Mon 12 (1) ... Sat 17 = 3rd Saturday (working)
    expect(cal.isWorkingDay('2026-10-10')).toBe(false);
    expect(cal.isWorkingDay('2026-10-17')).toBe(true);
    expect(fnfDeadline(cal, '2026-10-09')).toBe('2026-10-20');
  });

  it('excludes holidays from the calendar in force', () => {
    const withHoliday = calendarFromBasis({ ...cal.basis, source: 'PROFILE_CALENDAR', holidays: ['2026-10-02'] });
    expect(fnfDeadline(withHoliday, '2026-10-01')).toBe('2026-10-13');
  });

  it('honours the weekly-off policy flags instead of the standard schedule', () => {
    const noSaturdayOff = calendarFromBasis({ ...cal.basis, source: 'PROFILE_CALENDAR', weeklyOff: { everySunday: true, secondSaturday: false, fourthSaturday: false } });
    expect(noSaturdayOff.isWorkingDay('2026-10-10')).toBe(true);
  });

  it('escalates on working day 9, then every 3 working days', () => {
    expect(firstEscalationOn(cal, '2026-10-01')).toBe('2026-10-13');
    expect(nextEscalationAfter(cal, '2026-10-13')).toBe('2026-10-16');
  });

  it('is not rewritten by a later calendar edit: the stored basis reproduces the deadline', () => {
    const basis = { ...cal.basis, source: 'PROFILE_CALENDAR' as const, holidays: ['2026-10-02'] };
    const first = fnfDeadline(calendarFromBasis(basis), '2026-10-01');
    expect(fnfDeadline(calendarFromBasis(JSON.parse(JSON.stringify(basis))), '2026-10-01')).toBe(first);
  });
});

describe('Phase 4 F&F state (never ready before separation)', () => {
  const base = { today: '2026-11-05', deadlineOn: '2026-11-12', pendingRequests: 0 };
  const done = ['DONE', 'WAIVED', 'NOT_APPLICABLE'];

  it('is NOT_STARTED before separation even when every item is settled', () => {
    const r = evaluateFnf({ ...base, state: 'NOT_STARTED', separated: false, itemStatuses: done });
    expect(r.state).toBe('NOT_STARTED');
  });

  it('becomes READY after separation with every item settled, before the deadline', () => {
    expect(evaluateFnf({ ...base, state: 'NOT_STARTED', separated: true, itemStatuses: done }).state).toBe('READY_FOR_RELEASE');
  });

  it('a pending adjustment request blocks readiness', () => {
    expect(evaluateFnf({ ...base, state: 'NOT_STARTED', separated: true, itemStatuses: done, pendingRequests: 1 }).state).toBe('NOT_STARTED');
  });

  it('goes on hold for review after the deadline with items still open', () => {
    const r = evaluateFnf({ ...base, today: '2026-11-13', state: 'NOT_STARTED', separated: true, itemStatuses: ['DONE', 'PENDING'] });
    expect(r).toMatchObject({ state: 'ON_HOLD_REVIEW_REQUIRED', holdReason: 'CLEARANCE_INCOMPLETE' });
  });

  it('leaves RELEASED and CANCELLED alone', () => {
    expect(evaluateFnf({ ...base, state: 'RELEASED', separated: true, itemStatuses: ['PENDING'] }).changed).toBe(false);
    expect(evaluateFnf({ ...base, state: 'CANCELLED', separated: false, itemStatuses: [] }).changed).toBe(false);
  });

  it('release needs separation, settled items, no pending request, READY and an explicit action', () => {
    const ok = { state: 'READY_FOR_RELEASE' as const, separated: true, itemStatuses: done, pendingRequests: 0 };
    expect(releaseProblem(ok)).toBeNull();
    expect(releaseProblem({ ...ok, separated: false })).toMatch(/after the employee has separated/);
    expect(releaseProblem({ ...ok, itemStatuses: ['DONE', 'IN_PROGRESS'] })).toMatch(/clearance item/);
    expect(releaseProblem({ ...ok, pendingRequests: 2 })).toMatch(/adjustment request/);
    expect(releaseProblem({ ...ok, state: 'ON_HOLD_REVIEW_REQUIRED' })).toMatch(/not ready/);
    expect(releaseProblem({ ...ok, state: 'RELEASED' })).toMatch(/already released/);
  });

  it('an empty checklist is never "settled"', () => {
    expect(allSettled([])).toBe(false);
  });
});

describe('Phase 4 F&F adjustments', () => {
  const good = { kind: 'ASSET_RECOVERY', direction: 'DEBIT', amount: 1500.5, currency: 'INR', reasonCode: 'ASSET_NOT_RETURNED', reference: 'AST-2026-0042' };
  it('accepts a complete adjustment', () => expect(adjustmentProblem(good)).toBeNull());
  it.each([
    [{ amount: 0 }], [{ amount: -5 }], [{ amount: 10.123 }], [{ currency: 'rupee' }], [{ direction: 'SIDEWAYS' }],
    [{ reasonCode: 'MADE_UP' }], [{ reference: '  ' }], [{ kind: 'ATTENDANCE' }],
  ])('refuses %j', (patch) => expect(adjustmentProblem({ ...good, ...patch })).toBeTruthy());
  it('lets a REVERSAL reason accompany any kind', () => {
    expect(adjustmentProblem({ ...good, kind: 'ATTENDANCE', direction: 'CREDIT', reasonCode: 'REVERSAL' })).toBeNull();
  });
});

describe('Phase 4 clearance', () => {
  it('defines a responsible capability for all nine categories', () => {
    expect(CLEARANCE_CATEGORIES).toHaveLength(9);
    for (const c of CLEARANCE_CATEGORIES) expect(['TEAM_LEAD', 'DEPT_MANAGER', 'HR', 'ADMIN']).toContain(CLEARANCE_DEFAULTS[c].capability);
  });
  it.each(['AST-2026-0042', 'DOC-HR-311', 'FIN-0007-A'])('accepts the opaque reference %s', (ref) => expect(evidenceRefProblem(ref)).toBeNull());
  it.each(['https://drive.google.com/file/d/abc', 'rahul@example.com', 'C:\\files\\x.pdf', '/mnt/vault/12', 'Rahul Sharma', 'ast-2026-1', 'AST-ABCDEFG', 'X'])('refuses %s', (ref) => expect(evidenceRefProblem(ref)).toBeTruthy());
});

describe('Phase 4 idempotency keys', () => {
  it('accepts a UUID v4 and rejects everything else', () => {
    expect(requireIdempotencyKey('3b241101-e2bb-4255-8caf-4136c566a962')).toBe('3b241101-e2bb-4255-8caf-4136c566a962');
    for (const bad of [undefined, '', 'abc', 123, '3b241101-e2bb-1255-8caf-4136c566a962']) expect(() => requireIdempotencyKey(bad)).toThrow();
  });
});

describe('Phase 4 retention', () => {
  const now = new Date('2026-10-22T00:00:00Z');
  const row = (over: any = {}) => ({ category: 'ATTENDANCE', retentionMonths: 24, active: true, approvedAt: new Date('2026-01-01'), status: 'ACTIVE' as const, noExpiry: false, policyReference: 'POL-7', ...over });
  const input = (rules: any[], defaultDeny: boolean) => ({ protectedDates: { ATTENDANCE: [new Date('2020-01-01')] }, rules, activeLegalHolds: 0, now, defaultDeny });

  it('reads health: missing, inactive, invalid, legacy', () => {
    expect(ruleHealth(undefined)).toBe('MISSING');
    expect(ruleHealth(row())).toBe('OK');
    expect(ruleHealth(row({ status: 'INACTIVE' }))).toBe('INACTIVE');
    expect(ruleHealth(row({ policyReference: ' ' }))).toBe('INVALID');
    expect(ruleHealth(row({ retentionMonths: 0 }))).toBe('INVALID');
    expect(ruleHealth(row({ noExpiry: true, retentionMonths: 12 }))).toBe('INVALID');
    expect(ruleHealth(row({ status: null, active: true, approvedAt: null }))).toBe('LEGACY_UNAPPROVED');
    expect(ruleHealth(row({ status: null }))).toBe('OK');
  });

  it('default-deny OFF: a missing rule only warns and does not block', () => {
    const r = evaluateRetention(input([], false));
    expect(r.allowsDeletion).toBe(true);
    expect(r.categories.ATTENDANCE.reason).toBe('POLICY_NOT_CONFIGURED');
  });

  it('default-deny ON: missing, inactive and invalid rules block', () => {
    for (const rules of [[], [row({ status: 'INACTIVE' })], [row({ policyReference: '' })]]) {
      const r = evaluateRetention(input(rules, true));
      expect([r.allowsDeletion, r.categories.ATTENDANCE.reason]).toEqual([false, 'RETENTION_POLICY_REQUIRED']);
    }
  });

  it('noExpiry retains indefinitely and always blocks', () => {
    const r = evaluateRetention(input([row({ noExpiry: true, retentionMonths: null })], false));
    expect([r.allowsDeletion, r.categories.ATTENDANCE.reason]).toEqual([false, 'RETAINED_INDEFINITELY']);
  });

  it('an elapsed approved period allows deletion', () => {
    expect(evaluateRetention(input([row()], true)).allowsDeletion).toBe(true);
  });

  it('a legal hold still wins over a clean retention result', () => {
    expect(evaluateRetention({ ...input([row()], true), activeLegalHolds: 1 }).result).toBe('LEGAL_HOLD');
  });
});

describe('Phase 4 change-request allow-list', () => {
  it.each(['departmentId', 'roleId', 'isHR', 'isActive', 'isSystemAccount', 'employmentState', 'scheduledActivationOn', 'accessEndsAt', 'sessionsRevokedAt', 'joiningDate', 'lastWorkingDate', 'probationPeriod', 'employeeId', 'email', 'password'])(
    'refuses %s', (field) => expect(disallowedChangeFields([{ field, newValue: 'x' }])).toEqual([field]),
  );
  it('allows only designation, team lead and reporting manager', () => {
    expect(disallowedChangeFields([{ field: 'designation' }, { field: 'teamLeadName' }, { field: 'reportingManager' }])).toEqual([]);
  });
  it('refuses the whole request when one field is not allowed', () => {
    expect(disallowedChangeFields([{ field: 'designation' }, { field: 'roleId' }])).toEqual(['roleId']);
  });
});

describe('Phase 4 transfer fingerprint and permission delta', () => {
  const state: any = {
    user: { id: 'u1', name: 'A', departmentId: 'd1', roleId: 'r1', roleName: 'EMPLOYEE', roleLevel: 4, isHR: false, isActive: true, employmentState: 'ACTIVE' },
    toDepartment: { id: 'd2', name: 'B' }, toRole: { id: 'r2', name: 'TEAM_LEAD', level: 3 }, fromRole: { id: 'r1', name: 'EMPLOYEE', level: 4 },
    hierarchyAsSubject: [], hierarchyAsAssignee: [], profile: null, ownPendingLeave: [], leaveApprovalsRoutedToUser: [], ownCorrections: [],
    correctionsAwaitingUser: [], reviewTickets: [], ownedTickets: [], assignedTickets: [], coAssignedTickets: [], projectMemberships: [],
    teamMemberships: [], pendingChangeRequests: [], openExitCaseId: null,
  };
  const plan = { toDepartmentId: 'd2', toRoleId: 'r2' };

  it('is stable and ignores key order', () => {
    expect(transferFingerprint(state, plan)).toBe(transferFingerprint({ ...state }, { toRoleId: 'r2', toDepartmentId: 'd2' }));
  });
  it.each([
    ['a new pending leave', { ownPendingLeave: [{ id: 'l1', routingSnapshotId: null, startDate: '2026-11-01', endDate: '2026-11-01' }] }],
    ['a new review ticket', { reviewTickets: [{ id: 't1', title: 'x', type: 'TASK', submittedAt: '2026-10-01T00:00:00Z', approverId: null }] }],
    ['a new correction', { ownCorrections: [{ id: 'c1', date: '2026-10-01', status: 'PENDING' }] }],
    ['a new team membership', { teamMemberships: [{ id: 'm1', teamId: 't' }] }],
    ['an opened exit case', { openExitCaseId: 'e1' }],
    ['a new change request', { pendingChangeRequests: [{ id: 'cr', status: 'PENDING_TL_APPROVAL' }] }],
  ])('changes when there is %s', (_n, patch) => {
    expect(transferFingerprint({ ...state, ...patch }, plan)).not.toBe(transferFingerprint(state, plan));
  });
  it('changes with the plan', () => {
    expect(transferFingerprint(state, { ...plan, toRoleId: 'r3' })).not.toBe(transferFingerprint(state, plan));
  });
  it('lists permissions gained and lost between base roles', () => {
    const d = permissionDelta('EMPLOYEE', 'TEAM_LEAD');
    expect(d.gained.length).toBeGreaterThan(0);
    expect(d.lost).toContain('Own tickets, leave and attendance');
    expect(permissionDelta('ADMIN', 'ADMIN')).toEqual({ gained: [], lost: [] });
  });
});

describe('Phase 4 payroll rule versions (frozen months stay stable)', () => {
  it('rebuilds a month finalized before Phase 4 with the legacy rule', () => {
    expect(ruleVersionFor({ status: 'FINALIZED', reportRuleVersion: null })).toBeNull();
    expect(ruleVersionFor({ status: 'SENT', reportRuleVersion: null })).toBeNull();
  });
  it('uses the Phase 4 rule for new and open months and months finalized under it', () => {
    expect(ruleVersionFor(null)).toBe(PAYROLL_RULE_PHASE4);
    expect(ruleVersionFor({ status: 'REVIEWING', reportRuleVersion: null })).toBe(PAYROLL_RULE_PHASE4);
    expect(ruleVersionFor({ status: 'FINALIZED', reportRuleVersion: PAYROLL_RULE_PHASE4 })).toBe(PAYROLL_RULE_PHASE4);
  });
});

describe('Phase 4 remediation registry', () => {
  it('stays valid and carries the new codes', () => {
    expect(validateRegistry()).toEqual([]);
    for (const code of ['OPEN_EXIT_CASE', 'RETENTION_POLICY_REQUIRED', 'PROBATION_STATUS_UNVERIFIED', 'RESIGNATION_WITHDRAWAL_CLOSED', 'TRANSFER_EXIT_CASE_OPEN', 'PAYROLL_UNRESOLVED_ACK_REQUIRED']) {
      expect(REMEDIATION_REGISTRY[code]).toBeDefined();
    }
  });
});
