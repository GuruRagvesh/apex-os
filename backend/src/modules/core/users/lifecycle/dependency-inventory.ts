/**
 * The central dependency inventory: every row the matrix ties to one person,
 * their counts, the versioned "no history" decision and the data fingerprint.
 *
 * Archive builds its workbook from these rows; permanent delete recomputes the
 * fingerprint and counts and refuses if anything changed. Nothing here writes.
 */

import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { FINGERPRINT_OPTIONAL_WHEN_EMPTY, HANDLERS, Handler, MatrixContext, Subject, delegateName, handlerWhere } from './dependency-matrix';
import { ARCHIVE_EVENT_NAMES, LIFECYCLE_EVENT, NO_HISTORY_CLASSIFICATION_VERSION, RETURN_EVENT_NAMES } from './lifecycle-codes';

type Client = Prisma.TransactionClient | any;

/** User columns that change without any business-data change. */
const VOLATILE_USER_FIELDS = ['password', 'lastActiveAt', 'currentStatus', 'updatedAt', 'sessionsRevokedAt'];

/**
 * Nullable user columns introduced after archive-v2 snapshots were already in
 * use. Prisma returns these keys with a null value after the migration, while
 * the same user row did not contain the keys when an older snapshot was
 * fingerprinted. Omitting only the null representation keeps those snapshots
 * compatible; a real value remains part of the fingerprint and is therefore a
 * genuine data change.
 */
const FINGERPRINT_OPTIONAL_USER_FIELDS_WHEN_NULL = new Set([
  'employmentState',
  'scheduledActivationOn',
]);

/**
 * no-history-v1: the rows that may exist for a person who never did anything.
 * Named, versioned and stored on every snapshot. Anything not listed counts.
 */
export const SETUP_ONLY_ALLOWANCE: Record<string, { max: number; filter?: (row: any) => boolean; note: string }> = {
  'UserRoleAssignment.userId': { max: 1, note: 'Initial role assignment.' },
  'UserDepartmentMembership.userId': { max: 1, note: 'Initial department membership.' },
  'EmployeeAttendanceProfile.userId': { max: 1, note: 'Initial attendance profile.' },
  'OperationalEvent.entityId[User]': {
    max: Number.MAX_SAFE_INTEGER,
    filter: (row) => row.action === 'USER_CREATED' || LIFECYCLE_BOOKKEEPING_EVENTS.includes(row.action) || ARCHIVE_EVENT_NAMES.includes(row.action),
    note: 'USER_CREATED, the archive event itself, and this module\'s own lifecycle bookkeeping events.',
  },
  'AppSetting.key[user-prefs]': {
    max: 1,
    filter: (row) => row.value === null || (typeof row.value === 'object' && Object.keys(row.value ?? {}).length === 0),
    note: 'Empty personal preferences.',
  },
  // Lifecycle foundation (Phase 1): rows Create User writes before anyone works.
  'EmploymentPeriod.userId': {
    max: 1,
    filter: (row) => row.startReason === 'NEW_HIRE' && row.endDate === null,
    note: 'The initial open NEW_HIRE employment period.',
  },
  'HierarchyAssignment.subjectUserId': {
    max: 2,
    filter: (row) => row.scope === 'EMPLOYEE' && row.isPrimary === true && row.effectiveTo === null,
    note: 'The initial primary TL and Manager assignment.',
  },
};

/** Events the lifecycle itself writes about the person; never "history". */
export const LIFECYCLE_BOOKKEEPING_EVENTS: string[] = [
  LIFECYCLE_EVENT.ARCHIVE_PREFLIGHT_COMPLETED,
  LIFECYCLE_EVENT.ACTIVE_WORK_CLOSED_FOR_ARCHIVE,
  LIFECYCLE_EVENT.ARCHIVE_BACKUP_STARTED,
  LIFECYCLE_EVENT.ARCHIVE_BACKUP_VERIFIED,
  LIFECYCLE_EVENT.ARCHIVE_NO_HISTORY_VERIFIED,
  LIFECYCLE_EVENT.ARCHIVE_SNAPSHOT_INVALIDATED,
  LIFECYCLE_EVENT.PERMANENT_DELETE_REQUESTED,
  LIFECYCLE_EVENT.PERMANENT_DELETE_VERIFICATION_FAILED,
];

export interface Inventory {
  subject: Subject;
  user: Record<string, unknown>;
  /** Rows per handler key, deterministically ordered. */
  rows: Record<string, any[]>;
  /** Correction screenshots of the person's own corrections (bytes live in Postgres). */
  screenshots: any[];
  counts: Record<string, number>;
}

export interface NoHistoryResult {
  classificationVersion: string;
  noHistory: boolean;
  /** Counts that remain after removing named setup-only rows. */
  historyCounts: Record<string, number>;
  ignoredSetupCounts: Record<string, number>;
}

