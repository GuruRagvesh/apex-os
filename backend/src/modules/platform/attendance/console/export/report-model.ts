/**
 * The monthly attendance report, as one canonical dataset.
 *
 * Everything that leaves the system as a monthly attendance file is built from
 * ONE MonthlyAttendanceReport. The workbook and the CSV package are encoders of
 * this object and nothing more: neither queries, neither decides a status, and
 * neither recomputes a figure. So the Daily Attendance sheet, the Monthly
 * Summary sheet and both CSV files cannot disagree with each other.
 *
 * The source facts below are plain values, not Prisma rows, so the assembler
 * that turns them into the report is a pure function: every rule it applies
 * can be proved without a database, a clock or a Nest module graph.
 */

/** yyyy-MM-dd company business date. */
export type BusinessDate = string;

export interface ReportEmployeeFacts {
  userId: string;
  /** The HR employee code (TE-001), never the database id. Null when unassigned. */
  employeeCode: string | null;
  name: string;
  department: string | null;
  designation: string | null;
  employmentType: string | null;
  /** Inclusive. Null when HR never recorded one. */
  joiningDate: BusinessDate | null;
  /** Inclusive. Null while employed. */
  lastWorkingDate: BusinessDate | null;
}

/** The attendance profile in force over a window, with its shift. */
export interface ReportProfileFacts {
  userId: string;
  effectiveFrom: BusinessDate;
  /** Inclusive. Null when open-ended. */
  effectiveTo: BusinessDate | null;
  category: string;
  attendanceRequired: boolean;
  /** The shift's minimum presence. Null when no shift is assigned. */
  requiredPresenceMinutes: number | null;
}

/** The company calendar's answer for one date. */
export interface ReportCalendarDay {
  businessDate: BusinessDate;
  isWorkingDay: boolean;
  /** WORKING | SUNDAY | SECOND_SATURDAY | FOURTH_SATURDAY | HOLIDAY | COMPANY_CLOSURE | SPECIAL_WORKING_DAY */
  reason: string;
  holidayName: string | null;
}

/** The authoritative DailyAttendance row for one employee-date. */
export interface ReportOfficialDay {
  userId: string;
  businessDate: BusinessDate;
  status: string;
  evaluationState: 'CALCULATED' | 'NEEDS_REVIEW' | 'FINALIZED' | string;
  calculationReason: string | null;
  exceptionFlags: string[];
  punchInAt: Date | null;
  punchOutAt: Date | null;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  leaveDeducted: number;
  lwpDeducted: number;
  revision: number;
  lastRegularizationId: string | null;
  leaveRequestId: string | null;
}

export interface ReportLeaveFacts {
  id: string;
  userId: string;
  /** LeaveType enum value. */
  type: string;
  /** PENDING | APPROVED | REJECTED | CANCELLED */
  status: string;
  approvalStage: string | null;
  isHalfDay: boolean;
  /** Business dates of the month this leave overlaps, resolved in company time. */
  dates: BusinessDate[];
}

/** A granted comp-off credit. Credits only exist once granted. */
export interface ReportCompOffFacts {
  userId: string;
  earnedFromBusinessDate: BusinessDate;
  creditMinutes: number;
  /** AVAILABLE | USED | EXPIRED | CANCELLED */
  status: string;
}

export interface ReportCorrectionFacts {
  userId: string;
  businessDate: BusinessDate;
  /** RegularizationStatus. */
  status: string;
  /** CorrectionApplicationStatus or null for legacy rows. */
  applicationStatus: string | null;
  applicationFailureReason: string | null;
  /** The refined correction type when recorded, else the historical enum. */
  requestType: string;
  /** The employee's own explanation. */
  reason: string;
  createdAt: Date;
}

/** A worked session, read for days the official record does not describe (holiday work). */
export interface ReportSessionFacts {
  userId: string;
  businessDate: BusinessDate;
  startWorkAt: Date | null;
  logoutAt: Date | null;
  totalWorkMinutes: number;
  totalBreakMinutes: number;
  /** Closed by the system (end-of-day or policy stop), not by the employee. */
  autoClosed?: boolean;
}

