/**
 * MY ATTENDANCE READS THE SAME CANONICAL DATA HR READS.
 *
 * Two properties matter here and they pull in opposite directions, which is why
 * both are tested rather than one:
 *
 *   SCOPE    An employee must never see another employee, and the route takes
 *            no userId, so the only way to get this wrong is for the query to
 *            lose its restriction. That is exactly what a mutation would do.
 *
 *   SAMENESS An employee must see the SAME figures payroll sees. A self-service
 *            view that computed its own numbers would let an employee and the
 *            register disagree about one day with no way to tell which is
 *            official.
 */
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { AttendanceReportService } from '../../src/modules/platform/attendance/canonical/attendance-report.service';

const ALICE = { id: 'u-alice', role: { name: 'EMPLOYEE' } };
const BOB = { id: 'u-bob', role: { name: 'EMPLOYEE' } };
const HR = { id: 'hr-1', role: { name: 'HR' } };

function ist(day: number, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 8, day, h - 5, m - 30, 0));
}

function userRow(id: string, name: string, employeeId: string) {
  return {
    id,
    name,
    employeeId,
    designation: 'Engineer',
    employmentType: 'FULL_TIME',
    joiningDate: new Date('2020-01-01T00:00:00.000Z'),
    lastWorkingDate: null,
    department: { name: 'Delivery' },
  };
}

const ALL_USERS = [userRow('u-alice', 'Alice', 'TE-001'), userRow('u-bob', 'Bob', 'TE-002')];

function attendanceRow(userId: string, day: number, punchIn: string, punchOut: string) {
  return {
    userId,
    date: new Date(Date.UTC(2026, 8, day)),
    status: 'PRESENT',
    evaluationState: 'CALCULATED',
    punchInAt: ist(day, punchIn),
    punchOutAt: ist(day, punchOut),
    workedMinutes: 540,
    breakMinutes: 0,
    lateMinutes: null,
    leaveDeducted: null,
    lwpDeducted: null,
    exceptionFlags: [],
    shiftPolicyId: null,
    attendancePolicyId: null,
  };
}

function build(over: { joiningDate?: Date } = {}) {
  const userQueries: any[] = [];
  const attendanceQueries: any[] = [];

  const roster = over.joiningDate
    ? ALL_USERS.map((u) =>
        u.id === 'u-alice' ? { ...u, joiningDate: over.joiningDate! } : u,
      )
    : ALL_USERS;

  const prisma: any = {
    user: {
      findMany: jest.fn(async (args: any) => {
        userQueries.push(args);
        // THE DOUBLE HONOURS THE RESTRICTION, because a double that ignored it
        // would let a mutation dropping the scope survive: every test would
        // still see one employee regardless of what the query asked for.
        const restriction = (args?.where?.AND ?? []).find((c: any) => c?.id?.in);
        const scoped = restriction
          ? roster.filter((u) => restriction.id.in.includes(u.id))
          : roster;

        // THE DOUBLE ALSO HONOURS THE EMPLOYMENT WINDOW, because a double that
        // returned an employee for every month would make a month with no
        // summary unreachable -- and the test asserting twelve slots would
        // pass without ever meeting the case it exists for.
        const to = args?.where?.AND?.find((c: any) => c?.OR?.[0]?.joiningDate === null)
          ?.OR?.[1]?.joiningDate?.lte;
        return to
          ? scoped.filter((u) => !u.joiningDate || u.joiningDate <= to)
          : scoped;
      }),
    },
    dailyAttendance: {
      findMany: jest.fn(async (args: any) => {
        attendanceQueries.push(args);
        const ids: string[] = args?.where?.userId?.in ?? [];
        return [
          // Alice arrives late, Bob on time, so a leak is visible in the data
          // and not only in the row count.
          attendanceRow('u-alice', 10, '10:45', '19:45'),
          attendanceRow('u-bob', 10, '09:30', '18:30'),
        ].filter((r) => ids.includes(r.userId));
      }),
    },
    attendancePunchEvidence: { findMany: jest.fn(async () => []) },
    workSession: { findMany: jest.fn(async () => []) },
    leaveRequest: { findMany: jest.fn(async () => []) },
    attendanceRegularization: { findMany: jest.fn(async () => []) },
    attendancePolicy: { findMany: jest.fn(async () => []) },
    shiftPolicy: { findMany: jest.fn(async () => []) },
    appSetting: { findUnique: jest.fn(async () => null) },
  };

  const service = new AttendanceReportService(
    prisma,
    {
      now: () => new Date('2026-10-01T06:00:00.000Z'),
      companyTimezone: () => 'Asia/Kolkata',
      companyDateOnly: (d: Date) => d,
      companyBusinessDate: (d: Date) => d.toISOString().slice(0, 10),
    } as any,
    { isHrOrAdmin: (u: any) => ['HR', 'ADMIN', 'SUPER_ADMIN'].includes(u?.role?.name) } as any,
    {
      classifyMonth: jest.fn(async () => ({
        month: '2026-09',
        sources: { weeklyOffPolicy: { resolved: true } },
        days: [{ businessDate: '2026-09-10', isWorkingDay: true }],
      })),
    } as any,
  );

  return { service, prisma, userQueries, attendanceQueries };
}

