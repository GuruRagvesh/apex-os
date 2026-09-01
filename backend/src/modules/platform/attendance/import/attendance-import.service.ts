import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';
import { AccessPolicyService } from '../../../../common/services/access-policy.service';
import { LeaveFactsService } from '../evaluation/leave-facts.service';
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  extractRows,
  findDuplicateKeys,
  type Cell,
  type FileProblem,
} from './import-rows';
import {
  normalizeRow,
  type EmployeeRef,
  type ImportMode,
  type NormalizedRow,
} from './import-normalize';
import {
  buildErrorFileRows,
  classifyRow,
  summarise,
  type ClassifiedRow,
  type CurrentDay,
  type ImportSummary,
} from './import-classify';

/**
 * Reading an attendance file and saying what it would do. Nothing else.
 *
 * PHASE 3 WRITES NOTHING. There is no create, update or upsert in this file,
 * and a test asserts that by inspecting the source. Persistence arrives in
 * Phase 4 and application in Phase 5; until then the most this can do is
 * describe a change somebody might later approve.
 *
 * Every lookup is bulk. Six thousand rows resolved one query at a time would be
 * twenty-four thousand round trips, which is the pattern that already made the
 * monthly views feel broken -- so employees, existing attendance, month closes,
 * open corrections and approved leave are each fetched once for the whole file
 * and compared in memory.
 */

/** Statuses that mean a correction has not been settled yet. */
const OPEN_CORRECTION_STATUSES = ['PENDING', 'MANAGER_APPROVED'] as const;

export interface ImportPreview {
  mode: ImportMode;
  fileName: string;
  fileByteSize: number;
  /**
   * Reported, never used to refuse a file. The same workbook may legitimately
   * be uploaded again to check what has changed since; Phase 4 uses this to say
   * "this file has been seen before", which is information, not a verdict.
   */
  fileSha256: string;
  periodFrom: string | null;
  periodTo: string | null;
  fileProblems: FileProblem[];
  summary: ImportSummary;
  rows: ClassifiedRow[];
  errorFile: ReturnType<typeof buildErrorFileRows>;
}

