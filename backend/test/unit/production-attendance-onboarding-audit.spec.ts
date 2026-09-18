import { classifyExistingUser } from '../../scripts/audit-production-attendance-onboarding';

const today = new Date('2026-09-18T00:00:00.000Z');

describe('production attendance onboarding audit classification', () => {
  it('reports but does not reinterpret a working legacy user with no joining date', () => {
    expect(
      classifyExistingUser(
        {
          joiningDate: null,
          profiles: [{ effectiveFrom: new Date('2026-09-01T00:00:00.000Z'), effectiveTo: null }],
        },
        today,
      ),
    ).toEqual({
      missingJoiningDate: true,
      profileCount: 1,
      currentProfileCount: 1,
      noProfile: false,
      noCurrentProfile: false,
      overlappingCurrentProfiles: false,
    });
  });

  it('reports an active user with no attendance profile', () => {
    expect(
      classifyExistingUser({ joiningDate: null, profiles: [] }, today),
    ).toMatchObject({
      missingJoiningDate: true,
      noProfile: true,
      noCurrentProfile: true,
    });
  });

  it('reports overlapping current profiles without selecting one', () => {
    expect(
      classifyExistingUser(
        {
          joiningDate: new Date('2026-09-01T00:00:00.000Z'),
          profiles: [
            { effectiveFrom: new Date('2026-09-01T00:00:00.000Z'), effectiveTo: null },
            { effectiveFrom: new Date('2026-09-10T00:00:00.000Z'), effectiveTo: null },
          ],
        },
        today,
      ),
    ).toMatchObject({ currentProfileCount: 2, overlappingCurrentProfiles: true });
  });
});
