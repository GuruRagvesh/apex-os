/**
 * Turning a spreadsheet row into a proposal Apex OS could act on — or saying,
 * precisely, why it cannot.
 *
 * The raw cells and the normalized proposal are kept apart on purpose. Raw is
 * evidence: what the operator actually typed, quoted back in the error file.
 * Normalized is meaning: the employee, the business date, the status, the
 * instants. Overwriting one with the other would leave nothing to show somebody
 * when they ask why their file was refused.
 *
 * Nothing here guesses. Where a value could plausibly mean two things -- most
 * of all a date like 01/02/26 -- the row is refused. A silently wrong date
 * produces attendance for a day the employee was somewhere else, and no
 * downstream check can catch it, because the row looks perfectly valid.
 */

import {
  MIN_REASON_ENTERED_CORRECTION,
  validateCorrectionProposal,
  type CorrectionProposal,
  type OfficialSnapshot,
} from '../regularization/correction-proposal';
import type { Cell, RawImportRow } from './import-rows';

export type ImportMode = 'CURRENT_CORRECTION' | 'HISTORICAL_MIGRATION';

/** Statuses an import may assert, mapped onto real DailyAttendanceStatus members. */
export const IMPORTABLE_STATUSES = ['PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE', 'LWP'] as const;
export type ImportableStatus = (typeof IMPORTABLE_STATUSES)[number];

export const HALF_DAY_SESSIONS = ['FIRST_HALF', 'SECOND_HALF'] as const;
export const LEAVE_TYPES = ['ANNUAL', 'SICK', 'EMERGENCY', 'CASUAL', 'COMP_OFF', 'UNPAID', 'OTHER'] as const;

export type RowProblemCode =
  | 'EMPLOYEE_ID_MISSING'
  | 'EMPLOYEE_UNKNOWN'
  | 'DATE_MISSING'
  | 'DATE_UNPARSEABLE'
  | 'DATE_AMBIGUOUS'
  | 'DATE_IN_FUTURE'
  | 'DATE_BEFORE_EMPLOYMENT'
  | 'DATE_AFTER_EMPLOYMENT'
  | 'STATUS_MISSING'
  | 'STATUS_UNKNOWN'
  | 'TIME_UNPARSEABLE'
  | 'PUNCH_OUT_BEFORE_PUNCH_IN'
  | 'CROSS_MIDNIGHT_UNSUPPORTED'
  | 'PUNCH_TIMES_REQUIRED'
  | 'HALF_DAY_SESSION_REQUIRED'
  | 'HALF_DAY_SESSION_UNEXPECTED'
  | 'HALF_DAY_SESSION_UNKNOWN'
  | 'LEAVE_TYPE_UNKNOWN'
  | 'LEAVE_TYPE_UNEXPECTED'
  | 'REASON_TOO_SHORT'
  | 'DUPLICATE_EMPLOYEE_DAY'
  | 'DUPLICATE_CONFLICTING_EMPLOYEE_DAY';

export type RowWarningCode = 'EMPLOYEE_NAME_MISMATCH' | 'NON_WORKING_DAY';

export interface RowProblem {
  code: RowProblemCode;
  message: string;
  /** What the operator typed, quoted back so the error file is actionable. */
  value?: string;
  suggestion?: string;
}

export interface RowWarning {
  code: RowWarningCode;
  message: string;
}

/** The semantic proposal, frozen once and never re-derived from raw text. */
export interface NormalizedProposal {
  userId: string;
  employeeId: string;
  employeeName: string;
  businessDate: string;
  proposedStatus: ImportableStatus;
  proposedPunchIn: Date | null;
  proposedPunchOut: Date | null;
  proposedHalfDay: (typeof HALF_DAY_SESSIONS)[number] | null;
  proposedLeaveType: (typeof LEAVE_TYPES)[number] | null;
  normalizedReason: string;
}

export interface NormalizedRow {
  rowNumber: number;
  raw: RawImportRow;
  proposal: NormalizedProposal | null;
  problems: RowProblem[];
  warnings: RowWarning[];
}

export interface EmployeeRef {
  id: string;
  employeeId: string;
  name: string;
  joiningDate: Date | null;
  lastWorkingDate: Date | null;
}

