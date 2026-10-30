import * as ExcelJS from 'exceljs';
const JSZip = require('jszip');
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { assembleMonthlyAttendanceReport, monthDates } from '../../src/modules/platform/attendance/console/export/report-assembler';
import {
  DAILY_COLUMNS,
  DAILY_SHEET_NAME,
  MONTHLY_COLUMNS,
  MONTHLY_SHEET_NAME,
  REMOVED_COLUMN_HEADERS,
  formatCell,
} from '../../src/modules/platform/attendance/console/export/report-columns';
import {
  FIRST_DATA_ROW,
  FORMULA_KEYS,
  HEADER_ROW,
  monthlyAttendanceWorkbookBuffer,
} from '../../src/modules/platform/attendance/console/export/report-workbook';
import { csvCell, csvPackage, dailyCsvName, monthlyCsvName } from '../../src/modules/platform/attendance/console/export/report-csv';
import { DAY_STATES, type MonthlyAttendanceReport, type ReportSourceFacts } from '../../src/modules/platform/attendance/console/export/report-model';
import { MonthlyAttendanceReportService } from '../../src/modules/platform/attendance/console/export/monthly-attendance-report.service';
import { TVAService } from '../../src/common/services/tva.service';
import { ConfigService } from '@nestjs/config';

/**
 * The monthly attendance report: one canonical assembler, three encodings
 * (the on-screen register, the Excel workbook and the CSV package).
 *
 * The assembler is pure, so most of what matters is proved on facts directly.
 * The workbook and the ZIP are then re-read with independent readers (ExcelJS
 * and JSZip), never with the code that wrote them.
 */

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MONTH = '2026-09';
const AFTER_MONTH = '2026-10-29';
const SUNDAYS = ['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27'];
const HOLIDAY = '2026-09-15';

/** An IST wall-clock time on a business date, as the stored UTC instant. */
const ist = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + (h * 60 + m - 330) * 60_000);
};

function calendar(month = MONTH) {
  return monthDates(month).map((d) => ({
    businessDate: d,
    isWorkingDay: !SUNDAYS.includes(d) && d !== HOLIDAY,
    reason: SUNDAYS.includes(d) ? 'SUNDAY' : d === HOLIDAY ? 'HOLIDAY' : 'WORKING',
    holidayName: d === HOLIDAY ? 'Founders Day' : null,
  }));
}

const workingDates = (month = MONTH) => calendar(month).filter((d) => d.isWorkingDay).map((d) => d.businessDate);

function official(userId: string, date: string, over: Partial<ReportSourceFacts['official'][number]> = {}) {
  return {
    userId,
    businessDate: date,
    status: 'PRESENT',
    evaluationState: 'FINALIZED',
    calculationReason: 'COMPLETE_WORKDAY',
    exceptionFlags: [],
    punchInAt: ist(date, '09:30'),
    punchOutAt: ist(date, '18:45'),
    workedMinutes: 525,
    breakMinutes: 30,
    lateMinutes: 0,
    leaveDeducted: 0,
    lwpDeducted: 0,
    revision: 0,
    lastRegularizationId: null,
    leaveRequestId: null,
    ...over,
  };
}

function employee(userId: string, name: string, over: Partial<ReportSourceFacts['employees'][number]> = {}) {
  return {
    userId,
    employeeCode: `TE-${userId}`,
    name,
    department: 'Operations',
    designation: 'Associate',
    employmentType: 'FULL_TIME',
    joiningDate: '2025-01-01',
    lastWorkingDate: null,
    ...over,
  };
}

/** Every working day present for each employee, unless overridden. */
function facts(over: Partial<ReportSourceFacts> = {}, fill: string[] = ['u1']): ReportSourceFacts {
  const base: ReportSourceFacts = {
    month: MONTH,
    today: AFTER_MONTH,
    generatedAt: new Date('2026-10-29T06:00:00.000Z'),
    timezone: 'Asia/Kolkata',
    financialYear: '2026-2027',
    scope: 'COMPANY',
    departmentName: null,
    calendarResolved: true,
    employees: [employee('u1', 'Ajay Singh')],
    profiles: [],
    calendar: calendar(),
    official: fill.flatMap((u) => workingDates().map((d) => official(u, d))),
    leaves: [],
    compOff: [],
    corrections: [],
    sessions: [],
    meetings: [],
    punches: [],
  };
  return { ...base, ...over };
}

/** Replaces one official day for one employee. */
function withDay(f: ReportSourceFacts, userId: string, date: string, over: Partial<ReportSourceFacts['official'][number]> | null) {
  const rest = f.official.filter((o) => !(o.userId === userId && o.businessDate === date));
  return { ...f, official: over === null ? rest : [...rest, official(userId, date, over)] };
}

const day = (r: MonthlyAttendanceReport, userId: string, date: string) =>
  r.dailyRows.find((d) => d.userId === userId && d.businessDate === date)!.values;
const summary = (r: MonthlyAttendanceReport, userId = 'u1') => r.monthlySummaryRows.find((m) => m.userId === userId)!.values;

// ── A: day resolution and the monthly figures ────────────────────────────────

