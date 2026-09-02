/**
 * Attendance Data Control — how the backend's verdicts are worded for a human.
 *
 * Dependency-free on purpose: the frontend has no test runner, so this is
 * exercised from the backend suite, which cannot resolve the app's module
 * aliases. Transport lives in import-api.ts; the screens are thin over this.
 *
 * WHAT BELONGS HERE AND WHAT DOES NOT
 *
 * Nothing here decides anything. Classification, approvability, staleness and
 * batch outcome are all settled by the server, and this file only chooses the
 * words. The stored codes are the durable record and the sentences are
 * presentation -- which is exactly why the sentences live on this side, and why
 * a test asserts this file has a sentence for EVERY code the server can emit.
 * A missing one would otherwise surface as a raw SCREAMING_SNAKE code in front
 * of HR, which is how a system tells somebody it was not finished.
 */

// ── Classification ──────────────────────────────────────────────────────────

export const CLASSIFICATIONS = ['NEW', 'MATCH', 'CHANGE', 'CONFLICT', 'INVALID'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export type Tone = 'positive' | 'neutral' | 'info' | 'warn' | 'danger' | 'muted';

export interface ClassificationPresentation {
  label: string;
  tone: Tone;
  /** One line, in the reviewer's language rather than the system's. */
  meaning: string;
}

/**
 * MATCH is deliberately POSITIVE.
 *
 * On a six-month reconciliation most rows will match, and a screen that paints
 * 3,500 matches in warning colours tells HR their import failed when in fact it
 * confirmed the data. "No change needed" is the good news, and it should look
 * like it.
 */
export const CLASSIFICATION: Record<Classification, ClassificationPresentation> = {
  MATCH: {
    label: 'No change needed',
    tone: 'positive',
    meaning: 'Apex OS already records exactly this.',
  },
  NEW: {
    label: 'New record',
    tone: 'info',
    meaning: 'There is no attendance recorded for this day yet.',
  },
  CHANGE: {
    label: 'Change',
    tone: 'neutral',
    meaning: 'This would replace what Apex OS currently records.',
  },
  CONFLICT: {
    label: 'Cannot apply',
    tone: 'warn',
    meaning: 'The row is understood, but Apex OS cannot safely apply it.',
  },
  INVALID: {
    label: 'Cannot read',
    tone: 'danger',
    meaning: 'This row cannot be interpreted safely and must be fixed in the file.',
  },
};

/** Rows that would actually write something. Used for wording, never for gating. */
export const ACTIONABLE: Classification[] = ['NEW', 'CHANGE'];

/** Rows that stop a batch being approvable. The server decides; this only explains. */
export const BLOCKING: Classification[] = ['CONFLICT', 'INVALID'];

// ── Review filters ──────────────────────────────────────────────────────────

export type RowFilter = 'ALL' | Classification | 'WARNINGS';

export const ROW_FILTERS: { value: RowFilter; label: string }[] = [
  { value: 'ALL', label: 'All rows' },
  { value: 'CHANGE', label: 'Changes' },
  { value: 'NEW', label: 'New' },
  { value: 'MATCH', label: 'No change needed' },
  { value: 'CONFLICT', label: 'Cannot apply' },
  { value: 'INVALID', label: 'Cannot read' },
  { value: 'WARNINGS', label: 'Warnings' },
];

export interface FilterableRow {
  classification: string;
  warnings?: string[] | null;
}

/**
 * WARNINGS is not a classification, so it cannot be pushed to the server as
 * one. It filters what is already loaded; everything else is a server query.
 */
export function filterRows<T extends FilterableRow>(rows: T[], filter: RowFilter): T[] {
  if (filter === 'ALL') return rows;
  if (filter === 'WARNINGS') return rows.filter((r) => (r.warnings?.length ?? 0) > 0);
  return rows.filter((r) => r.classification === filter);
}

export function serverClassificationFilter(filter: RowFilter): string | undefined {
  return filter === 'ALL' || filter === 'WARNINGS' ? undefined : filter;
}

// ── Mode ────────────────────────────────────────────────────────────────────

export const IMPORT_MODES = ['CURRENT_CORRECTION', 'HISTORICAL_MIGRATION'] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];

