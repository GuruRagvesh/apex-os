/**
 * Every file that belongs to, or is referenced by, one person: found from the
 * inventory, de-duplicated by its canonical provider reference, and marked
 * shared when a surviving record (another person's row, or a shared business
 * object such as a ticket attachment) still points at the same object.
 *
 * All of them -- shared or not -- are copied into the private archive. Only
 * non-shared originals are ever deleted, and only by permanent deletion.
 *
 * A canonical reference can embed a name, so it is never logged and never
 * returned to a client. It lives in memory, in the private workbook, and (for
 * cleanup) encrypted in PostgreSQL.
 */

import { createHash } from 'crypto';
import { Inventory } from './dependency-inventory';

export type FileProvider = 'inline' | 'database' | 'cloudinary' | 'local-private' | 'external-url';

/** Where a reference came from: a column and the row that holds it. */
export interface FileSource {
  column: string;
  rowId: string;
}

export interface FileObject {
  /** Canonical provider reference. Never logged, never sent to a client. */
  ref: string;
  provider: FileProvider;
  shared: boolean;
  /** Can permanent deletion remove the original? (Not for inline/DB bytes or foreign URLs.) */
  cleanupEligible: boolean;
  mimeType: string | null;
  sources: FileSource[];
  /** Inline / DB bytes, already in hand. */
  bytes?: Buffer;
}

/** Reads and deletes original objects at their provider. */
export interface FileStore {
  read(file: FileObject): Promise<{ bytes: Buffer; mimeType: string | null }>;
  /** Provider-authenticated deletion. "NOT_FOUND" is an authoritative absence. */
  remove(provider: FileProvider, ref: string): Promise<'DELETED' | 'NOT_FOUND'>;
}

/** The columns that can hold a file reference, and which matrix rows carry them. */
export const FILE_COLUMNS: { column: string; handlerKey: string; field: string; alwaysShared?: boolean }[] = [
  { column: 'EmployeeDocument.fileUrl', handlerKey: 'EmployeeDocument.userId', field: 'fileUrl' },
  { column: 'AttendancePunchPhoto.objectKey', handlerKey: 'AttendancePunchPhoto.userId', field: 'objectKey' },
  { column: 'AttendancePunchEvidence.photoObjectKey', handlerKey: 'AttendancePunchEvidence.userId', field: 'photoObjectKey' },
  { column: 'AttendanceEvent.faceImageUrl', handlerKey: 'AttendanceEvent.userId', field: 'faceImageUrl' },
  // Ticket attachments are shared business records: copied, never deleted.
  { column: 'Attachment.url', handlerKey: 'Attachment.uploadedById', field: 'url', alwaysShared: true },
];

/** The User columns that can hold a file reference. */
export const USER_FILE_FIELDS = ['avatar', 'photoUrl'];

const DATA_URL = /^data:([^;,]+)?;base64,(.*)$/s;

/**
 * Canonical form of a stored reference, or null when it is not a file.
 * `cloudinary:authenticated:<type>:<publicId>:<fmt>` and
 * `local-private:<file>:<mime>` are this codebase's stored formats.
 */
export function canonicalRef(stored: string, cloudName?: string): { ref: string; provider: FileProvider; mimeType: string | null; bytes?: Buffer } | null {
  const v = (stored ?? '').trim();
  if (!v) return null;
  const data = DATA_URL.exec(v);
  if (data) {
    const bytes = Buffer.from(data[2], 'base64');
    return { ref: `inline:sha256:${createHash('sha256').update(bytes).digest('hex')}`, provider: 'inline', mimeType: data[1] || null, bytes };
  }
  if (v.startsWith('cloudinary:authenticated:')) {
    const [, , type, publicId, format] = v.split(':');
    if (!publicId) return null;
    return { ref: `cloudinary:authenticated:${type || 'raw'}:${publicId}:${format ?? ''}`, provider: 'cloudinary', mimeType: null };
  }
  if (v.startsWith('local-private:')) {
    const [, file, mime] = v.split(':');
    if (!file) return null;
    return { ref: `local-private:${file}:${mime ?? ''}`, provider: 'local-private', mimeType: mime ? decodeURIComponent(mime) : null };
  }
  if (/^https?:\/\//i.test(v)) {
    // A delivery URL on our own Cloudinary account is ours to manage.
    const m = /^https?:\/\/res\.cloudinary\.com\/([^/]+)\/(image|video|raw)\/upload\/(?:v\d+\/)?(.+?)(?:\.([a-z0-9]+))?$/i.exec(v);
    if (m && cloudName && m[1] === cloudName) {
      return { ref: `cloudinary:upload:${m[2]}:${encodeURIComponent(m[3])}:${m[4] ?? ''}`, provider: 'cloudinary', mimeType: null };
    }
    return { ref: `url:${v}`, provider: 'external-url', mimeType: null };
  }
  return null;
}