describe('A. one explicit state per employee-date', () => {
  it('A1. every employee has one contiguous row per date, ordered by name', () => {
    const r = assembleMonthlyAttendanceReport(
      facts({ employees: [employee('u2', 'Zoya Khan'), employee('u1', 'Ajay Singh')] }, ['u1', 'u2']),
    );
    expect(r.dailyRows).toHaveLength(60);
    expect(r.dailyRows.slice(0, 30).every((d) => d.userId === 'u1')).toBe(true);
    expect(r.dailyRows.slice(30).every((d) => d.userId === 'u2')).toBe(true);
    expect(r.dailyRows.slice(0, 30).map((d) => d.businessDate)).toEqual(monthDates(MONTH));
    expect(r.monthlySummaryRows.map((m) => m.dailyRange)).toEqual([{ first: 0, last: 29 }, { first: 30, last: 59 }]);
  });

  it('A2. a complete finalized month is Present every working day and final', () => {
    const r = assembleMonthlyAttendanceReport(facts());
    const s = summary(r);
    expect(s.workingDays).toBe(25);
    expect(s.presentDays).toBe(25);
    expect(s.absentDays).toBe(0);
    expect(s.weeklyOffDays).toBe(4);
    expect(s.holidayDays).toBe(1);
    expect(s.attendancePercent).toBe(1);
    expect(s.provisional).toBe('No');
    expect(day(r, 'u1', '2026-09-01').attendanceStatus).toBe(DAY_STATES.PRESENT);
    expect(day(r, 'u1', '2026-09-01').nineHourCompletion).toBe('Completed');
    expect(day(r, 'u1', HOLIDAY).attendanceStatus).toBe(DAY_STATES.HOLIDAY);
    expect(day(r, 'u1', SUNDAYS[0]).attendanceStatus).toBe(DAY_STATES.WEEKLY_OFF);
    expect(r.metadata.provisional).toBe(false);
  });

  it('A3. late and short hours are independent facts', () => {
    const f = withDay(facts(), 'u1', '2026-09-02', {
      status: 'LATE',
      lateMinutes: 12,
      punchInAt: ist('2026-09-02', '09:42'),
      punchOutAt: ist('2026-09-02', '17:42'),
    });
    const r = assembleMonthlyAttendanceReport(f);
    const d = day(r, 'u1', '2026-09-02');
    expect(d.attendanceStatus).toBe(DAY_STATES.SHORT_HOURS);
    expect(d.lateArrival).toBe('Yes');
    expect(d.nineHourCompletion).toBe('Shortfall 1:00');
    expect(d.present).toBe(1);
    const s = summary(r);
    expect(s.lateDays).toBe(1);
    expect(s.daysBelowNineHours).toBe(1);
    // Still a present day: no double penalty.
    expect(s.presentDays).toBe(25);
  });

  it('A3b. a late but complete day is Late, not Short Hours', () => {
    const f = withDay(facts(), 'u1', '2026-09-02', {
      status: 'LATE',
      lateMinutes: 20,
      punchInAt: ist('2026-09-02', '09:50'),
      punchOutAt: ist('2026-09-02', '19:00'),
    });
    expect(day(assembleMonthlyAttendanceReport(f), 'u1', '2026-09-02').attendanceStatus).toBe(DAY_STATES.LATE);
  });

  it('A3c. the required presence comes from the assigned shift', () => {
    const f = withDay(
      { ...facts(), profiles: [{ userId: 'u1', effectiveFrom: '2026-01-01', effectiveTo: null, category: 'STANDARD', attendanceRequired: true, requiredPresenceMinutes: 480 }] },
      'u1',
      '2026-09-02',
      { punchInAt: ist('2026-09-02', '09:30'), punchOutAt: ist('2026-09-02', '17:30') },
    );
    const d = day(assembleMonthlyAttendanceReport(f), 'u1', '2026-09-02');
    expect(d.attendanceStatus).toBe(DAY_STATES.PRESENT);
    expect(d.nineHourCompletion).toBe('Completed');
  });

  it('A4. a past working day with no official row is unresolved, never Absent', () => {
    const r = assembleMonthlyAttendanceReport(withDay(facts(), 'u1', '2026-09-03', null));
    const d = day(r, 'u1', '2026-09-03');
    expect(d.attendanceStatus).toBe(DAY_STATES.NEEDS_REVIEW);
    expect(d.absent).toBe(0);
    expect(d.hrReview).toBe('Not Evaluated - Review Required');
    const s = summary(r);
    expect(s.unresolvedDays).toBe(1);
    expect(s.absentDays).toBe(0);
    // Blank, not a fabricated score.
    expect(s.attendancePercent).toBeNull();
    expect(s.provisional).toBe('Yes');
  });

  it('A5. the current month is provisional and future days carry no counts', () => {
    const today = '2026-09-10';
    const f = facts({ today, official: workingDates().filter((d) => d < today).map((d) => official('u1', d)) });
    const r = assembleMonthlyAttendanceReport(f);
    expect(day(r, 'u1', '2026-09-11').attendanceStatus).toBe(DAY_STATES.FUTURE);
    // Today without a settled result is still future, not absent.
    expect(day(r, 'u1', today).attendanceStatus).toBe(DAY_STATES.FUTURE);
    const s = summary(r);
    expect(s.absentDays).toBe(0);
    expect(s.unresolvedDays).toBe(0);
    expect(s.presentDays).toBe(8);
    expect(s.attendancePercent).toBe(1);
    expect(s.provisional).toBe('Yes');
    expect(r.metadata.monthComplete).toBe(false);
    expect(r.warnings.join(' ')).toMatch(/not complete/);
  });

  it('A6. days before joining are Not Yet Joined and not working days', () => {
    const r = assembleMonthlyAttendanceReport(
      facts({
        employees: [employee('u1', 'Ajay Singh', { joiningDate: '2026-09-16' })],
        official: workingDates().filter((d) => d >= '2026-09-16').map((d) => official('u1', d)),
      }),
    );
    expect(day(r, 'u1', '2026-09-01').attendanceStatus).toBe(DAY_STATES.NOT_YET_JOINED);
    const s = summary(r);
    expect(s.notYetJoinedDays).toBe(15);
    // 16-30 September less two Sundays.
    expect(s.workingDays).toBe(13);
    expect(s.presentDays).toBe(13);
    expect(s.unresolvedDays).toBe(0);
    expect(s.attendancePercent).toBe(1);
  });

  it('A7. approved leave is leave, not attendance credit, and leaves the denominator', () => {
    let f = facts({ leaves: [{ id: 'lv1', userId: 'u1', type: 'CASUAL', status: 'APPROVED', approvalStage: 'COMPLETE', isHalfDay: false, dates: ['2026-09-04', '2026-09-05'] }] });
    f = withDay(f, 'u1', '2026-09-04', { status: 'LEAVE', calculationReason: 'APPROVED_LEAVE', leaveRequestId: 'lv1', leaveDeducted: 1, punchInAt: null, punchOutAt: null, workedMinutes: 0 });
    f = withDay(f, 'u1', '2026-09-05', { status: 'LEAVE', calculationReason: 'APPROVED_LEAVE', leaveRequestId: 'lv1', leaveDeducted: 1, punchInAt: null, punchOutAt: null, workedMinutes: 0 });
    f = withDay(f, 'u1', '2026-09-07', { status: 'ABSENT', calculationReason: 'NO_ATTENDANCE', punchInAt: null, punchOutAt: null, workedMinutes: 0 });
    const r = assembleMonthlyAttendanceReport(f);
    expect(day(r, 'u1', '2026-09-04').attendanceStatus).toBe(DAY_STATES.APPROVED_LEAVE);
    expect(day(r, 'u1', '2026-09-04').leaveType).toBe('Casual Leave');
    const s = summary(r);
    expect(s.leaveDays).toBe(2);
    expect(s.clUsed).toBe(2);
    expect(s.presentDays).toBe(22);
    expect(s.eligibleWorkingDays).toBe(23);
    // 22 / 23, rounded to four places -- the leave days are neither credit nor penalty.
    expect(s.attendancePercent).toBe(0.9565);
  });

  it('A8. Attendance % = (Present + 0.5 x Half) / eligible resolved days', () => {
    let f = facts();
    f = withDay(f, 'u1', '2026-09-01', { status: 'ABSENT', punchInAt: null, punchOutAt: null, workedMinutes: 0 });
    f = withDay(f, 'u1', '2026-09-02', { status: 'HALF_DAY', calculationReason: 'HALF_DAY', punchOutAt: ist('2026-09-02', '14:00') });
    f = withDay(f, 'u1', '2026-09-03', { status: 'HALF_DAY', calculationReason: 'HALF_DAY', punchOutAt: ist('2026-09-03', '14:00') });
    const s = summary(assembleMonthlyAttendanceReport(f));
    expect(s.presentDays).toBe(22);
    expect(s.absentDays).toBe(1);
    expect(s.halfDays).toBe(2);
    expect(s.eligibleWorkingDays).toBe(25);
    expect(s.attendancePercent).toBe(Number(((22 + 0.5 * 2) / 25).toFixed(4)));
  });

  it('A9. LWP from approved unpaid leave is leave; any other LWP is an absence', () => {
    let f = withDay(facts(), 'u1', '2026-09-01', { status: 'LWP', calculationReason: 'APPROVED_UNPAID_LEAVE', lwpDeducted: 1, punchInAt: null, punchOutAt: null });
    f = withDay(f, 'u1', '2026-09-02', { status: 'LWP', calculationReason: 'UNREPORTED_ABSENCE_3_DAYS', lwpDeducted: 1, punchInAt: null, punchOutAt: null });
    const r = assembleMonthlyAttendanceReport(f);
    expect(day(r, 'u1', '2026-09-01')).toMatchObject({ attendanceStatus: DAY_STATES.LWP, leave: 1, absent: 0 });
    expect(day(r, 'u1', '2026-09-02')).toMatchObject({ attendanceStatus: DAY_STATES.LWP, leave: 0, absent: 1 });
    const s = summary(r);
    expect(s.lwpDays).toBe(2);
    expect(s.eligibleWorkingDays).toBe(24);
  });

  it('A10. an ABSENT stored on a non-working calendar day is held for review, never charged', () => {
    const f = { ...facts(), official: [...facts().official, official('u1', SUNDAYS[1], { status: 'ABSENT', punchInAt: null, punchOutAt: null })] };
    const r = assembleMonthlyAttendanceReport(f);
    expect(day(r, 'u1', SUNDAYS[1]).attendanceStatus).toBe(DAY_STATES.NEEDS_REVIEW);
    expect(summary(r).absentDays).toBe(0);
    expect(summary(r).unresolvedDays).toBe(1);
  });

  it('A11. an official NEEDS_REVIEW day keeps its values visible but counts nothing', () => {
    const r = assembleMonthlyAttendanceReport(withDay(facts(), 'u1', '2026-09-08', { status: 'ABSENT', evaluationState: 'NEEDS_REVIEW' }));
    const d = day(r, 'u1', '2026-09-08');
    expect(d.attendanceStatus).toBe(DAY_STATES.NEEDS_REVIEW);
    expect(d.punchIn).toBe('09:30');
    expect(d.absent).toBe(0);
    expect(d.hrReview).toBe('Review Required');
  });

  it('A12. a worked holiday is Holiday Worked, from the punch evidence', () => {
    const f = facts({
      punches: [
        { userId: 'u1', businessDate: HOLIDAY, type: 'PUNCH_IN', at: ist(HOLIDAY, '10:00') },
        { userId: 'u1', businessDate: HOLIDAY, type: 'PUNCH_OUT', at: ist(HOLIDAY, '22:00') },
      ],
      compOff: [{ userId: 'u1', earnedFromBusinessDate: HOLIDAY, creditMinutes: 540, status: 'AVAILABLE' }],
    });
    const r = assembleMonthlyAttendanceReport(f);
    expect(day(r, 'u1', HOLIDAY)).toMatchObject({ attendanceStatus: DAY_STATES.HOLIDAY_WORKED, compOff: 9, present: 0 });
    expect(summary(r).holidayDays).toBe(1);
  });
});

