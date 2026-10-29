import { AttendanceRegularizationReminderService, isLastCalendarDay } from './attendance-regularization-reminder.service';

describe('Attendance regularization reminders', () => {
  it('recognises the real final calendar day, including leap years', () => {
    expect(isLastCalendarDay('2026-02-28')).toBe(true);
    expect(isLastCalendarDay('2028-02-28')).toBe(false);
    expect(isLastCalendarDay('2028-02-29')).toBe(true);
    expect(isLastCalendarDay('2026-10-30')).toBe(false);
    expect(isLastCalendarDay('2026-10-31')).toBe(true);
  });

  it('sends one date-specific reminder only when no open request exists', async () => {
    const date = new Date('2026-10-27T00:00:00.000Z');
    const prisma = {
      dailyAttendance: { findMany: jest.fn().mockResolvedValue([
        { id: 'day-1', userId: 'user-1', date },
        { id: 'day-2', userId: 'user-2', date },
      ]) },
      attendanceRegularization: { findMany: jest.fn().mockResolvedValue([
        { userId: 'user-2', date },
      ]) },
    };
    const notifications = { sendNotification: jest.fn().mockResolvedValue({ id: 'notification-1' }) };
    const service = new AttendanceRegularizationReminderService(prisma as any, notifications as any);

    await expect(service.remindForDate('2026-10-27')).resolves.toBe(1);
    expect(notifications.sendNotification).toHaveBeenCalledTimes(1);
    expect(notifications.sendNotification).toHaveBeenCalledWith('user-1', 'attendanceCorrection', expect.objectContaining({
      entityId: 'day-1',
      dedupeKey: 'attendance-regularization:day:day-1',
      link: '/attendance',
    }));
  });

  it('groups all still-unregularized month days into one user summary', async () => {
    const prisma = {
      dailyAttendance: { findMany: jest.fn().mockResolvedValue([
        { id: 'day-1', userId: 'user-1', date: new Date('2026-10-03T00:00:00.000Z') },
        { id: 'day-2', userId: 'user-1', date: new Date('2026-10-17T00:00:00.000Z') },
      ]) },
      attendanceRegularization: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const notifications = { sendNotification: jest.fn().mockResolvedValue({ id: 'notification-1' }) };
    const service = new AttendanceRegularizationReminderService(prisma as any, notifications as any);

    await expect(service.remindMonthEnd('2026-10')).resolves.toBe(1);
    expect(notifications.sendNotification).toHaveBeenCalledWith('user-1', 'attendanceCorrection', expect.objectContaining({
      title: '2 attendance days need review',
      entityId: '2026-10',
      dedupeKey: 'attendance-regularization:month-end:user-1:2026-10',
    }));
  });
});
