import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import {
  WAIVABLE_SETUP_ISSUE_CODES,
  deriveEmploymentState,
  deriveLateSubmission,
  deriveLeaveSetupStatus,
  deriveLeaveSubmissionMode,
  holdStatusOf,
  isHoldActive,
  strongestHold,
} from '../../src/common/lifecycle-domain';
import { effectiveChannels, sanitizeChannels } from '../../src/modules/operations/notifications/notification-channels';
import { equivalenceGroups } from '../../scripts/employee-id/equivalent-codes';

// Phase 1 read-time derivations (spec §7), the hold reader, notification
// channels (§4) and the employee-ID equivalence report (§2.3).

describe('deriveEmploymentState', () => {
  it('prefers the stored value', () => {
    expect(deriveEmploymentState({ employmentState: 'SCHEDULED_TO_JOIN', isActive: false })).toBe('SCHEDULED_TO_JOIN');
  });
  it('derives legacy rows exactly as before Phase 1', () => {
    expect(deriveEmploymentState({ employmentState: null, isActive: true })).toBe('ACTIVE');
    expect(deriveEmploymentState({ employmentState: null, isActive: false }, 'USER_ARCHIVED')).toBe('ARCHIVED');
    expect(deriveEmploymentState({ employmentState: null, isActive: false }, 'USER_ARCHIVED_AFTER_BACKUP')).toBe('ARCHIVED');
    expect(deriveEmploymentState({ employmentState: null, isActive: false }, 'USER_DEACTIVATED')).toBe('DEACTIVATED');
    expect(deriveEmploymentState({ employmentState: null, isActive: false })).toBe('DEACTIVATED');
  });
});

describe('leave legacy derivation', () => {
  it('reads an EMERGENCY type as EMERGENCY mode and anything else as STANDARD', () => {
    expect(deriveLeaveSubmissionMode({ submissionMode: null, type: 'EMERGENCY' })).toBe('EMERGENCY');
    expect(deriveLeaveSubmissionMode({ submissionMode: null, type: 'CASUAL' })).toBe('STANDARD');
    expect(deriveLeaveSubmissionMode({ submissionMode: 'EMERGENCY', type: 'SICK' })).toBe('EMERGENCY');
  });
  it('never reads a missing setup status as RESOLVED', () => {
    expect(deriveLeaveSetupStatus({ setupStatus: null })).toBe('LEGACY_UNASSESSED');
    expect(deriveLeaveSetupStatus({})).toBe('LEGACY_UNASSESSED');
    expect(deriveLeaveSetupStatus({ setupStatus: 'POLICY_SETUP_PENDING' })).toBe('POLICY_SETUP_PENDING');
    expect(deriveLeaveSetupStatus({ setupStatus: 'RESOLVED' })).toBe('RESOLVED');
  });
  it('keeps unknown lateness unknown', () => {
    expect(deriveLateSubmission({ isLateSubmission: null })).toBeNull();
    expect(deriveLateSubmission({ isLateSubmission: false })).toBe(false);
  });
});

describe('isHoldActive', () => {
  it('blocks for ACTIVE, REQUESTED and legacy unreleased rows only', () => {
    expect(isHoldActive({ status: 'ACTIVE', releasedAt: null })).toBe(true);
    expect(isHoldActive({ status: 'REQUESTED', releasedAt: null })).toBe(true);
    expect(isHoldActive({ status: null, releasedAt: null })).toBe(true);
    expect(isHoldActive({ status: null, releasedAt: new Date() })).toBe(false);
    for (const s of ['REJECTED', 'WITHDRAWN', 'RELEASED']) expect([s, isHoldActive({ status: s, releasedAt: null })]).toEqual([s, false]);
  });
  it('reports the strongest hold: active outranks requested', () => {
    expect(holdStatusOf({ status: null, releasedAt: null })).toBe('LEGACY_ACTIVE');
    expect(strongestHold([{ status: 'REQUESTED' }, { status: 'ACTIVE' }])).toBe('ACTIVE');
    expect(strongestHold([{ status: 'REQUESTED' }, { status: 'RELEASED', releasedAt: new Date() }])).toBe('REQUESTED');
    expect(strongestHold([{ status: 'WITHDRAWN' }, { status: null, releasedAt: new Date() }])).toBeNull();
  });
});

