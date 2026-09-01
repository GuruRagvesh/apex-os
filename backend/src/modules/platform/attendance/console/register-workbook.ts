import * as ExcelJS from 'exceljs';
import {
  REGISTER_COLUMNS,
  monthLabel,
  type RegisterResult,
} from './register-report';

/**
 * The monthly register as a workbook.
 *
 * exceljs is already a dependency (the payroll workbook uses it), so nothing
 * new is installed for this. One sheet, seven columns, a three-line heading
 * that says which month and how many working days it contains -- a file whose
 * meaning survives being emailed on without the page it came from.
 *
 * Counts are written as NUMBERS and the completion as a real Excel PERCENTAGE,
 * so the columns can be sorted, averaged and filtered. A pre-formatted string
 * like "95.45%" looks identical on screen and is useless in a spreadsheet.
 */

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF1F5F9' },
};

const WIDTHS: Record<string, number> = {
  name: 28,
  daysPresent: 20,
  daysAbsent: 20,
  halfDays: 18,
  leaveBalance: 16,
  latePunchIns: 22,
  attendanceCompletionPercentage: 24,
};

export function buildRegisterWorkbook(
  result: RegisterResult,
  generatedAt: Date,
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Apex OS Attendance';

  // Pinned to the supplied instant rather than the clock, so two renders of the
  // same month produce the same bytes.
  wb.created = generatedAt;
  wb.modified = generatedAt;

  const sheet = wb.addWorksheet('Monthly Register');

  sheet.addRow(['Apex OS — Monthly Attendance Register']);
  sheet.addRow([`Month: ${monthLabel(result.month)}`]);
  sheet.addRow([`Working Days: ${result.workingDays}`]);
  sheet.addRow([]);
  sheet.getRow(1).font = { bold: true, size: 13 };

  const headerRow = sheet.addRow(REGISTER_COLUMNS.map((c) => c.header));
  headerRow.font = { bold: true };
  headerRow.fill = HEADER_FILL;
  headerRow.alignment = { vertical: 'middle' };

  REGISTER_COLUMNS.forEach((c, i) => {
    sheet.getColumn(i + 1).width = WIDTHS[c.key] ?? 18;
  });

  for (const e of result.employees) {
    const row = sheet.addRow([
      e.name ?? '',
      e.daysPresent,
      e.daysAbsent,
      e.halfDays,
      // Blank, not 0: an unreadable balance is unknown, not exhausted.
      e.leaveBalance ?? null,
      e.latePunchIns,
      // Excel percentages are fractions. 95.45% is stored as 0.9545 and the
      // number format supplies the sign; storing 95.45 with a % format would
      // display 9545%.
      e.attendanceCompletionPercentage === null
        ? null
        : e.attendanceCompletionPercentage / 100,
    ]);
    row.getCell(REGISTER_COLUMNS.length).numFmt = '0.00%';
  }

  // The heading block plus the column header stay in view while HR scrolls
  // through thirty-odd employees.
  sheet.views = [{ state: 'frozen', ySplit: 5 }];

  return wb;
}
