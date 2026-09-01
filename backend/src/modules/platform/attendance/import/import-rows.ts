/**
 * Getting rows out of a spreadsheet, and refusing the ones that are not rows.
 *
 * Pure: it is handed a grid of cells, not a file. Whoever read the .xlsx or the
 * .csv has already dealt with the file format; from here on an Excel workbook
 * and a CSV are the same thing, and the rules below cannot accidentally differ
 * between them.
 *
 * Nothing here knows what attendance is. It produces raw rows, exactly as
 * typed, and says whether the file has the shape of an attendance import at
 * all.
 */

/** One cell as either reader hands it over. */
export type Cell = string | number | Date | boolean | null | undefined;

export const IMPORT_COLUMNS = [
  'Employee ID',
  'Employee Name',
  'Date',
  'Status',
  'Punch In',
  'Punch Out',
  'Half Day',
  'Leave Type',
  'Reason',
] as const;

/**
 * Enough for roughly 34 employees across a year, with room to be wrong about
 * the headcount. A file larger than this is not a correction, it is a different
 * conversation.
 */
export const MAX_IMPORT_ROWS = 20_000;

/** Matches the ticket importer's existing ceiling. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export interface RawImportRow {
  /** The line in the spreadsheet, so an error file can point at it. */
  rowNumber: number;
  rawEmployeeId: string;
  rawEmployeeName: string;
  rawDate: string;
  rawStatus: string;
  rawPunchIn: string;
  rawPunchOut: string;
  rawHalfDay: string;
  rawLeaveType: string;
  rawReason: string;
  /**
   * The date cell as the reader gave it, kept alongside the string form.
   *
   * Excel stores a date as a number and a formatted string is a display
   * decision; the reader may hand over either. Discarding the typed value would
   * force the normalizer to re-parse text that had already been unambiguous.
   */
  dateCell: Cell;
  punchInCell: Cell;
  punchOutCell: Cell;
}

export type FileProblemCode =
  | 'EMPTY_FILE'
  | 'MISSING_HEADER'
  | 'MISSING_REQUIRED_COLUMNS'
  | 'AGGREGATE_ONLY_HISTORY_UNSUPPORTED'
  | 'TOO_MANY_ROWS';

export interface FileProblem {
  code: FileProblemCode;
  message: string;
}

const text = (cell: Cell): string => {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString();
  return String(cell).trim();
};

const normaliseHeader = (cell: Cell) => text(cell).toLowerCase().replace(/[^a-z]/g, '');

/**
 * Columns that make a file a DAILY attendance import.
 *
 * A file without a date column is the aggregate-only shape: "Ajay, 21 present,
 * 2 absent". It cannot become attendance without inventing which 21 days those
 * were, so it is refused by name rather than parsed into something plausible.
 */
const REQUIRED_HEADERS = ['employeeid', 'date', 'status'];

const AGGREGATE_HEADERS = ['presentdays', 'absentdays', 'halfdays', 'totalpresent', 'dayspresent'];

export interface ExtractResult {
  rows: RawImportRow[];
  problems: FileProblem[];
  /** Header row index (0-based) in the supplied grid, or -1. */
  headerRow: number;
}

/**
 * Finds the header, then reads every row under it.
 *
 * The header is searched for rather than assumed to be line 1: people add a
 * title row, a company logo, or an empty line above a table without thinking of
 * it as editing the file.
 */