it('the WAIVED allow-list is empty in Phase 1', () => {
  expect(WAIVABLE_SETUP_ISSUE_CODES).toEqual([]);
});

describe('notification channels', () => {
  it('a legacy false mutes popup, push and email', () => {
    expect(effectiveChannels({ assignedTicket: false }, 'assignedTicket')).toEqual({ popup: false, push: false, email: false });
  });
  it('channels win over the legacy flag, key by key', () => {
    expect(effectiveChannels({ assignedTicket: false, channels: { assignedTicket: { popup: true } } }, 'assignedTicket')).toEqual({ popup: true, push: false, email: false });
    expect(effectiveChannels({ channels: { assignedTicket: { push: false } } }, 'assignedTicket')).toEqual({ popup: true, push: false, email: true });
  });
  it('global switches still apply', () => {
    expect(effectiveChannels({ inApp: false, pushEnabled: false }, 'x')).toEqual({ popup: false, push: false, email: true });
  });
  it('stores only booleans for known channels on well-formed event keys', () => {
    expect(sanitizeChannels({ assignedTicket: { popup: false, push: 'yes', sms: true }, 'bad key!': { popup: true }, ok: 5 })).toEqual({ assignedTicket: { popup: false } });
    expect(sanitizeChannels('nope')).toBeUndefined();
  });
});

describe('employee ID equivalence report', () => {
  it('groups numerically equivalent spellings and flags two different users', () => {
    const groups = equivalenceGroups([
      { source: 'users', code: 'TE-014', userId: 'a' },
      { source: 'users', code: 'TE-14', userId: 'b' },
      { source: 'attendance_import_rows', code: 'TE-0014' },
      { source: 'users', code: 'TE-7', userId: 'c' },
      { source: 'attendance_import_rows', code: 'TE-7' },
      { source: 'users', code: 'te-5', userId: 'd' },
      { source: 'users', code: 'TE-0', userId: 'e' },
    ]);
    expect(groups).toEqual([
      {
        number: 14,
        spellings: [{ code: 'TE-0014', users: 0, importRows: 1 }, { code: 'TE-014', users: 1, importRows: 0 }, { code: 'TE-14', users: 1, importRows: 0 }],
        distinctUsers: 2,
        blocksMigration: true,
      },
    ]);
  });
  it('the report script has no write path', () => {
    const src = readFileSync(join(__dirname, '../../scripts/employee-id/report-equivalent-codes.ts'), 'utf8');
    expect(src).toMatch(/SET TRANSACTION READ ONLY/);
    expect(src).not.toMatch(/\.(create|update|upsert|delete)(Many)?\(|\$executeRaw`|INSERT |UPDATE "|DELETE FROM/);
  });
});

// Phase 3 switched every entitlement reader at once (§7.4): Sick is now the
// authority and the retired Emergency allocation must have no reader at all,
// so 4 Emergency + 4 Sick (18 days) can never be shown.
it('no backend source outside the schema reads emergencyLeaveAllocation after Phase 3 (§7.4)', () => {
  const root = join(__dirname, '../../src');
  const hits: string[] = [];
  const walk = (d: string) => readdirSync(d).forEach((f) => {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/.ts$/.test(f) && readFileSync(p, 'utf8').includes('emergencyLeaveAllocation')) hits.push(p);
  });
  walk(root);
  expect(hits).toEqual([]);
});

it('the Sick allocation is read by the leave entitlement authority (Phase 3)', () => {
  const rules = readFileSync(join(__dirname, '../../src/modules/operations/leave/leave-rules.ts'), 'utf8');
  expect(rules).toContain('sickLeaveAllocation');
  expect(rules).toContain('casualLeaveAllocation');
});
