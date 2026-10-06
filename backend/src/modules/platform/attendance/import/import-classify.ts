/**
 * What each row would actually do, compared against what Apex OS already holds.
 *
 * The classifier is the last thing between a spreadsheet and a correction, and
 * it writes nothing. It answers one question per row -- NEW, MATCH, CHANGE,
 * CONFLICT or INVALID -- and shows the current and proposed values side by side
 * so a person can see what they are approving.
 *
 * LAYERING: this module translates settlement reasons into import vocabulary.
 * The settlement module knows nothing about NEW/MATCH/CHANGE/CONFLICT/INVALID
 * and must not learn -- it answers "is this period settled", which is true
 * regardless of whether a spreadsheet is involved.
 */

import {
  assessSettlement,
  type SettlementReason,
} from '../evaluation/attendance-settlement';
import type { NormalizedRow, RowProblem, RowWarning } from './import-normalize';

export type RowClassification = 'NEW' | 'MATCH' | 'CHANGE' | 'CONFLICT' | 'INVALID';

export type ConflictCode =
  | 'LOCKED_DAY'
  | 'FINALIZED_DAY'
  | 'FINALIZED_MONTH'
  | 'SENT_MONTH'
  | 'OPEN_CORRECTION'
  | 'MISSING_AUTHORITATIVE_LEAVE';

export interface ConflictReason {
  code: ConflictCode;
  message: string;
}

/** The official record for one employee-day, as the classifier needs it. */
export interface CurrentDay {
  status: string | null;
  punchInAt: Date | null;
  punchOutAt: Date | null;
  evaluationState: string | null;
  locked: boolean | null;
  /**
   * The evidence rows backing each punch, by id.
   *
   * Stored as ids rather than a has-evidence Boolean so the snapshot invents no
   * second evidence vocabulary and points at the specific rows that backed the
   * day. Whether evidence exists is derived from them.
   */
  punchInEvidenceId: string | null;
  punchOutEvidenceId: string | null;
  /** Digest of the facts this record was computed from. Frozen for staleness. */
  sourceFingerprint: string | null;
}

export interface ClassifyContext {
  /** `${userId}|${businessDate}` -> the official record. */
  currentByKey: Map<string, CurrentDay>;
  /** `yyyy-MM` -> close status. */
  monthStatusByMonth: Map<string, string>;
  /** `${userId}|${businessDate}` for days with an unresolved correction. */
  openCorrections: Set<string>;
  /**
   * `${userId}|${businessDate}` -> the approved leave fact, when one exists.
   * An import never creates leave authority; it can only recognise it.
   */
  approvedLeaveByKey: Map<string, { kind: string; leaveType?: string | null }>;
  /** Employee-days duplicated within this file, and whether they disagree. */
  duplicateRows: Map<string, { rows: number[]; conflicting: boolean }>;
}

export interface ClassifiedRow {
  rowNumber: number;
  classification: RowClassification;
  /** The resolved account, or null when identity did not resolve. */
  userId: string | null;
  employeeId: string;
  employeeName: string;
  businessDate: string | null;
  errors: RowProblem[];
  warnings: RowWarning[];
  conflicts: ConflictReason[];
  settlementReasons: SettlementReason[];
  current: {
    status: string | null;
    punchIn: string | null;
    punchOut: string | null;
    punchInEvidenceId: string | null;
    punchOutEvidenceId: string | null;
    sourceFingerprint: string | null;
    /** Derived, for a reviewer reading the preview. */
    hasEvidence: boolean;
  } | null;
  proposed: {
    status: string | null;
    punchIn: string | null;
    punchOut: string | null;
    halfDay: string | null;
    leaveType: string | null;
    reason: string | null;
  } | null;
}

