/**
 * Navigation state: what a page needs to look the same after Back, Forward or
 * a refresh. UI state only, never the truth of anything.
 *
 * WHERE IT LIVES
 *   1. history.state, under one key, merged with Next.js's own router keys
 *      (never overwriting them). Back and Forward read it from there.
 *   2. sessionStorage, as a short-lived refresh fallback for this tab only.
 *
 * WHAT IT MAY HOLD
 *   Filters, search text, the selected tab, page, sort, Kanban department and
 *   search, scroll positions, ticket ids, and the New Ticket form's non-text
 *   fields (type, priority, dates, estimate, selected ids, recurrence).
 *
 * WHAT IT NEVER HOLDS
 *   Titles, descriptions, notes, comments, attachments, anything loaded from
 *   the server, tokens, roles or permissions, personal data, and any workday,
 *   timer or review-clock state. The schemas below are whitelists: an entry
 *   with any other field, or a field of the wrong shape, is rejected whole.
 *
 * WHOSE IT IS
 *   Every entry carries the signed-in user's id and is keyed by it and by a
 *   per-tab id. An entry for another user is never returned, and is removed
 *   as soon as a different user (or nobody) is signed in.
 *
 * HOW LONG
 *   30 minutes from when it was saved. Expired, corrupt or unknown entries are
 *   removed when read.
 *
 * Restoring state changes what the page shows and nothing else: this module
 * has no network access, and callers only feed it into local React state, the
 * URL and scroll positions.
 *
 * Pure apart from the Storage / History objects passed in, so it is tested
 * without a browser (backend/test/unit/ticket-nav-state.spec.ts).
 */

export const NAV_STATE_VERSION = 1;
export const NAV_STATE_TTL_MS = 30 * 60_000;
/** Every sessionStorage key this module writes starts with this. */
export const NAV_STATE_PREFIX = 'apex-nav:';
const ENTRY_PREFIX = `${NAV_STATE_PREFIX}v${NAV_STATE_VERSION}:`;
/** This tab's id (sessionStorage is already per tab; the id also namespaces history.state entries). */
export const NAV_TAB_KEY = `${NAV_STATE_PREFIX}tab`;
/** The single key this module adds to history.state. */
export const HISTORY_STATE_KEY = '__apexNav';
/** At most this many saved entries per tab; the oldest go first. */
export const MAX_ENTRIES = 30;

export type NavPage = 'tickets' | 'kanban' | 'ticket-new';

// ── Field shapes ───────────────────────────────────────────────────────────

type Guard<T> = (v: unknown) => v is T;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/** Exactly these keys, no more and no fewer, each passing its guard. */
function exactObject<T>(shape: { [K in keyof T]: Guard<T[K]> }): Guard<T> {
  const keys = Object.keys(shape);
  return (v: unknown): v is T => {
    if (!isPlainObject(v)) return false;
    const own = Object.keys(v);
    if (own.length !== keys.length || own.some((k) => !keys.includes(k))) return false;
    return keys.every((k) => (shape as any)[k](v[k]));
  };
}

const matches = (re: RegExp, max: number): Guard<string> => (v: unknown): v is string =>
  typeof v === 'string' && v.length <= max && re.test(v);
const oneOf = <T extends string>(values: readonly T[]): Guard<T> => (v: unknown): v is T =>
  typeof v === 'string' && (values as readonly string[]).includes(v);
const arrayOf = <T>(item: Guard<T>, max: number): Guard<T[]> => (v: unknown): v is T[] =>
  Array.isArray(v) && v.length <= max && v.every(item);

/** A record id (cuid / uuid / seeded ids) or empty. Never free text. */
export const isId = matches(/^$|^[A-Za-z0-9_-]{1,64}$/, 64);
const isNonEmptyId = matches(/^[A-Za-z0-9_-]{1,64}$/, 64);
/** Search text a person typed into a filter box. */
const isSearch = (v: unknown): v is string => typeof v === 'string' && v.length <= 200 && !/[\u0000-\u001f]/.test(v);
const isDate = matches(/^$|^\d{4}-\d{2}-\d{2}$/, 10);
const isTime = matches(/^$|^\d{2}:\d{2}$/, 5);
const isDateTimeLocal = matches(/^$|^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 16);
const isEstimate = matches(/^$|^\d{1,4}$/, 4);
const isCoord = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1_000_000;
const isPath = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 1000 && v.startsWith('/') && !v.startsWith('//');

export interface Scroll { x: number; y: number }
const isScroll = exactObject<Scroll>({ x: isCoord, y: isCoord });

// ── Page schemas ───────────────────────────────────────────────────────────