/** The enum name is a wire value. Nobody choosing a mode should have to read it. */
export const MODE: Record<ImportMode, { label: string; help: string }> = {
  CURRENT_CORRECTION: {
    label: 'Correct existing attendance',
    help: 'For days Apex OS already knows about, where the recorded times or status are wrong.',
  },
  HISTORICAL_MIGRATION: {
    label: 'Bring in older records',
    help: 'For attendance from before Apex OS was recording it. These days have no punch evidence.',
  },
};

// ── Batch status ────────────────────────────────────────────────────────────

export const BATCH_STATUSES = [
  'UPLOADING', 'VALIDATING', 'READY_FOR_REVIEW', 'HAS_ERRORS', 'APPROVED',
  'APPLYING', 'APPLIED', 'PARTIALLY_APPLIED', 'REVIEW_REQUIRED', 'FAILED', 'CANCELLED',
] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export interface StatusPresentation {
  label: string;
  tone: Tone;
  /** What has happened, and crucially whether attendance has been changed yet. */
  detail: string;
  /** The one thing to do next, if there is one. */
  action: 'REVIEW' | 'APPROVE' | 'APPLY' | 'RE_PREVIEW' | 'RESUME' | 'FIX_FILE' | 'NONE';
}

export const BATCH_STATUS: Record<BatchStatus, StatusPresentation> = {
  UPLOADING: {
    label: 'Uploading', tone: 'neutral', action: 'NONE',
    detail: 'The file is being read. Nothing has been changed.',
  },
  VALIDATING: {
    label: 'Checking', tone: 'neutral', action: 'NONE',
    detail: 'Every row is being compared with Apex OS. Nothing has been changed.',
  },
  READY_FOR_REVIEW: {
    label: 'Ready for review', tone: 'info', action: 'REVIEW',
    detail: 'The comparison is ready. No attendance has been changed yet.',
  },
  HAS_ERRORS: {
    label: 'Needs fixing', tone: 'danger', action: 'FIX_FILE',
    detail: 'Some rows cannot be applied. Download the error file, fix them, and upload again. No attendance has been changed.',
  },
  APPROVED: {
    label: 'Approved', tone: 'info', action: 'APPLY',
    detail: 'Approved and waiting to be applied. No attendance has been changed yet.',
  },
  APPLYING: {
    label: 'Applying', tone: 'neutral', action: 'NONE',
    detail: 'Attendance is being updated now.',
  },
  APPLIED: {
    label: 'Applied', tone: 'positive', action: 'NONE',
    detail: 'This batch is finished and nothing is outstanding.',
  },
  PARTIALLY_APPLIED: {
    label: 'Partly applied', tone: 'warn', action: 'RE_PREVIEW',
    detail: 'Some rows were applied. The rest need reviewing against the current attendance before they can be.',
  },
  REVIEW_REQUIRED: {
    label: 'Needs re-review', tone: 'warn', action: 'RE_PREVIEW',
    detail: 'Attendance changed after this batch was approved, so nothing was applied. Refresh the comparison and approve it again.',
  },
  FAILED: {
    label: 'Failed', tone: 'danger', action: 'REVIEW',
    detail: 'This batch could not be completed.',
  },
  CANCELLED: {
    label: 'Cancelled', tone: 'muted', action: 'NONE',
    detail: 'This batch was cancelled.',
  },
};

/** True while the batch is doing something and the screen should keep asking. */
export function isBatchBusy(status: string): boolean {
  return status === 'UPLOADING' || status === 'VALIDATING' || status === 'APPLYING';
}

// ── Row problems and conflicts ──────────────────────────────────────────────

/**
 * Every code the server can put on a row, in a sentence, with what to do.
 *
 * Kept total by test against the server's own unions. If the server gains a
 * code and this map does not, the test fails rather than HR meeting
 * `HALF_DAY_SESSION_UNEXPECTED` on a Tuesday.
 */
