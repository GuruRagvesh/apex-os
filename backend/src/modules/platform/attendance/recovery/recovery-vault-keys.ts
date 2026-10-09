/**
 * Attendance Recovery Vault — object layout. Keys are BUILT, never accepted.
 *
 *   quarantine/<importBatchId>/original.<ext>
 *   approved-imports/<yyyy>/<mm>/<importBatchId>/manifest.json
 *   snapshots/<yyyy>/<mm>/<employeeId>/<businessDate>/r<NNNN>-<bundleHash>.json
 *   manifests/imports/<importBatchId>.json
 *   manifests/snapshots/<yyyy>/<mm>/<employeeId>/<businessDate>/<bundleHash>.json
 *
 * Every segment is checked against a strict allow-list. A segment that would
 * need escaping is refused rather than rewritten: two different identifiers
 * must never be able to collapse into the same key, and `..`, `/` or a control
 * character must never reach R2.
 */

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HASH = /^[0-9a-f]{64}$/;

export const QUARANTINE_EXTENSIONS = ['json', 'xlsx', 'csv'] as const;
export type QuarantineExtension = (typeof QUARANTINE_EXTENSIONS)[number];
export const QUARANTINE_CONTENT_TYPES: Record<QuarantineExtension, string> = {
  json: 'application/json',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
};

export class RecoveryKeyError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'RecoveryKeyError';
  }
}

function segment(value: string, label: string): string {
  if (typeof value !== 'string' || !SEGMENT.test(value) || value.includes('..')) throw new RecoveryKeyError(`INVALID_${label}`);
  return value;
}
function businessDate(value: string): string {
  if (!DATE.test(value)) throw new RecoveryKeyError('INVALID_BUSINESS_DATE');
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new RecoveryKeyError('INVALID_BUSINESS_DATE');
  return value;
}
function hash(value: string): string {
  if (!HASH.test(value)) throw new RecoveryKeyError('INVALID_HASH');
  return value;
}

/** The extension, from an allow-list. The supplied file name never shapes the key. */
export function quarantineExtensionOf(fileName: string): QuarantineExtension {
  const ext = String(fileName ?? '').toLowerCase().split('.').pop() ?? '';
  if (!(QUARANTINE_EXTENSIONS as readonly string[]).includes(ext)) throw new RecoveryKeyError('EXTENSION_NOT_ALLOWED');
  return ext as QuarantineExtension;
}

/** A display-safe version of the original name, kept in metadata only. */
export function sanitizeOriginalName(fileName: string): string {
  const base = String(fileName ?? '').split(/[/\\]/).pop() ?? '';
  return base.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/\.{2,}/g, '.').slice(0, 120) || 'upload';
}

export const recoveryKeys = {
  quarantine: (importBatchId: string, ext: QuarantineExtension) =>
    `quarantine/${segment(importBatchId, 'IMPORT_BATCH_ID')}/original.${ext}`,
  approvedImport: (importBatchId: string, approvedAt: Date) =>
    `approved-imports/${approvedAt.toISOString().slice(0, 4)}/${approvedAt.toISOString().slice(5, 7)}/${segment(importBatchId, 'IMPORT_BATCH_ID')}/manifest.json`,
  importManifest: (importBatchId: string) => `manifests/imports/${segment(importBatchId, 'IMPORT_BATCH_ID')}.json`,
  snapshotPrefix: (employeeId: string, date: string) =>
    `snapshots/${businessDate(date).slice(0, 4)}/${date.slice(5, 7)}/${segment(employeeId, 'EMPLOYEE_ID')}/${date}/`,
  snapshot: (employeeId: string, date: string, revision: number, bundleHash: string) => {
    if (!Number.isInteger(revision) || revision < 1 || revision > 9999) throw new RecoveryKeyError('INVALID_REVISION');
    return `${recoveryKeys.snapshotPrefix(employeeId, date)}r${String(revision).padStart(4, '0')}-${hash(bundleHash)}.json`;
  },
  snapshotManifest: (employeeId: string, date: string, bundleHash: string) =>
    `manifests/snapshots/${businessDate(date).slice(0, 4)}/${date.slice(5, 7)}/${segment(employeeId, 'EMPLOYEE_ID')}/${date}/${hash(bundleHash)}.json`,
};

/** Parses `r0003-<hash>.json` → { revision: 3, hash }. Anything else → null. */
export function parseSnapshotName(key: string): { revision: number; hash: string } | null {
  const m = /\/r(\d{4})-([0-9a-f]{64})\.json$/.exec(key);
  return m ? { revision: Number(m[1]), hash: m[2] } : null;
}