/** Canonical JSON: sorted keys, ISO dates, base64 bytes. */
export function canonical(value: unknown): string {
  const norm = (v: any): any => {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return v.toISOString();
    if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { $bytes: Buffer.from(v).toString('base64') };
    if (typeof v === 'bigint') return v.toString();
    if (v instanceof Prisma.Decimal) return v.toString();
    if (Array.isArray(v)) return v.map(norm);
    if (typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) out[k] = norm(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

const sortRows = (rows: any[]) => [...rows].sort((a, b) => {
  const ka = canonical(a);
  const kb = canonical(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
});

/** Collects every row the matrix ties to the person. Read-only. */
export async function collectInventory(db: Client, userId: string, ctx: MatrixContext): Promise<Inventory> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('INVENTORY_USER_NOT_FOUND');
  const subject: Subject = { id: user.id, email: user.email, employeeId: user.employeeId ?? null };
  const rows: Record<string, any[]> = {};
  const counts: Record<string, number> = {};
  for (const h of HANDLERS) {
    const where = handlerWhere(h, subject, ctx);
    const found = where ? await db[delegateName(h.model)].findMany({ where }) : [];
    rows[h.key] = sortRows(found);
    counts[h.key] = found.length;
  }
  const screenshots = sortRows(
    await db.correctionScreenshot.findMany({ where: { regularization: { userId: subject.id } } }),
  );
  counts['CorrectionScreenshot[own]'] = screenshots.length;
  const userRow: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(user)) {
    if (VOLATILE_USER_FIELDS.includes(k)) continue;
    if (v === null && FINGERPRINT_OPTIONAL_USER_FIELDS_WHEN_NULL.has(k)) continue;
    userRow[k] = v;
  }
  return { subject, user: userRow, rows, screenshots, counts };
}

/** no-history-v1, from an inventory. */
export function classifyNoHistory(inv: Inventory): NoHistoryResult {
  const historyCounts: Record<string, number> = {};
  const ignoredSetupCounts: Record<string, number> = {};
  for (const h of HANDLERS) {
    const rows = inv.rows[h.key] ?? [];
    const allowance = SETUP_ONLY_ALLOWANCE[h.key];
    let remaining = rows.length;
    if (allowance) {
      const eligible = allowance.filter ? rows.filter(allowance.filter).length : rows.length;
      const ignored = Math.min(eligible, allowance.max);
      if (ignored > 0) ignoredSetupCounts[h.key] = ignored;
      remaining = rows.length - ignored;
    }
    const counts = h.history || allowance ? remaining : 0;
    historyCounts[h.key] = counts;
  }
  historyCounts['CorrectionScreenshot[own]'] = inv.screenshots.length;
  const noHistory = Object.values(historyCounts).every((n) => n === 0);
  return { classificationVersion: NO_HISTORY_CLASSIFICATION_VERSION, noHistory, historyCounts, ignoredSetupCounts };
}

/**
 * Lifecycle bookkeeping is not business data: the archive's own events, the
 * operation rows and access logs written while looking at an archived person
 * must not make a verified snapshot stale. Nor must system inbox copies:
 * notifications are generated for anyone involved in a ticket, archived or not.
 * They are still archived and still deleted. A rehire after the snapshot is
 * caught separately, by the snapshot status.
 *
 * Legal holds (Phase 1) are lifecycle controls too: requesting, confirming,
 * rejecting or releasing a hold after archiving must not force a re-archive.
 * Deletion re-reads every hold live under the lock instead, so a hold can never
 * be bypassed. A person with no holds fingerprints exactly as before.
 */
const FINGERPRINT_EXCLUDED_HANDLERS = ['UserLifecycleOperation.userId', 'ActivityLog.entityId[User]', 'Notification.userId', 'PushSubscription.userId', 'UserLegalHold.userId'];
/**
 * Phase 1 bookkeeping that is never fingerprinted at all (not even its count):
 * a failed or retried operation appends remediation attempts about the person,
 * and that must not make their verified snapshot stale.
 */
const FINGERPRINT_IGNORED_HANDLERS = ['LifecycleRemediationAttempt.subjectUserId', 'LifecycleRemediationAttempt.subjectUserId[running]'];
const FINGERPRINT_EXCLUDED_EVENTS = [...LIFECYCLE_BOOKKEEPING_EVENTS, ...ARCHIVE_EVENT_NAMES, ...RETURN_EVENT_NAMES, 'USER_DEACTIVATED'];

function fingerprintRows(h: Handler, rows: any[]): any[] | null {
  if (FINGERPRINT_IGNORED_HANDLERS.includes(h.key)) return null;
  if (rows.length === 0 && FINGERPRINT_OPTIONAL_WHEN_EMPTY.has(h.key)) return null;
  if (FINGERPRINT_EXCLUDED_HANDLERS.includes(h.key)) return [];
  if (h.key === 'OperationalEvent.entityId[User]') return rows.filter((r) => !FINGERPRINT_EXCLUDED_EVENTS.includes(r.action));
  return rows;
}

/** For shared records only the link matters: another person editing the ticket is not a change to this person's data. */
function fingerprintRow(h: Handler, row: any): unknown {
  if (h.action === 'DEL') return row;
  return { id: row.id ?? row.key ?? null, [h.field]: row[h.field] ?? null };
}

/**
 * SHA-256 over the canonical form of everything permanent deletion will touch:
 * the person's own rows in full, the identity of each shared row that points at
 * them, and the counts. Stored as the hash only.
 */
export function dataFingerprint(inv: Inventory): string {
  const handlers = HANDLERS.flatMap((h) => {
    const rows = fingerprintRows(h, inv.rows[h.key] ?? []);
    return rows === null ? [] : [{ key: h.key, count: rows.length, rows: rows.map((r) => fingerprintRow(h, r)) }];
  });
  // Normalize here as well as during collection because tests, import tools and
  // compatibility readers can construct an Inventory directly.
  const user = Object.fromEntries(Object.entries(inv.user).filter(([key, value]) => (
    !(value === null && FINGERPRINT_OPTIONAL_USER_FIELDS_WHEN_NULL.has(key))
  )));
  const body = { user, handlers, screenshots: inv.screenshots };
  return createHash('sha256').update(canonical(body)).digest('hex');
}