const CONFLICT_MESSAGE: Record<ConflictCode, string> = {
  LOCKED_DAY: 'This day is locked and cannot be changed by an import.',
  FINALIZED_DAY: 'This day has been finalized and cannot be changed by an import.',
  FINALIZED_MONTH: 'This month has been finalized for payroll.',
  SENT_MONTH: 'This month has already been sent to Finance.',
  OPEN_CORRECTION: 'A correction for this day is already awaiting review.',
  MISSING_AUTHORITATIVE_LEAVE:
    'Apex OS holds no approved leave for this employee on this date. An attendance import cannot create leave.',
};

const key = (userId: string, businessDate: string) => `${userId}|${businessDate}`;
const iso = (at: Date | null) => (at ? at.toISOString() : null);

/** Same instant to the minute. Seconds are display noise from a spreadsheet. */
const sameMinute = (a: Date | null, b: Date | null): boolean => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return Math.floor(a.getTime() / 60_000) === Math.floor(b.getTime() / 60_000);
};

/**
 * Statuses that mean the same attended day.
 *
 * The evaluator classifies a late arrival as LATE and an exempted one as
 * LATE_EXEMPTED. A spreadsheet saying PRESENT for such a day is agreeing with
 * Apex OS, not contradicting it, and treating that as a CHANGE would produce
 * thousands of proposals to rewrite records that are already right.
 */
const PRESENT_EQUIVALENT = new Set(['PRESENT', 'LATE', 'LATE_EXEMPTED']);

function statusesAgree(proposed: string, current: string | null): boolean {
  if (!current) return false;
  if (proposed === current) return true;
  return proposed === 'PRESENT' && PRESENT_EQUIVALENT.has(current);
}

/**
 * One row's verdict.
 *
 * Order matters. INVALID comes first because a row that cannot become a
 * proposal cannot be compared to anything. CONFLICT comes before MATCH and
 * CHANGE because a settled period refuses a row whatever it says.
 */
