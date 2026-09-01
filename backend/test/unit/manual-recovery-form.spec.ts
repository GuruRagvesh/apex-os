import { readFileSync } from 'fs';
import { MIN_REASON_ENTERED_CORRECTION } from '../../src/modules/platform/attendance/regularization/correction-proposal';
import { resolve } from 'path';
import {
  ACTION_LABEL,
  MIN_EXPLANATION,
  availableActions,
  isCorrection,
  isPunchIn,
  toInstant,
  validateDraft,
} from '../../../frontend/components/attendance/manual-recovery-rules';

// The form's decision logic is pure so it can be proven here; the frontend has
// no test runner. The React shell around it is covered by the static guard in
// scripts/frontend/verify-attendance-day-surface.mjs.

const F = (p: string) => readFileSync(resolve(__dirname, '../../../frontend', p), 'utf8');

const draft = (over: any = {}) => ({
  userId: 'emp-1',
  businessDate: '2026-08-29',
  action: 'ADD_OUT' as const,
  effectiveTime: '18:31',
  recoveryReason: 'SERVER_UNAVAILABLE' as const,
  reason: 'Apex OS was unavailable when the employee tried to punch out.',
  employeeInformedAt: '2026-08-29T18:36',
  ...over,
});

describe('the form never offers an action the server would refuse', () => {
  it('offers Add when no punch exists', () => {
    expect(availableActions({ punchInAt: null, punchOutAt: null })).toEqual(['ADD_IN', 'ADD_OUT']);
  });

  it('offers Correct instead of Add once a punch exists', () => {
    // Offering Add here would invite a duplicate the server refuses; the rule
    // belongs in the choices, not in an error message.
    expect(
      availableActions({ punchInAt: '2026-08-29T04:00:00Z', punchOutAt: null }),
    ).toEqual(['CORRECT_IN', 'ADD_OUT']);
  });

  it('handles a day where only the punch out exists', () => {
    expect(
      availableActions({ punchInAt: null, punchOutAt: '2026-08-29T13:00:00Z' }),
    ).toEqual(['ADD_IN', 'CORRECT_OUT']);
  });

  it('offers only corrections on a complete day', () => {
    expect(
      availableActions({ punchInAt: '2026-08-29T04:00:00Z', punchOutAt: '2026-08-29T13:00:00Z' }),
    ).toEqual(['CORRECT_IN', 'CORRECT_OUT']);
  });

  it('labels every action in plain words', () => {
    for (const a of ['ADD_IN', 'ADD_OUT', 'CORRECT_IN', 'CORRECT_OUT'] as const) {
      expect(ACTION_LABEL[a]).toMatch(/punch (in|out)/i);
    }
  });

  it('classifies each action correctly', () => {
    expect(isPunchIn('ADD_IN')).toBe(true);
    expect(isPunchIn('CORRECT_IN')).toBe(true);
    expect(isPunchIn('ADD_OUT')).toBe(false);
    expect(isCorrection('CORRECT_OUT')).toBe(true);
    expect(isCorrection('ADD_OUT')).toBe(false);
  });
});

