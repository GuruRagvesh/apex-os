/**
 * THE LATE CUTOFF IS ONE COMPANY VALUE.
 *
 * The rule under test is a product decision, and the thing it rules OUT is what
 * these tests have to prove: lateness must NOT be derived from each employee's
 * own shift start time. That was the previous behaviour, and it is the mutation
 * these tests exist to kill.
 *
 * THE FIXTURE IS BUILT SO THE TWO RULES DISAGREE. Two employees arrive at the
 * same moment, 10:45, on shifts starting 09:00 and 11:00. Under the company
 * cutoff both are late. Under the old per-shift rule one is late and one is
 * early -- so any test that passed under both rules would be proving nothing,
 * and these cannot.
 *
 * The shift rows deliberately still carry startTime and graceMinutes even
 * though the service no longer selects them: a Prisma double ignores `select`,
 * so the fields stay visible to any code that reaches for them. That is on
 * purpose. If somebody restores `arrivalThreshold: shift?.startTime`, the data
 * is right there for the mutation to pick up and these tests still fail.
 */
import { AttendanceReportService } from '../../src/modules/platform/attendance/canonical/attendance-report.service';
import {
  COMPANY_LATE_CUTOFF_FALLBACK,
  LATE_CUTOFF_SETTING_KEY,
  parseConfiguredCutoff,
  resolveLateCutoff,
} from '../../src/modules/platform/attendance/shared/attendance-primitives';

const HR = { id: 'hr-1', role: { name: 'HR' } };

/**
 * 2026-09-10 at an IST wall-clock time. Accepts HH:mm or HH:mm:ss.
 *
 * SECONDS MATTER HERE. The cutoff is inclusive to the second, and the report
 * derived arrival with an HH:mm format that discarded them -- so 10:30:59 was
 * indistinguishable from 10:30:00 and read as on time.
 */
function ist(clock: string): Date {
  const [h, m, s = 0] = clock.split(':').map(Number);
  // IST is UTC+5:30 and has no DST, so one fixed offset is exact here.
  return new Date(Date.UTC(2026, 8, 10, h - 5, m - 30, s));
}

const EARLY_SHIFT = {
  id: 'shift-early',
  minimumWorkingMinutes: 540,
  startTime: '09:00',
  graceMinutes: 0,
};
const LATE_SHIFT = {
  id: 'shift-late',
  minimumWorkingMinutes: 540,
  // 11:00 is AFTER the company cutoff. An employee arriving 10:45 is EARLY for
  // this shift and LATE for the company -- the whole disagreement in one row.
  startTime: '11:00',
  // Two hours of grace, which under the old rule would have excused an arrival
  // as late as 13:00. The company cutoff must ignore it completely.
  graceMinutes: 120,
};

function build(
  over: { configuredCutoff?: unknown; hasSetting?: boolean; punchIn?: string } = {},
) {
  const arrival = over.punchIn ?? '10:45';
  const users = [
    { id: 'u-early', name: 'Asha Early', employeeId: 'TE-001' },
    { id: 'u-late', name: 'Bala Late', employeeId: 'TE-002' },
  ].map((u) => ({
    ...u,
    designation: 'Engineer',
    employmentType: 'FULL_TIME',
    joiningDate: new Date('2020-01-01T00:00:00.000Z'),
    lastWorkingDate: null,
    department: { name: 'Delivery' },
  }));

  const day = new Date('2026-09-10T00:00:00.000Z');

  const prisma: any = {
    user: { findMany: jest.fn(async () => users) },
    // Both arrive at exactly the same moment.
    dailyAttendance: {
      findMany: jest.fn(async () => [
        {
          userId: 'u-early',
          date: day,
          status: 'PRESENT',
          evaluationState: 'CALCULATED',
          punchInAt: ist(arrival),
          punchOutAt: ist('19:45'),
          workedMinutes: 540,
          breakMinutes: 0,
          lateMinutes: null,
          leaveDeducted: null,
          lwpDeducted: null,
          exceptionFlags: [],
          shiftPolicyId: EARLY_SHIFT.id,
          attendancePolicyId: null,
        },
        {
          userId: 'u-late',
          date: day,
          status: 'PRESENT',
          evaluationState: 'CALCULATED',
          punchInAt: ist(arrival),
          punchOutAt: ist('19:45'),
          workedMinutes: 540,
          breakMinutes: 0,
          lateMinutes: null,
          leaveDeducted: null,
          lwpDeducted: null,
          exceptionFlags: [],
          shiftPolicyId: LATE_SHIFT.id,
          attendancePolicyId: null,
        },
      ]),
    },
    attendancePunchEvidence: { findMany: jest.fn(async () => []) },
    workSession: { findMany: jest.fn(async () => []) },
    leaveRequest: { findMany: jest.fn(async () => []) },
    attendanceRegularization: { findMany: jest.fn(async () => []) },
    attendancePolicy: { findMany: jest.fn(async () => []) },
    shiftPolicy: { findMany: jest.fn(async () => [EARLY_SHIFT, LATE_SHIFT]) },
    appSetting: {
      findUnique: jest.fn(async () => (over.hasSetting ? { value: over.configuredCutoff } : null)),
    },
  };

  const service = new AttendanceReportService(
    prisma,
    {
      now: () => new Date('2026-10-01T06:00:00.000Z'),
      companyTimezone: () => 'Asia/Kolkata',
      companyDateOnly: (d: Date) => d,
      companyBusinessDate: (d: Date) => d.toISOString().slice(0, 10),
    } as any,
    { isHrOrAdmin: () => true } as any,
    {
      classifyMonth: jest.fn(async () => ({
        month: '2026-09',
        sources: { weeklyOffPolicy: { resolved: true } },
        days: [{ businessDate: '2026-09-10', isWorkingDay: true }],
      })),
    } as any,
  );

  return { service, prisma };
}