export interface NormalizeContext {
  mode: ImportMode;
  /** Keyed by UPPER-CASED employeeId. Identity is never resolved by name. */
  employeesByEmployeeId: Map<string, EmployeeRef>;
  /** Company today, so a file cannot assert attendance that has not happened. */
  companyToday: string;
  /**
   * Builds the instant for a company-local wall clock on a business date.
   * Injected so this module needs no timezone machinery of its own.
   */
  toCompanyInstant: (businessDate: string, hhmm: string) => Date;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
/** Any slash- or dot-separated date. Ambiguous by construction — see below. */
const SEPARATED_DATE = /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}$/;

/** Excel's day zero. Serial 1 is 1900-01-01; the offset absorbs its leap-year bug. */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

const problem = (code: RowProblemCode, message: string, value?: string, suggestion?: string): RowProblem =>
  ({ code, message, value, suggestion });

/**
 * A date cell, from a real date, an Excel serial, or ISO text.
 *
 * `01/02/26` is deliberately refused. It is 1 February in most of the world, 2
 * January in the United States, and 26 February 2001 to a minority of systems.
 * A guess here produces attendance on a day the employee was somewhere else,
 * and every check downstream would pass, because the row looks perfectly valid.
 */
export function normalizeDate(cell: Cell, raw: string): { businessDate?: string; problem?: RowProblem } {
  if (cell instanceof Date) {
    // Readers hand back a UTC-midnight Date for a date-only cell.
    return { businessDate: cell.toISOString().slice(0, 10) };
  }

  if (typeof cell === 'number' && Number.isFinite(cell)) {
    const whole = Math.floor(cell);
    if (whole < 1 || whole > 60_000) {
      return { problem: problem('DATE_UNPARSEABLE', 'That date is outside any sensible range.', raw) };
    }
    return { businessDate: new Date(EXCEL_EPOCH_UTC + whole * 86_400_000).toISOString().slice(0, 10) };
  }

  const value = (raw ?? '').trim();
  if (!value) return { problem: problem('DATE_MISSING', 'A date is required.') };

  const iso = ISO_DATE.exec(value);
  if (iso) {
    const [, y, m, d] = iso;
    const at = new Date(`${value}T00:00:00.000Z`);
    // Rejects 2026-02-30, which Date would otherwise roll into March.
    if (
      Number.isNaN(at.getTime()) ||
      at.getUTCFullYear() !== Number(y) ||
      at.getUTCMonth() + 1 !== Number(m) ||
      at.getUTCDate() !== Number(d)
    ) {
      return { problem: problem('DATE_UNPARSEABLE', 'That date does not exist.', raw) };
    }
    return { businessDate: value };
  }

  if (SEPARATED_DATE.test(value)) {
    return {
      problem: problem(
        'DATE_AMBIGUOUS',
        'This date could mean more than one day, so Apex OS will not guess.',
        raw,
        'Write the date as yyyy-MM-dd, for example 2026-08-14.',
      ),
    };
  }

  return {
    problem: problem('DATE_UNPARSEABLE', 'That is not a date Apex OS can read.', raw, 'Use yyyy-MM-dd.'),
  };
}