export function extractRows(grid: Cell[][]): ExtractResult {
  const problems: FileProblem[] = [];

  const meaningful = grid.filter((row) => row.some((c) => text(c) !== ''));
  if (meaningful.length === 0) {
    return { rows: [], headerRow: -1, problems: [{ code: 'EMPTY_FILE', message: 'The file contains no rows.' }] };
  }

  let headerRow = -1;
  for (let i = 0; i < Math.min(grid.length, 20); i += 1) {
    const headers = grid[i].map(normaliseHeader);
    if (headers.includes('employeeid')) {
      headerRow = i;
      break;
    }
  }

  if (headerRow === -1) {
    return {
      rows: [],
      headerRow: -1,
      problems: [
        {
          code: 'MISSING_HEADER',
          message: 'No header row was found. Start from the Apex OS import template.',
        },
      ],
    };
  }

  const headers = grid[headerRow].map(normaliseHeader);
  const at = (name: string) => headers.indexOf(name);

  // Aggregate-only is detected BEFORE the missing-column complaint, because
  // "your file has no Date column" is a true but unhelpful way to say "this is
  // a monthly summary and no importer can turn it into days".
  if (at('date') === -1 && AGGREGATE_HEADERS.some((h) => headers.includes(h))) {
    return {
      rows: [],
      headerRow,
      problems: [
        {
          code: 'AGGREGATE_ONLY_HISTORY_UNSUPPORTED',
          message:
            'This file holds monthly totals rather than one row per day. Apex OS will not guess which ' +
            'dates produced those totals — supply a row per employee per date.',
        },
      ],
    };
  }

  const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    return {
      rows: [],
      headerRow,
      problems: [
        {
          code: 'MISSING_REQUIRED_COLUMNS',
          message: `The file is missing required column(s): ${missing.join(', ')}.`,
        },
      ],
    };
  }

  const idx = {
    employeeId: at('employeeid'),
    name: at('employeename'),
    date: at('date'),
    status: at('status'),
    punchIn: at('punchin'),
    punchOut: at('punchout'),
    halfDay: at('halfday'),
    leaveType: at('leavetype'),
    reason: at('reason'),
  };

  const cell = (row: Cell[], i: number): Cell => (i === -1 ? null : row[i]);

  const rows: RawImportRow[] = [];
  for (let i = headerRow + 1; i < grid.length; i += 1) {
    const row = grid[i];
    // A blank line inside a sheet is formatting, not a row.
    if (!row || !row.some((c) => text(c) !== '')) continue;

    rows.push({
      // 1-based, matching what the spreadsheet application shows.
      rowNumber: i + 1,
      rawEmployeeId: text(cell(row, idx.employeeId)),
      rawEmployeeName: text(cell(row, idx.name)),
      rawDate: text(cell(row, idx.date)),
      rawStatus: text(cell(row, idx.status)),
      rawPunchIn: text(cell(row, idx.punchIn)),
      rawPunchOut: text(cell(row, idx.punchOut)),
      rawHalfDay: text(cell(row, idx.halfDay)),
      rawLeaveType: text(cell(row, idx.leaveType)),
      rawReason: text(cell(row, idx.reason)),
      dateCell: cell(row, idx.date),
      punchInCell: cell(row, idx.punchIn),
      punchOutCell: cell(row, idx.punchOut),
    });

    if (rows.length > MAX_IMPORT_ROWS) {
      problems.push({
        code: 'TOO_MANY_ROWS',
        message: `This file has more than ${MAX_IMPORT_ROWS.toLocaleString()} rows. Split it into smaller uploads.`,
      });
      break;
    }
  }

  if (rows.length === 0 && problems.length === 0) {
    problems.push({ code: 'EMPTY_FILE', message: 'The file has a header but no data rows.' });
  }

  return { rows, headerRow, problems };
}

/**
 * Employee-days appearing more than once in one file.
 *
 * Never resolved by picking one. Two rows for the same person on the same day
 * are a question about the source data, and answering it by preferring the
 * later line would silently discard whichever the operator actually meant.
 */
export function findDuplicateKeys(
  rows: Array<{ rowNumber: number; employeeKey: string; businessDate: string }>,
): Map<string, number[]> {
  const seen = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.employeeKey || !row.businessDate) continue;
    const key = `${row.employeeKey}|${row.businessDate}`;
    seen.set(key, [...(seen.get(key) ?? []), row.rowNumber]);
  }
  for (const [key, lines] of seen) if (lines.length < 2) seen.delete(key);
  return seen;
}
