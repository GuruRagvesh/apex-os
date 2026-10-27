import { TeamInsightsService, netSessionMinutes, unionMinutes } from '../../src/modules/platform/dashboard/team-insights.service';

const NOW = new Date('2026-10-14T18:00:00.000Z');

const tva: any = {
  now: jest.fn(() => NOW),
  companyToday: jest.fn(() => '2026-10-14'),
  companyTimezone: jest.fn(() => 'UTC'),
  companyInstantAt: jest.fn((day: string, time: string) => new Date(`${day}T${time}:00.000Z`)),
};

const access: any = { roleName: jest.fn((user: any) => user.role.name) };
const timing: any = {
  getSlaConfig: jest.fn(async () => ({})),
  getTimingState: jest.fn(() => ({ isOverdue: false })),
};

function prismaDouble() {
  return {
    team: { findMany: jest.fn(async () => []) },
    managerDeptAccess: { findMany: jest.fn(async () => []) },
    user: { findMany: jest.fn(async () => []), findUnique: jest.fn(), aggregate: jest.fn(async () => ({ _count: { _all: 0 }, _max: {} })) },
    employeeAttendanceProfile: { findMany: jest.fn(async () => []) },
    workSession: { findMany: jest.fn(async () => []), findFirst: jest.fn(), aggregate: jest.fn(async () => ({ _count: { _all: 0 }, _max: {} })) },
    breakLog: { findMany: jest.fn(async () => []), aggregate: jest.fn(async () => ({ _count: { _all: 0 }, _max: {} })) },
    ticketTimeLog: { findMany: jest.fn(async () => []), aggregate: jest.fn(async () => ({ _count: { _all: 0 }, _max: {} })) },
    meeting: { findMany: jest.fn(async () => []), aggregate: jest.fn(async () => ({ _count: { _all: 0 }, _max: {} })) },
    ticket: { findMany: jest.fn(async () => []), aggregate: jest.fn(async () => ({ _count: { _all: 0 }, _max: {} })) },
    reviewCycleLog: { findMany: jest.fn(async () => []), aggregate: jest.fn(async () => ({ _count: { _all: 0 }, _max: {} })) },
    dailyAttendance: { findMany: jest.fn(async () => []), aggregate: jest.fn(async () => ({ _count: { _all: 0 }, _max: {} })) },
    leaveRequest: { findMany: jest.fn(async () => []), aggregate: jest.fn(async () => ({ _count: { _all: 0 }, _max: {} })) },
    project: { findMany: jest.fn(async () => []), aggregate: jest.fn(async () => ({ _count: { _all: 0 }, _max: {} })) },
  } as any;
}

const range = {
  from: '2026-10-14',
  to: '2026-10-14',
  start: new Date('2026-10-14T00:00:00.000Z'),
  end: new Date('2026-10-15T00:00:00.000Z'),
  days: 1,
};