/** Every file reference in the inventory, de-duplicated, with all of its sources. */
export function collectFileObjects(inv: Inventory, cloudName?: string): FileObject[] {
  const byRef = new Map<string, FileObject>();
  const add = (stored: unknown, source: FileSource, alwaysShared = false) => {
    if (typeof stored !== 'string') return;
    const c = canonicalRef(stored, cloudName);
    if (!c) return;
    const existing = byRef.get(c.ref);
    if (existing) {
      existing.sources.push(source);
      if (alwaysShared) existing.shared = true;
      return;
    }
    byRef.set(c.ref, {
      ref: c.ref,
      provider: c.provider,
      shared: alwaysShared,
      cleanupEligible: c.provider === 'cloudinary' || c.provider === 'local-private',
      mimeType: c.mimeType,
      sources: [source],
      bytes: c.bytes,
    });
  };

  for (const field of USER_FILE_FIELDS) add(inv.user[field], { column: `User.${field}`, rowId: inv.subject.id });
  for (const fc of FILE_COLUMNS) {
    for (const row of inv.rows[fc.handlerKey] ?? []) add(row[fc.field], { column: fc.column, rowId: String(row.id) }, fc.alwaysShared);
  }
  for (const s of inv.screenshots) {
    const sha = createHash('sha256').update(Buffer.from(s.content)).digest('hex');
    const ref = `database:sha256:${sha}`;
    const existing = byRef.get(ref);
    if (existing) existing.sources.push({ column: 'CorrectionScreenshot.content', rowId: s.id });
    else byRef.set(ref, { ref, provider: 'database', shared: false, cleanupEligible: false, mimeType: s.mimeType ?? null, sources: [{ column: 'CorrectionScreenshot.content', rowId: s.id }], bytes: Buffer.from(s.content) });
  }
  // Deterministic order: by first source, then reference.
  return [...byRef.values()].sort((a, b) => {
    const ka = `${a.sources[0].column}|${a.sources[0].rowId}|${a.ref}`;
    const kb = `${b.sources[0].column}|${b.sources[0].rowId}|${b.ref}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/**
 * Marks objects still referenced by a record that survives the person's
 * deletion. Read-only.
 */
export async function markShared(db: any, subjectId: string, files: FileObject[], cloudName?: string): Promise<void> {
  const stored = new Map<string, string[]>();
  // The stored spellings that canonicalize to each ref.
  const spellings = (f: FileObject) => {
    if (f.provider === 'cloudinary' && f.ref.startsWith('cloudinary:authenticated:')) return [f.ref];
    if (f.provider === 'local-private') return [f.ref];
    return [];
  };
  for (const f of files) stored.set(f.ref, spellings(f));
  const candidates = files.filter((f) => f.cleanupEligible && !f.shared);
  for (const f of candidates) {
    const values = stored.get(f.ref) ?? [];
    if (values.length === 0) continue;
    const checks = await Promise.all([
      db.user.count({ where: { id: { not: subjectId }, OR: [{ avatar: { in: values } }, { photoUrl: { in: values } }] } }),
      db.employeeDocument.count({ where: { userId: { not: subjectId }, fileUrl: { in: values } } }),
      db.attendancePunchPhoto.count({ where: { userId: { not: subjectId }, objectKey: { in: values } } }),
      db.attendancePunchEvidence.count({ where: { userId: { not: subjectId }, photoObjectKey: { in: values } } }),
      db.attendanceEvent.count({ where: { userId: { not: subjectId }, faceImageUrl: { in: values } } }),
      db.attachment.count({ where: { url: { in: values } } }),
    ]);
    if (checks.some((n: number) => n > 0)) f.shared = true;
  }
  void cloudName;
}

/** The archive file name: sequence plus hash prefix plus extension. Nothing about the person. */
export function archiveFileName(seq: number, sha256: string, mimeType: string | null): string {
  const ext = ({
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  } as Record<string, string>)[(mimeType ?? '').toLowerCase()] ?? 'bin';
  return `${String(seq).padStart(4, '0')}-${sha256.slice(0, 12)}.${ext}`;
}
