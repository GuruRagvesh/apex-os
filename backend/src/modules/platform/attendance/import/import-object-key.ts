/**
 * Where an uploaded attendance file is stored, derived rather than accepted.
 *
 * The filename arrives from a multipart upload, which means it arrives from
 * whoever is uploading. Putting it into an object key unexamined lets a name
 * decide where the object lands: `../../backups/latest.dump` walks out of the
 * namespace, a leading slash re-roots the key, and a control character or a
 * thousand-character name produces something that may store but cannot
 * reliably be fetched, listed or deleted afterwards.
 *
 * So the key is BUILT, not accepted. The batch id -- which Apex OS generated --
 * is what makes it unique, and the only thing taken from the upload is which of
 * two known extensions it had. The original name is kept verbatim on the batch
 * row as `fileName`, where it is displayed and audited and can do no harm.
 */

/** The only shapes this importer reads, and therefore the only ones it stores. */
const KNOWN_EXTENSIONS = ['xlsx', 'csv'] as const;
export type ImportFileExtension = (typeof KNOWN_EXTENSIONS)[number];

export const IMPORT_NAMESPACE = 'attendance-imports';

/** Longest slug taken from a supplied name: enough to recognise, not to abuse. */
const MAX_SLUG = 48;

/**
 * C0 and DEL. Built from char codes rather than written as literals, so the
 * bytes this guards against never appear in the source that guards them.
 */
const CONTROL_CHARACTERS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  'g',
);

/**
 * The safe part of a filename, or an empty string when nothing survives.
 *
 * Unsafe characters are replaced rather than dropped, so two different names
 * cannot collapse into the same slug by having their differences removed.
 */
export function sanitizeFileSlug(fileName: string): string {
  const base = String(fileName ?? '')
    // The basename under BOTH separators: a Windows client sends backslashes,
    // and splitting on only one leaves the other in place.
    .split(/[/\\]/)
    .pop()!
    // The extension is decided separately, from an allow-list.
    .replace(/\.[^.]*$/, '');

  return base
    .replace(CONTROL_CHARACTERS, '')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    // Collapses the dot runs that spell `..`, and any longer variation.
    .replace(/\.+/g, '.')
    .replace(/^[.\-_]+|[.\-_]+$/g, '')
    .slice(0, MAX_SLUG);
}

/** The extension, from an allow-list. Never trusted from the name itself. */
export function importExtensionOf(fileName: string): ImportFileExtension {
  return String(fileName ?? '').toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx';
}

export function importContentType(extension: ImportFileExtension): string {
  return extension === 'csv'
    ? 'text/csv'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

/**
 * `attendance-imports/2026/<batchId>/source-august-2026.xlsx`
 *
 * Uniqueness comes from the batch id, so a hostile or empty slug can make the
 * key uglier but can never collide with another batch, escape the namespace, or
 * overwrite anything.
 */
export function importObjectKey(year: string, batchId: string, fileName: string): string {
  const slug = sanitizeFileSlug(fileName);
  const extension = importExtensionOf(fileName);
  const name = slug ? `source-${slug}.${extension}` : `source.${extension}`;

  return `${IMPORT_NAMESPACE}/${year}/${batchId}/${name}`;
}