@Injectable()
export class AttendanceImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly accessPolicy: AccessPolicyService,
    private readonly leaveFacts: LeaveFactsService,
  ) {}

  /**
   * Who may prepare an import.
   *
   * A data operator prepares COMPANY-WIDE, because a payroll file covers
   * everybody and an operator who could only validate their own department
   * could not do the job at all. That reach is confined to this subsystem: the
   * flag grants no Daily Review, no Monthly Register, and no authority to
   * apply anything. HR, Admin and Super Admin approve; an operator never does.
   */
  assertMayPrepare(actor: any) {
    const mayPrepare =
      this.accessPolicy.isHrOrAdmin(actor) || actor?.isAttendanceDataOperator === true;
    if (!mayPrepare) {
      throw new ForbiddenException(
        'Preparing an attendance import is limited to HR, administrators, and the attendance data operator.',
      );
    }
  }

  /** Only HR authority may approve or apply. Phase 5 uses this; nothing does yet. */
  assertMayApprove(actor: any) {
    if (!this.accessPolicy.isHrOrAdmin(actor)) {
      throw new ForbiddenException('Only HR or an administrator can approve an attendance import.');
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Reading the file
  // ───────────────────────────────────────────────────────────────────────

  /**
   * A workbook or a CSV as one grid of cells.
   *
   * Both readers produce the same shape, so every rule downstream applies
   * identically to an .xlsx and a .csv rather than being written twice and
   * drifting.
   *
   * exceljs is asked for cell VALUES. A formula cell yields its cached result
   * and is never evaluated -- an import must state a fact, not compute one.
   */
  async readGrid(buffer: Buffer, fileName: string): Promise<Cell[][]> {
    if (buffer.byteLength > MAX_IMPORT_BYTES) {
      throw new BadRequestException(
        `That file is larger than ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} MB. Split it into smaller uploads.`,
      );
    }

    const lower = (fileName ?? '').toLowerCase();
    if (lower.endsWith('.csv')) return this.readCsv(buffer);
    if (!lower.endsWith('.xlsx')) {
      throw new BadRequestException('Upload an .xlsx or .csv file. Older .xls and macro-enabled .xlsm are not supported.');
    }

    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as any);
    } catch {
      throw new BadRequestException('That file could not be opened as a spreadsheet.');
    }

    const sheet = wb.getWorksheet('Attendance Import') ?? wb.worksheets[0];
    if (!sheet) throw new BadRequestException('The workbook has no sheets.');

    const grid: Cell[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: Cell[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        const v: any = cell.value;
        // A formula cell carries { formula, result }. The cached result is the
        // value; the formula itself is never run.
        cells[col - 1] = v && typeof v === 'object' && 'result' in v ? v.result : (v as Cell);
      });
      grid.push(cells);
      if (grid.length > MAX_IMPORT_ROWS + 50) return false;
      return true;
    });

    return grid;
  }

  /** RFC 4180 enough for a file Excel produced: quoted fields, doubled quotes. */
  private readCsv(buffer: Buffer): Cell[][] {
    // Strip a UTF-8 BOM, which Excel writes and which would otherwise become
    // part of the first header cell and break header detection.
    const content = buffer.toString('utf8').replace(/^﻿/, '');
    const grid: Cell[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;

    for (let i = 0; i < content.length; i += 1) {
      const ch = content[i];
      if (quoted) {
        if (ch === '"') {
          if (content[i + 1] === '"') { field += '"'; i += 1; }
          else quoted = false;
        } else field += ch;
        continue;
      }
      if (ch === '"') { quoted = true; continue; }
      if (ch === ',') { row.push(field); field = ''; continue; }
      if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && content[i + 1] === '\n') i += 1;
        row.push(field);
        grid.push(row);
        row = [];
        field = '';
        if (grid.length > MAX_IMPORT_ROWS + 50) break;
        continue;
      }
      field += ch;
    }
    if (field !== '' || row.length > 0) { row.push(field); grid.push(row); }

    return grid;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Preview
  // ───────────────────────────────────────────────────────────────────────

  /**
   * The whole read-only pipeline: parse, normalize, compare, classify.
   *
   * Returns what WOULD happen. Nothing is written, and nothing is remembered.
   */
  async preview(
    actor: any,
    input: { buffer: Buffer; fileName: string; mode: ImportMode },
  ): Promise<ImportPreview> {
    this.assertMayPrepare(actor);

    const fileSha256 = createHash('sha256').update(input.buffer).digest('hex');
    const grid = await this.readGrid(input.buffer, input.fileName);
    const extracted = extractRows(grid);

    const base = {
      mode: input.mode,
      fileName: input.fileName,
      fileByteSize: input.buffer.byteLength,
      fileSha256,
    };

    if (extracted.rows.length === 0) {
      return {
        ...base,
        periodFrom: null,
        periodTo: null,
        fileProblems: extracted.problems,
        summary: summarise([]),
        rows: [],
        errorFile: [],
      };
    }

    // ── One query per THING, never per row ────────────────────────────────
    const employeeIds = [...new Set(extracted.rows.map((r) => r.rawEmployeeId.trim().toUpperCase()).filter(Boolean))];
    const employees = await this.prisma.user.findMany({
      where: { employeeId: { in: employeeIds } },
      select: { id: true, employeeId: true, name: true, joiningDate: true, lastWorkingDate: true },
    });
    const employeesByEmployeeId = new Map<string, EmployeeRef>(
      employees
        .filter((e): e is typeof e & { employeeId: string } => Boolean(e.employeeId))
        .map((e) => [e.employeeId.toUpperCase(), e as EmployeeRef]),
    );

    const companyToday = this.tva.companyToday();
    const normalized: NormalizedRow[] = extracted.rows.map((raw) =>
      normalizeRow(raw, {
        mode: input.mode,
        employeesByEmployeeId,
        companyToday,
        // The company-time authority, not a second conversion. It takes the
        // offset from the target date, so a historical month resolves with the
        // offset that was in force then rather than today's.
        toCompanyInstant: (businessDate, hhmm) => {
          const at = this.tva.companyInstantAt(businessDate, hhmm);
          // hhmm has already been validated by the normalizer, so a null here
          // would be a contradiction rather than bad input.
          if (!at) throw new Error(`Company time could not be resolved for ${businessDate} ${hhmm}`);
          return at;
        },
      }),
    );

    const resolved = normalized.filter((r) => r.proposal);
    const dates = resolved.map((r) => r.proposal!.businessDate).sort();
    const periodFrom = dates[0] ?? null;
    const periodTo = dates[dates.length - 1] ?? null;

    const userIds = [...new Set(resolved.map((r) => r.proposal!.userId))];
    const [records, monthCloses, openCorrections] = await Promise.all([
      periodFrom && periodTo
        ? this.prisma.dailyAttendance.findMany({
            where: {
              userId: { in: userIds },
              date: {
                gte: this.tva.companyDateOnly(new Date(`${periodFrom}T00:00:00.000Z`)),
                lte: this.tva.companyDateOnly(new Date(`${periodTo}T00:00:00.000Z`)),
              },
            },
            select: {
              userId: true, date: true, status: true, punchInAt: true, punchOutAt: true,
              evaluationState: true, locked: true, punchInEvidenceId: true, punchOutEvidenceId: true,
            },
          })
        : Promise.resolve([]),
      this.prisma.attendanceMonthClose.findMany({
        where: { month: { in: [...new Set(dates.map((d) => d.slice(0, 7)))] } },
        select: { month: true, status: true },
      }),
      periodFrom && periodTo
        ? this.prisma.attendanceRegularization.findMany({
            where: {
              userId: { in: userIds },
              status: { in: [...OPEN_CORRECTION_STATUSES] },
              date: {
                gte: this.tva.companyDateOnly(new Date(`${periodFrom}T00:00:00.000Z`)),
                lte: this.tva.companyDateOnly(new Date(`${periodTo}T00:00:00.000Z`)),
              },
            },
            select: { userId: true, date: true },
          })
        : Promise.resolve([]),
    ]);

    const key = (userId: string, businessDate: string) => `${userId}|${businessDate}`;

    const currentByKey = new Map<string, CurrentDay>(
      records.map((r) => [
        key(r.userId, this.tva.companyBusinessDate(r.date)),
        {
          status: r.status,
          punchInAt: r.punchInAt,
          punchOutAt: r.punchOutAt,
          evaluationState: r.evaluationState,
          locked: r.locked,
          hasEvidence: Boolean(r.punchInEvidenceId || r.punchOutEvidenceId),
        },
      ]),
    );

    // ── Leave authority, only for rows that claim it ──────────────────────
    //
    // Asked employee-day by employee-day through LeaveFactsService, because
    // "is there approved leave covering this date" is its question and a second
    // implementation here would eventually answer differently. Restricted to
    // the rows that actually claim LEAVE or LWP, and de-duplicated, so a file
    // with no leave in it costs nothing.
    const leaveKeys = [
      ...new Set(
        resolved
          .filter((r) => r.proposal!.proposedStatus === 'LEAVE' || r.proposal!.proposedStatus === 'LWP')
          .map((r) => key(r.proposal!.userId, r.proposal!.businessDate)),
      ),
    ];
    const approvedLeaveByKey = new Map<string, { kind: string; leaveType?: string | null }>();
    const BATCH = 12;
    for (let i = 0; i < leaveKeys.length; i += BATCH) {
      const slice = leaveKeys.slice(i, i + BATCH);
      const facts = await Promise.all(
        slice.map((k) => {
          const [userId, businessDate] = k.split('|');
          return this.leaveFacts
            .resolveForDate(userId, businessDate)
            .catch(() => ({ kind: 'NONE' as const, leaveType: null }));
        }),
      );
      slice.forEach((k, n) => approvedLeaveByKey.set(k, facts[n] as any));
    }

    const duplicates = this.duplicates(resolved);

    const rows = normalized.map((row) =>
      classifyRow(row, {
        currentByKey,
        monthStatusByMonth: new Map(monthCloses.map((m) => [m.month, m.status])),
        openCorrections: new Set(
          openCorrections.map((c) => key(c.userId, this.tva.companyBusinessDate(c.date))),
        ),
        approvedLeaveByKey,
        duplicateRows: duplicates,
      }),
    );

    return {
      ...base,
      periodFrom,
      periodTo,
      fileProblems: extracted.problems,
      summary: summarise(rows),
      rows,
      errorFile: buildErrorFileRows(rows),
    };
  }

  /** Employee-days repeated in one file, and whether the repeats disagree. */
  private duplicates(resolved: NormalizedRow[]) {
    const found = findDuplicateKeys(
      resolved.map((r) => ({
        rowNumber: r.rowNumber,
        employeeKey: r.proposal!.userId,
        businessDate: r.proposal!.businessDate,
      })),
    );

    const byKey = new Map<string, NormalizedRow[]>();
    for (const r of resolved) {
      const k = `${r.proposal!.userId}|${r.proposal!.businessDate}`;
      byKey.set(k, [...(byKey.get(k) ?? []), r]);
    }

    const out = new Map<string, { rows: number[]; conflicting: boolean }>();
    for (const [k, lines] of found) {
      const group = byKey.get(k) ?? [];
      const shapes = new Set(
        group.map((r) => {
          const p = r.proposal!;
          return [
            p.proposedStatus,
            p.proposedPunchIn?.toISOString() ?? '',
            p.proposedPunchOut?.toISOString() ?? '',
            p.proposedHalfDay ?? '',
          ].join('|');
        }),
      );
      out.set(k, { rows: lines, conflicting: shapes.size > 1 });
    }
    return out;
  }
}