/** Tickets list. Its filters, search and page live in the URL already. */
export interface TicketsNav { tab: 'all' | 'approvals'; scroll: Scroll }
const isTicketsNav = exactObject<TicketsNav>({ tab: oneOf(['all', 'approvals'] as const), scroll: isScroll });

export const KANBAN_COLUMNS = ['OPEN', 'IN_PROGRESS', 'REVIEW', 'DONE', 'CLOSED'] as const;
export type KanbanColumn = typeof KANBAN_COLUMNS[number];
export interface KanbanNav {
  departmentId: string;
  search: string;
  board: Scroll;
  columns: Partial<Record<KanbanColumn, number>>;
}
const isKanbanColumns = (v: unknown): v is Partial<Record<KanbanColumn, number>> =>
  isPlainObject(v) && Object.keys(v).every((k) => (KANBAN_COLUMNS as readonly string[]).includes(k) && isCoord(v[k]));
const isKanbanNav = exactObject<KanbanNav>({
  departmentId: isId, search: isSearch, board: isScroll, columns: isKanbanColumns,
});

export const DRAFT_TYPES = ['TASK', 'QUERY', 'HELP'] as const;
export const DRAFT_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export interface DraftRecurrence { mode: string; oneTimeAt: string; endPreset: string; endDate: string }
const isDraftRecurrence = exactObject<DraftRecurrence>({
  mode: matches(/^[a-z_]{1,20}$/, 20),
  oneTimeAt: isDateTimeLocal,
  endPreset: matches(/^[a-z0-9_]{1,20}$/, 20),
  endDate: isDate,
});

/** One New Ticket row, without any of its text. */
export interface DraftRow {
  type: typeof DRAFT_TYPES[number];
  priority: typeof DRAFT_PRIORITIES[number];
  departmentId: string;
  taskTypeId: string;
  taskSubtypeId: string;
  assigneeIds: string[];
  targetDepartmentId: string;
  projectId: string;
  startDate: string;
  startTime: string;
  dueDate: string;
  dueTime: string;
  estHours: string;
  estMinutes: string;
  scheduledEndAt: string;
  recurrence: DraftRecurrence;
}
export const DRAFT_ROW_FIELDS = [
  'type', 'priority', 'departmentId', 'taskTypeId', 'taskSubtypeId', 'assigneeIds', 'targetDepartmentId',
  'projectId', 'startDate', 'startTime', 'dueDate', 'dueTime', 'estHours', 'estMinutes', 'scheduledEndAt', 'recurrence',
] as const;
const isDraftRow = exactObject<DraftRow>({
  type: oneOf(DRAFT_TYPES),
  priority: oneOf(DRAFT_PRIORITIES),
  departmentId: isId,
  taskTypeId: isId,
  taskSubtypeId: isId, // '' | id | '__custom__' (the custom text itself is never stored)
  assigneeIds: arrayOf(isNonEmptyId, 50),
  targetDepartmentId: isId,
  projectId: isId,
  startDate: isDate,
  startTime: isTime,
  dueDate: isDate,
  dueTime: isTime,
  estHours: isEstimate,
  estMinutes: isEstimate,
  scheduledEndAt: isDateTimeLocal,
  recurrence: isDraftRecurrence,
});
export interface DraftGlobals { departmentId: string; projectId: string; priority: string; taskTypeId: string; taskSubtypeId: string }
const isDraftGlobals = exactObject<DraftGlobals>({
  departmentId: isId, projectId: isId, priority: oneOf(DRAFT_PRIORITIES), taskTypeId: isId, taskSubtypeId: isId,
});
export interface TicketDraftNav { globals: DraftGlobals; rows: DraftRow[] }
const isTicketDraftNav = exactObject<TicketDraftNav>({
  globals: isDraftGlobals,
  rows: (v: unknown): v is DraftRow[] => arrayOf(isDraftRow, 50)(v) && (v as unknown[]).length >= 1,
});

export interface NavData { tickets: TicketsNav; kanban: KanbanNav; 'ticket-new': TicketDraftNav }
const PAGE_GUARDS: { [P in NavPage]: Guard<NavData[P]> } = {
  tickets: isTicketsNav,
  kanban: isKanbanNav,
  'ticket-new': isTicketDraftNav,
};
export const isNavPage = oneOf(['tickets', 'kanban', 'ticket-new'] as const);

/** Copies only the whitelisted non-text fields out of a New Ticket row. */
export function draftRowFrom(row: Record<string, any>): DraftRow {
  const out: Record<string, unknown> = {};
  for (const k of DRAFT_ROW_FIELDS) out[k] = row[k];
  const r = row.recurrence ?? {};
  out.recurrence = { mode: r.mode, oneTimeAt: r.oneTimeAt, endPreset: r.endPreset, endDate: r.endDate };
  out.assigneeIds = Array.isArray(row.assigneeIds) ? [...row.assigneeIds] : row.assigneeIds;
  return out as unknown as DraftRow;
}