export interface CodeExplanation {
  message: string;
  fix: string;
}

export const ROW_CODE: Record<string, CodeExplanation> = {
  // ── Identity ──
  EMPLOYEE_ID_MISSING: {
    message: 'No Employee ID in this row.',
    fix: 'Add the Employee ID. The name alone cannot identify somebody.',
  },
  EMPLOYEE_UNKNOWN: {
    message: 'No employee in Apex OS has this Employee ID.',
    fix: 'Check the ID against the employee record, and mind leading zeros.',
  },
  // ── Date ──
  DATE_MISSING: { message: 'No date in this row.', fix: 'Add the date.' },
  DATE_UNPARSEABLE: {
    message: 'This date could not be read.',
    fix: 'Use the format shown in the template.',
  },
  DATE_AMBIGUOUS: {
    message: 'This date could mean more than one day.',
    fix: 'Write it unambiguously — 01/02/26 is three different days depending on where you are.',
  },
  DATE_IN_FUTURE: {
    message: 'This date has not happened yet.',
    fix: 'Attendance cannot be recorded in advance.',
  },
  DATE_BEFORE_EMPLOYMENT: {
    message: 'This is before the employee joined.',
    fix: 'Check the date, or the joining date on their record.',
  },
  DATE_AFTER_EMPLOYMENT: {
    message: 'This is after the employee left.',
    fix: 'Check the date, or the last working date on their record.',
  },
  // ── Status ──
  STATUS_MISSING: { message: 'No status in this row.', fix: 'Add a status from the template.' },
  STATUS_UNKNOWN: {
    message: 'That is not a status this import understands.',
    fix: 'Use one of the statuses listed in the template.',
  },
  // ── Times ──
  TIME_UNPARSEABLE: {
    message: 'A time in this row could not be read.',
    fix: 'Use 24-hour HH:mm, for example 09:38.',
  },
  PUNCH_OUT_BEFORE_PUNCH_IN: {
    message: 'The punch out is earlier than the punch in.',
    fix: 'Check both times.',
  },
  CROSS_MIDNIGHT_UNSUPPORTED: {
    message: 'This shift appears to cross midnight.',
    fix: 'Overnight shifts cannot be imported. Record this day through a correction instead.',
  },
  PUNCH_TIMES_REQUIRED: {
    message: 'This status needs punch times.',
    fix: 'Add the punch in and punch out.',
  },
  // ── Half day and leave ──
  HALF_DAY_SESSION_REQUIRED: {
    message: 'A half day needs to say which half.',
    fix: 'Set Half Day to the first or second half.',
  },
  HALF_DAY_SESSION_UNEXPECTED: {
    message: 'A half day session was given for a day that is not a half day.',
    fix: 'Clear the Half Day column, or change the status.',
  },
  HALF_DAY_SESSION_UNKNOWN: {
    message: 'That is not a half day session this import understands.',
    fix: 'Use the values listed in the template.',
  },
  LEAVE_TYPE_UNKNOWN: {
    message: 'That is not a leave type this import understands.',
    fix: 'Use one of the leave types listed in the template.',
  },
  LEAVE_TYPE_UNEXPECTED: {
    message: 'A leave type was given for a day that is not leave.',
    fix: 'Clear the Leave Type column, or change the status.',
  },
  // ── Reason and duplicates ──
  REASON_TOO_SHORT: {
    message: 'The reason is too short to be useful later.',
    fix: 'Say what happened, in a sentence somebody could understand in six months.',
  },
  DUPLICATE_EMPLOYEE_DAY: {
    message: 'This employee and date appear more than once in the file.',
    fix: 'Keep one row per employee per day.',
  },
  DUPLICATE_CONFLICTING_EMPLOYEE_DAY: {
    message: 'This employee and date appear more than once, saying different things.',
    fix: 'Decide which row is right and remove the others.',
  },
  // ── Conflicts: understood, but cannot be applied ──
  LOCKED_DAY: {
    message: 'This day is locked.',
    fix: 'A locked day can only be changed through an individual correction.',
  },
  FINALIZED_DAY: {
    message: 'This day has been finalized.',
    fix: 'A finalized day can only be changed through an individual correction.',
  },
  FINALIZED_MONTH: {
    message: 'This month has been closed for payroll.',
    fix: 'Closed months cannot be changed by import.',
  },
  SENT_MONTH: {
    message: 'This month has already gone to Finance.',
    fix: 'Once a month has been sent it cannot be changed.',
  },
  OPEN_CORRECTION: {
    message: 'A correction for this day is already under review.',
    fix: 'Settle that correction first, then import again.',
  },
  MISSING_AUTHORITATIVE_LEAVE: {
    message: 'There is no approved leave behind this leave day.',
    fix: 'Approve the leave in the Leave workflow first. An import cannot create leave.',
  },
  // ── Warnings ──
  EMPLOYEE_NAME_MISMATCH: {
    message: 'The name in the file does not match the employee record.',
    fix: 'The Employee ID was used. Check you have the right person.',
  },
  NON_WORKING_DAY: {
    message: 'This is a weekly off or a holiday.',
    fix: 'Check the date if that was not intended.',
  },
};