// ── R: the regularization lifecycle in the report ────────────────────────────

const correction = (status: string, over: Partial<ReportSourceFacts['corrections'][number]> = {}) => ({
  userId: 'u1',
  businessDate: '2026-09-09',
  status,
  applicationStatus: null,
  applicationFailureReason: null,
  requestType: 'MISSING_PUNCH_OUT',
  reason: 'Forgot to punch out',
  createdAt: new Date('2026-09-10T05:00:00.000Z'),
  ...over,
});

describe('R. regularization lifecycle', () => {
  const absentDay = { status: 'ABSENT', calculationReason: 'NO_PUNCH_OUT', punchOutAt: null, workedMinutes: 0 };

  it('R1. pending: official values stay, the day is flagged, the month is provisional', () => {
    const f = { ...withDay(facts(), 'u1', '2026-09-09', absentDay), corrections: [correction('PENDING')] };
    const r = assembleMonthlyAttendanceReport(f);
    const d = day(r, 'u1', '2026-09-09');
    expect(d.attendanceStatus).toBe(DAY_STATES.ABSENT);
    expect(d.disputeStatus).toBe('Pending');
    expect(d.hrReview).toBe('Correction Awaiting Decision');
    expect(d.remarks).toContain('Correction request: Forgot to punch out');
    const s = summary(r);
    expect(s.absentDays).toBe(1);
    expect(s.pendingDisputes).toBe(1);
    expect(s.provisional).toBe('Yes');
    // The official answer is still the official answer.
    expect(s.attendancePercent).toBe(0.96);
  });

  it('R2. applied: the corrected official row is what the report shows', () => {
    const f = {
      ...withDay(facts(), 'u1', '2026-09-09', { revision: 2, lastRegularizationId: 'reg-1' }),
      corrections: [correction('APPROVED', { applicationStatus: 'APPLIED' })],
    };
    const r = assembleMonthlyAttendanceReport(f);
    expect(day(r, 'u1', '2026-09-09')).toMatchObject({
      attendanceStatus: DAY_STATES.PRESENT,
      regularized: 'Yes',
      disputeStatus: 'Approved - Applied',
    });
    expect(summary(r)).toMatchObject({ presentDays: 25, provisional: 'No', pendingDisputes: 0 });
  });

  it('R3. rejected: original values, and not provisional', () => {
    const f = { ...withDay(facts(), 'u1', '2026-09-09', absentDay), corrections: [correction('REJECTED')] };
    const r = assembleMonthlyAttendanceReport(f);
    expect(day(r, 'u1', '2026-09-09')).toMatchObject({ attendanceStatus: DAY_STATES.ABSENT, regularized: 'No', disputeStatus: 'Rejected' });
    expect(summary(r)).toMatchObject({ absentDays: 1, provisional: 'No' });
  });

  it('R4. approved but held (REVIEW_REQUIRED): not applied, provisional, HR to apply', () => {
    const f = {
      ...withDay(facts(), 'u1', '2026-09-09', absentDay),
      corrections: [correction('APPROVED', { applicationStatus: 'REVIEW_REQUIRED', applicationFailureReason: 'MONTH_LOCKED' })],
    };
    const r = assembleMonthlyAttendanceReport(f);
    expect(day(r, 'u1', '2026-09-09')).toMatchObject({
      attendanceStatus: DAY_STATES.ABSENT,
      disputeStatus: 'Approved - Held (Not Applied)',
      hrReview: 'Approved Correction Held - HR to Apply',
    });
    expect(summary(r).provisional).toBe('Yes');
  });

  it('R5. stale: not applied, re-review, provisional', () => {
    const f = { ...withDay(facts(), 'u1', '2026-09-09', absentDay), corrections: [correction('STALE_REVIEW_REQUIRED')] };
    const r = assembleMonthlyAttendanceReport(f);
    expect(day(r, 'u1', '2026-09-09')).toMatchObject({
      attendanceStatus: DAY_STATES.ABSENT,
      disputeStatus: 'Stale - Requires Review',
      hrReview: 'Correction Stale - Re-review',
    });
    expect(summary(r).provisional).toBe('Yes');
  });

  it('R6. an approved review-only request is reported as such and closes the dispute', () => {
    const f = { ...facts(), corrections: [correction('APPROVED', { applicationStatus: 'NOT_REQUIRED', applicationFailureReason: 'REVIEW_ONLY_REQUEST' })] };
    const r = assembleMonthlyAttendanceReport(f);
    expect(day(r, 'u1', '2026-09-09').disputeStatus).toBe('Approved - Review Only');
    expect(summary(r).provisional).toBe('No');
  });
});

// ── M: meetings are never double counted ────────────────────────────────────

const meeting = (id: string, from: string, to: string, approvalStatus: string | null, over: any = {}) => ({
  userId: 'u1',
  businessDate: '2026-09-10',
  meetingId: id,
  startAt: ist('2026-09-10', from),
  endAt: ist('2026-09-10', to),
  durationMinutes: null,
  approvalStatus,
  cancelled: false,
  ...over,
});

describe('M. meetings', () => {
  it('M1. overlapping meetings count each minute once', () => {
    const f = facts({ meetings: [meeting('m1', '11:00', '12:00', 'APPROVED'), meeting('m2', '11:30', '12:30', 'NOT_REQUIRED')] });
    const r = assembleMonthlyAttendanceReport(f);
    const d = day(r, 'u1', '2026-09-10');
    expect(d.meetingHours).toBe(1.5);
    expect(d.workHours).toBe(8.75);
    expect(d.meetingVerification).toBe('Approved');
    expect(summary(r)).toMatchObject({ meetingDays: 1, meetingHours: 1.5, approvedMeetingHours: 1.5 });
  });

  it('M2. a rejected meeting comes out of meeting hours and work hours', () => {
    const f = facts({ meetings: [meeting('m1', '15:00', '16:00', 'REJECTED')] });
    const r = assembleMonthlyAttendanceReport(f);
    const d = day(r, 'u1', '2026-09-10');
    expect(d.meetingHours).toBe(0);
    expect(d.workHours).toBe(7.75);
    expect(d.meetingVerification).toBe('Rejected');
    expect(String(d.remarks)).toMatch(/rejected meeting/);
    expect(summary(r).workHours).toBe(8.75 * 24 + 7.75);
  });

  it('M3. a rejected meeting overlapped by an approved one removes nothing twice', () => {
    const f = facts({ meetings: [meeting('m1', '15:00', '16:00', 'REJECTED'), meeting('m2', '15:30', '16:30', 'APPROVED')] });
    const d = day(assembleMonthlyAttendanceReport(f), 'u1', '2026-09-10');
    expect(d.meetingHours).toBe(1);
    expect(d.workHours).toBe(8.25);
  });

  it('M4. a pending meeting is shown and counted, and does not make the month provisional', () => {
    const f = facts({ meetings: [meeting('m1', '11:00', '12:00', 'PENDING')] });
    const r = assembleMonthlyAttendanceReport(f);
    expect(day(r, 'u1', '2026-09-10').meetingVerification).toBe('Pending');
    expect(summary(r)).toMatchObject({ pendingMeetingApprovals: 1, provisional: 'No', approvedMeetingHours: 0 });
  });

  it('M5. a cancelled meeting is not a meeting', () => {
    const f = facts({ meetings: [meeting('m1', '11:00', '12:00', 'APPROVED', { cancelled: true })] });
    const d = day(assembleMonthlyAttendanceReport(f), 'u1', '2026-09-10');
    expect(d.meetingVerification).toBe('Not Applicable');
    expect(d.meetingHours).toBeNull();
  });
});

describe('C. comp-off', () => {
  it('C1. only granted (not cancelled) comp-off is shown, in hours', () => {
    const f = facts({
      compOff: [
        { userId: 'u1', earnedFromBusinessDate: '2026-09-11', creditMinutes: 180, status: 'AVAILABLE' },
        { userId: 'u1', earnedFromBusinessDate: '2026-09-12', creditMinutes: 540, status: 'CANCELLED' },
      ],
    });
    const r = assembleMonthlyAttendanceReport(f);
    expect(day(r, 'u1', '2026-09-11').compOff).toBe(3);
    expect(day(r, 'u1', '2026-09-12').compOff).toBeNull();
    expect(summary(r).approvedCompOff).toBe(3);
  });
});

// ── W / Z: the two files, read back with independent readers ────────────────

