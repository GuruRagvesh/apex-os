/**
 * archive-v2: the complete structured archive of one person.
 *
 * Every row the dependency matrix ties to them -- no caps, no sampling -- one
 * sheet per matrix group, plus:
 *   Manifest  row count and SHA-256 of every sheet, versions, fingerprint
 *   Files     every copied file: archive name, size, SHA-256, shared flag, and
 *             the original provider reference (kept here, inside the private
 *             archive, because restoration needs it)
 *
 * If any sheet would exceed Excel's row limit, or any cell its character limit,
 * archival is refused. A truncated archive must never be called complete.
 */

import { createHash } from 'crypto';
import { Workbook } from 'exceljs';
import { HANDLERS, workbookSheets } from './dependency-matrix';
import { Inventory, canonical } from './dependency-inventory';
import { ARCHIVE_SCHEMA_VERSION, LifecycleRefusal, REASON } from './lifecycle-codes';

/** Excel: 1,048,576 rows including the header row; 32,767 characters per cell. */
export const EXCEL_MAX_DATA_ROWS = 1_048_575;
export const EXCEL_MAX_CELL_CHARS = 32_767;

export interface ArchivedFileEntry {
  seq: number;
  archiveFileName: string;
  provider: string;
  shared: boolean;
  cleanupEligible: boolean;
  sizeBytes: number;
  sha256: string;
  mimeType: string | null;
  ref: string;
  sources: { column: string; rowId: string }[];
}

export interface WorkbookMeta {
  archiveRef: string;
  version: number;
  environment: string;
  operationId: string;
  classificationVersion: string;
  noHistory: boolean;
  dataFingerprint: string;
  generatedAt: Date;
  /** Exactly what archiving will close or re-home, at generatedAt. Applied only after this workbook is verified. */
  closures?: Record<string, unknown>[];
}

export interface BuiltWorkbook {
  buffer: Buffer;
  /** Data rows per sheet (excluding the header). */
  sheetRows: Record<string, number>;
}

function cellValue(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'bigint') return v.toString();
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return `[${Buffer.from(v).length} bytes in files/]`;
  if (typeof v === 'object') return canonical(v);
  return String(v);
}

function sheetSha(rows: Record<string, unknown>[]): string {
  return createHash('sha256').update(canonical(rows)).digest('hex');
}

function guardRows(sheet: string, rows: Record<string, unknown>[]) {
  if (rows.length > EXCEL_MAX_DATA_ROWS) {
    throw new LifecycleRefusal(REASON.ARCHIVE_TOO_LARGE_FOR_WORKBOOK, 'The archive is too large for a workbook sheet. Nothing was changed.', { rows: rows.length });
  }
  for (const r of rows) {
    for (const v of Object.values(r)) {
      if (typeof v === 'string' && v.length > EXCEL_MAX_CELL_CHARS) {
        throw new LifecycleRefusal(REASON.ARCHIVE_TOO_LARGE_FOR_WORKBOOK, 'A value is too long for a workbook cell. Nothing was changed.', { chars: v.length });
      }
    }
  }
  void sheet;
}

function writeSheet(wb: Workbook, name: string, rows: Record<string, unknown>[]) {
  const ws = wb.addWorksheet(name);
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  ws.columns = columns.map((key) => ({ header: key, key, width: Math.min(40, Math.max(10, key.length + 2)) }));
  for (const r of rows) ws.addRow(r);
}

/** The sheet rows for every matrix group, as written. Exposed so tests can compare counts. */
export function sheetRowsFor(inv: Inventory): Record<string, Record<string, unknown>[]> {
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const name of workbookSheets()) out[name] = [];
  for (const h of HANDLERS) {
    for (const row of inv.rows[h.key] ?? []) {
      const flat: Record<string, unknown> = { _source: h.key };
      for (const [k, v] of Object.entries(row)) flat[k] = cellValue(v);
      out[h.sheet].push(flat);
    }
  }
  out['Correction Screenshots'] = inv.screenshots.map((s) => ({
    _source: 'CorrectionScreenshot[own]',
    id: s.id,
    regularizationId: s.regularizationId,
    filename: s.filename,
    mimeType: s.mimeType,
    byteSize: s.byteSize,
    createdAt: cellValue(s.createdAt),
    sha256: createHash('sha256').update(Buffer.from(s.content)).digest('hex'),
  }));
  return out;
}

export async function buildArchiveWorkbook(inv: Inventory, files: ArchivedFileEntry[], meta: WorkbookMeta): Promise<BuiltWorkbook> {
  const groups = sheetRowsFor(inv);
  const profile = [Object.fromEntries(Object.entries(inv.user).map(([k, v]) => [k, cellValue(v)]))];
  const fileRows = files.flatMap((f) =>
    f.sources.map((s) => ({
      seq: f.seq,
      archiveFile: `files/${f.archiveFileName}`,
      provider: f.provider,
      shared: f.shared,
      cleanupEligible: f.cleanupEligible,
      sizeBytes: f.sizeBytes,
      sha256: f.sha256,
      mimeType: f.mimeType,
      sourceColumn: s.column,
      sourceRowId: s.rowId,
      originalReference: f.ref,
    })),
  );

  const closures = (meta.closures ?? []).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cellValue(v)])));
  const all: Record<string, Record<string, unknown>[]> = { 'User Profile': profile, ...groups, 'Archive Closures': closures, Files: fileRows };
  for (const [name, rows] of Object.entries(all)) guardRows(name, rows);

  const sheetRows: Record<string, number> = {};
  const manifest: Record<string, unknown>[] = [
    { key: 'schemaVersion', value: ARCHIVE_SCHEMA_VERSION },
    { key: 'classificationVersion', value: meta.classificationVersion },
    { key: 'archiveRef', value: meta.archiveRef },
    { key: 'snapshotVersion', value: meta.version },
    { key: 'environment', value: meta.environment },
    { key: 'operationId', value: meta.operationId },
    { key: 'noHistory', value: meta.noHistory },
    { key: 'dataFingerprint', value: meta.dataFingerprint },
    { key: 'generatedAt', value: meta.generatedAt.toISOString() },
    { key: 'fileCount', value: files.length },
  ];
  for (const [name, rows] of Object.entries(all)) {
    sheetRows[name] = rows.length;
    manifest.push({ key: `sheet:${name}`, value: rows.length, sha256: sheetSha(rows) });
  }

  const wb = new Workbook();
  wb.creator = 'Apex OS';
  wb.created = meta.generatedAt;
  writeSheet(wb, 'Manifest', manifest);
  for (const [name, rows] of Object.entries(all)) writeSheet(wb, name, rows);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, sheetRows };
}

/** Reads the Files sheet back out of a workbook (permanent-delete preflight). */
export async function readFilesSheet(buffer: Buffer): Promise<{ manifest: Record<string, unknown>; files: Record<string, unknown>[] }> {
  const wb = new Workbook();
  await wb.xlsx.load(buffer as any);
  const readSheet = (name: string) => {
    const ws = wb.getWorksheet(name);
    if (!ws) return [];
    const header: string[] = [];
    ws.getRow(1).eachCell((c, i) => (header[i] = String(c.value)));
    const rows: Record<string, unknown>[] = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const r: Record<string, unknown> = {};
      row.eachCell((c, i) => (r[header[i]] = c.value));
      rows.push(r);
    });
    return rows;
  };
  const manifest: Record<string, unknown> = {};
  for (const r of readSheet('Manifest')) manifest[String(r.key)] = r.value;
  return { manifest, files: readSheet('Files') };
}