describe('TeamInsightsService analytics rules', () => {
  beforeEach(() => jest.clearAllMocks());

  it('merges overlapping intervals instead of double-counting them', () => {
    expect(unionMinutes([
      { start: 0, end: 120 * 60_000 },
      { start: 90 * 60_000, end: 180 * 60_000 },
    ])).toBe(180);
  });

  it('subtracts overlapping non-meeting breaks from a work session once', () => {
    expect(netSessionMinutes(
      { start: 9 * 60 * 60_000, end: 17 * 60 * 60_000 },
      [
        { start: 12 * 60 * 60_000, end: 12.5 * 60 * 60_000 },
        { start: 12.25 * 60 * 60_000, end: 12.75 * 60 * 60_000 },
      ],
    )).toBe(435);
  });

  it('keeps meetings in working time, excludes normal breaks, and de-duplicates productive overlap', async () => {
    const prisma = prismaDouble();
    prisma.workSession.findMany.mockResolvedValue([{
      id: 'ws1', userId: 'u1', date: new Date('2026-10-14T00:00:00Z'),
      startWorkAt: new Date('2026-10-14T09:00:00Z'), logoutAt: new Date('2026-10-14T17:00:00Z'),
    }]);
    prisma.breakLog.findMany.mockResolvedValue([
      { userId: 'u1', breakType: 'BREAK', startAt: new Date('2026-10-14T12:00:00Z'), endAt: new Date('2026-10-14T12:30:00Z') },
      { userId: 'u1', breakType: 'MEETING', startAt: new Date('2026-10-14T14:00:00Z'), endAt: new Date('2026-10-14T15:00:00Z') },
    ]);
    prisma.ticketTimeLog.findMany.mockResolvedValue([
      { userId: 'u1', startedAt: new Date('2026-10-14T09:00:00Z'), endedAt: new Date('2026-10-14T11:00:00Z') },
    ]);
    prisma.meeting.findMany.mockResolvedValue([{
      id: 'm1', visibility: 'PERSONAL', startedAt: new Date('2026-10-14T10:30:00Z'), endedAt: new Date('2026-10-14T12:00:00Z'),
      participants: [{ userId: 'u1' }],
    }]);

    const service = new TeamInsightsService(prisma, access, timing, tva);
    const metrics = await (service as any).timeMetrics(['u1'], range);

    expect(metrics).toEqual({
      workingMinutes: 450,
      presenceMinutes: 480,
      breakMinutes: 30,
      breakCount: 1,
      ticketMinutes: 120,
      meetingMinutes: 90,
      productiveMinutes: 180,
      meetingCount: 1,
      meetingParticipationCount: 1,
      punchInMinute: 540,
      punchOutMinute: 1020,
      punchInCount: 1,
      punchOutCount: 1,
      measurablePresenceDays: 1,
      daysWorked: 1,
      calendarDaysWorked: 1,
    });
    expect(prisma.workSession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        date: {
          gte: new Date('2026-10-14T00:00:00.000Z'),
          lte: new Date('2026-10-14T00:00:00.000Z'),
        },
      }),
    }));
  });

  it('builds the denominator per employee and excludes dates outside employment', async () => {
    const prisma = prismaDouble();
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', joiningDate: new Date('2026-10-12T00:00:00Z'), lastWorkingDate: null },
      { id: 'u2', joiningDate: new Date('2026-09-01T00:00:00Z'), lastWorkingDate: new Date('2026-10-13T00:00:00Z') },
      { id: 'u3', joiningDate: null, lastWorkingDate: null },
    ]);
    prisma.employeeAttendanceProfile.findMany.mockResolvedValue([{
      userId: 'u3', attendanceRequired: true, category: 'REGULAR_EMPLOYEE',
      effectiveFrom: new Date('2026-10-13T00:00:00Z'), effectiveTo: null,
    }]);
    const service = new TeamInsightsService(prisma, access, timing, tva);

    const schedule = await (service as any).scheduledEmployeeDays(
      ['u1', 'u2', 'u3'],
      ['2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14'],
    );

    expect([...schedule.eligible].sort()).toEqual([
      'u1:2026-10-12', 'u1:2026-10-13', 'u1:2026-10-14',
      'u2:2026-10-09', 'u2:2026-10-12', 'u2:2026-10-13',
      'u3:2026-10-13', 'u3:2026-10-14',
    ]);
    expect(schedule).toMatchObject({
      expectedEmployeeDays: 8,
      employmentExcludedDays: 2,
      unresolvedScheduleDays: 2,
    });
  });

  it('keeps missing and under-review days in the denominator without double-counting outcomes', async () => {
    const prisma = prismaDouble();
    prisma.dailyAttendance.findMany.mockResolvedValue([
      { userId: 'u1', date: new Date('2026-10-12T00:00:00Z'), status: 'LATE', evaluationState: 'FINALIZED', exceptionFlags: ['INSUFFICIENT_EFFECTIVE_WORK'] },
      { userId: 'u1', date: new Date('2026-10-13T00:00:00Z'), status: 'PRESENT', evaluationState: 'NEEDS_REVIEW' },
      { userId: 'u1', date: new Date('2026-10-14T00:00:00Z'), status: 'HALF_DAY', evaluationState: 'FINALIZED' },
    ]);
    const service = new TeamInsightsService(prisma, access, timing, tva);
    const eligible = new Set([
      'u1:2026-10-12', 'u1:2026-10-13', 'u1:2026-10-14', 'u1:2026-10-15',
    ]);

    const metrics = await (service as any).attendanceMetrics(
      ['u1'], ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'], eligible, 0,
    );

    // Present days include the half day (the person attended); the attendance
    // rate still weights half days separately.
    expect(metrics).toMatchObject({
      expectedEmployeeDays: 4,
      presentDays: 2,
      halfDays: 1,
      lateDays: 1,
      lessWorkingHoursDays: 1,
      unresolvedDays: 1,
      missingDays: 1,
      attendanceRate: null,
      coverageRate: 50,
    });
  });

  it('builds a complete individual month calendar with attendance and company-day colours', async () => {
    const prisma = prismaDouble();
    prisma.dailyAttendance.findMany.mockResolvedValue([
      { date: new Date('2026-10-12T00:00:00Z'), status: 'PRESENT', evaluationState: 'NEEDS_REVIEW' },
      { date: new Date('2026-10-13T00:00:00Z'), status: 'LATE', evaluationState: 'FINALIZED' },
    ]);
    const service = new TeamInsightsService(prisma, access, timing, tva);
    const days = await (service as any).personalAttendanceCalendar('u1', {
      from: '2026-10-11', to: '2026-10-15',
      start: new Date('2026-10-11T00:00:00Z'), end: new Date('2026-10-16T00:00:00Z'), days: 5,
    }, [
      { businessDate: '2026-10-11', isWorkingDay: false, reason: 'SUNDAY', holidayName: null },
      { businessDate: '2026-10-12', isWorkingDay: true, reason: 'WORKING', holidayName: null },
      { businessDate: '2026-10-13', isWorkingDay: true, reason: 'WORKING', holidayName: null },
      { businessDate: '2026-10-14', isWorkingDay: false, reason: 'HOLIDAY', holidayName: 'Founders Day' },
      { businessDate: '2026-10-15', isWorkingDay: true, reason: 'WORKING', holidayName: null },
    ]);

    expect(days.map((day: any) => [day.date, day.status])).toEqual([
      ['2026-10-11', 'WEEKLY_OFF'],
      ['2026-10-12', 'NEEDS_REVIEW'],
      ['2026-10-13', 'LATE'],
      ['2026-10-14', 'HOLIDAY'],
      ['2026-10-15', 'FUTURE'],
    ]);
  });

  it('marks verified overtime and productive days from recorded evidence', async () => {
    const prisma = prismaDouble();
    prisma.dailyAttendance.findMany.mockResolvedValue([
      { date: new Date('2026-10-12T00:00:00Z'), status: 'PRESENT', evaluationState: 'FINALIZED', workedMinutes: 600, exceptionFlags: [] },
      { date: new Date('2026-10-13T00:00:00Z'), status: 'PRESENT', evaluationState: 'FINALIZED', workedMinutes: 480, exceptionFlags: [] },
    ]);
    prisma.ticketTimeLog.findMany.mockResolvedValue([{
      startedAt: new Date('2026-10-13T10:00:00Z'), endedAt: new Date('2026-10-13T11:00:00Z'),
    }]);
    const service = new TeamInsightsService(prisma, access, timing, tva);
    const days = await (service as any).personalAttendanceCalendar('u1', {
      from: '2026-10-12', to: '2026-10-13',
      start: new Date('2026-10-12T00:00:00Z'), end: new Date('2026-10-14T00:00:00Z'), days: 2,
    }, [
      { businessDate: '2026-10-12', isWorkingDay: true, reason: 'WORKING', holidayName: null },
      { businessDate: '2026-10-13', isWorkingDay: true, reason: 'WORKING', holidayName: null },
    ]);

    expect(days.map((day: any) => [day.date, day.status])).toEqual([
      ['2026-10-12', 'OVERTIME'],
      ['2026-10-13', 'PRODUCTIVE'],
    ]);
  });

  it('shows approved leave immediately and lets real work evidence replace a stale leave row', async () => {
    const prisma = prismaDouble();
    prisma.leaveRequest.findMany.mockResolvedValue([{
      id: 'leave-1', type: 'CASUAL', startDate: new Date('2026-10-12T00:00:00Z'),
      endDate: new Date('2026-10-12T00:00:00Z'), isHalfDay: false,
    }]);
    const service = new TeamInsightsService(prisma, access, timing, tva);
    const window = {
      from: '2026-10-12', to: '2026-10-12',
      start: new Date('2026-10-12T00:00:00Z'), end: new Date('2026-10-13T00:00:00Z'), days: 1,
    };
    const calendar = [{ businessDate: '2026-10-12', isWorkingDay: true, reason: 'WORKING', holidayName: null }];

    const leaveDays = await (service as any).personalAttendanceCalendar('u1', window, calendar);
    expect(leaveDays[0]).toMatchObject({ status: 'LEAVE', outcome: 'LEAVE', leaveType: 'CASUAL' });

    prisma.leaveRequest.findMany.mockResolvedValue([]);
    prisma.dailyAttendance.findMany.mockResolvedValue([{
      date: new Date('2026-10-12T00:00:00Z'), status: 'LEAVE', evaluationState: 'FINALIZED',
      punchInAt: null, punchOutAt: null, exceptionFlags: [], workedMinutes: 0,
    }]);
    prisma.workSession.findMany.mockResolvedValue([{
      id: 'ws1', date: new Date('2026-10-12T00:00:00Z'),
      startWorkAt: new Date('2026-10-12T09:00:00Z'), logoutAt: null, status: 'WORKING',
    }]);
    const workedDays = await (service as any).personalAttendanceCalendar('u1', window, calendar);
    expect(workedDays[0]).toMatchObject({ status: 'NEEDS_REVIEW', outcome: null, leaveType: null });
  });

  it('counts a completed shared meeting once in overall even with several participants', async () => {
    const prisma = prismaDouble();
    prisma.meeting.findMany.mockResolvedValue([{
      id: 'm1', visibility: 'SHARED', startedAt: new Date('2026-10-14T10:00:00Z'), endedAt: new Date('2026-10-14T11:00:00Z'),
      participants: [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }],
    }]);
    const service = new TeamInsightsService(prisma, access, timing, tva);

    const metrics = await (service as any).timeMetrics(['u1', 'u2', 'u3'], range, true);

    expect(metrics.meetingCount).toBe(1);
    expect(prisma.meeting.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'COMPLETED', visibility: 'SHARED' }),
    }));
  });

  it('counts distinct tickets sent for review and reports rework attempts separately', async () => {
    const prisma = prismaDouble();
    prisma.reviewCycleLog.findMany
      .mockResolvedValueOnce([{ ticketId: 't1' }, { ticketId: 't1' }, { ticketId: 't2' }])
      .mockResolvedValueOnce([{ ticketId: 't1' }, { ticketId: 't1' }, { ticketId: 't2' }]);
    const service = new TeamInsightsService(prisma, access, timing, tva);

    const metrics = await (service as any).ticketMetrics(['u1'], range);

    expect(metrics.sentForReview).toBe(2);
    expect(metrics.reworkTickets).toBe(2);
    expect(metrics.reworkAttempts).toBe(3);
  });

  it('counts ticket workload from status activity inside the selected period', async () => {
    const prisma = prismaDouble();
    prisma.ticket.findMany.mockResolvedValue([
      {
        id: 't1', status: 'DONE', createdAt: new Date('2026-10-01T09:00:00Z'), updatedAt: new Date('2026-10-14T12:00:00Z'),
        history: [
          { field: 'status', oldValue: 'OPEN', newValue: 'IN_PROGRESS', changedAt: new Date('2026-10-14T09:00:00Z') },
          { field: 'status', oldValue: 'IN_PROGRESS', newValue: 'REVIEW', changedAt: new Date('2026-10-14T10:00:00Z') },
          { field: 'status', oldValue: 'REVIEW', newValue: 'DONE', changedAt: new Date('2026-10-14T12:00:00Z') },
        ],
      },
      {
        id: 't2', status: 'DONE', createdAt: new Date('2026-09-01T09:00:00Z'), updatedAt: new Date('2026-09-02T12:00:00Z'),
        history: [{ field: 'status', oldValue: 'OPEN', newValue: 'DONE', changedAt: new Date('2026-09-02T12:00:00Z') }],
      },
    ]);
    const service = new TeamInsightsService(prisma, access, timing, tva);

    const metrics = await (service as any).ticketMetrics(['u1'], range);

    expect(metrics).toMatchObject({ active: 1, inProgress: 1, underReview: 1, completed: 1 });
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ AND: expect.any(Array) }),
    }));
  });

  it('excludes admins and super admins from company aggregates while including managers', async () => {
    const prisma = prismaDouble();
    prisma.user.findMany.mockResolvedValue([{ id: 'tl1' }, { id: 'employee1' }]);
    prisma.managerDeptAccess.findMany.mockResolvedValue([{ managerId: 'manager1' }, { managerId: 'manager1' }]);
    const service = new TeamInsightsService(prisma, access, timing, tva);

    const scope = await (service as any).allowedScope({ id: 'admin1', role: { name: 'ADMIN' } });

    expect(scope.userIds).toEqual(['tl1', 'employee1', 'manager1']);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        role: { name: { in: ['TEAM_LEAD', 'EMPLOYEE', 'INTERN'] } },
        id: { not: 'admin1' },
      }),
    }));
  });

  it('uses the live work ledger for break and meeting status', async () => {
    const prisma = prismaDouble();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1', name: 'Asha Rao', photoUrl: null, avatar: null, currentStatus: 'WORKING',
      role: { name: 'EMPLOYEE' }, department: { id: 'd1', name: 'Retail' },
    });
    prisma.workSession.findFirst.mockResolvedValue({
      startWorkAt: new Date('2026-10-14T09:00:00Z'), status: 'ON_BREAK',
      breakLogs: [{ breakType: 'BREAK', startAt: new Date('2026-10-14T17:00:00Z') }],
    });
    const service = new TeamInsightsService(prisma, access, timing, tva);

    const onBreak = await (service as any).liveIdentity('u1');
    expect(onBreak).toMatchObject({ status: 'ON_BREAK', activeBreakMinutes: 60 });

    prisma.workSession.findFirst.mockResolvedValue({
      startWorkAt: new Date('2026-10-14T09:00:00Z'), status: 'ON_BREAK',
      breakLogs: [{ breakType: 'MEETING', startAt: new Date('2026-10-14T17:00:00Z') }],
    });
    const inMeeting = await (service as any).liveIdentity('u1');
    expect(inMeeting).toMatchObject({ status: 'IN_MEETING', activeBreakMinutes: 0 });
  });

  it('shows leave from the universal user status when no work session is open', async () => {
    const prisma = prismaDouble();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1', name: 'Asha Rao', photoUrl: null, avatar: null, currentStatus: 'ON_LEAVE',
      role: { name: 'EMPLOYEE' }, department: { id: 'd1', name: 'Retail' },
    });
    prisma.workSession.findFirst.mockResolvedValue(null);
    const service = new TeamInsightsService(prisma, access, timing, tva);

    await expect((service as any).liveIdentity('u1')).resolves.toMatchObject({ status: 'ON_LEAVE' });
  });

  it('builds complete Monday-to-Sunday calendar weeks and rejects an outside week', () => {
    const service = new TeamInsightsService(prismaDouble(), access, timing, tva);
    const october = (service as any).resolveRange('2026-10', 'all');
    expect(october.weeks.map((week: any) => [week.from, week.to])).toEqual([
      ['2026-09-28', '2026-10-04'],
      ['2026-10-05', '2026-10-11'],
      ['2026-10-12', '2026-10-18'],
      ['2026-10-19', '2026-10-25'],
      ['2026-10-26', '2026-11-01'],
    ]);
    expect(october.range).toMatchObject({ from: '2026-10-01', to: '2026-10-31', days: 31 });
    const boundaryWeek = (service as any).resolveRange('2026-10', '1');
    expect(boundaryWeek.range).toMatchObject({ from: '2026-09-28', to: '2026-10-04', days: 7 });
    const selectedDay = (service as any).resolveRange('2026-10', 'all', '2026-10-14');
    expect(selectedDay).toMatchObject({ mode: 'DAY', range: { from: '2026-10-14', to: '2026-10-14', days: 1 } });
    expect(() => (service as any).resolveRange('2026-10', 'all', '2026-02-30')).toThrow('date must be a valid');
    expect(() => (service as any).resolveRange('2026-10', '6')).toThrow('week is not valid');
  });

  it('marks future productivity weeks as upcoming and only calculates elapsed dates', async () => {
    const service = new TeamInsightsService(prismaDouble(), access, timing, tva);
    const metrics = jest.spyOn(service as any, 'timeMetrics').mockResolvedValue({
      workingMinutes: 0, breakMinutes: 0, ticketMinutes: 0, meetingMinutes: 0,
      productiveMinutes: 0, meetingCount: 0, daysWorked: 0, calendarDaysWorked: 0,
    });
    const october = (service as any).resolveRange('2026-10', 'all').range;

    const buckets = await (service as any).direction(['u1'], october, false);

    expect(buckets).toHaveLength(5);
    expect(buckets[2]).toMatchObject({ label: 'Week 3', isFuture: false, isPartial: true });
    expect(buckets[3]).toMatchObject({ label: 'Week 4', isFuture: true, averageMinutes: 0 });
    expect(buckets[4]).toMatchObject({ label: 'Week 5', isFuture: true, averageMinutes: 0 });
    expect(metrics).toHaveBeenCalledTimes(3);
    expect(metrics.mock.calls[2][1]).toMatchObject({ from: '2026-10-12', to: '2026-10-14', days: 3 });
  });

  it('suppresses meaningless company contribution and flags completed projects with active tickets', async () => {
    const prisma = prismaDouble();
    prisma.project.findMany.mockResolvedValue([{
      id: 'p1', projectId: 'PRJ-1', name: 'Contradictory project', status: 'COMPLETED', endDate: new Date('2026-10-14T12:00:00Z'),
      tickets: [
        { id: 't1', status: 'IN_PROGRESS', assignedToId: 'u1', dueDate: new Date('2026-10-13T12:00:00Z'), executionDueAt: null, reviewDueAt: null, createdAt: new Date('2026-10-14T08:00:00Z'), actualStartAt: new Date('2026-10-14T09:00:00Z'), submittedAt: null, closedAt: null, resolvedAt: null, assignees: [] },
        { id: 't2', status: 'DONE', assignedToId: 'u1', dueDate: null, executionDueAt: null, reviewDueAt: null, createdAt: new Date('2026-10-14T08:00:00Z'), actualStartAt: new Date('2026-10-14T09:00:00Z'), submittedAt: new Date('2026-10-14T11:00:00Z'), closedAt: new Date('2026-10-14T12:00:00Z'), resolvedAt: null, assignees: [] },
      ],
    }]);
    const service = new TeamInsightsService(prisma, access, timing, tva);

    const projects = await (service as any).projects(['u1'], range, false);

    expect(projects[0]).toMatchObject({
      assigned: 2, done: 1, active: 1, overdue: 1,
      contributionPercent: null, hasStatusConflict: true,
    });
  });

  it('awards monthly badges only from real ranking and personal-history values', async () => {
    const prisma = prismaDouble();
    prisma.user.findMany.mockResolvedValue([{ id: 'manager1' }, { id: 'employee1' }]);
    const service = new TeamInsightsService(prisma, access, timing, tva);
    const current = new Map([
      ['manager1', { daysWorked: 10, workingMinutes: 4800, productiveMinutes: 3000, breakMinutes: 400, completedTickets: 8, attendanceDays: 10, onTimeDays: 10 }],
      ['employee1', { daysWorked: 10, workingMinutes: 4500, productiveMinutes: 2500, breakMinutes: 500, completedTickets: 5, attendanceDays: 10, onTimeDays: 9 }],
    ]);
    const previous = new Map([
      ['manager1', { daysWorked: 10, workingMinutes: 4200, productiveMinutes: 2500, breakMinutes: 450, completedTickets: 6, attendanceDays: 10, onTimeDays: 9 }],
    ]);
    jest.spyOn(service as any, 'achievementStats').mockResolvedValueOnce(current).mockResolvedValueOnce(previous);
    jest.spyOn(service as any, 'projects').mockResolvedValue([]);

    const result = await service.getPersonalHighlights({ id: 'manager1', role: { name: 'MANAGER' } }, '2026-10');

    expect(result.achievements.map((item) => item.id)).toEqual(expect.arrayContaining([
      'punctual', 'ticket-leader', 'work-leader', 'focus-leader', 'ticket-growth', 'work-growth', 'productivity-growth',
    ]));
    expect(result.averageBreakMinutes).toBe(40);
  });

  it.each([
    ['admin1', 'ADMIN'],
    ['super1', 'SUPER_ADMIN'],
  ])('exposes personal achievements and project contributions to %s', async (userId, role) => {
    const prisma = prismaDouble();
    prisma.user.findMany.mockResolvedValue([{ id: userId }]);
    const service = new TeamInsightsService(prisma, access, timing, tva);
    const stats = new Map([[userId, {
      daysWorked: 3,
      workingMinutes: 1440,
      productiveMinutes: 900,
      breakMinutes: 120,
      completedTickets: 1,
      attendanceDays: 3,
      onTimeDays: 3,
    }]]);
    const previous = new Map([[userId, {
      daysWorked: 0,
      workingMinutes: 0,
      productiveMinutes: 0,
      breakMinutes: 0,
      completedTickets: 0,
      attendanceDays: 0,
      onTimeDays: 0,
    }]]);
    jest.spyOn(service as any, 'achievementStats').mockResolvedValueOnce(stats).mockResolvedValueOnce(previous);
    jest.spyOn(service as any, 'projects').mockResolvedValue([{ id: 'project-1', name: 'Leadership project' }]);

    const result = await service.getPersonalHighlights({ id: userId, role: { name: role } }, '2026-10');

    expect(result.achievements.length).toBeGreaterThan(0);
    expect(result.projects).toEqual([{ id: 'project-1', name: 'Leadership project' }]);
  });

  it('shares identical in-flight insight calculations and reuses the completed result', async () => {
    const service = new TeamInsightsService(prismaDouble(), access, timing, tva);
    const answer = { target: 'OVERALL', scope: { people: 3 } };
    const calculate = jest.spyOn(service as any, 'calculateInsights').mockResolvedValue(answer);
    const viewer = { id: 'admin1', role: { name: 'ADMIN' } };
    const query = { personId: 'overall', month: '2026-10', week: 'all' };

    const [first, second] = await Promise.all([
      service.getInsights(viewer, query),
      service.getInsights(viewer, query),
    ]);
    const third = await service.getInsights(viewer, query);

    expect(first).toBe(answer);
    expect(second).toBe(answer);
    expect(third).toBe(answer);
    expect(calculate).toHaveBeenCalledTimes(1);

    const cached = [...(service as any).insightCache.values()][0];
    cached.expiresAt = 0;
    const afterFreshnessCheck = await service.getInsights(viewer, query);
    expect(afterFreshnessCheck).toBe(answer);
    expect(calculate).toHaveBeenCalledTimes(1);
  });
});