export function classifyRow(row: NormalizedRow, context: ClassifyContext): ClassifiedRow {
  const base = {
    rowNumber: row.rowNumber,
    userId: row.proposal?.userId ?? null,
    employeeId: row.proposal?.employeeId ?? row.raw.rawEmployeeId,
    employeeName: row.proposal?.employeeName ?? row.raw.rawEmployeeName,
    businessDate: row.proposal?.businessDate ?? null,
    errors: row.problems,
    warnings: row.warnings,
    conflicts: [] as ConflictReason[],
    settlementReasons: [] as SettlementReason[],
    current: null as ClassifiedRow['current'],
    proposed: null as ClassifiedRow['proposed'],
  };

  if (!row.proposal || row.problems.length > 0) {
    return { ...base, classification: 'INVALID' };
  }

  const p = row.proposal;
  const rowKey = key(p.userId, p.businessDate);

  const proposed = {
    status: p.proposedStatus,
    punchIn: iso(p.proposedPunchIn),
    punchOut: iso(p.proposedPunchOut),
    halfDay: p.proposedHalfDay,
    leaveType: p.proposedLeaveType,
    reason: p.normalizedReason,
  };

  // ── Duplicated inside this very file ────────────────────────────────────
  const duplicate = context.duplicateRows.get(rowKey);
  if (duplicate) {
    // Never resolved by picking one. Two rows for one employee-day are a
    // question about the source data, and preferring the later line would
    // silently discard whichever the operator actually meant.
    return {
      ...base,
      proposed,
      classification: 'INVALID',
      errors: [
        ...row.problems,
        {
          code: duplicate.conflicting ? 'DUPLICATE_CONFLICTING_EMPLOYEE_DAY' : 'DUPLICATE_EMPLOYEE_DAY',
          message: duplicate.conflicting
            ? `This employee and date appear on rows ${duplicate.rows.join(', ')} with different values.`
            : `This employee and date appear more than once (rows ${duplicate.rows.join(', ')}).`,
          suggestion: 'Leave exactly one row per employee per date.',
        },
      ],
    };
  }

  const current = context.currentByKey.get(rowKey) ?? null;
  const currentView = current
    ? {
        status: current.status,
        punchIn: iso(current.punchInAt),
        punchOut: iso(current.punchOutAt),
        punchInEvidenceId: current.punchInEvidenceId,
        punchOutEvidenceId: current.punchOutEvidenceId,
        sourceFingerprint: current.sourceFingerprint,
        hasEvidence: Boolean(current.punchInEvidenceId || current.punchOutEvidenceId),
      }
    : null;

  // ── Settled periods refuse the row whatever it says ─────────────────────
  const settlement = assessSettlement(
    {
      day: current ? { locked: current.locked, evaluationState: current.evaluationState } : null,
      monthClose: { status: context.monthStatusByMonth.get(p.businessDate.slice(0, 7)) ?? null },
    },
    'BULK_IMPORT',
  );

  const conflicts: ConflictReason[] = settlement.blocked.map((reason) => ({
    code: reason as ConflictCode,
    message: CONFLICT_MESSAGE[reason as ConflictCode],
  }));

  // ── A correction already under review ───────────────────────────────────
  if (context.openCorrections.has(rowKey)) {
    conflicts.push({ code: 'OPEN_CORRECTION', message: CONFLICT_MESSAGE.OPEN_CORRECTION });
  }

  // ── Leave authority is never manufactured by a spreadsheet ──────────────
  //
  // Attendance saying LEAVE while the leave module says the leave never existed
  // is the exact divergence this import must not create. The row is refused,
  // and the refusal names what is missing so HR can resolve it in the place
  // that owns it.
  if (p.proposedStatus === 'LEAVE' || p.proposedStatus === 'LWP') {
    const leave = context.approvedLeaveByKey.get(rowKey);
    if (!leave || leave.kind === 'NONE') {
      conflicts.push({
        code: 'MISSING_AUTHORITATIVE_LEAVE',
        message: CONFLICT_MESSAGE.MISSING_AUTHORITATIVE_LEAVE,
      });
    }
  }

  if (conflicts.length > 0) {
    return {
      ...base,
      classification: 'CONFLICT',
      conflicts,
      settlementReasons: settlement.reasons,
      current: currentView,
      proposed,
    };
  }

  // ── Nothing on record yet ───────────────────────────────────────────────
  if (!current) {
    return { ...base, classification: 'NEW', current: null, proposed, settlementReasons: settlement.reasons };
  }

  // ── Does the proposal actually differ? ──────────────────────────────────
  const agrees = statusesAgree(p.proposedStatus, current.status);

  // A SPREADSHEET WITH LESS DETAIL IS NOT A REQUEST TO DELETE DETAIL.
  //
  // This is where that rule lives: a time the file does not state is not a
  // proposal to clear the one Apex OS holds. Historical files routinely record
  // "present" and nothing else for days backed by real punch evidence, and
  // reading the silence as "set this to null" would turn a reconciliation into
  // thousands of quiet evidence deletions.
  //
  // Only a time the file actually states is compared.
  const timesAgree =
    (!p.proposedPunchIn || sameMinute(p.proposedPunchIn, current.punchInAt)) &&
    (!p.proposedPunchOut || sameMinute(p.proposedPunchOut, current.punchOutAt));

  if (agrees && timesAgree) {
    return { ...base, classification: 'MATCH', current: currentView, proposed, settlementReasons: settlement.reasons };
  }

  return { ...base, classification: 'CHANGE', current: currentView, proposed, settlementReasons: settlement.reasons };
}

export interface ImportSummary {
  totalRows: number;
  newRows: number;
  matchRows: number;
  changeRows: number;
  conflictRows: number;
  invalidRows: number;
  warningRows: number;
  /**
   * Whether this batch could be approved as it stands.
   *
   * False while any row is INVALID or in CONFLICT. One button that applies
   * 4,000 rows while quietly skipping 30 bad ones is how an operator learns
   * months later that a fortnight of somebody's attendance was never imported.
   */
  approvable: boolean;
}

