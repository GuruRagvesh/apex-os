import { api, unwrap as r } from '@apex/shared-auth';
import {
  IMPORT_TEMPLATE_FILENAME,
  errorWorkbookFileName,
  type ImportMode,
} from './import-presentation';

/**
 * Attendance Data Control transport.
 *
 * Every route is authorised by the server on every call, so nothing here asks
 * whether the caller is HR or a data operator — the same endpoints return what
 * that caller is entitled to, and refuse what they are not. The screens hide
 * controls as a courtesy; this file assumes nothing.
 *
 * Approve and apply are separate calls because they are separate decisions.
 * Nothing here merges them.
 */

export interface ImportBatch {
  id: string;
  reference: string;
  mode: ImportMode;
  status: string;
  fileName: string;
  fileByteSize: number;
  fileSha256: string;
  periodFrom: string | null;
  periodTo: string | null;
  totalRows: number;
  newRows: number;
  matchRows: number;
  changeRows: number;
  conflictRows: number;
  invalidRows: number;
  warningRows: number;
  appliedRows: number;
  skippedRows: number;
  failedRows: number;
  uploadedById: string;
  uploadedAt: string;
  approvedById: string | null;
  approvedAt: string | null;
  appliedById: string | null;
  applyStartedAt: string | null;
  failureReason: string | null;
  uploadedBy?: { id: string; name: string } | null;
  approvedBy?: { id: string; name: string } | null;
}

export interface ImportBatchDetail extends ImportBatch {
  previousUploadsOfThisFile?: { id: string; reference: string; uploadedAt: string }[];
}

/**
 * One reviewable row.
 *
 * currentFingerprint, currentPunchInEvidenceId and currentPunchOutEvidenceId
 * exist on the server row and are deliberately ABSENT from this type. They are
 * backend audit details; a review screen is not where private capture data
 * should surface, and a field that is not in the type cannot be rendered by
 * accident.
 */
export interface ImportRow {
  id: string;
  rowNumber: number;
  rawEmployeeId: string;
  rawName: string | null;
  rawDate: string | null;
  userId: string | null;
  businessDate: string | null;
  proposedStatus: string | null;
  proposedPunchIn: string | null;
  proposedPunchOut: string | null;
  proposedHalfDay: string | null;
  proposedLeaveType: string | null;
  normalizedReason: string | null;
  currentStatus: string | null;
  currentPunchIn: string | null;
  currentPunchOut: string | null;
  classification: string;
  messages: string[];
  warnings: string[];
  applyState: string;
  appliedAt: string | null;
}

export interface ApplySummary {
  reference: string;
  status: string;
  attempted: number;
  applied: number;
  stale: number;
  failed: number;
  noOps: number;
}

const BASE = '/attendance/import';

export async function listBatches(limit = 50): Promise<ImportBatch[]> {
  return r<ImportBatch[]>(api.get(BASE, { params: { limit } }));
}

export async function getBatch(id: string): Promise<ImportBatchDetail> {
  return r<ImportBatchDetail>(api.get(`${BASE}/${id}`));
}

/**
 * The stored classification, filtered server-side where the filter IS a
 * classification. "Warnings" is not one, so that filter is applied to what
 * comes back rather than invented as a query the server does not have.
 */
export async function getRows(id: string, classification?: string): Promise<ImportRow[]> {
  return r<ImportRow[]>(
    api.get(`${BASE}/${id}/preview`, {
      params: classification ? { classification } : undefined,
    }),
  );
}

export async function uploadImport(file: File, mode: ImportMode): Promise<{
  id: string;
  reference: string;
  status: string;
}> {
  const form = new FormData();
  form.append('file', file);
  // Content-Type is left to the browser: setting multipart/form-data by hand
  // omits the boundary and the server cannot parse the body.
  return r(api.post(`${BASE}`, form, { params: { mode } }));
}

export async function approveBatch(id: string): Promise<ImportBatch> {
  return r<ImportBatch>(api.post(`${BASE}/${id}/approve`));
}

export async function applyBatch(id: string): Promise<ApplySummary> {
  return r<ApplySummary>(api.post(`${BASE}/${id}/apply`));
}

/** Only permitted once a dead run's lease has gone stale. The server decides. */
export async function resumeBatch(id: string): Promise<ApplySummary> {
  return r<ApplySummary>(api.post(`${BASE}/${id}/resume`));
}

/**
 * Reclassifies against current attendance and returns the batch for a fresh
 * approval. The ONLY way out of "needs re-review" — nothing here resets rows
 * locally, because a local reset would put a new signature on an old
 * comparison.
 */
export async function rePreviewBatch(id: string): Promise<ImportBatch> {
  return r<ImportBatch>(api.post(`${BASE}/${id}/re-preview`));
}

/**
 * Authenticated downloads.
 *
 * A plain <a href> would 401: the bearer token is attached by a request
 * interceptor, and a browser navigation does not go through it.
 */
async function download(path: string, filename: string): Promise<void> {
  const blob = await r<Blob>(api.get(path, { responseType: 'blob' }));
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    // Named here rather than read from Content-Disposition: the response
    // interceptor returns response.data, so headers never reach this code.
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downloadTemplate(): Promise<void> {
  await download(`${BASE}/template.xlsx`, IMPORT_TEMPLATE_FILENAME);
}

export async function downloadErrorWorkbook(id: string, reference: string): Promise<void> {
  await download(`${BASE}/${id}/errors.xlsx`, errorWorkbookFileName(reference));
}
