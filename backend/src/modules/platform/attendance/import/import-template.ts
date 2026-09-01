import * as ExcelJS from 'exceljs';
import {
  HALF_DAY_SESSIONS,
  IMPORTABLE_STATUSES,
  LEAVE_TYPES,
} from './import-normalize';
import { IMPORT_COLUMNS } from './import-rows';

/**
 * The workbook an operator fills in.
 *
 * exceljs is already a dependency, so nothing new is installed.
 *
 * Every column an importer parses is written as TEXT. Excel is helpful in ways
 * that destroy data here: it turns "2026-08-14" into a serial number formatted
 * by locale, strips the leading zero from an employee ID, and reformats "09:38"
 * into whatever the machine's regional settings prefer. The parser copes with
 * all of that, but a file that never gets mangled is better than one that has
 * to be un-mangled.
 *
 * There are no formulas and no macros. A formula is a value the file computes
 * rather than states, and an import must be a statement.
 */

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF1F5F9' },
};

const WIDTHS: Record<string, number> = {
  'Employee ID': 16,
  'Employee Name': 26,
  Date: 14,
  Status: 14,
  'Punch In': 12,
  'Punch Out': 12,
  'Half Day': 16,
  'Leave Type': 16,
  Reason: 46,
};

export const IMPORT_TEMPLATE_FILENAME = 'Apex_OS_Attendance_Import_Template.xlsx';

export function buildImportTemplate(generatedAt: Date): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Apex OS Attendance';
  // Pinned so two downloads of the same template are the same bytes.
  wb.created = generatedAt;
  wb.modified = generatedAt;

  // ── Sheet 1: the table people fill in ──────────────────────────────────
  const sheet = wb.addWorksheet('Attendance Import');
  const header = sheet.addRow([...IMPORT_COLUMNS]);
  header.font = { bold: true };
  header.fill = HEADER_FILL;

  IMPORT_COLUMNS.forEach((name, i) => {
    const column = sheet.getColumn(i + 1);
    column.width = WIDTHS[name] ?? 16;
    // '@' is Excel's text format. Applied to the whole column so a value typed
    // into row 500 is treated the same as one typed into row 2.
    column.numFmt = '@';
  });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  // One worked example, so the expected shape is visible rather than described.
  const example = sheet.addRow([
    'TE-014',
    'Example Employee — delete this row',
    '2026-08-14',
    'PRESENT',
    '09:38',
    '18:42',
    '',
    '',
    'Office internet outage — attendance could not be recorded that day.',
  ]);
  example.font = { italic: true, color: { argb: 'FF94A3B8' } };

  // ── Sheet 2: what the values mean ──────────────────────────────────────
  const ref = wb.addWorksheet('Reference');
  ref.getColumn(1).width = 24;
  ref.getColumn(2).width = 86;

  const heading = (t: string) => {
    const r = ref.addRow([t, '']);
    r.font = { bold: true };
    return r;
  };

  heading('Apex OS — Attendance import');
  ref.addRow(['', 'One row per employee per date. Fill in the first sheet and delete the grey example row.']);
  ref.addRow(['', '']);

  heading('Employee ID');
  ref.addRow(['', 'This is the identity. Employee Name is only so a person can check the row by eye —']);
  ref.addRow(['', 'it is never used to decide who the row belongs to, and a mismatch is reported as a warning.']);
  ref.addRow(['', '']);

  heading('Date');
  ref.addRow(['', 'Write it as yyyy-MM-dd, for example 2026-08-14.']);
  ref.addRow(['', 'A date like 01/02/26 is refused rather than guessed: it means three different days in']);
  ref.addRow(['', 'three different places, and a wrong guess produces attendance for a day nobody worked.']);
  ref.addRow(['', '']);

  heading('Status');
  ref.addRow(['', IMPORTABLE_STATUSES.join('   ')]);
  ref.addRow(['', '']);

  heading('Punch In / Punch Out');
  ref.addRow(['', 'HH:mm in company time, for example 09:38. Punch out must be later the same day —']);
  ref.addRow(['', 'shifts crossing midnight are not supported by this import.']);
  ref.addRow(['', 'A historical migration may record PRESENT with no times when the originals were never kept.']);
  ref.addRow(['', 'Apex OS will not invent times, and a day with no known punch in never counts as late.']);
  ref.addRow(['', '']);

  heading('Half Day');
  ref.addRow(['', `${HALF_DAY_SESSIONS.join('   ')} — required when Status is HALF_DAY, and not allowed otherwise.`]);
  ref.addRow(['', '']);

  heading('Leave Type');
  ref.addRow(['', LEAVE_TYPES.join('   ')]);
  ref.addRow(['', 'Only on a LEAVE row. An import cannot create leave: if Apex OS holds no approved leave']);
  ref.addRow(['', 'for that employee and date, the row is reported as a conflict for HR to resolve in Leave.']);
  ref.addRow(['', '']);

  heading('Reason');
  ref.addRow(['', 'Required on every row, and at least 10 characters. It becomes the permanent record of']);
  ref.addRow(['', 'why this day says something the punch record never said.']);
  ref.addRow(['', '']);

  heading('What is never asked for');
  ref.addRow(['', 'There are no columns for location, photo, accuracy or device, and there never will be.']);
  ref.addRow(['', 'Imported days record that evidence is unavailable rather than manufacturing any.']);

  ref.getColumn(1).numFmt = '@';
  ref.getColumn(2).numFmt = '@';

  return wb;
}