export function summarise(rows: ClassifiedRow[]): ImportSummary {
  const count = (c: RowClassification) => rows.filter((r) => r.classification === c).length;
  const invalidRows = count('INVALID');
  const conflictRows = count('CONFLICT');

  return {
    totalRows: rows.length,
    newRows: count('NEW'),
    matchRows: count('MATCH'),
    changeRows: count('CHANGE'),
    conflictRows,
    invalidRows,
    warningRows: rows.filter((r) => r.warnings.length > 0).length,
    approvable: rows.length > 0 && invalidRows === 0 && conflictRows === 0,
  };
}

export interface ErrorFileRow {
  rowNumber: number;
  employeeId: string;
  employeeName: string;
  date: string;
  field: string;
  value: string;
  errorCode: string;
  error: string;
  suggestedFix: string;
}

/**
 * The rows an operator needs to fix, as data rather than as prose.
 *
 * Codes travel beside the sentences so nothing downstream has to parse English
 * to decide what happened.
 */
export function buildErrorFileRows(rows: ClassifiedRow[]): ErrorFileRow[] {
  const out: ErrorFileRow[] = [];

  for (const row of rows) {
    if (row.classification !== 'INVALID' && row.classification !== 'CONFLICT') continue;

    const shared = {
      rowNumber: row.rowNumber,
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      date: row.businessDate ?? '',
    };

    for (const e of row.errors) {
      out.push({
        ...shared,
        field: fieldFor(e.code),
        value: e.value ?? '',
        errorCode: e.code,
        error: e.message,
        suggestedFix: e.suggestion ?? '',
      });
    }
    for (const c of row.conflicts) {
      out.push({
        ...shared,
        field: '',
        value: '',
        errorCode: c.code,
        error: c.message,
        suggestedFix: suggestionFor(c.code),
      });
    }
  }

  return out;
}

function fieldFor(code: string): string {
  if (code.startsWith('EMPLOYEE')) return 'Employee ID';
  if (code.startsWith('DATE')) return 'Date';
  if (code.startsWith('STATUS')) return 'Status';
  if (code.startsWith('TIME') || code.includes('PUNCH') || code.includes('MIDNIGHT')) return 'Punch In / Punch Out';
  if (code.startsWith('HALF_DAY')) return 'Half Day';
  if (code.startsWith('LEAVE_TYPE')) return 'Leave Type';
  if (code.startsWith('REASON')) return 'Reason';
  return '';
}

function suggestionFor(code: ConflictCode): string {
  switch (code) {
    case 'MISSING_AUTHORITATIVE_LEAVE':
      return 'Record the leave in Apex OS first, or remove this row and handle it as a leave migration.';
    case 'OPEN_CORRECTION':
      return 'Resolve the correction already awaiting review, then re-upload this row.';
    case 'SENT_MONTH':
    case 'FINALIZED_MONTH':
      return 'This period is closed. Remove these rows from the file.';
    default:
      return 'Remove this row, or correct the day individually with a reviewed correction.';
  }
}

/** The human sentence for a stored code. Presentation, never the record. */
export function describeCode(code: string): string {
  return (CONFLICT_MESSAGE as Record<string, string>)[code] ?? code.replace(/_/g, ' ').toLowerCase();
}

/** What to do about a stored code. */
export function suggestForCode(code: string): string {
  if (code in CONFLICT_MESSAGE) return suggestionFor(code as ConflictCode);
  if (code.startsWith('DATE')) return 'Write the date as yyyy-MM-dd, for example 2026-08-14.';
  if (code.startsWith('TIME') || code.includes('MIDNIGHT')) return 'Use HH:mm in company time, and end the day after it starts.';
  if (code.startsWith('EMPLOYEE')) return 'Check the Employee ID against the employee list.';
  if (code.startsWith('DUPLICATE')) return 'Leave exactly one row per employee per date.';
  if (code.startsWith('REASON')) return 'Give a reason of at least 10 characters.';
  return 'Correct this row and upload the file again.';
}