// ════════════════════════════════════════════════════════════════════════════
describe('an employee sees their own attendance and nobody else', () => {
  it('RETURNS ONLY THE CALLER, never a colleague', async () => {
    const { service } = build();

    const mine = await service.myMonth(ALICE, '2026-09');

    const userIds = new Set(mine.dailyRows.map((r) => r.userId));
    expect([...userIds]).toEqual(['u-alice']);
    expect(mine.summaryRows).toHaveLength(1);
    expect(mine.summaryRows[0].userId).toBe('u-alice');
  });

  it('two employees get genuinely different answers', async () => {
    // Guards against a scope that happens to return the right COUNT while
    // reading the wrong person.
    const alice = await build().service.myMonth(ALICE, '2026-09');
    const bob = await build().service.myMonth(BOB, '2026-09');

    expect(alice.summaryRows[0].employeeId).toBe('TE-001');
    expect(bob.summaryRows[0].employeeId).toBe('TE-002');
    // Alice arrived at 10:45 and Bob at 09:30, against a 10:30 cutoff.
    expect(alice.summaryRows[0].lateDays).toBe(1);
    expect(bob.summaryRows[0].lateDays).toBe(0);
    expect(alice.summaryRows[0].lateDays).not.toBe(bob.summaryRows[0].lateDays);
  });

  it('PUSHES THE RESTRICTION INTO THE QUERY, not into a filter afterwards', async () => {
    const { service, userQueries, attendanceQueries } = build();

    await service.myMonth(ALICE, '2026-09');

    // Filtering after the fact would mean the database had already returned
    // every employee to a request that may not see them.
    const restriction = (userQueries[0].where.AND ?? []).find((c: any) => c?.id?.in);
    expect(restriction).toEqual({ id: { in: ['u-alice'] } });
    expect(attendanceQueries[0].where.userId.in).toEqual(['u-alice']);
  });

  it('KEEPS THE EMPLOYMENT-WINDOW CLAUSES as well as the scope', async () => {
    // The restriction is an extra AND member, not a replacement. An employee
    // reading their joining month must still not see days before they joined.
    const { service, userQueries } = build();

    await service.myMonth(ALICE, '2026-09');

    const clauses = userQueries[0].where.AND;
    expect(clauses.length).toBeGreaterThan(1);
    expect(JSON.stringify(clauses)).toContain('joiningDate');
    expect(JSON.stringify(clauses)).toContain('lastWorkingDate');
  });

  it('refuses a caller with no subject rather than querying for everybody', async () => {
    const { service, prisma } = build();

    await expect(service.myMonth({}, '2026-09')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.myMonth(null, '2026-09')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('does NOT require HR, which is the whole point of a self-service route', async () => {
    const { service } = build();
    await expect(service.myMonth(ALICE, '2026-09')).resolves.toBeDefined();
  });

  it('validates the month rather than guessing a range', async () => {
    const { service } = build();
    for (const bad of ['2026', '2026-13', 'September', '', '2026-9']) {
      await expect(service.myMonth(ALICE, bad)).rejects.toBeInstanceOf(BadRequestException);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the employee view and the HR report agree', () => {
  it('GIVES THE EMPLOYEE EXACTLY THE ROW HR SEES FOR THEM', async () => {
    // The property that makes this worth building on the canonical assembly
    // instead of a self-service query. If these ever diverge, an employee
    // disputing a day and the HR answering them are reading different numbers.
    const company = await build().service.monthReport(HR, '2026-09');
    const mine = await build().service.myMonth(ALICE, '2026-09');

    const hrRowForAlice = company.summaryRows.find((s) => s.userId === 'u-alice');
    expect(mine.summaryRows[0]).toEqual(hrRowForAlice);

    const hrDaysForAlice = company.dailyRows.filter((r) => r.userId === 'u-alice');
    expect(mine.dailyRows).toEqual(hrDaysForAlice);
  });

  it('reads the same late cutoff the register was built with', async () => {
    const mine = await build().service.myMonth(ALICE, '2026-09');
    expect(mine.metadata.lateCutoff).toEqual({ clock: '10:30', source: 'SYSTEM_FALLBACK' });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the year view is twelve summaries, not a year of days', () => {
  it('returns one slot per month, in order', async () => {
    const { service } = build();

    const year = await service.myYear(ALICE, '2026');

    expect(year.year).toBe('2026');
    expect(year.months).toHaveLength(12);
    expect(year.months.map((m) => m.month)).toEqual([
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
      '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12',
    ]);
  });

  it('carries real figures in the month that has them', async () => {
    const { service } = build();

    const year = await service.myYear(ALICE, '2026');

    // The fixture's calendar only describes September, so that is the month
    // with a working day in it.
    const september = year.months.find((m) => m.month === '2026-09');
    expect(september!.summary!.userId).toBe('u-alice');
    expect(september!.summary!.lateDays).toBe(1);
  });

  it('IS SCOPED TO THE CALLER in every one of the twelve months', async () => {
    // A scope applied to the first month and dropped afterwards would leak
    // eleven months of somebody else.
    const { service, userQueries } = build();

    await service.myYear(ALICE, '2026');

    expect(userQueries).toHaveLength(12);
    for (const q of userQueries) {
      const restriction = (q.where.AND ?? []).find((c: any) => c?.id?.in);
      expect(restriction).toEqual({ id: { in: ['u-alice'] } });
    }
  });

  it('does not fetch a year of days', async () => {
    // Each query covers one month. The guard is that no single query spans the
    // whole year, which is the shape a 365-day fetch would have.
    const { service, attendanceQueries } = build();

    await service.myYear(ALICE, '2026');

    for (const q of attendanceQueries) {
      const span =
        new Date(q.where.date.lte).getTime() - new Date(q.where.date.gte).getTime();
      expect(span).toBeLessThan(32 * 24 * 60 * 60 * 1000);
    }
  });

  it('KEEPS A SLOT FOR A MONTH THE EMPLOYEE WAS NOT EMPLOYED IN', async () => {
    // Alice joins in June. January to May are not months of zeros -- she was
    // not there -- but they still occupy a slot, so the UI never has to work
    // out what a missing month means or shift the other eleven along.
    const { service } = build({ joiningDate: new Date('2026-06-01T00:00:00.000Z') });

    const year = await service.myYear(ALICE, '2026');

    expect(year.months).toHaveLength(12);
    expect(year.months.slice(0, 5).map((m) => m.month)).toEqual([
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05',
    ]);
    for (const m of year.months.slice(0, 5)) {
      expect(m.summary).toBeNull();
    }
    // And June onwards is present, so this is not just "everything is null".
    expect(year.months.find((m) => m.month === '2026-09')!.summary).not.toBeNull();
  });

  it('refuses a year that is not a year', async () => {
    const { service } = build();
    for (const bad of ['26', '2026-01', 'last year', '']) {
      await expect(service.myYear(ALICE, bad)).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('refuses a caller with no subject', async () => {
    const { service } = build();
    await expect(service.myYear({}, '2026')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
