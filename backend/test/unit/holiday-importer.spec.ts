import { PolicyStatus } from '@prisma/client';
import {
  buildFirstVersionCalendarCreateInput,
  writeHolidayImport,
} from '../../scripts/import-attendance-calendar-2026';
import { OFFICIAL_HOLIDAYS_2026 } from '../../src/modules/platform/attendance/calendar/official-holidays-2026';

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

  it('atomically creates the calendar and all holidays in one bounded batch transaction', async () => {
    const calendarOperation = { operation: 'create-calendar' };
    const holidayOperation = { operation: 'create-holidays' };
    const holidayCalendarCreate = jest.fn().mockReturnValue(calendarOperation);
    const holidayCreateMany = jest.fn().mockReturnValue(holidayOperation);
    const transaction = jest
      .fn()
      .mockResolvedValue([{ id: 'generated-calendar-id' }, { count: 17 }]);
    const prisma = {
      holidayCalendar: { create: holidayCalendarCreate },
      holiday: { createMany: holidayCreateMany },
      $transaction: transaction,
    } as any;
    const result = await writeHolidayImport(prisma, null, OFFICIAL_HOLIDAYS_2026);

    const calendarData = holidayCalendarCreate.mock.calls[0][0].data;
    expect(calendarData.policyKey).toBe(calendarData.id);
    expect(holidayCreateMany).toHaveBeenCalledWith({
      data: OFFICIAL_HOLIDAYS_2026.map((holiday) => ({
        calendarId: calendarData.id,
        date: new Date(`${holiday.date}T00:00:00.000Z`),
        name: holiday.name,
        isOptional: false,
      })),
    });
    expect(holidayCreateMany.mock.calls[0][0].data).toHaveLength(17);
    expect(holidayCreateMany.mock.calls[0][0]).not.toHaveProperty('skipDuplicates');
    expect(transaction).toHaveBeenCalledWith([calendarOperation, holidayOperation]);
    expect(Array.isArray(transaction.mock.calls[0][0])).toBe(true);
    expect(result).toEqual({ calendarId: calendarData.id, created: 17 });
  });
});
