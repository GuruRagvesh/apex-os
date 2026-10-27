import { classifyRefinedAttendance } from '../../src/modules/platform/attendance/evaluation/refined-attendance-policy';
import { defaultNoticeForEmployee } from '../../src/modules/core/users/transitions/exit/notice';

describe('refined attendance policy', () => {
  it('classifies a complete nine-hour workday as full day', () => {
    expect(classifyRefinedAttendance({ workedMinutes: 540, punchInMinutes: 600, punchOutMinutes: 1140 })).toBe('FULL_DAY');
  });

  it('classifies at most 4.5 hours and an early checkout as half day', () => {
    expect(classifyRefinedAttendance({ workedMinutes: 270, punchInMinutes: 600, punchOutMinutes: 870 })).toBe('HALF_DAY');
    expect(classifyRefinedAttendance({ workedMinutes: 330, punchInMinutes: 600, punchOutMinutes: 960 })).toBe('HALF_DAY');
  });

  it('uses 6:30 PM as the late-arrival half-day completion boundary', () => {
    expect(classifyRefinedAttendance({ workedMinutes: 330, punchInMinutes: 780, punchOutMinutes: 1110 })).toBe('HALF_DAY');
    expect(classifyRefinedAttendance({ workedMinutes: 320, punchInMinutes: 780, punchOutMinutes: 1109 })).toBe('SHORT_DAY');
  });

  it('classifies other work between half and full day as one-third-deduction short day', () => {
    expect(classifyRefinedAttendance({ workedMinutes: 400, punchInMinutes: 630, punchOutMinutes: 1080 })).toBe('SHORT_DAY');
  });
});

describe('refined role-based notice policy', () => {
  it.each([
    [{ roleName: 'INTERN', employmentType: 'Intern' }, 7],
    [{ roleName: 'EMPLOYEE', employmentType: 'Full-time' }, 15],
    [{ roleName: 'TEAM_LEAD' }, 30],
    [{ roleName: 'MANAGER' }, 30],
    [{ roleName: 'ADMIN' }, 60],
    [{ roleName: 'SUPER_ADMIN' }, 60],
  ])('assigns the correct notice period to %o', (input, days) => {
    expect(defaultNoticeForEmployee(input).noticeDays).toBe(days);
  });
});