// ── Envelope ───────────────────────────────────────────────────────────────

export interface NavEnvelope<P extends NavPage = NavPage> {
  v: typeof NAV_STATE_VERSION;
  userId: string;
  tabId: string;
  page: P;
  path: string;
  savedAt: number;
  data: NavData[P];
}
const ENVELOPE_KEYS = ['v', 'userId', 'tabId', 'page', 'path', 'savedAt', 'data'];

export function isValidEnvelope(v: unknown): v is NavEnvelope {
  if (!isPlainObject(v)) return false;
  const own = Object.keys(v);
  if (own.length !== ENVELOPE_KEYS.length || own.some((k) => !ENVELOPE_KEYS.includes(k))) return false;
  if (v.v !== NAV_STATE_VERSION) return false;
  if (!isNonEmptyId(v.userId) || !isNonEmptyId(v.tabId) || !isNavPage(v.page) || !isPath(v.path)) return false;
  if (typeof v.savedAt !== 'number' || !Number.isFinite(v.savedAt)) return false;
  return PAGE_GUARDS[v.page as NavPage](v.data);
}

interface Want<P extends NavPage> { userId: string | null | undefined; tabId: string; page: P; path: string; nowMs: number }

/** The envelope's data, if it is valid, fresh, and this user's, this tab's, this page's and this path's. */
export function acceptEnvelope<P extends NavPage>(v: unknown, want: Want<P>): NavData[P] | null {
  if (!want.userId || !isValidEnvelope(v)) return null;
  if (v.userId !== want.userId || v.tabId !== want.tabId || v.page !== want.page || v.path !== want.path) return null;
  const age = want.nowMs - v.savedAt;
  if (age < 0 || age > NAV_STATE_TTL_MS) return null;
  return v.data as NavData[P];
}

export function buildEnvelope<P extends NavPage>(page: P, data: NavData[P], at: { userId: string; tabId: string; path: string; nowMs: number }): NavEnvelope<P> | null {
  const env: NavEnvelope<P> = { v: NAV_STATE_VERSION, userId: at.userId, tabId: at.tabId, page, path: at.path, savedAt: at.nowMs, data };
  // Never write what could not be read back: the same whitelist guards writing.
  return isValidEnvelope(env) ? env : null;
}

// ── sessionStorage ─────────────────────────────────────────────────────────

export interface KeyStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const storageKey = (userId: string, tabId: string, page: NavPage, path: string) =>
  `${ENTRY_PREFIX}${userId}:${tabId}:${page}:${path}`;

function keysOf(storage: KeyStorage): string[] {
  const out: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k !== null) out.push(k);
  }
  return out;
}

/** This tab's id, created on first use. */
export function tabIdFor(storage: KeyStorage, newId: () => string): string {
  const existing = storage.getItem(NAV_TAB_KEY);
  if (existing && isNonEmptyId(existing)) return existing;
  const id = newId().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'tab';
  storage.setItem(NAV_TAB_KEY, id);
  return id;
}

