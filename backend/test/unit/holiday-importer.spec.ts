import { PolicyStatus } from '@prisma/client';
import { buildFirstVersionCalendarCreateInput } from '../../scripts/import-attendance-calendar-2026';

describe('2026 holiday importer lifecycle', () => {
  it('creates a live BL-4 first version rooted in its own policy series', () => {
    const id = 'calendar-v1';
    const data = buildFirstVersionCalendarCreateInput(id);

    expect(data).toMatchObject({
      id,
      policyKey: id,
      version: 1,
      status: PolicyStatus.ACTIVE,
      isActive: true,
    });
  });

  it('never pairs the active compatibility mirror with authoritative DRAFT status', () => {
    const data = buildFirstVersionCalendarCreateInput('calendar-v1');

    expect(data.isActive === true && data.status === PolicyStatus.DRAFT).toBe(false);
  });
});
