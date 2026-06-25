import { Injectable } from '@nestjs/common';
import { Workbook } from 'exceljs';

// Column order matches the published template exactly (apex-ticket-import-template.xlsx).
// Header lookup below is case-insensitive and accepts a couple of common header
// variants, so re-ordering or lightly renaming columns in a user's copy still maps.
const TEMPLATE_COLUMNS = [
  { header: 'Type', key: 'type', width: 12 },
  { header: 'Title', key: 'title', width: 36 },
  { header: 'Description', key: 'description', width: 40 },
  { header: 'Department', key: 'department', width: 20 },
  { header: 'Task Type / Category', key: 'taskType', width: 24 },
  { header: 'Subtype', key: 'subtype', width: 20 },
  { header: 'Assigned To Email', key: 'assigneeEmail', width: 28 },
  { header: 'Priority', key: 'priority', width: 12 },
  { header: 'Due Date', key: 'dueDate', width: 14 },
  { header: 'Due Time', key: 'dueTime', width: 12 },
  { header: 'Est Hours', key: 'estHours', width: 10 },
  { header: 'Est Minutes', key: 'estMinutes', width: 12 },
  { header: 'Project', key: 'project', width: 20 },
  { header: 'Schedule Start', key: 'scheduleStart', width: 16 },
  { header: 'Schedule End', key: 'scheduleEnd', width: 16 },
  { header: 'Notes', key: 'notes', width: 30 },
];

const HEADER_TO_KEY: Record<string, string> = {
  'type': 'type', 'request type': 'type',
  'title': 'title',
  'description': 'description',
  'department': 'department',
  'task type / category': 'taskType', 'task type': 'taskType', 'category': 'taskType',
  'subtype': 'subtype',
  'assigned to email': 'assigneeEmail', 'assignee email': 'assigneeEmail',
  'priority': 'priority',
  'due date': 'dueDate',
  'due time': 'dueTime',
  'est hours': 'estHours', 'estimated hours': 'estHours',
  'est minutes': 'estMinutes', 'estimated minutes': 'estMinutes',
  'project': 'project',
  'schedule start': 'scheduleStart', 'scheduled start': 'scheduleStart',
  'schedule end': 'scheduleEnd', 'scheduled end': 'scheduleEnd',
  'notes': 'notes',
};

// exceljs gives back a JS Date for any cell Excel treats as a date/time, built
// from the cell's UTC-serialized components — read those components back
// literally (don't re-interpret through any timezone) so "2026-06-26" typed
// into a date cell round-trips as that exact calendar date, not shifted by
// whatever timezone happens to be running this process.
function cellText(cell: any): string {
  const value = cell?.value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    const hh = value.getUTCHours();
    const mm = value.getUTCMinutes();
    if (hh === 0 && mm === 0) return `${y}-${m}-${d}`;
    return `${y}-${m}-${d}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  if (typeof value === 'object') {
    if ('text' in value) return String(value.text).trim();
    if ('richText' in value) return value.richText.map((t: any) => t.text).join('').trim();
    if ('result' in value) return String(value.result ?? '').trim();
  }
  return String(value).trim();
}

export interface ImportRawRow {
  row: number; // 1-based data row number, header excluded (row 1 in the sheet = data row 1)
  raw: Record<string, string>;
}

@Injectable()
export class TicketImportService {
  async generateTemplate(): Promise<Buffer> {
    const wb = new Workbook();
    wb.creator = 'Apex OS';
    wb.created = new Date();
    const ws = wb.addWorksheet('Tickets');
    ws.columns = TEMPLATE_COLUMNS as any;
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    ws.addRow({
      type: 'TASK',
      title: 'Create poster design',
      description: 'Need design for campaign',
      department: 'Marketing',
      taskType: 'Design',
      subtype: '',
      assigneeEmail: 'jane@company.com',
      priority: 'HIGH',
      dueDate: '2026-06-26',
      dueTime: '18:00',
      estHours: 2,
      estMinutes: 30,
      project: '',
      scheduleStart: '',
      scheduleEnd: '',
      notes: 'Example row — delete before importing',
    });
    const exampleRow = ws.getRow(2);
    exampleRow.font = { italic: true, color: { argb: 'FF888888' } };

    const raw = await wb.xlsx.writeBuffer();
    return Buffer.from(raw);
  }

  async parseRows(buffer: Buffer): Promise<ImportRawRow[]> {
    const wb = new Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) return [];

    const colIndexByKey: Record<string, number> = {};
    ws.getRow(1).eachCell((cell, colNumber) => {
      const key = HEADER_TO_KEY[String(cell.value ?? '').trim().toLowerCase()];
      if (key) colIndexByKey[key] = colNumber;
    });

    const out: ImportRawRow[] = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // header row
      const raw: Record<string, string> = {};
      for (const key of Object.keys(colIndexByKey)) {
        raw[key] = cellText(row.getCell(colIndexByKey[key]));
      }
      const isEmpty = Object.values(raw).every((v) => !v);
      if (isEmpty) return;
      out.push({ row: rowNumber - 1, raw });
    });
    return out;
  }
}
