import { classifyRefinedAttendance } from '../../src/modules/platform/attendance/evaluation/refined-attendance-policy';
import { defaultNoticeForEmployee } from '../../src/modules/core/users/transitions/exit/notice';

describe('refined attendance policy', () => {
  const c = (presenceMinutes: number, punchInMinutes: number, punchOutMinutes: number) =>
    classifyRefinedAttendance({ presenceMinutes, punchInMinutes, punchOutMinutes });

  it('classifies a complete nine-hour workday as full day', () => {
    expect(c(540, 600, 1140)).toBe('FULL_DAY');
  });

  it('a full nine hours is never a half day, even when it starts after 1:00 PM', () => {
    expect(c(540, 780, 1320)).toBe('FULL_DAY');
  });

  it('presence of 5 hours or less is a half day', () => {
    expect(c(240, 570, 1100)).toBe('HALF_DAY');
    expect(c(270, 570, 1100)).toBe('HALF_DAY');
    expect(c(300, 570, 1100)).toBe('HALF_DAY');
    expect(c(200, 600, 800)).toBe('HALF_DAY');
    expect(c(301, 570, 1100)).toBe('SHORT_DAY');
  });

  it('arriving at or after 1:00 PM is a half day', () => {
    expect(c(330, 780, 1110)).toBe('HALF_DAY');
    expect(c(330, 779, 1109)).toBe('SHORT_DAY');
  });

  it('leaving at or before 4:00 PM is a half day', () => {
    expect(c(390, 570, 960)).toBe('HALF_DAY');
    expect(c(391, 570, 961)).toBe('SHORT_DAY');
  });

  it('anything else under nine hours is short hours', () => {
    expect(c(400, 630, 1080)).toBe('SHORT_DAY');
    expect(c(539, 570, 1109)).toBe('SHORT_DAY');
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