async function rowsFor(over?: {
  configuredCutoff?: unknown;
  hasSetting?: boolean;
  punchIn?: string;
}) {
  const report = await build(over).service.monthReport(HR, '2026-09');
  const on = (userId: string) =>
    report.dailyRows.filter((r) => r.userId === userId && r.date === '2026-09-10');
  return { report, early: on('u-early')[0], late: on('u-late')[0] };
}

// ════════════════════════════════════════════════════════════════════════════
describe('the late cutoff is company-wide, not per shift', () => {
  it('MARKS BOTH EMPLOYEES LATE although their shifts start two hours apart', async () => {
    const { early, late } = await rowsFor();

    // 10:45 against a 10:30 company cutoff is 15 minutes late, for everybody.
    expect(early.raw.lateMinutes).toBe(15);
    expect(late.raw.lateMinutes).toBe(15);
    expect(early.lateArrival).toBe('Late by 00:15');
    expect(late.lateArrival).toBe('Late by 00:15');
  });

  it('gives the two employees the SAME verdict, which the old rule could not', async () => {
    const { early, late } = await rowsFor();

    // The assertion that fails the instant lateness goes back to being
    // per-shift. Stated as an equality rather than as two separate numbers so
    // it keeps its meaning even if the fixture arrival time is ever changed.
    expect(late.raw.lateMinutes).toBe(early.raw.lateMinutes);
    expect(late.lateArrival).toBe(early.lateArrival);
  });

  it('does NOT treat the 11:00 shift as on time', async () => {
    const { late } = await rowsFor();

    // Under the old rule this row read "On time": 10:45 is before 11:00.
    expect(late.lateArrival).not.toBe('On time');
    expect(late.raw.lateMinutes).not.toBe(0);
    expect(late.raw.lateMinutes).not.toBeNull();
  });

  it('does NOT add the per-shift grace minutes to the company cutoff', async () => {
    const { late } = await rowsFor();

    // LATE_SHIFT carries 120 minutes of grace. Applied to a 10:30 cutoff that
    // would excuse anything before 12:30 and this row would read "On time".
    // 15 is the figure with NO grace applied, so this pins grace at zero rather
    // than merely checking that the row is late.
    expect(late.raw.lateMinutes).toBe(15);
  });

  it('IS INCLUSIVE TO THE SECOND: 10:30:00 on time, 10:30:01 late', async () => {
    // The register has to draw the boundary in the same place the evaluator
    // does. It derived arrival with HH:mm, which threw the seconds away, so
    // the whole first minute of lateness was reported as on time.
    const onTime = await rowsFor({ punchIn: '10:30:00' });
    expect(onTime.early.lateArrival).toBe('On time');
    expect(onTime.early.raw.lateMinutes).toBe(0);

    const oneSecond = await rowsFor({ punchIn: '10:30:01' });
    expect(oneSecond.early.lateArrival).toBe('Late by 00:01');
    expect(oneSecond.early.raw.lateMinutes).toBe(1);

    // And the last second of that minute is still late.
    const lastSecond = await rowsFor({ punchIn: '10:30:59' });
    expect(lastSecond.early.raw.lateMinutes).toBe(1);
  });

  it('counts the late day for both employees in the monthly summary', async () => {
    const { report } = await rowsFor();
    const byUser = new Map(report.summaryRows.map((s) => [s.userId, s]));

    expect(byUser.get('u-early')!.lateDays).toBe(1);
    expect(byUser.get('u-late')!.lateDays).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the cutoff is read from configuration, and reported with the rows', () => {
  it('uses the company fallback when nothing is configured', async () => {
    const { report, early } = await rowsFor();

    expect(report.metadata.lateCutoff).toEqual({ clock: '10:30', source: 'SYSTEM_FALLBACK' });
    expect(early.raw.lateMinutes).toBe(15);
  });

  it('READS THE CONFIGURED VALUE, so the cutoff is changeable without a deploy', async () => {
    // 11:00 configured. The same 10:45 arrival is now on time for everybody,
    // which also proves the fallback is not hardcoded into the comparison.
    const { report, early, late } = await rowsFor({
      hasSetting: true,
      configuredCutoff: '11:00',
    });

    expect(report.metadata.lateCutoff).toEqual({ clock: '11:00', source: 'CONFIGURED' });
    expect(early.lateArrival).toBe('On time');
    expect(late.lateArrival).toBe('On time');
  });

  it('accepts the object form of the setting', async () => {
    const { report } = await rowsFor({ hasSetting: true, configuredCutoff: { clock: '09:15' } });
    expect(report.metadata.lateCutoff).toEqual({ clock: '09:15', source: 'CONFIGURED' });
  });

  it('RENDERS THE MONTH ANYWAY when the setting is not a time, and says so', async () => {
    // A mistyped setting must not fail the report for 56 people, and must not
    // pass as "nothing configured" either.
    const { report, early } = await rowsFor({ hasSetting: true, configuredCutoff: 42 });

    expect(report.metadata.lateCutoff).toEqual({
      clock: '10:30',
      source: 'INVALID_CONFIGURED_VALUE',
    });
    expect(early.raw.lateMinutes).toBe(15);
  });

  it('reads the setting ONCE for the whole report, not once per employee', async () => {
    const ctx = build();
    await ctx.service.monthReport(HR, '2026-09');

    // Two employees, one read. A per-row read would be both wasteful and the
    // shape in which a per-employee cutoff could creep back in.
    expect(ctx.prisma.appSetting.findUnique).toHaveBeenCalledTimes(1);
    expect(ctx.prisma.appSetting.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: LATE_CUTOFF_SETTING_KEY } }),
    );
  });

  it('still renders when the settings table cannot be read at all', async () => {
    const ctx = build();
    ctx.prisma.appSetting.findUnique = jest.fn(async () => {
      throw new Error('relation "app_settings" does not exist');
    });

    const report = await ctx.service.monthReport(HR, '2026-09');
    expect(report.metadata.lateCutoff.clock).toBe('10:30');
    expect(report.dailyRows.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('resolveLateCutoff keeps three states apart', () => {
  it('unconfigured is not the same news as misconfigured', () => {
    expect(resolveLateCutoff(undefined)).toEqual({
      clock: '10:30',
      source: 'SYSTEM_FALLBACK',
    });
    expect(resolveLateCutoff(null)).toEqual({
      clock: '10:30',
      source: 'INVALID_CONFIGURED_VALUE',
    });

    // Both fall back to the same clock, so the clock alone cannot tell them
    // apart -- the source is the only thing that can, which is why it exists.
    expect(resolveLateCutoff(undefined).source).not.toBe(resolveLateCutoff(null).source);
  });

  it('an emptied setting is a mistake, not an absence', () => {
    expect(resolveLateCutoff('').source).toBe('INVALID_CONFIGURED_VALUE');
  });

  it('refuses a value that is not a wall-clock time', () => {
    for (const bad of ['25:00', '10:60', 'half past ten', '1030', '10:3o']) {
      expect(resolveLateCutoff(bad).source).toBe('INVALID_CONFIGURED_VALUE');
      expect(resolveLateCutoff(bad).clock).toBe(COMPANY_LATE_CUTOFF_FALLBACK);
    }
  });

  it('takes a well-formed value as configured', () => {
    expect(resolveLateCutoff('09:45')).toEqual({ clock: '09:45', source: 'CONFIGURED' });
    expect(resolveLateCutoff('00:00')).toEqual({ clock: '00:00', source: 'CONFIGURED' });
  });

  it('the fallback is 10:30', () => {
    // Pinned deliberately. This is the company decision, and a change to it
    // should have to change a test that says so out loud.
    expect(COMPANY_LATE_CUTOFF_FALLBACK).toBe('10:30');
  });
});

describe('parseConfiguredCutoff distinguishes absent from malformed', () => {
  it('absent is undefined', () => {
    expect(parseConfiguredCutoff(null)).toBeUndefined();
    expect(parseConfiguredCutoff(undefined)).toBeUndefined();
  });

  it('a bare string and an object both carry a cutoff', () => {
    expect(parseConfiguredCutoff('10:30')).toBe('10:30');
    expect(parseConfiguredCutoff({ clock: '10:30' })).toBe('10:30');
    expect(parseConfiguredCutoff({ lateCutoff: '10:30' })).toBe('10:30');
  });

  it('present but not a cutoff is null, which must not read as absent', () => {
    for (const bad of [42, true, [], {}, { clock: 9 }]) {
      expect(parseConfiguredCutoff(bad)).toBeNull();
    }
    // The distinction the resolver depends on.
    expect(parseConfiguredCutoff(42)).not.toBeUndefined();
  });
});
