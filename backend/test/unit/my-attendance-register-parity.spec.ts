/**
 * THE EMPLOYEE VIEW AND THE PAYROLL REGISTER, OVER THE SAME STORED MONTH.
 *
 * Two surfaces read the same DailyAttendance rows and present them: the
 * employee dashboard (EmployeeAttendanceSummaryService) and the canonical
 * register (AttendanceReportService). An employee who disputes a figure and
 * the HR answering them must not be reading different numbers.
 *
 * This is a PARITY test, not a unit test of either. It feeds one set of rows
 * to both and compares what comes out, so a divergence shows up here rather
 * than in a payroll conversation.
 */
import { AttendanceReportService } from '../../src/modules/platform/attendance/canonical/attendance-report.service';
import { EmployeeAttendanceSummaryService } from '../../src/modules/platform/attendance/summary/employee-attendance-summary.service';
import { createTvaDouble } from '../helpers/tva-double';
// The rendered KPI labels, imported from the frontend presentation module the
// dashboard actually uses -- the same cross-boundary import the dashboard
// presentation spec already relies on.
import { monthKpis } from '../../../frontend/components/attendance/employee-summary-presentation';

const MONTH = '2026-09';
const NOW = new Date('2026-10-02T06:00:00.000Z');
const ALICE = { id: 'u-alice', role: { name: 'EMPLOYEE' } };

function ist(day: number, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 8, day, h - 5, m - 30, 0));
}

/** One stored official day, as the nightly evaluator would have written it. */
function row(day: number, status: string, punchIn: string, punchOut: string) {
  return {
    userId: 'u-alice',
    date: new Date(Date.UTC(2026, 8, day)),
    status,
    evaluationState: 'CALCULATED',
    punchInAt: ist(day, punchIn),
    punchOutAt: ist(day, punchOut),
    workedMinutes: 480,
    breakMinutes: 60,
    lateMinutes: status === 'LATE' ? 15 : 0,
    leaveDeducted: null,
    lwpDeducted: null,
    exceptionFlags: [],
    locked: false,
    shiftPolicyId: null,
    attendancePolicyId: null,
  };
}

// Three ordinary present days and two late ones. The late days are the whole
// point: they are the rows the two surfaces classify differently.
const ROWS = [
  row(1, 'PRESENT', '09:30', '18:30'),
  row(2, 'PRESENT', '09:30', '18:30'),
  row(3, 'PRESENT', '09:30', '18:30'),
  row(4, 'LATE', '10:45', '19:45'),
  row(7, 'LATE', '10:45', '19:45'),
];

const WORKING_DATES = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-07'];

const USER = {
  id: 'u-alice',
  name: 'Alice',
  employeeId: 'TE-001',
  designation: 'Engineer',
  employmentType: 'FULL_TIME',
  joiningDate: new Date('2020-01-01T00:00:00.000Z'),
  lastWorkingDate: null,
  isActive: true,
  department: { id: 'd-1', name: 'Delivery' },
};