export function readStored<P extends NavPage>(storage: KeyStorage, want: Want<P>): NavData[P] | null {
  if (!want.userId) return null;
  const key = storageKey(want.userId, want.tabId, want.page, want.path);
  const raw = storage.getItem(key);
  if (raw === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
  const data = acceptEnvelope(parsed, want);
  if (data === null) storage.removeItem(key); // corrupt, expired, or not this user's: gone
  return data;
}

export function writeStored(storage: KeyStorage, env: NavEnvelope): void {
  storage.setItem(storageKey(env.userId, env.tabId, env.page, env.path), JSON.stringify(env));
  pruneStored(storage, env.userId, env.savedAt);
}

export function removeStored(storage: KeyStorage, userId: string, tabId: string, page: NavPage, path: string): void {
  storage.removeItem(storageKey(userId, tabId, page, path));
}

/**
 * Drops entries that are expired, unreadable, another user's, or beyond the
 * newest MAX_ENTRIES. Returns how many were removed.
 */
export function pruneStored(storage: KeyStorage, userId: string | null, nowMs: number): number {
  let removed = 0;
  const live: Array<{ key: string; savedAt: number }> = [];
  for (const key of keysOf(storage)) {
    // The tab id and the one-shot back origin are not entries (the origin is
    // checked for its owner and age when it is taken).
    if (!key.startsWith(NAV_STATE_PREFIX) || key === NAV_TAB_KEY || (key === BACK_ORIGIN_KEY && userId)) continue;
    let env: unknown;
    try { env = JSON.parse(storage.getItem(key) ?? ''); } catch { env = undefined; }
    const ok = key.startsWith(ENTRY_PREFIX) && isValidEnvelope(env) && !!userId && env.userId === userId
      && key === storageKey(env.userId, env.tabId, env.page, env.path)
      && nowMs - env.savedAt >= 0 && nowMs - env.savedAt <= NAV_STATE_TTL_MS;
    if (!ok) { storage.removeItem(key); removed += 1; continue; }
    live.push({ key, savedAt: (env as NavEnvelope).savedAt });
  }
  live.sort((a, b) => b.savedAt - a.savedAt);
  for (const { key } of live.slice(MAX_ENTRIES)) { storage.removeItem(key); removed += 1; }
  return removed;
}

/** Removes every navigation-state key (logout, session expiry). */
export function clearAllStored(storage: KeyStorage): void {
  for (const key of keysOf(storage)) if (key.startsWith(NAV_STATE_PREFIX)) storage.removeItem(key);
}

/** Keeps only the signed-in user's fresh entries; with nobody signed in, keeps none. */
export function syncStoredOwner(storage: KeyStorage, userId: string | null | undefined, nowMs: number): void {
  if (!userId) { clearAllStored(storage); return; }
  pruneStored(storage, userId, nowMs);
}

// ── history.state ──────────────────────────────────────────────────────────

export interface HistoryLike {
  readonly state: unknown;
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

/** This entry's saved navigation state, if it is acceptable. */
export function readHistory<P extends NavPage>(history: HistoryLike, want: Want<P>): NavData[P] | null {
  const state = history.state;
  if (!isPlainObject(state)) return null;
  return acceptEnvelope(state[HISTORY_STATE_KEY], want);
}

/**
 * Saves into the current history entry, keeping every key already there
 * (Next.js's __NA and router tree included) and replacing only ours. The URL
 * is left exactly as it is.
 */
export function writeHistory(history: HistoryLike, env: NavEnvelope | null): void {
  const current = isPlainObject(history.state) ? history.state : {};
  const next: Record<string, unknown> = { ...current };
  if (env) next[HISTORY_STATE_KEY] = env;
  else delete next[HISTORY_STATE_KEY];
  history.replaceState(next, '');
}

// ── Ticket detail Back ─────────────────────────────────────────────────────

/** Where ticket detail's Back may go through browser history: the Tickets list or Kanban, nothing else. */
export function isSafeBackTarget(path: string | null | undefined): boolean {
  if (typeof path !== 'string' || !isPath(path)) return false;
  const pathname = path.split(/[?#]/)[0];
  return pathname === '/tickets' || pathname === '/kanban';
}

/** Remembers, for this tab, the list page a ticket was opened from. */
export const BACK_ORIGIN_KEY = `${NAV_STATE_PREFIX}back-origin`;
/** The ticket must open within this long of the click on the list for the list to count as its previous entry. */
export const BACK_ORIGIN_WINDOW_MS = 15_000;

/** Called when a ticket is opened from the Tickets list or Kanban: which list, which ticket. */
export function writeBackOrigin(storage: KeyStorage, userId: string, path: string, ticketId: string, nowMs: number): void {
  if (!isNonEmptyId(userId) || !isNonEmptyId(ticketId) || !isSafeBackTarget(path)) return;
  storage.setItem(BACK_ORIGIN_KEY, JSON.stringify({ v: NAV_STATE_VERSION, userId, path, ticketId, at: nowMs }));
}

/**
 * Read once, when a ticket opens, then removed: the list path this exact
 * ticket was just opened from, or null (direct link, refresh, opened from
 * anywhere else, another ticket, another user, too old, anything malformed).
 */
export function takeBackOrigin(storage: KeyStorage, userId: string | null | undefined, ticketId: string, nowMs: number): string | null {
  const raw = storage.getItem(BACK_ORIGIN_KEY);
  storage.removeItem(BACK_ORIGIN_KEY);
  if (!raw || !userId) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!isPlainObject(v)) return null;
  const keys = Object.keys(v);
  if (keys.length !== 5 || !['v', 'userId', 'path', 'ticketId', 'at'].every((k) => keys.includes(k))) return null;
  if (v.v !== NAV_STATE_VERSION || v.userId !== userId || v.ticketId !== ticketId || !isSafeBackTarget(v.path as string)) return null;
  if (typeof v.at !== 'number' || nowMs - v.at < 0 || nowMs - v.at > BACK_ORIGIN_WINDOW_MS) return null;
  return v.path as string;
}

/** The ticket id a click on a list opens, from the clicked link or card; null for anything else. */
export function ticketIdFromHref(href: string | null | undefined): string | null {
  if (typeof href !== 'string') return null;
  const m = /^\/tickets\/([A-Za-z0-9_-]{1,64})(?:[?#].*)?$/.exec(href);
  return m && m[1] !== 'new' ? m[1] : null;
}
