/**
 * Pure presentation rules for the unified review queue.
 *
 * Employee requests and system alerts share one table component but are not
 * the same thing: a request has a requester and is approved or rejected; a
 * system alert has an affected employee and is marked reviewed or dismissed.
 * Every label that differs between the two is decided here, from `origin`,
 * never from guessing at the request type in the markup.
 *
 * No imports, so scripts/frontend/verify-review-queue-system-alerts.mjs can
 * run these rules directly.
 */

export type QueueOrigin = 'USER' | 'SYSTEM';
export type QueueStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface PresentableItem {
  requestType: string;
  origin?: QueueOrigin;
  status: QueueStatus;
  requestDate: string;
  employee: { name: string } | null;
  affectedEmployee?: { name: string } | null;
  details: Record<string, unknown>;
}

/** The Type filter value that switches the queue to system alerts. */
export const SYSTEM_REQUESTS_FILTER = 'SYSTEM_REQUESTS';
export const SYSTEM_REQUESTS_LABEL = 'System Requests';

/**
 * Ordinary request types offered under the Type filter. Punch evidence is not
 * one of them: those alerts are reached only through System Requests.
 */
export const USER_REQUEST_TYPES: ReadonlyArray<readonly [string, string]> = [
  ['ATTENDANCE_CORRECTION', 'Attendance Correction'],
  ['LEAVE_REQUEST', 'Leave Request'],
  ['DEPARTMENT_ROLE_TRANSFER', 'Department/Role Transfer'],
  ['RETENTION_RULE_PROPOSAL', 'Retention Rule Proposal'],
  ['LEGAL_HOLD_REQUEST', 'Legal Hold Request'],
  ['FNF_ADJUSTMENT_REQUEST', 'F&F Adjustment Request'],
];

/** Which list the server is asked for. Anything but System Requests is the default list. */
export function queueOrigin(typeFilter: string): 'default' | 'system' {
  return typeFilter === SYSTEM_REQUESTS_FILTER ? 'system' : 'default';
}

export function isSystemItem(item: Pick<PresentableItem, 'origin'>): boolean {
  return item.origin === 'SYSTEM';
}

/** The person a row is about: the requester's employee, or the affected employee of an alert. */
export function subjectName(item: PresentableItem): string {
  if (isSystemItem(item)) return item.affectedEmployee?.name ?? 'Unknown employee';
  return item.employee?.name ?? 'Company request';
}

export function statusLabel(item: Pick<PresentableItem, 'origin' | 'status'>): string {
  if (isSystemItem(item)) return item.status === 'PENDING' ? 'Needs Review' : item.status === 'APPROVED' ? 'Reviewed' : 'Dismissed';
  return item.status === 'PENDING' ? 'Pending' : item.status === 'APPROVED' ? 'Approved' : 'Rejected';
}

export function statusOptions(system: boolean): Array<[QueueStatus, string]> {
  return system
    ? [['PENDING', 'Needs Review'], ['APPROVED', 'Reviewed'], ['REJECTED', 'Dismissed']]
    : [['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected']];
}

export const ACTION_LABELS = {
  USER: { approve: 'Approve', reject: 'Reject' },
  SYSTEM: { approve: 'Mark Reviewed', reject: 'Dismiss with Reason' },
} as const;

export function actionLabels(item: Pick<PresentableItem, 'origin'>) {
  return isSystemItem(item) ? ACTION_LABELS.SYSTEM : ACTION_LABELS.USER;
}

/** Column headings. A system alert never has a Name/Requester column. */
export const USER_COLUMNS = ['Employee ID', 'Name', 'Type', 'Reason / Request details', 'Status'] as const;
export const SYSTEM_COLUMNS = ['Source', 'Affected Employee', 'Alert', 'Business Date', 'Punch Type', 'Status'] as const;

export function punchTypeLabel(value: unknown): string {
  const one = (v: unknown) => (v === 'PUNCH_IN' ? 'Punch In' : v === 'PUNCH_OUT' ? 'Punch Out' : String(v ?? ''));
  if (Array.isArray(value)) return value.map(one).join(' + ') || '—';
  return value ? one(value) : '—';
}

export interface QueueFilters {
  date: string;
  name: string;
  type: string;
  status: QueueStatus | '';
}

export const DEFAULT_FILTERS: QueueFilters = { date: '', name: '', type: '', status: 'PENDING' };

/**
 * The client-side filters, applied to whichever list the server returned. The
 * server already split system alerts from requests, so the Type filter only
 * narrows ordinary requests; the name search reads the affected employee for
 * an alert.
 */
export function filterQueueItems<T extends PresentableItem>(items: T[], filters: QueueFilters): T[] {
  const needle = filters.name.trim().toLowerCase();
  const system = queueOrigin(filters.type) === 'system';
  return items.filter((item) => {
    if (system !== isSystemItem(item)) return false;
    const day = system ? String(item.details.businessDate ?? item.requestDate).slice(0, 10) : item.requestDate.slice(0, 10);
    if (filters.date && day !== filters.date) return false;
    if (needle && !subjectName(item).toLowerCase().includes(needle)) return false;
    if (!system && filters.type && item.requestType !== filters.type) return false;
    if (filters.status && item.status !== filters.status) return false;
    return true;
  });
}

/** How many filters differ from the default queue, for the badge on the filter button. */
export function activeFilterCount(filters: QueueFilters): number {
  return [filters.name.trim(), filters.type, filters.status].filter(Boolean).length;
}