/** A company-local wall clock from text or an Excel fractional-day cell. */
export function normalizeTime(cell: Cell, raw: string): { hhmm?: string; problem?: RowProblem } {
  const value = (raw ?? '').trim();

  if (typeof cell === 'number' && Number.isFinite(cell)) {
    // Excel stores a time as a fraction of a day. A whole number is a date, not
    // a time, and a value above 1 is a datetime whose time part is the fraction.
    const fraction = cell - Math.floor(cell);
    const minutes = Math.round(fraction * 24 * 60);
    if (minutes >= 24 * 60) return { problem: problem('TIME_UNPARSEABLE', 'That is not a valid time.', raw) };
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return { hhmm: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
  }

  if (cell instanceof Date) {
    return {
      hhmm: `${String(cell.getUTCHours()).padStart(2, '0')}:${String(cell.getUTCMinutes()).padStart(2, '0')}`,
    };
  }

  if (!value) return {};

  const m = HHMM.exec(value);
  if (!m) {
    return { problem: problem('TIME_UNPARSEABLE', 'That is not a time Apex OS can read.', raw, 'Use HH:mm, for example 09:38.') };
  }
  const hours = Number(m[1]);
  const mins = Number(m[2]);
  if (hours > 23 || mins > 59) {
    return { problem: problem('TIME_UNPARSEABLE', 'That time does not exist.', raw) };
  }
  return { hhmm: `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}` };
}

/**
 * For controlled VALUES, where "first half" and "FIRST-HALF" both mean
 * FIRST_HALF. Never for an employee ID: TE-014 and TE_014 are different
 * strings, and folding one into the other would fail to find a real employee.
 */
const upper = (s: string) => s.trim().toUpperCase().replace(/[\s-]+/g, '_');

/** For identifiers, which are matched as typed apart from case and padding. */
const upperId = (s: string) => s.trim().toUpperCase();

/**
 * One row, from raw cells to a proposal or a list of reasons it is not one.
 *
 * Every problem is collected rather than thrown at the first, so an operator
 * fixing a spreadsheet sees everything wrong with a line in one pass instead of
 * discovering faults one upload at a time.
 */
export function normalizeRow(raw: RawImportRow, context: NormalizeContext): NormalizedRow {
  const problems: RowProblem[] = [];
  const warnings: RowWarning[] = [];

  // ── Identity: the Employee ID, never the name ───────────────────────────
  const employeeKey = upperId(raw.rawEmployeeId);
  if (!employeeKey) {
    problems.push(problem('EMPLOYEE_ID_MISSING', 'An Employee ID is required.'));
  }
  const employee = employeeKey ? context.employeesByEmployeeId.get(employeeKey) : undefined;
  if (employeeKey && !employee) {
    problems.push(
      problem('EMPLOYEE_UNKNOWN', 'No employee has this ID.', raw.rawEmployeeId, 'Check the ID against the employee list.'),
    );
  }

  // A name that disagrees is worth saying out loud and is never the identity:
  // two people can share a name, and nobody shares an Employee ID.
  if (employee && raw.rawEmployeeName) {
    const typed = raw.rawEmployeeName.trim().toLowerCase();
    const actual = employee.name.trim().toLowerCase();
    if (typed !== actual && !actual.startsWith(typed) && !typed.startsWith(actual)) {
      warnings.push({
        code: 'EMPLOYEE_NAME_MISMATCH',
        message: `The file says "${raw.rawEmployeeName}"; this ID belongs to ${employee.name}. The ID is what will be used.`,
      });
    }
  }

  // ── Date ────────────────────────────────────────────────────────────────
  const date = normalizeDate(raw.dateCell, raw.rawDate);
  if (date.problem) problems.push(date.problem);
  const businessDate = date.businessDate;

  if (businessDate) {
    if (businessDate > context.companyToday) {
      problems.push(problem('DATE_IN_FUTURE', 'That day has not happened yet.', businessDate));
    }
    if (employee?.joiningDate) {
      const joined = employee.joiningDate.toISOString().slice(0, 10);
      if (businessDate < joined) {
        problems.push(
          problem('DATE_BEFORE_EMPLOYMENT', `${employee.name} had not joined on this date (joined ${joined}).`, businessDate),
        );
      }
    }
    if (employee?.lastWorkingDate) {
      const left = employee.lastWorkingDate.toISOString().slice(0, 10);
      if (businessDate > left) {
        problems.push(
          problem('DATE_AFTER_EMPLOYMENT', `${employee.name} had left by this date (last working day ${left}).`, businessDate),
        );
      }
    }
  }

  // ── Status ──────────────────────────────────────────────────────────────
  const statusText = upper(raw.rawStatus);
  if (!statusText) problems.push(problem('STATUS_MISSING', 'A status is required.'));
  else if (!IMPORTABLE_STATUSES.includes(statusText as ImportableStatus)) {
    problems.push(
      problem('STATUS_UNKNOWN', 'That is not a status this import understands.', raw.rawStatus,
        `Use one of: ${IMPORTABLE_STATUSES.join(', ')}.`),
    );
  }
  const status = statusText as ImportableStatus;

  // ── Times ───────────────────────────────────────────────────────────────
  const inTime = normalizeTime(raw.punchInCell, raw.rawPunchIn);
  const outTime = normalizeTime(raw.punchOutCell, raw.rawPunchOut);
  if (inTime.problem) problems.push(inTime.problem);
  if (outTime.problem) problems.push(outTime.problem);

  let punchIn: Date | null = null;
  let punchOut: Date | null = null;
  if (businessDate && inTime.hhmm) punchIn = context.toCompanyInstant(businessDate, inTime.hhmm);
  if (businessDate && outTime.hhmm) punchOut = context.toCompanyInstant(businessDate, outTime.hhmm);

  if (inTime.hhmm && outTime.hhmm && outTime.hhmm < inTime.hhmm) {
    // A punch out earlier in the day than the punch in is either an inverted
    // pair or an overnight shift. This import supports neither, and says which
    // it is treating it as rather than silently choosing.
    problems.push(
      problem('CROSS_MIDNIGHT_UNSUPPORTED',
        `Punch out (${outTime.hhmm}) is earlier in the day than punch in (${inTime.hhmm}). Shifts crossing midnight are not supported by this import.`,
        `${inTime.hhmm} – ${outTime.hhmm}`),
    );
  }

  // ── Status-specific shape ───────────────────────────────────────────────
  const halfDayText = upper(raw.rawHalfDay);
  const halfDay = halfDayText && halfDayText !== 'NONE' ? halfDayText : '';

  if (status === 'HALF_DAY') {
    if (!halfDay) {
      problems.push(problem('HALF_DAY_SESSION_REQUIRED', 'A half day must say which half.', '', 'Use FIRST_HALF or SECOND_HALF.'));
    } else if (!HALF_DAY_SESSIONS.includes(halfDay as any)) {
      problems.push(problem('HALF_DAY_SESSION_UNKNOWN', 'That is not a half-day session.', raw.rawHalfDay,
        `Use one of: ${HALF_DAY_SESSIONS.join(', ')}.`));
    }
  } else if (halfDay) {
    problems.push(
      problem('HALF_DAY_SESSION_UNEXPECTED', `A half-day session cannot be set on a ${status || 'blank'} row.`, raw.rawHalfDay),
    );
  }

  const leaveTypeText = upper(raw.rawLeaveType);
  if (status === 'LEAVE') {
    if (leaveTypeText && !LEAVE_TYPES.includes(leaveTypeText as any)) {
      problems.push(problem('LEAVE_TYPE_UNKNOWN', 'That is not a leave type Apex OS holds.', raw.rawLeaveType,
        `Use one of: ${LEAVE_TYPES.join(', ')}.`));
    }
  } else if (leaveTypeText) {
    problems.push(problem('LEAVE_TYPE_UNEXPECTED', `A leave type cannot be set on a ${status || 'blank'} row.`, raw.rawLeaveType));
  }

  // PRESENT WITHOUT PUNCH TIMES DEPENDS ENTIRELY ON THE MODE.
  //
  // Historical data legitimately remembers that somebody worked without
  // remembering when. A live correction does not have that excuse -- it is
  // asserting a fact about a day Apex OS was running for, and the manual
  // recovery rules require the times.
  if (status === 'PRESENT' && !punchIn && !punchOut && context.mode === 'CURRENT_CORRECTION') {
    problems.push(
      problem('PUNCH_TIMES_REQUIRED',
        'A present day needs its punch times. Only a historical migration may record a present day without them.',
        '', 'Supply Punch In and Punch Out, or upload this row as a historical migration.'),
    );
  }

  const reason = (raw.rawReason ?? '').trim();
  if (reason.length < MIN_REASON_ENTERED_CORRECTION) {
    problems.push(
      problem('REASON_TOO_SHORT',
        'Every imported row needs a reason. It becomes the durable record of why this day says what it says.',
        raw.rawReason),
    );
  }

  // ── The Phase 1 rules, not a second copy of them ────────────────────────
  if (punchIn || punchOut) {
    const asCorrection: CorrectionProposal = {
      punchInAt: punchIn,
      punchOutAt: punchOut,
      proposedStatus: status ?? null,
      reason,
    };
    const noOfficialYet: OfficialSnapshot | null = null;
    for (const shared of validateCorrectionProposal(asCorrection, noOfficialYet, {
      minReasonLength: MIN_REASON_ENTERED_CORRECTION,
      correctExisting: true,
    })) {
      // Reason and ordering are already reported above in import vocabulary;
      // only genuinely new findings are carried across.
      if (shared.code === 'PUNCH_OUT_BEFORE_PUNCH_IN' && !problems.some((p) => p.code === 'CROSS_MIDNIGHT_UNSUPPORTED')) {
        problems.push(problem('PUNCH_OUT_BEFORE_PUNCH_IN', shared.message));
      }
    }
  }

  if (problems.length > 0 || !employee || !businessDate) {
    return { rowNumber: raw.rowNumber, raw, proposal: null, problems, warnings };
  }

  return {
    rowNumber: raw.rowNumber,
    raw,
    warnings,
    problems,
    proposal: {
      userId: employee.id,
      employeeId: employee.employeeId,
      employeeName: employee.name,
      businessDate,
      proposedStatus: status,
      proposedPunchIn: punchIn,
      proposedPunchOut: punchOut,
      proposedHalfDay: (halfDay || null) as any,
      proposedLeaveType: (status === 'LEAVE' ? leaveTypeText || null : null) as any,
      normalizedReason: reason,
    },
  };
}
