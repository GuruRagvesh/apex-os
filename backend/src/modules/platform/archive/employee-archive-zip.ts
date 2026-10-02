import { createHash } from 'crypto';
// `import JSZip from 'jszip'` compiles to `jszip_1.default`, which is
// undefined here: this project sets allowSyntheticDefaultImports without
// esModuleInterop, so a default import type-checks and then fails at
// runtime. jszip's CommonJS export IS the constructor.
import JSZip = require('jszip');
import type { EmployeeArchive } from './employee-archive.types';

/**
 * Turns a collected archive into the bytes that go to Drive.
 *
 * DETERMINISTIC, AND IT HAS TO BE. The checksum computed here is compared
 * against the file Drive reports back, and that comparison is the last thing
 * standing between a bad upload and an irreversible deletion. A ZIP whose
 * bytes varied run to run -- because entry timestamps came from the clock, or
 * because object keys came out in hash order -- would make the comparison
 * meaningless and the failure impossible to reproduce.
 *
 * Three things are pinned to get there: every entry's date is the archive's
 * own generatedAt rather than now(), JSON keys are written in sorted order,
 * and compression is fixed.
 */

/** A ZIP date must be a real Date; this is the archive's instant, not the clock. */
function entryDate(archive: EmployeeArchive): Date {
  const at = new Date(archive.manifest.generatedAt);
  return Number.isNaN(at.getTime()) ? new Date(0) : at;
}

/**
 * JSON with object keys in a stable order.
 *
 * JSON.stringify follows insertion order, which for Prisma rows is column
 * order and is stable in practice -- but nested objects assembled elsewhere
 * are not guaranteed to be, and "in practice" is not good enough for the one
 * value a deletion is gated on.
 */
function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * `attendance/daily` -> `attendance/daily.json`.
 *
 * The collector's dataset keys already read as paths, so the ZIP layout is
 * the dataset layout and nothing has to maintain a second mapping between
 * them.
 */
function pathFor(datasetKey: string): string {
  return `${datasetKey}.json`;
}

export interface PackedArchive {
  /** The ZIP itself. */
  buffer: Buffer;
  /** SHA-256 of those exact bytes. Canonical; goes in the ledger. */
  checksum: string;
  /**
   * MD5 of the same bytes, for providers that report MD5 rather than SHA-256.
   * Google Drive does. Computed here so the comparison is like for like.
   */
  md5: string;
  bytes: number;
  /** Paths written, sorted. Useful in a failure report. */
  entries: string[];
}

/**
 * `APEX_EMPLOYEE_ARCHIVE_TE-014_20261003-060000.zip`
 *
 * EMPLOYEE ID AND A TIMESTAMP, NOT A NAME. Two people called Priya Sharma
 * would otherwise overwrite or shadow each other in the Drive folder, and the
 * one thing an archive must never be is ambiguous about whose it is. Falls
 * back to the user id when there is no employee id, which is still unique.
 */
export function archiveFileName(archive: EmployeeArchive): string {
  const who = archive.manifest.employeeId ?? archive.manifest.formerUserId;
  const stamp = archive.manifest.generatedAt
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15);
  return `APEX_EMPLOYEE_ARCHIVE_${sanitise(who)}_${stamp}.zip`;
}

/** Drive filenames tolerate most things; a path separator is still a bad idea. */
function sanitise(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

export async function packEmployeeArchive(
  archive: EmployeeArchive,
): Promise<PackedArchive> {
  const zip = new JSZip();
  const date = entryDate(archive);
  const entries: string[] = [];

  const add = (path: string, body: unknown) => {
    zip.file(path, stableJson(body), { date });
    entries.push(path);
  };

  // The manifest carries its own size and checksum, which cannot be known
  // until the bytes exist. They are filled in by the caller on the returned
  // object, NOT written into the file -- a file containing its own checksum
  // could never hash to it.
  add('manifest.json', archive.manifest);
  add('employee/profile.json', archive.employee);
  add('relationships/summary.json', archive.relationships);

  for (const key of Object.keys(archive.datasets).sort()) {
    add(pathFor(key), archive.datasets[key]);
  }

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    // Pinned: the default could change between library versions and move the
    // bytes for identical content.
    compressionOptions: { level: 6 },
    // No platform byte varying by host OS.
    platform: 'UNIX',
  });

  return {
    buffer,
    checksum: createHash('sha256').update(buffer).digest('hex'),
    md5: createHash('md5').update(buffer).digest('hex'),
    bytes: buffer.length,
    entries: entries.sort(),
  };
}