/** A month with every kind of day, for the file tests. */
function richFacts(): ReportSourceFacts {
  let f = facts(
    {
      employees: [
        employee('u1', 'Ajay Singh'),
        employee('u2', '=HYPERLINK("http://x")', { department: 'Sales, "North"\nZone', joiningDate: '2026-09-10' }),
        employee('u3', 'Meera Iyer'),
      ],
      meetings: [meeting('m1', '15:00', '16:00', 'REJECTED'), meeting('m2', '11:00', '12:00', 'PENDING')],
      compOff: [{ userId: 'u3', earnedFromBusinessDate: '2026-09-11', creditMinutes: 180, status: 'AVAILABLE' }],
      corrections: [correction('PENDING', { userId: 'u3', businessDate: '2026-09-14' })],
    },
    ['u1', 'u3'],
  );
  f = { ...f, official: [...f.official, ...workingDates().filter((d) => d >= '2026-09-10').map((d) => official('u2', d))] };
  f = withDay(f, 'u1', '2026-09-02', { status: 'LATE', lateMinutes: 12, punchInAt: ist('2026-09-02', '09:42'), punchOutAt: ist('2026-09-02', '17:42') });
  f = withDay(f, 'u1', '2026-09-03', { status: 'HALF_DAY', calculationReason: 'HALF_DAY', punchOutAt: ist('2026-09-03', '14:00') });
  f = withDay(f, 'u1', '2026-09-04', { status: 'ABSENT', punchInAt: null, punchOutAt: null, workedMinutes: 0 });
  f = withDay(f, 'u3', '2026-09-14', { status: 'ABSENT', punchInAt: null, punchOutAt: null, workedMinutes: 0 });
  f = withDay(f, 'u3', '2026-09-16', null);
  return f;
}

/**
 * Cached formula values, read from the sheet XML itself.
 *
 * ExcelJS's reader drops a cached <v>0</v> and an empty string alike (it tests
 * the text for truthiness), so the cached values are taken from the file the
 * way Excel reads them.
 */
const CACHED = new WeakMap<ExcelJS.Workbook, Map<string, Map<string, { t: string | null; v: string | null }>>>();

async function loadWorkbook(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const zip = await JSZip.loadAsync(buffer);
  const bySheet = new Map<string, Map<string, { t: string | null; v: string | null }>>();
  for (const [i, ws] of wb.worksheets.entries()) {
    const xml: string = await zip.file(`xl/worksheets/sheet${i + 1}.xml`).async('string');
    const cells = new Map<string, { t: string | null; v: string | null }>();
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*)><f>[^<]*<\/f>(?:<v>([^<]*)<\/v>|<v\/>)?<\/c>/g)) {
      const t = /t="(\w+)"/.exec(m[2])?.[1] ?? null;
      cells.set(m[1], { t, v: m[3] ?? null });
    }
    bySheet.set(ws.name, cells);
  }
  CACHED.set(wb, bySheet);
  return wb;
}

async function readWorkbook(report: MonthlyAttendanceReport) {
  return loadWorkbook(await monthlyAttendanceWorkbookBuffer(report));
}

/** A cell as Excel shows it before any recalculation: a formula's cached value. */
function evaluated(cell: ExcelJS.Cell): unknown {
  const v: any = cell.value;
  if (v && typeof v === 'object' && 'formula' in v) {
    const cached = CACHED.get(cell.worksheet.workbook)?.get(cell.worksheet.name)?.get(cell.address);
    if (!cached || cached.v === null) return undefined;
    return cached.t === 'str' ? cached.v : Number(cached.v);
  }
  return v;
}

function sheetRows(sheet: ExcelJS.Worksheet, columns: readonly { header: string }[]) {
  const out: unknown[][] = [];
  for (let r = FIRST_DATA_ROW; r <= sheet.rowCount; r++) {
    out.push(columns.map((_, c) => evaluated(sheet.getRow(r).getCell(c + 1))));
  }
  return out;
}

async function readZip(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const files: Record<string, string> = {};
  for (const name of Object.keys(zip.files)) files[name] = await zip.files[name].async('string');
  return files;
}