function prismaDouble() {
  return {
    user: {
      findMany: jest.fn(async () => [USER]),
      findUnique: jest.fn(async () => USER),
    },
    dailyAttendance: { findMany: jest.fn(async () => ROWS) },
    attendancePunchEvidence: { findMany: jest.fn(async () => []) },
    workSession: { findMany: jest.fn(async () => []) },
    leaveRequest: { findMany: jest.fn(async () => []) },
    attendanceRegularization: {
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
    attendancePolicy: { findMany: jest.fn(async () => []) },
    shiftPolicy: { findMany: jest.fn(async () => []) },
    appSetting: { findUnique: jest.fn(async () => null) },
  } as any;
}

function registerService() {
  const tva = createTvaDouble(NOW);
  return new AttendanceReportService(
    prismaDouble(),
    {
      ...tva,
      companyDateOnly: (d: Date) => d,
      companyBusinessDate: (d: Date) => d.toISOString().slice(0, 10),
    } as any,
    { isHrOrAdmin: () => true } as any,
    {
      classifyMonth: jest.fn(async () => ({
        month: MONTH,
        sources: { weeklyOffPolicy: { resolved: true } },
        days: WORKING_DATES.map((businessDate) => ({ businessDate, isWorkingDay: true })),
      })),
    } as any,
  );
}

function dashboardService() {
  const tva = createTvaDouble(NOW);
  return new EmployeeAttendanceSummaryService(
    prismaDouble(),
    { ...tva, companyDateOnly: (d: Date) => d } as any,
    { canViewUser: async () => true } as any,
    {
      resolveDailyContext: jest.fn(async () => ({
        shift: { startTime: '10:00', minimumWorkingMinutes: 540 },
        attendancePolicy: { minimumWorkingMinutes: 540 },
        lateCutoff: { clock: '10:30', source: 'SYSTEM_FALLBACK' },
      })),
    } as any,
    // Never reached: every day in the fixture has a stored row.
    { evaluate: jest.fn(async () => { throw new Error('must not evaluate a stored day'); }) } as any,
  );
}

describe('the employee dashboard and the payroll register, over one month', () => {
  it('AGREE ON LATE DAYS', async () => {
    const register = await registerService().myMonth(ALICE, MONTH);
    const dashboard = await dashboardService().summary('u-alice', 'u-alice', MONTH);

    expect(register.summaryRows[0].lateDays).toBe(2);
    expect(dashboard.counts.late).toBe(2);
    expect(dashboard.counts.late).toBe(register.summaryRows[0].lateDays);
  });

  it('COUNT TWO DIFFERENT THINGS, and the difference is exactly the late days', async () => {
    // THE TWO FIGURES ARE NOT THE SAME QUESTION, AND THAT IS NOT A BUG.
    //
    // The register's presentDays counts ATTENDANCE: deriveStatus maps LATE and
    // LATE_EXEMPTED onto the visible status "Present", because lateness is a
    // separate axis and a late employee did attend. It reports 5.
    //
    // The dashboard's counts.present counts status === 'PRESENT' only, which
    // is ON TIME, and the label it renders under says exactly that. It reports
    // 3 on time and 2 late.
    //
    // So the surfaces agree about every DAY -- all five attended, two of them
    // late -- and the two numbers answer "how many days did you attend" and
    // "how many did you arrive on time for". Both are needed; neither is the
    // other.
    //
    // WHAT KEEPS THIS SAFE IS THE LABEL, which is why the next test pins it.
    // Rendering counts.present as "Present" would put 3 next to the register's
    // 5 under the same word, and that IS the payroll conversation this test
    // exists to prevent.
    const register = await registerService().myMonth(ALICE, MONTH);
    const dashboard = await dashboardService().summary('u-alice', 'u-alice', MONTH);

    expect(register.summaryRows[0].presentDays).toBe(5);
    expect(dashboard.counts.present).toBe(3);

    // The gap is exactly the late days, and nothing else. If it ever is not,
    // the two surfaces have genuinely diverged about a day.
    expect(register.summaryRows[0].presentDays - dashboard.counts.present).toBe(
      register.summaryRows[0].lateDays,
    );
  });

  it('THE DASHBOARD CALLS ITS FIGURE "ON TIME", NEVER "PRESENT"', async () => {
    // The one thing standing between two correct numbers and a contradiction.
    //
    // counts.present is an on-time count wearing a misleading field name. The
    // rendered label is what the employee reads, and nothing tested it -- so
    // renaming the card to "Present" would have shown 3 beside a register
    // saying 5, under the same word, with no test objecting.
    const dashboard = await dashboardService().summary('u-alice', 'u-alice', MONTH);
    const card = monthKpis(dashboard.counts as any).find((k) => k.key === 'present');

    expect(card).toBeDefined();
    expect(card!.label).toBe('On Time');
    expect(card!.label).not.toBe('Present');
    expect(card!.value).toBe(3);
  });

  it('agree that every one of these days was attended', async () => {
    // The property that actually matters: no day is present on one surface and
    // absent on the other. The disagreement above is a label, not a day.
    const register = await registerService().myMonth(ALICE, MONTH);
    const dashboard = await dashboardService().summary('u-alice', 'u-alice', MONTH);

    const registerAttended =
      register.summaryRows[0].presentDays + register.summaryRows[0].halfDays;
    const dashboardAttended = dashboard.counts.present + dashboard.counts.late;

    expect(registerAttended).toBe(dashboardAttended);
    expect(register.summaryRows[0].absentDays).toBe(0);
    expect(dashboard.counts.absent).toBe(0);
  });

  it('NEITHER RE-EVALUATES A STORED DAY', async () => {
    // The evaluator double throws if called. A finalized month must show what
    // was finalized, and both surfaces reading persisted rows is what makes
    // that true -- the dashboard only live-evaluates a date with no row yet.
    await expect(
      dashboardService().summary('u-alice', 'u-alice', MONTH),
    ).resolves.toBeDefined();
  });
});