export function explainCode(code: string): CodeExplanation {
  return (
    ROW_CODE[code] ?? {
      // Never a raw code on screen, even for something this file has not met.
      message: 'Apex OS could not accept this row.',
      fix: 'Contact support with the batch reference if this keeps happening.',
    }
  );
}

// ── Current vs proposed ─────────────────────────────────────────────────────

export interface DiffField {
  label: string;
  current: string;
  proposed: string;
  changed: boolean;
}

/**
 * A dash, never an invented time.
 *
 * A historical PRESENT day genuinely has no punches. Rendering 09:30 there
 * would be the frontend fabricating evidence, which is the one thing this
 * whole subsystem exists to prevent.
 */
export const EMPTY = '—';

/** HH:mm in the viewer's locale-independent form, or a dash. */
export function displayTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** PRESENT -> Present. Never a raw enum in front of a person. */
export function displayStatus(status: string | null | undefined): string {
  if (!status) return EMPTY;
  return status
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export interface ComparableRow {
  currentStatus?: string | null;
  currentPunchIn?: string | null;
  currentPunchOut?: string | null;
  proposedStatus?: string | null;
  proposedPunchIn?: string | null;
  proposedPunchOut?: string | null;
}

/**
 * The three facts a reviewer is actually deciding about.
 *
 * Fingerprints, evidence ids, object keys, device and network metadata are
 * deliberately absent -- they are backend audit details, and a review screen is
 * not where private capture data should surface.
 */
export function diffFields(row: ComparableRow): DiffField[] {
  const field = (
    label: string,
    current: string | null | undefined,
    proposed: string | null | undefined,
    render: (v: string | null | undefined) => string,
  ): DiffField => {
    const c = render(current);
    const p = render(proposed);
    return { label, current: c, proposed: p, changed: c !== p };
  };

  return [
    field('Status', row.currentStatus, row.proposedStatus, displayStatus),
    field('Punch in', row.currentPunchIn, row.proposedPunchIn, displayTime),
    field('Punch out', row.currentPunchOut, row.proposedPunchOut, displayTime),
  ];
}

/** Fields that must never reach the screen. Asserted by test against the row type. */
export const NEVER_DISPLAYED = [
  'currentFingerprint',
  'currentPunchInEvidenceId',
  'currentPunchOutEvidenceId',
] as const;

// ── Summary and result wording ──────────────────────────────────────────────

export interface BatchCounts {
  totalRows: number;
  newRows: number;
  matchRows: number;
  changeRows: number;
  conflictRows: number;
  invalidRows: number;
  warningRows: number;
}

export interface SummaryCard {
  label: string;
  value: number;
  tone: Tone;
}

export function summaryCards(counts: BatchCounts): SummaryCard[] {
  return [
    { label: 'Total rows', value: counts.totalRows, tone: 'neutral' },
    { label: 'Changes', value: counts.changeRows, tone: 'neutral' },
    { label: 'New records', value: counts.newRows, tone: 'info' },
    { label: 'No change needed', value: counts.matchRows, tone: 'positive' },
    { label: 'Cannot apply', value: counts.conflictRows, tone: counts.conflictRows > 0 ? 'warn' : 'muted' },
    { label: 'Cannot read', value: counts.invalidRows, tone: counts.invalidRows > 0 ? 'danger' : 'muted' },
    { label: 'Warnings', value: counts.warningRows, tone: counts.warningRows > 0 ? 'warn' : 'muted' },
  ];
}

/** Everything already agrees. The success case of a reconciliation run. */
export function isAllMatch(counts: BatchCounts): boolean {
  return (
    counts.totalRows > 0 &&
    counts.matchRows === counts.totalRows
  );
}

export interface ApplyResult {
  status: string;
  attempted: number;
  applied: number;
  stale: number;
  failed: number;
  noOps: number;
}

export interface ResultLine {
  label: string;
  value: number;
  tone: Tone;
}

/**
 * The result, in the order a person asks the questions: what happened, what
 * did not, and what needs me.
 */
export function resultLines(result: ApplyResult): ResultLine[] {
  const lines: ResultLine[] = [{ label: 'Applied', value: result.applied, tone: 'positive' }];
  if (result.noOps > 0) {
    lines.push({ label: 'Already matched', value: result.noOps, tone: 'positive' });
  }
  if (result.stale > 0) {
    lines.push({ label: 'Need re-review', value: result.stale, tone: 'warn' });
  }
  if (result.failed > 0) {
    lines.push({ label: 'Failed', value: result.failed, tone: 'danger' });
  }
  return lines;
}

/**
 * One honest sentence about a finished run.
 *
 * Never claims every row applied: staleness protection legitimately refuses
 * rows, and a summary that glossed over that would be the screen lying about
 * somebody's attendance.
 */
export function resultHeadline(result: ApplyResult): string {
  if (result.status === 'APPLIED' && result.applied === 0 && result.noOps > 0) {
    return 'Attendance already matches this file. No changes were needed.';
  }
  if (result.status === 'APPLIED') {
    return `${result.applied} ${result.applied === 1 ? 'record' : 'records'} updated.`;
  }
  if (result.status === 'PARTIALLY_APPLIED') {
    return `${result.applied} of ${result.attempted} updated. The rest need reviewing before they can be.`;
  }
  if (result.status === 'REVIEW_REQUIRED') {
    return 'Nothing was changed. Attendance moved after this batch was approved, so the comparison needs refreshing.';
  }
  if (result.status === 'SUPERSEDED') {
    return 'Another run took over this batch. Nothing was changed by this one.';
  }
  return 'This batch could not be completed. Nothing outstanding was changed.';
}

// ── Capability (convenience only) ───────────────────────────────────────────

export interface ActorLike {
  role?: { name?: string } | string | null;
  isHR?: boolean | null;
  isAttendanceDataOperator?: boolean | null;
}

function roleName(actor: ActorLike | null | undefined): string {
  const role = actor?.role;
  return (typeof role === 'string' ? role : role?.name) ?? '';
}

export function isHrOrAdmin(actor: ActorLike | null | undefined): boolean {
  return Boolean(actor?.isHR) || ['ADMIN', 'SUPER_ADMIN'].includes(roleName(actor));
}

/**
 * WHAT THIS IS FOR, AND WHAT IT IS NOT FOR.
 *
 * Deciding which controls to render. That is a convenience, so a data operator
 * is not shown an Approve button that would only refuse them. It is NOT
 * authorization: every one of these routes is authorised in the service, and a
 * hidden button is not a permission check. These mirror the server's rules so
 * the screen agrees with it -- if they ever disagree, the server wins.
 */
export function canPrepare(actor: ActorLike | null | undefined): boolean {
  return isHrOrAdmin(actor) || actor?.isAttendanceDataOperator === true;
}

export function canApprove(actor: ActorLike | null | undefined): boolean {
  return isHrOrAdmin(actor);
}

// ── Errors ──────────────────────────────────────────────────────────────────

export interface HttpErrorLike {
  response?: { status?: number; data?: { message?: string | string[] } };
  message?: string;
}

/**
 * Server errors as sentences.
 *
 * The server's own message is preferred wherever it wrote one -- it knows
 * things this file does not, like WHICH day changed underneath a batch.
 */
export function describeError(error: HttpErrorLike | null | undefined): string {
  const status = error?.response?.status;
  const raw = error?.response?.data?.message;
  const fromServer = Array.isArray(raw) ? raw.join(' ') : raw;

  if (status === 401) return 'Your session has expired. Sign in again.';
  if (status === 403) {
    return fromServer || 'You do not have permission to do that.';
  }
  if (status === 409) {
    return fromServer || 'Another apply operation is already in progress for this batch.';
  }
  if (status === 413) return 'That file is too large. The limit is 5 MB.';
  if (status && status >= 500) {
    return 'Apex OS could not complete that. Nothing was changed. Try again in a moment.';
  }
  return fromServer || error?.message || 'Something went wrong. Nothing was changed.';
}

/** A 409 during apply/resume means somebody else holds the batch right now. */
export function isConcurrentApply(error: HttpErrorLike | null | undefined): boolean {
  return error?.response?.status === 409;
}

// ── Upload validation (client-side courtesy only) ───────────────────────────

export const ACCEPTED_EXTENSIONS = ['.xlsx', '.csv'] as const;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * A courtesy check so an obviously wrong file does not cost a round trip.
 * The server re-checks everything; this never decides that a file is GOOD.
 */
export function rejectFileReason(file: { name: string; size: number }): string | null {
  const lower = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    // .xls and .xlsm are named explicitly: they look close enough to right
    // that "unsupported format" would read as a bug rather than a rule.
    if (lower.endsWith('.xls') || lower.endsWith('.xlsm')) {
      return 'Save this as .xlsx first. Older .xls and macro-enabled files are not accepted.';
    }
    return 'Upload an .xlsx or .csv file.';
  }
  if (file.size > MAX_UPLOAD_BYTES) return 'That file is too large. The limit is 5 MB.';
  if (file.size === 0) return 'That file is empty.';
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── Wizard steps ────────────────────────────────────────────────────────────

export const WIZARD_STEPS = [
  { key: 'TEMPLATE', label: 'Template' },
  { key: 'UPLOAD', label: 'Upload' },
  { key: 'REVIEW', label: 'Review' },
  { key: 'APPROVE', label: 'Approve' },
  { key: 'APPLY', label: 'Apply' },
  { key: 'RESULT', label: 'Result' },
] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number]['key'];