/** RFC 4180 parse, enough for the files under test. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** A workbook value written as the CSV writes the same report value. */
function asCsvText(type: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'date' && value instanceof Date) return value.toISOString().slice(0, 10);
  if (type === 'time' && value instanceof Date) {
    return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
  }
  if (type === 'time' && typeof value === 'number') {
    const minutes = Math.round(value * 24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  return formatCell(type as any, value as any);
}

describe('W. the Excel workbook', () => {
  const report = assembleMonthlyAttendanceReport(richFacts());

  it('W1. exactly two sheets: Daily Attendance and Monthly Summary', async () => {
    const wb = await readWorkbook(report);
    expect(wb.worksheets.map((w) => w.name)).toEqual([DAILY_SHEET_NAME, MONTHLY_SHEET_NAME]);
  });

  it('W2. the headers are exactly the agreed columns; removed columns never appear', async () => {
    const wb = await readWorkbook(report);
    const headers = (s: ExcelJS.Worksheet, n: number) => Array.from({ length: n }, (_, i) => String(s.getRow(HEADER_ROW).getCell(i + 1).value));
    const daily = headers(wb.getWorksheet(DAILY_SHEET_NAME)!, DAILY_COLUMNS.length);
    const monthly = headers(wb.getWorksheet(MONTHLY_SHEET_NAME)!, MONTHLY_COLUMNS.length);
    expect(daily).toEqual(DAILY_COLUMNS.map((c) => c.header));
    expect(monthly).toEqual(MONTHLY_COLUMNS.map((c) => c.header));
    expect(wb.getWorksheet(DAILY_SHEET_NAME)!.getRow(HEADER_ROW).getCell(DAILY_COLUMNS.length + 1).value).toBeNull();
    for (const removed of REMOVED_COLUMN_HEADERS) {
      expect(daily).not.toContain(removed);
      expect(monthly).not.toContain(removed);
    }
    // No internal ids anywhere in the headers.
    expect([...daily, ...monthly].some((h) => /user ?id|uuid|database/i.test(h))).toBe(false);
  });

  it('W3. monthly formulas reference the Daily rows and cache the same result as the report', async () => {
    const wb = await readWorkbook(report);
    const sheet = wb.getWorksheet(MONTHLY_SHEET_NAME)!;
    report.monthlySummaryRows.forEach((row, i) => {
      for (const key of FORMULA_KEYS) {
        const col = MONTHLY_COLUMNS.findIndex((c) => c.key === key) + 1;
        const cell: any = sheet.getRow(FIRST_DATA_ROW + i).getCell(col).value;
        expect(cell && typeof cell === 'object' && 'formula' in cell).toBe(true);
        if (cell.formula.includes(`'${DAILY_SHEET_NAME}'!`)) {
          // Counted from exactly this employee's Daily rows.
          expect(cell.formula).toContain(`$${FIRST_DATA_ROW + row.dailyRange.first}:`);
          expect(cell.formula).toContain(`$${FIRST_DATA_ROW + row.dailyRange.last}`);
        } else {
          // Derived from other summary cells on the same row.
          expect(cell.formula).toMatch(new RegExp(`[A-Z]+${FIRST_DATA_ROW + i}\\b`));
        }
        const cachedValue = evaluated(sheet.getRow(FIRST_DATA_ROW + i).getCell(col));
        expect([key, cachedValue === '' ? null : cachedValue]).toEqual([key, row.values[key]]);
      }
    });
  });

  it('W3b. every formula carries its cached value in the file itself, zeros included', async () => {
    const zip = await JSZip.loadAsync(await monthlyAttendanceWorkbookBuffer(report));
    const xml: string = await zip.file('xl/worksheets/sheet2.xml').async('string');
    const formulaCells = [...xml.matchAll(/<c [^>]*>(<f>[^<]*<\/f>)(<v>[^<]*<\/v>)?<\/c>/g)];
    expect(formulaCells.length).toBe(report.monthlySummaryRows.length * FORMULA_KEYS.length);
    const withValue = formulaCells.filter((m) => m[2]);
    const nullResults = report.monthlySummaryRows.reduce(
      (n, r) => n + FORMULA_KEYS.filter((k) => r.values[k] === null).length,
      0,
    );
    // A null result (blank %) is written as an empty string value; everything else is a number.
    expect(withValue.length + nullResults).toBeGreaterThanOrEqual(formulaCells.length);
    expect(xml).toMatch(/<v>0<\/v>/);
  });

  it('W4. frozen header, filters, real numbers and percentages', async () => {
    const wb = await readWorkbook(report);
    for (const s of wb.worksheets) {
      expect(s.views[0]).toMatchObject({ state: 'frozen', ySplit: HEADER_ROW });
      expect(s.autoFilter).toBeTruthy();
    }
    const monthly = wb.getWorksheet(MONTHLY_SHEET_NAME)!;
    const pctCol = MONTHLY_COLUMNS.findIndex((c) => c.key === 'attendancePercent') + 1;
    const cell = monthly.getRow(FIRST_DATA_ROW).getCell(pctCol);
    expect(cell.numFmt).toBe('0.00%');
    expect(typeof evaluated(cell)).toBe('number');
  });

  it('W5. an unresolved employee has a blank percentage, never 0%', async () => {
    const wb = await readWorkbook(report);
    const monthly = wb.getWorksheet(MONTHLY_SHEET_NAME)!;
    const i = report.monthlySummaryRows.findIndex((r) => r.userId === 'u3');
    const pctCol = MONTHLY_COLUMNS.findIndex((c) => c.key === 'attendancePercent') + 1;
    expect(report.monthlySummaryRows[i].values.attendancePercent).toBeNull();
    expect(evaluated(monthly.getRow(FIRST_DATA_ROW + i).getCell(pctCol)) ?? '').toBe('');
  });

  it('W6. the generated-at time is file metadata, not a column', async () => {
    const wb = await readWorkbook(report);
    expect(wb.created?.toISOString()).toBe(report.metadata.generatedAt.toISOString());
    expect(DAILY_COLUMNS.some((c) => /generated/i.test(c.header))).toBe(false);
  });
});

describe('Z. the CSV package', () => {
  const report = assembleMonthlyAttendanceReport(richFacts());

  it('Z1. one ZIP with exactly the two named CSV files', async () => {
    const files = await readZip(csvPackage(report));
    expect(Object.keys(files).sort()).toEqual([dailyCsvName('September 2026'), monthlyCsvName('September 2026')].sort());
    expect(dailyCsvName('September 2026')).toBe('Daily_Attendance_September_2026.csv');
    expect(monthlyCsvName('September 2026')).toBe('Monthly_Summary_September_2026.csv');
  });

  it('Z2. UTF-8 BOM, CRLF, RFC 4180 quoting', async () => {
    const files = await readZip(csvPackage(report));
    const daily = files[dailyCsvName('September 2026')];
    expect(daily.charCodeAt(0)).toBe(0xfeff);
    expect(daily).toContain('\r\n');
    expect(daily).toContain('"Sales, ""North""\nZone"');
  });

  it('Z3. a formula-looking name is neutralised in the CSV', async () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    const files = await readZip(csvPackage(report));
    const rows = parseCsv(files[monthlyCsvName('September 2026')].slice(1));
    expect(rows.some((r) => r[1] === `'=HYPERLINK("http://x")`)).toBe(true);
  });

  it('Z4. every CSV cell equals the matching Excel cell, for both sheets', async () => {
    const wb = await readWorkbook(report);
    const files = await readZip(csvPackage(report));
    for (const [sheetName, fileName, columns] of [
      [DAILY_SHEET_NAME, dailyCsvName('September 2026'), DAILY_COLUMNS],
      [MONTHLY_SHEET_NAME, monthlyCsvName('September 2026'), MONTHLY_COLUMNS],
    ] as const) {
      const csv = parseCsv(files[fileName].slice(1));
      expect(csv[0]).toEqual(columns.map((c) => c.header));
      const excel = sheetRows(wb.getWorksheet(sheetName)!, columns);
      expect(csv.length - 1).toBe(excel.length);
      excel.forEach((row, r) => {
        row.forEach((value, c) => {
          const col = columns[c];
          const csvText = csv[r + 1][c].replace(/^'(?=[=+\-@])/, '');
          expect([sheetName, r, col.header, csvText]).toEqual([sheetName, r, col.header, asCsvText(col.type, value)]);
        });
      });
    }
  });

  it('Z5. two renders of one report are byte-identical', () => {
    expect(csvPackage(report).equals(csvPackage(report))).toBe(true);
  });
});

// ── S / P: the service -- scope, parity with the screen, query shape ─────────

const tva = () => new TVAService({ get: () => undefined } as unknown as ConfigService);

function serviceRig(opts: { users?: any[]; official?: any[]; sessions?: any[]; punches?: any[]; scope?: { isHr: boolean; userIds: string[] | null }; eligible?: boolean; department?: any } = {}) {
  const users = opts.users ?? [
    { id: 'u1', name: 'Ajay Singh', employeeId: 'TE-1', designation: 'Associate', employmentType: 'FULL_TIME', joiningDate: new Date('2025-01-01T00:00:00Z'), lastWorkingDate: null, isActive: true, avatar: null, photoUrl: null, department: { name: 'Operations' } },
  ];
  const calls: string[] = [];
  const track = (name: string, value: any) => jest.fn((args: any) => { calls.push(name); (track as any).last = { ...(track as any).last, [name]: args }; return Promise.resolve(typeof value === 'function' ? value(args) : value); });
  const prisma: any = {
    user: { findMany: track('user', (args: any) => { const ids = args?.where?.id?.in; return ids ? users.filter((u) => ids.includes(u.id)) : users; }) },
    department: { findUnique: track('department', opts.department === undefined ? { name: 'Operations' } : opts.department) },
    employeeAttendanceProfile: { findMany: track('profiles', []) },
    dailyAttendance: { findMany: track('official', opts.official ?? []) },
    attendanceRegularization: { findMany: track('corrections', []) },
    compOffCredit: { findMany: track('compOff', []) },
    workSession: { findMany: track('sessions', opts.sessions ?? []) },
    attendancePunchEvidence: { findMany: track('punches', opts.punches ?? []) },
    leaveRequest: { findMany: track('leaves', []) },
  };
  prisma.$transaction = jest.fn((fn: any, options: any) => { calls.push(`tx:${options?.isolationLevel}`); return fn(prisma); });
  const scope = opts.scope ?? { isHr: true, userIds: null };
  const consoleService: any = {
    resolveScope: jest.fn().mockResolvedValue(scope),
    assertEligibleScope: jest.fn(() => { if (opts.eligible === false) throw new ForbiddenException('Attendance console is for HR and managers'); return scope; }),
    leaveBalances: jest.fn(async (ids: string[]) => ({ financialYear: '2026-2027', byUser: new Map(ids.map((id) => [id, 4])) })),
    registerDevices: jest.fn().mockResolvedValue([]),
  };
  const calendarService: any = {
    classifyMonth: jest.fn(async () => ({ month: MONTH, workingDays: 25, sources: { weeklyOffPolicy: 'COMPANY_DEFAULT', holidayCalendar: 'COMPANY_DEFAULT' }, days: calendar() })),
  };
  const audit: any[] = [];
  const service = new MonthlyAttendanceReportService(
    prisma,
    tva(),
    consoleService,
    calendarService,
    { log: jest.fn((e: any) => { audit.push(e); return Promise.resolve(); }) } as any,
    { isHrOrAdmin: () => scope.isHr } as any,
  );
  return { service, prisma, calls, consoleService, audit };
}

const storedDay = (userId: string, date: string, over: any = {}) => ({
  userId,
  date: new Date(`${date}T00:00:00.000Z`),
  status: 'PRESENT',
  evaluationState: 'FINALIZED',
  calculationReason: 'COMPLETE_WORKDAY',
  exceptionFlags: [],
  punchInAt: ist(date, '09:30'),
  punchOutAt: ist(date, '18:45'),
  workedMinutes: 525,
  breakMinutes: 30,
  lateMinutes: 0,
  leaveDeducted: 0,
  lwpDeducted: 0,
  revision: 0,
  lastRegularizationId: null,
  leaveRequestId: null,
  ...over,
});

describe('S. scope and validation', () => {
  it('S1. an ineligible caller is refused before any attendance is read', async () => {
    const { service, prisma } = serviceRig({ eligible: false });
    await expect(service.export({ id: 'emp' }, { month: MONTH }, 'xlsx')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.export({ id: 'emp' }, { month: MONTH }, 'zip')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.register({ id: 'emp' }, { month: MONTH })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.dailyAttendance.findMany).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('S2. a department filter narrows a manager scope; it never replaces it', async () => {
    const { service, prisma } = serviceRig({ scope: { isHr: false, userIds: ['u1'] } });
    await service.build({ id: 'mgr' }, { month: MONTH, departmentId: 'dept-sales' });
    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(where.id).toEqual({ in: ['u1'] });
    expect(where.departmentId).toBe('dept-sales');
    expect(where.isSystemAccount).toBe(false);
  });

  it('S3. an unknown department, a malformed or future month, or a partial range is a 400', async () => {
    await expect(serviceRig({ department: null }).service.build({ id: 'hr' }, { month: MONTH, departmentId: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
    const { service } = serviceRig();
    for (const bad of [{ month: '2026-9' }, { month: '2026-13' }, { month: '2099-01' }, { from: '2026-09-01', to: '2026-09-15' }, { from: 'x', to: 'y' }, { month: MONTH, departmentId: 'x'.repeat(65) }]) {
      await expect(service.build({ id: 'hr' }, bad as any)).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('S4. every fact is read in one repeatable-read snapshot', async () => {
    const { service, calls } = serviceRig();
    await service.build({ id: 'hr' }, { month: MONTH });
    expect(calls[0]).toBe('tx:RepeatableRead');
  });

  it('S5. an export is audited with counts only', async () => {
    const { service, audit } = serviceRig({ official: workingDates().map((d) => storedDay('u1', d)) });
    await service.export({ id: 'hr' }, { month: MONTH }, 'zip');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'EXPORT_PERFORMED', metadata: { month: MONTH, format: 'zip', employees: 1 } });
    expect(JSON.stringify(audit[0])).not.toMatch(/Ajay|09:30|PRESENT/);
  });
});

describe('P. one answer on the screen, in Excel and in the CSV', () => {
  const PARITY_KEYS: Array<[string, string, string]> = [
    // screen field             Monthly Summary key   header
    ['daysPresent', 'presentDays', 'Present Days'],
    ['daysAbsent', 'absentDays', 'Absent Days'],
    ['halfDays', 'halfDays', 'Half Days'],
    ['leaveDays', 'leaveDays', 'Leave Days'],
    ['latePunchIns', 'lateDays', 'Late Days'],
    ['daysBelowNineHours', 'daysBelowNineHours', ''],
    ['approvedCompOff', 'approvedCompOff', ''],
    ['unresolvedDays', 'unresolvedDays', ''],
    ['attendanceCompletionPercentage', 'attendancePercent', ''],
    ['provisional', 'provisional', ''],
  ];

  async function threeWays(official: any[], users?: any[]) {
    const { service } = serviceRig({ official, users });
    const screen = await service.register({ id: 'hr' }, { month: MONTH });
    const xlsx = await service.export({ id: 'hr' }, { month: MONTH }, 'xlsx');
    const zip = await service.export({ id: 'hr' }, { month: MONTH }, 'zip');
    const wb = await loadWorkbook(xlsx.buffer);
    const excel = sheetRows(wb.getWorksheet(MONTHLY_SHEET_NAME)!, MONTHLY_COLUMNS);
    const files = await readZip(zip.buffer);
    const csv = parseCsv(files[monthlyCsvName('September 2026')].slice(1)).slice(1);
    return { screen, excel, csv };
  }

  const col = (key: string) => MONTHLY_COLUMNS.findIndex((c) => c.key === key);

  function expectParity(screen: any, excel: unknown[][], csv: string[][]) {
    expect(screen.employees).toHaveLength(excel.length);
    expect(csv).toHaveLength(excel.length);
    screen.employees.forEach((e: any, i: number) => {
      expect(excel[i][col('employeeName')]).toBe(e.name);
      for (const [screenKey, key] of PARITY_KEYS) {
        const type = MONTHLY_COLUMNS[col(key)].type;
        const x = excel[i][col(key)];
        const fromExcel = x === '' || x === undefined ? null : x;
        let fromScreen: unknown = e[screenKey];
        if (key === 'attendancePercent') fromScreen = fromScreen === null ? null : Number(((fromScreen as number) / 100).toFixed(4));
        if (key === 'provisional') fromScreen = fromScreen ? 'Yes' : 'No';
        expect([key, fromScreen]).toEqual([key, fromExcel]);
        expect([key, csv[i][col(key)]]).toEqual([key, asCsvText(type, fromExcel)]);
      }
    });
  }

  it('P1. a settled month: identical Present, Absent, Half, Leave, Late, Below 9h, Comp off, Unresolved, % and Provisional', async () => {
    const official = workingDates().map((d) => storedDay('u1', d));
    official[1] = storedDay('u1', workingDates()[1], { status: 'LATE', lateMinutes: 15, punchInAt: ist(workingDates()[1], '09:45'), punchOutAt: ist(workingDates()[1], '17:00') });
    official[2] = storedDay('u1', workingDates()[2], { status: 'HALF_DAY', calculationReason: 'HALF_DAY' });
    official[3] = storedDay('u1', workingDates()[3], { status: 'ABSENT', punchInAt: null, punchOutAt: null });
    official[4] = storedDay('u1', workingDates()[4], { status: 'LEAVE', punchInAt: null, punchOutAt: null });
    const { screen, excel, csv } = await threeWays(official);
    expect(screen.employees[0]).toMatchObject({ daysPresent: 22, daysAbsent: 1, halfDays: 1, leaveDays: 1, latePunchIns: 1, daysBelowNineHours: 1, unresolvedDays: 0, provisional: false });
    expect(screen.employees[0].attendanceCompletionPercentage).toBe(93.75);
    expectParity(screen, excel, csv);
  });

  it('P2. missing records are unresolved on all three, never zeros that look like absence', async () => {
    const official = workingDates().slice(0, 10).map((d) => storedDay('u1', d));
    const { screen, excel, csv } = await threeWays(official);
    expect(screen.employees[0]).toMatchObject({ daysPresent: 10, daysAbsent: 0, unresolvedDays: 15, attendanceCompletionPercentage: null, provisional: true });
    expectParity(screen, excel, csv);
  });

  it('P3. a corrected official row reaches the screen and both files on the next read', async () => {
    const before = workingDates().map((d) => storedDay('u1', d));
    before[5] = storedDay('u1', workingDates()[5], { status: 'ABSENT', punchInAt: null, punchOutAt: null });
    const first = await threeWays(before);
    expect(first.screen.employees[0].daysAbsent).toBe(1);

    // The correction was applied: the evaluator revised the official row.
    const after = [...before];
    after[5] = storedDay('u1', workingDates()[5], { revision: 1, lastRegularizationId: 'reg-1' });
    const second = await threeWays(after);
    expect(second.screen.employees[0]).toMatchObject({ daysAbsent: 0, daysPresent: 25 });
    expectParity(second.screen, second.excel, second.csv);
    // And the earlier download is untouched: it was a snapshot of its moment.
    expect(first.excel[0][col('absentDays')]).toBe(1);
  });
});

describe('Q. query shape and performance', () => {
  function people(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: `u${i}`,
      name: `Employee ${String(i).padStart(4, '0')}`,
      employeeId: `TE-${i}`,
      designation: 'Associate',
      employmentType: 'FULL_TIME',
      joiningDate: new Date('2025-01-01T00:00:00Z'),
      lastWorkingDate: null,
      isActive: true,
      avatar: null,
      photoUrl: null,
      department: { name: 'Operations' },
    }));
  }

  it('Q1. the number of queries does not grow with the number of employees', async () => {
    const small = serviceRig({ users: people(3) });
    await small.service.build({ id: 'hr' }, { month: MONTH });
    const large = serviceRig({ users: people(300) });
    await large.service.build({ id: 'hr' }, { month: MONTH });
    expect(large.calls.length).toBe(small.calls.length);
    // One transaction, one population query, then the batched fact reads.
    expect(small.calls.filter((c) => c === 'user')).toHaveLength(1);
    expect(small.calls.filter((c) => c === 'official')).toHaveLength(1);
  });

  it('Q2. 250 employees x 30 days assembles and encodes both files in bounded time and memory', async () => {
    // Kept to 250 so the unit suite fits a parallel jest worker; the 1,000-
    // employee figures are measured separately and recorded in the report.
    const users = people(250);
    const official = users.flatMap((u) => workingDates().map((d) => storedDay(u.id, d)));
    const { service } = serviceRig({ users, official });
    const heapBefore = process.memoryUsage().heapUsed;
    const t0 = Date.now();
    const report = await service.build({ id: 'hr' }, { month: MONTH });
    const t1 = Date.now();
    const xlsx = await monthlyAttendanceWorkbookBuffer(report);
    const t2 = Date.now();
    const zip = csvPackage(report);
    const t3 = Date.now();
    const heapDelta = process.memoryUsage().heapUsed - heapBefore;
    // Printed for the record; the bounds below are deliberately generous for CI.
    // eslint-disable-next-line no-console
    console.log(
      `[perf] 250x30: rows=${report.dailyRows.length} assemble=${t1 - t0}ms xlsx=${t2 - t1}ms (${xlsx.length} B) zip=${t3 - t2}ms (${zip.length} B) heapDelta=${Math.round(heapDelta / 1048576)}MB`,
    );
    expect(report.dailyRows).toHaveLength(7500);
    expect(t1 - t0).toBeLessThan(5000);
    expect(t2 - t1).toBeLessThan(30000);
    expect(t3 - t2).toBeLessThan(5000);
  }, 60000);
});

// ── E: recorded punches on a working day with no official result ────────────

describe('E. evidence on an unresolved working day', () => {
  const D = '2026-09-03';
  const D2 = '2026-09-04';
  const punch = (type: string, date: string, hhmm: string, userId = 'u1') => ({ userId, businessDate: date, type, at: ist(date, hhmm) });
  const session = (date: string, from: string, to: string | null, work: number, brk = 0, userId = 'u1') => ({
    userId,
    businessDate: date,
    startWorkAt: ist(date, from),
    logoutAt: to ? ist(date, to) : null,
    totalWorkMinutes: work,
    totalBreakMinutes: brk,
  });
  const unresolved = (over: Partial<ReportSourceFacts> = {}) =>
    assembleMonthlyAttendanceReport({ ...withDay(facts(), 'u1', D, null), ...over } as ReportSourceFacts);

  const expectUnresolved = (d: Record<string, unknown>) => {
    expect(d).toMatchObject({ attendanceStatus: DAY_STATES.NEEDS_REVIEW, present: 0, absent: 0, halfDay: 0, leave: 0, hrReview: 'Not Evaluated - Review Required' });
    expect(d.lateArrival).toBeNull();
    expect(d.nineHourCompletion).toBeNull();
  };

  it('E1. punch-in and punch-out are shown, presence is their span, and the day stays unresolved', () => {
    const r = unresolved({
      punches: [punch('PUNCH_IN', D, '09:40'), punch('PUNCH_OUT', D, '18:10')],
      sessions: [session(D, '09:40', '18:10', 480, 30)],
    });
    const d = day(r, 'u1', D);
    expectUnresolved(d);
    expect(d).toMatchObject({ punchIn: '09:40', punchOut: '18:10', presenceHours: 8.5, workHours: 8, breakHours: 0.5, missingPunch: '' });
    expect(String(d.remarks)).toContain('not an official result');
    expect(r.dailyRows.find((x) => x.businessDate === D)!.unresolved).toBe(true);
  });

  it('E2. punch-in only: shown, no presence, Punch-out missing', () => {
    const d = day(unresolved({ punches: [punch('PUNCH_IN', D, '09:15')] }), 'u1', D);
    expectUnresolved(d);
    expect(d).toMatchObject({ punchIn: '09:15', punchOut: null, presenceHours: null, missingPunch: 'Punch-out missing' });
  });

  it('E3. punch-out only: shown, no presence, Punch-in missing', () => {
    const d = day(unresolved({ punches: [punch('PUNCH_OUT', D, '19:05')] }), 'u1', D);
    expectUnresolved(d);
    expect(d).toMatchObject({ punchIn: null, punchOut: '19:05', presenceHours: null, missingPunch: 'Punch-in missing' });
  });

  it('E4. no evidence at all: blank times, No punch recorded', () => {
    const d = day(unresolved(), 'u1', D);
    expectUnresolved(d);
    expect(d).toMatchObject({ punchIn: null, punchOut: null, presenceHours: null, workHours: null, breakHours: null, missingPunch: 'No punch recorded' });
    expect(String(d.remarks)).not.toContain('recorded punches');
  });

  it('E5. several punches and sessions: the earliest punch-in and the final punch-out', () => {
    const r = unresolved({
      punches: [punch('PUNCH_IN', D, '13:30'), punch('PUNCH_OUT', D, '12:30'), punch('PUNCH_IN', D, '09:05'), punch('PUNCH_OUT', D, '18:50')],
      sessions: [session(D, '09:05', '12:30', 205, 10), session(D, '13:30', '18:50', 300, 20)],
    });
    expect(day(r, 'u1', D)).toMatchObject({ punchIn: '09:05', punchOut: '18:50', presenceHours: 9.75, workHours: 8.42, breakHours: 0.5 });
  });

  it('E6. with no raw punches the work sessions supply the times', () => {
    const r = unresolved({ sessions: [session(D, '10:00', '14:00', 230, 10), session(D, '15:00', '19:00', 240, 0)] });
    expect(day(r, 'u1', D)).toMatchObject({ punchIn: '10:00', punchOut: '19:00', presenceHours: 9, workHours: 7.83, missingPunch: '' });
    // An open session has started but not ended: its start is shown, its end is not invented.
    const open = day(unresolved({ sessions: [session(D, '09:30', null, 0)] }), 'u1', D);
    expect(open).toMatchObject({ punchIn: '09:30', punchOut: null, workHours: null, missingPunch: 'Punch-out missing' });
  });

  it('E7. an official row is authoritative: raw evidence never overrides it', () => {
    const f = withDay(facts(), 'u1', D, { status: 'ABSENT', punchInAt: null, punchOutAt: null, workedMinutes: 0, breakMinutes: 0 });
    const r = assembleMonthlyAttendanceReport({ ...f, punches: [punch('PUNCH_IN', D, '09:00'), punch('PUNCH_OUT', D, '18:00')] });
    expect(day(r, 'u1', D)).toMatchObject({ attendanceStatus: DAY_STATES.ABSENT, absent: 1, punchIn: null, punchOut: null });
    const present = assembleMonthlyAttendanceReport({ ...facts(), punches: [punch('PUNCH_IN', D, '07:00')] });
    expect(day(present, 'u1', D)).toMatchObject({ attendanceStatus: DAY_STATES.PRESENT, punchIn: '09:30', punchOut: '18:45' });
  });

  it('E8. an applied regularization is authoritative over the original evidence', () => {
    const f = {
      ...withDay(facts(), 'u1', '2026-09-09', { revision: 2, lastRegularizationId: 'reg-1', punchInAt: ist('2026-09-09', '09:30'), punchOutAt: ist('2026-09-09', '18:45') }),
      corrections: [correction('APPROVED', { applicationStatus: 'APPLIED' })],
      punches: [punch('PUNCH_IN', '2026-09-09', '09:30')],
    };
    expect(day(assembleMonthlyAttendanceReport(f), 'u1', '2026-09-09')).toMatchObject({
      attendanceStatus: DAY_STATES.PRESENT,
      punchOut: '18:45',
      regularized: 'Yes',
      missingPunch: '',
    });
  });

  it('E9. holiday and weekly-off evidence behaves exactly as before', () => {
    const r = assembleMonthlyAttendanceReport(facts({ punches: [punch('PUNCH_IN', HOLIDAY, '10:00')] }));
    expect(day(r, 'u1', HOLIDAY)).toMatchObject({ attendanceStatus: DAY_STATES.HOLIDAY_WORKED, punchIn: '10:00', punchOut: null, workHours: 0, breakHours: 0, missingPunch: 'Punch-out missing' });
    const off = assembleMonthlyAttendanceReport(facts());
    expect(day(off, 'u1', SUNDAYS[0])).toMatchObject({ attendanceStatus: DAY_STATES.WEEKLY_OFF, punchIn: null, missingPunch: '' });
    expect(summary(off).missingPunch).toBe('0');
  });

  it('E10. evidence is grouped by company business date and shown in company time', async () => {
    // 00:20 IST on the 3rd is 18:50 UTC on the 2nd: it belongs to the 3rd.
    const at = ist(D, '00:20');
    expect(at.toISOString().slice(0, 10)).toBe('2026-09-02');
    const official = workingDates().filter((d) => d !== D).map((d) => storedDay('u1', d));
    const { service } = serviceRig({
      official,
      punches: [{ userId: 'u1', businessDate: new Date(`${D}T00:00:00.000Z`), type: 'PUNCH_IN', serverOccurredAt: at }],
    });
    const { report } = await (service as any).snapshot({ id: 'hr' }, { month: MONTH });
    expect(day(report, 'u1', D)).toMatchObject({ punchIn: '00:20', attendanceStatus: DAY_STATES.NEEDS_REVIEW });
    expect(day(report, 'u1', '2026-09-02').punchIn).toBe('09:30');
  });

  it('E11. work time that was never recorded is blank, never 0.00', async () => {
    const r = unresolved({ punches: [punch('PUNCH_IN', D, '09:00'), punch('PUNCH_OUT', D, '18:00')] });
    const d = day(r, 'u1', D);
    expect(d.presenceHours).toBe(9);
    expect(d.workHours).toBeNull();
    expect(d.breakHours).toBeNull();
    const files = await readZip(csvPackage(r));
    const rows = parseCsv(files[dailyCsvName('September 2026')].slice(1));
    const header = rows[0];
    const row = rows.find((x) => x[header.indexOf('Date')] === D)!;
    expect(row[header.indexOf(DAILY_COLUMNS.find((c) => c.key === 'workHours')!.header)]).toBe('');
  });

  it('E12. the Monthly Summary still counts every unresolved day, with or without evidence', () => {
    let f: ReportSourceFacts = withDay(withDay(facts(), 'u1', D, null), 'u1', D2, null);
    f = { ...f, punches: [punch('PUNCH_IN', D, '09:00'), punch('PUNCH_OUT', D, '18:00')] };
    const s = summary(assembleMonthlyAttendanceReport(f));
    expect(s).toMatchObject({ unresolvedDays: 2, presentDays: 23, absentDays: 0, provisional: 'Yes' });
    expect(s.missingPunch).toBe('1: 04 Sep (No punch recorded)');
  });

  it('E13. Attendance % stays unavailable while an eligible day is unresolved, evidence or not', () => {
    const s = summary(unresolved({ punches: [punch('PUNCH_IN', D, '09:00'), punch('PUNCH_OUT', D, '18:30')] }));
    expect(s.attendancePercent).toBeNull();
    // The unresolved day is not in the denominator; it is not scored either way.
    expect(s.eligibleWorkingDays).toBe(24);
    expect(s.unresolvedDays).toBe(1);
  });

  it('E14. the screen, the Excel Daily and Monthly sheets and both CSVs carry the same evidence values', async () => {
    const official = workingDates().filter((d) => d !== D && d !== D2).map((d) => storedDay('u1', d));
    const { service } = serviceRig({
      official,
      punches: [
        { userId: 'u1', businessDate: new Date(`${D}T00:00:00.000Z`), type: 'PUNCH_IN', serverOccurredAt: ist(D, '09:10') },
        { userId: 'u1', businessDate: new Date(`${D}T00:00:00.000Z`), type: 'PUNCH_OUT', serverOccurredAt: ist(D, '18:40') },
        { userId: 'u1', businessDate: new Date(`${D2}T00:00:00.000Z`), type: 'PUNCH_IN', serverOccurredAt: ist(D2, '09:55') },
      ],
      sessions: [{ userId: 'u1', date: new Date(`${D}T00:00:00.000Z`), startWorkAt: ist(D, '09:10'), logoutAt: ist(D, '18:40'), totalWorkMinutes: 510, totalBreakMinutes: 20, breakLogs: [] }],
    });
    const screen = await service.register({ id: 'hr' }, { month: MONTH });
    const xlsx = await service.export({ id: 'hr' }, { month: MONTH }, 'xlsx');
    const zip = await service.export({ id: 'hr' }, { month: MONTH }, 'zip');
    const wb = await loadWorkbook(xlsx.buffer);
    const daily = sheetRows(wb.getWorksheet(DAILY_SHEET_NAME)!, DAILY_COLUMNS);
    const monthly = sheetRows(wb.getWorksheet(MONTHLY_SHEET_NAME)!, MONTHLY_COLUMNS);
    const files = await readZip(zip.buffer);
    const dailyCsv = parseCsv(files[dailyCsvName('September 2026')].slice(1)).slice(1);
    const monthlyCsv = parseCsv(files[monthlyCsvName('September 2026')].slice(1)).slice(1);

    const dc = (key: string) => DAILY_COLUMNS.findIndex((c) => c.key === key);
    const mc = (key: string) => MONTHLY_COLUMNS.findIndex((c) => c.key === key);
    const typeOf = (key: string) => DAILY_COLUMNS[dc(key)].type;
    const asText = (key: string, v: unknown) => asCsvText(typeOf(key), v);
    for (const [date, expected] of [
      [D, { punchIn: '09:10', punchOut: '18:40', presenceHours: '9.50', workHours: '8.50', missingPunch: '' }],
      [D2, { punchIn: '09:55', punchOut: '', presenceHours: '', workHours: '', missingPunch: 'Punch-out missing' }],
    ] as const) {
      const x = daily.find((r) => asText('date', r[dc('date')]) === date)!;
      const c = dailyCsv.find((r) => r[dc('date')] === date)!;
      expect(x[dc('attendanceStatus')]).toBe(DAY_STATES.NEEDS_REVIEW);
      expect(c[dc('attendanceStatus')]).toBe(DAY_STATES.NEEDS_REVIEW);
      for (const [key, value] of Object.entries(expected)) {
        expect([date, key, 'xlsx', asText(key, x[dc(key)])]).toEqual([date, key, 'xlsx', value]);
        expect([date, key, 'csv', c[dc(key)]]).toEqual([date, key, 'csv', value]);
      }
    }
    expect(screen.employees[0]).toMatchObject({ unresolvedDays: 2, daysPresent: 23, daysAbsent: 0, attendanceCompletionPercentage: null, provisional: true });
    expect(monthly[0][mc('unresolvedDays')]).toBe(2);
    expect(monthlyCsv[0][mc('unresolvedDays')]).toBe('2');
    expect(monthly[0][mc('missingPunch')]).toBe('1: 04 Sep (Punch-out missing)');
    expect(monthlyCsv[0][mc('missingPunch')]).toBe('1: 04 Sep (Punch-out missing)');
  });

  it('E15. the CSV download is a ZIP with the agreed name, type and two entries', async () => {
    const { service } = serviceRig({ official: workingDates().map((d) => storedDay('u1', d)) });
    const zip = await service.export({ id: 'hr' }, { month: '2026-09' }, 'zip');
    expect(zip.contentType).toBe('application/zip');
    expect(zip.filename).toBe('Attendance_Report_September_2026_CSV.zip');
    expect(zip.buffer.subarray(0, 2).toString('latin1')).toBe('PK');
    const files = await readZip(zip.buffer);
    expect(Object.keys(files).sort()).toEqual(['Daily_Attendance_September_2026.csv', 'Monthly_Summary_September_2026.csv']);
    const xlsx = await service.export({ id: 'hr' }, { month: '2026-09' }, 'xlsx');
    expect(xlsx.filename).toBe('Attendance_Report_September_2026.xlsx');
  });

  it('E17. a session the system closed itself is not a punch-out; its recorded work still counts', () => {
    const auto = { ...session(D, '14:49', '21:00', 371), autoClosed: true };
    const fromSessions = day(unresolved({ sessions: [auto] }), 'u1', D);
    expectUnresolved(fromSessions);
    expect(fromSessions).toMatchObject({ punchIn: '14:49', punchOut: null, presenceHours: null, workHours: 6.18, missingPunch: 'Punch-out missing' });
    // With a raw punch-in on record, the auto-close does not stand in for the missing punch-out either.
    const withPunch = day(unresolved({ punches: [punch('PUNCH_IN', D, '14:49')], sessions: [auto] }), 'u1', D);
    expect(withPunch).toMatchObject({ punchIn: '14:49', punchOut: null, presenceHours: null, workHours: 6.18, missingPunch: 'Punch-out missing' });
  });

  it('E18. a punch-in after the last punch-out means the departure is unknown', () => {
    const r = unresolved({
      punches: [punch('PUNCH_IN', D, '16:30'), punch('PUNCH_OUT', D, '16:31'), punch('PUNCH_IN', D, '16:32')],
      sessions: [session(D, '16:30', '16:31', 1), { ...session(D, '16:32', '21:00', 261, 5), autoClosed: true }],
    });
    expect(day(r, 'u1', D)).toMatchObject({ punchIn: '16:30', punchOut: null, presenceHours: null, missingPunch: 'Punch-out missing' });
  });

  it('E19. raw punches are the evidence when present; sessions are used only when there are none', () => {
    const r = unresolved({ punches: [punch('PUNCH_IN', D, '09:00')], sessions: [session(D, '09:00', '18:00', 510, 30)] });
    expect(day(r, 'u1', D)).toMatchObject({ punchIn: '09:00', punchOut: null, presenceHours: null, workHours: 8.5, breakHours: 0.5, missingPunch: 'Punch-out missing' });
  });

  it('E16. the visible download requests export.xlsx / export.zip, never the legacy export.csv', () => {
    const fs = require('fs');
    const path = require('path');
    const root = path.resolve(__dirname, '../../../frontend/components/attendance');
    const api = fs.readFileSync(path.join(root, 'console-api.ts'), 'utf8');
    const ui = fs.readFileSync(path.join(root, 'AttendanceConsole.tsx'), 'utf8');
    expect(api).toMatch(/register\/export\.\$\{format\}/);
    expect(api).toMatch(/format: 'xlsx' \| 'zip'/);
    expect(api).not.toMatch(/export\.csv/);
    expect(ui).not.toMatch(/export\.csv/);
    expect(ui).toMatch(/download\('zip'\)/);
  });
});