describe('validation mirrors the server', () => {
  it('accepts a complete draft', () => {
    expect(validateDraft(draft()).ok).toBe(true);
  });

  it.each([
    ['employee', { userId: '' }, 'userId'],
    ['business date', { businessDate: '' }, 'businessDate'],
    ['punch time', { effectiveTime: '' }, 'effectiveTime'],
    ['a malformed time', { effectiveTime: '6pm' }, 'effectiveTime'],
    ['reason category', { recoveryReason: undefined }, 'recoveryReason'],
    ['informed-at', { employeeInformedAt: '' }, 'employeeInformedAt'],
    ['explanation', { reason: '' }, 'reason'],
    ['a token explanation', { reason: 'n/a' }, 'reason'],
  ])('refuses a draft missing %s', (_label, over, field) => {
    const result = validateDraft(draft(over));

    expect(result.ok).toBe(false);
    expect(result.errors[field as keyof typeof result.errors]).toBeTruthy();
  });

  it('requires a real explanation even for OTHER', () => {
    // OTHER is the case that needs one most: the category says nothing.
    expect(validateDraft(draft({ recoveryReason: 'OTHER', reason: 'other' })).ok).toBe(false);
    expect(
      validateDraft(draft({ recoveryReason: 'OTHER', reason: 'Laptop camera broken, phone flat.' }))
        .ok,
    ).toBe(true);
  });

  it('uses the same minimum the server enforces', () => {
    // Compared against the CONSTANT rather than a literal grepped out of the
    // service. The rule moved into the shared correction module so that manual
    // recovery and bulk import provably hold to one bar; a guard that greps for
    // "length < 10" would have gone silently vacuous the moment it did.
    expect(MIN_EXPLANATION).toBe(MIN_REASON_ENTERED_CORRECTION);

    // And the service must actually apply that bar to an entered correction,
    // not merely import it.
    const service = readFileSync(
      resolve(
        __dirname,
        '../../src/modules/platform/attendance/regularization/regularization.service.ts',
      ),
      'utf8',
    );
    expect(service).toMatch(/minReasonLength:\s*MIN_REASON_ENTERED_CORRECTION/);
  });
});

describe('the submitted payload', () => {
  it('combines the business date and company time', () => {
    expect(toInstant('2026-08-29', '18:31')).toBe('2026-08-29T18:31:00.000Z');
  });

  it('sends only the side being recorded', () => {
    const src = F('components/attendance/manual-recovery-api.ts');

    expect(src).toMatch(/requestedPunchIn: isPunchIn\(draft\.action\) \? at : null/);
    expect(src).toMatch(/requestedPunchOut: isPunchIn\(draft\.action\) \? null : at/);
  });

  it('never sends location or photo fields', () => {
    // A manual entry has no evidence, and the absence is the honest record.
    const src = F('components/attendance/manual-recovery-api.ts');

    for (const field of ['latitude', 'longitude', 'accuracyMeters', 'photoAssetId']) {
      expect(src).not.toContain(field);
    }
  });

  it('marks a correction so the server allows replacing an existing punch', () => {
    const src = F('components/attendance/manual-recovery-api.ts');

    expect(src).toMatch(/correctExisting: isCorrection\(draft\.action\)/);
  });
});

describe('the form states absent evidence rather than implying it', () => {
  const form = F('components/attendance/ManualRecoveryForm.tsx');

  it('says photo and location are unavailable', () => {
    expect(form).toMatch(/Photo: not available — manual recovery/);
    expect(form).toMatch(/Location: not available — manual recovery/);
  });

  it('does not render evidence through the real photo or location components', () => {
    // Reusing those would imply evidence exists and merely failed to load,
    // which is a far more forgiving claim than "there is none".
    expect(form).not.toMatch(/<PunchPhoto\b/);
    expect(form).not.toMatch(/presentLocation\(/);
  });

  it('requires a second deliberate step before recording', () => {
    expect(form).toMatch(/setConfirming\(true\)/);
    expect(form).toMatch(/Confirm & Record/);
  });

  it('shows the old value next to the new one', () => {
    expect(form).toMatch(/Missing.*→|→.*effectiveTime/s);
  });

  it('disables the buttons while submitting', () => {
    expect(form).toMatch(/disabled=\{save\.isPending\}/);
  });

  it('tells a manager that HR must still approve', () => {
    expect(form).toMatch(/HR must give final approval/);
  });
});

describe('the control is not on any employee surface', () => {
  it.each([
    'components/attendance/PunchModal.tsx',
    'components/attendance/AttendanceToday.tsx',
    'components/attendance/AttendanceCalendar.tsx',
    'components/attendance/AttendanceDayDetail.tsx',
  ])('%s does not offer manual recovery', (file) => {
    expect(F(file)).not.toMatch(/ManualRecoveryForm|manual-recovery-api/);
  });

  it('lives on the console, where authorised people work', () => {
    expect(F('components/attendance/AttendanceConsole.tsx')).toMatch(/<ManualRecoveryForm/);
  });
});