/** A recorded meeting interval (a MEETING break inside a work session). */
export interface ReportMeetingFacts {
  userId: string;
  businessDate: BusinessDate;
  /** Null for a meeting break never linked to a meeting record. */
  meetingId: string | null;
  startAt: Date;
  endAt: Date | null;
  durationMinutes: number | null;
  /** NOT_REQUIRED | PENDING | APPROVED | REJECTED, or null when unlinked. */
  approvalStatus: string | null;
  cancelled: boolean;
}

export interface ReportPunchFacts {
  userId: string;
  businessDate: BusinessDate;
  type: 'PUNCH_IN' | 'PUNCH_OUT' | string;
  at: Date;
  /** Where the punch was captured, as stored on the evidence row. Null when none was stored. */
  location?: ReportPunchLocation | null;
}

export interface ReportPunchLocation {
  latitude: number;
  longitude: number;
  /** PunchLocationVerification: VERIFIED, NOT_ENFORCED, OUTSIDE_GEOFENCE, ... */
  verification: string | null;
  distanceMeters: number | null;
  /** The approved attendance location the punch was checked against, if any. */
  placeName: string | null;
}

/** Everything the assembler reads, gathered once from one snapshot. */
export interface ReportSourceFacts {
  /** yyyy-MM */
  month: string;
  /** The company business date the report was generated on. */
  today: BusinessDate;
  generatedAt: Date;
  /** IANA zone used for every wall-clock value. */
  timezone: string;
  /** e.g. 2026-2027 */
  financialYear: string;
  scope: 'COMPANY' | 'TEAM';
  departmentName: string | null;
  calendarResolved: boolean;
  employees: ReportEmployeeFacts[];
  profiles: ReportProfileFacts[];
  calendar: ReportCalendarDay[];
  official: ReportOfficialDay[];
  leaves: ReportLeaveFacts[];
  compOff: ReportCompOffFacts[];
  corrections: ReportCorrectionFacts[];
  sessions: ReportSessionFacts[];
  meetings: ReportMeetingFacts[];
  punches: ReportPunchFacts[];
}

// ── Output ─────────────────────────────────────────────────────────────────

/** The explicit state every employee-date resolves to. */
export const DAY_STATES = {
  PRESENT: 'Present',
  LATE: 'Late',
  SHORT_HOURS: 'Short Hours',
  HALF_DAY: 'Half Day',
  ABSENT: 'Absent',
  APPROVED_LEAVE: 'Approved Leave',
  LWP: 'LWP / Unpaid Leave',
  WEEKLY_OFF: 'Weekly Off',
  HOLIDAY: 'Holiday',
  HOLIDAY_WORKED: 'Holiday Worked',
  NOT_YET_JOINED: 'Not Yet Joined',
  POST_EMPLOYMENT: 'Post Employment',
  FUTURE: 'Future / Not Yet Applicable',
  NEEDS_REVIEW: 'Needs Review / Unresolved',
  NOT_REQUIRED: 'Attendance Not Required',
} as const;

export type DayState = (typeof DAY_STATES)[keyof typeof DAY_STATES];

export const SCHEDULE = {
  WORKDAY: 'Scheduled Workday',
  WEEKLY_OFF: 'Weekly Off',
  HOLIDAY: 'Holiday',
} as const;

/** One cell value. Dates are yyyy-MM-dd, times HH:mm, percentages fractions. */
export type CellValue = string | number | null;

export interface DailyReportRow {
  userId: string;
  businessDate: BusinessDate;
  values: Record<string, CellValue>;
  /** Internal: true when the day is an unresolved eligible day. */
  unresolved: boolean;
}

export interface MonthlyReportRow {
  userId: string;
  values: Record<string, CellValue>;
  /** Index range of this employee's rows in dailyRows, inclusive. */
  dailyRange: { first: number; last: number };
}

export interface ReportMetadata {
  month: string;
  monthLabel: string;
  from: BusinessDate;
  to: BusinessDate;
  generatedAt: Date;
  timezone: string;
  scope: 'COMPANY' | 'TEAM';
  departmentName: string | null;
  employees: number;
  /** Any employee provisional, or the month not yet complete. */
  provisional: boolean;
  monthComplete: boolean;
}

export interface MonthlyAttendanceReport {
  metadata: ReportMetadata;
  dailyRows: DailyReportRow[];
  monthlySummaryRows: MonthlyReportRow[];
  warnings: string[];
}