/**
 * Where the batch actually is, derived from the SERVER's status rather than
 * from what the user last clicked. Reloading the page lands in the right place,
 * and two people looking at one batch see the same step.
 */
export function stepForStatus(status: string | null | undefined): WizardStep {
  if (!status) return 'UPLOAD';
  switch (status) {
    case 'UPLOADING':
    case 'VALIDATING':
      return 'UPLOAD';
    case 'READY_FOR_REVIEW':
    case 'HAS_ERRORS':
      return 'REVIEW';
    case 'APPROVED':
      return 'APPLY';
    case 'APPLYING':
      return 'APPLY';
    case 'APPLIED':
    case 'PARTIALLY_APPLIED':
    case 'REVIEW_REQUIRED':
    case 'FAILED':
    case 'CANCELLED':
      return 'RESULT';
    default:
      return 'REVIEW';
  }
}

// ── Download filenames ──────────────────────────────────────────────────────

/**
 * The server's own names, mirrored on this side.
 *
 * The response interceptor returns response.data, so Content-Disposition never
 * reaches the client and the name cannot be read off the response. Both are
 * pinned to the server's constants by test -- renaming one side fails the build
 * rather than silently saving a file nobody can identify later.
 */
export const IMPORT_TEMPLATE_FILENAME = 'Apex_OS_Attendance_Import_Template.xlsx';

export function errorWorkbookFileName(reference: string): string {
  return `Attendance_Import_Errors_${reference}.xlsx`;
}
