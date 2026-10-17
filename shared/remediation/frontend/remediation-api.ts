// shared/remediation — HTTP clients (Phase 1, spec §11.5).
//
// Published ONLY as '@apex/shared-remediation/api'. The root barrel never
// re-exports this file, so screens that only need the dialog or the types do
// not pull axios and the authenticated client into their bundle.
//
// Every route here is a real controller route; retries always re-run the
// server check and the dialog shows whatever the server answers.

import { api, unwrap as r } from '@apex/shared-auth';
import { RemediationAction, RemediationResult, AllowedRetryEndpoint } from '../shared/remediation-contract';

export interface LifecycleOperationView {
  operationId: string;
  kind: string;
  state: string;
  result: Record<string, unknown> | null;
  remediation: RemediationResult | null;
}

export interface RemediationAttemptView {
  attemptNo: number;
  code: string;
  phase: 'FAILURE' | 'VERIFICATION' | 'INSTRUCTION' | 'RETRY' | 'RESOLUTION';
  outcome: string;
  actorId: string;
  serverAt: string;
  remediation: RemediationResult;
}

const enc = encodeURIComponent;

export const getLifecycleOperation = (operationId: string): Promise<LifecycleOperationView> =>
  r(api.get(`/user-lifecycle/operations/${enc(operationId)}`));

export const listRemediationAttempts = (operationId: string): Promise<{ operationId: string; attempts: RemediationAttemptView[] }> =>
  r(api.get(`/user-lifecycle/operations/${enc(operationId)}/attempts`));

export const retryCleanup = (operationId: string): Promise<LifecycleOperationView> =>
  r(api.post(`/user-lifecycle/operations/${enc(operationId)}/cleanup-retry`));

export const retryArchiveCleanup = (operationId: string): Promise<LifecycleOperationView> =>
  r(api.post(`/user-lifecycle/operations/${enc(operationId)}/archive-cleanup-retry`));

export const archivePreflight = (userId: string): Promise<any> =>
  r(api.get(`/user-lifecycle/${enc(userId)}/archive/preflight`));

/** Read-only archive storage check (Retry Verification for ARCHIVE_PRIVACY_FAILED). Never archives the user. */
export const verifyArchiveStorage = (userId: string, operationId?: string): Promise<{ ready: boolean; remediation: RemediationResult }> =>
  r(api.post(`/user-lifecycle/${enc(userId)}/archive/storage-verification`, operationId ? { operationId } : {}));

export const permanentDeletePreflight = (userId: string): Promise<any> =>
  r(api.get(`/user-lifecycle/${enc(userId)}/permanent-delete/preflight`));

export const getArchivedStatus = (ids: string[]): Promise<any[]> =>
  r(api.get('/user-lifecycle/archived-status', { params: { ids: ids.join(',') } }));

export const getNotificationPreferences = (): Promise<Record<string, any>> => r(api.get('/users/me/preferences'));

export const updateNotificationPreferences = (prefs: Record<string, any>): Promise<Record<string, any>> =>
  r(api.patch('/users/me/preferences', prefs));

export const prepareVerifiedArchive = (userId: string, idempotencyKey: string): Promise<LifecycleOperationView> =>
  r(api.post(`/user-lifecycle/${enc(userId)}/verified-archive`, { idempotencyKey }));

export const getArchiveFolder = (userId: string): Promise<{ url: string }> =>
  r(api.get(`/user-lifecycle/${enc(userId)}/archive-folder`));

function randomKey(): string {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  c?.getRandomValues ? c.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.floor(Math.random() * 256); });
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const listUserSetupIssues = (userId: string): Promise<{ userId: string; issues: any[] }> =>
  r(api.get(`/users/${enc(userId)}/setup-issues`));

/** The same result, marked resolved by a fresh server check. */
function resolved(current: RemediationResult): RemediationResult {
  return { ...current, status: 'RESOLVED', lastCheckedAt: new Date().toISOString() };
}

/** The same result, re-checked but not provable from this check alone. */
function stillPending(current: RemediationResult): RemediationResult {
  return { ...current, status: 'PENDING', lastCheckedAt: new Date().toISOString() };
}

const fromOperation = (current: RemediationResult, op: LifecycleOperationView): RemediationResult => {
  if (op.state === 'PERMANENTLY_DELETED' || op.state === 'COMPLETED' || op.state === 'FAILED') return resolved(current);
  return op.remediation ?? stillPending(current);
};

const RETRY: Record<AllowedRetryEndpoint, (current: RemediationResult) => Promise<RemediationResult>> = {
  LIFECYCLE_CLEANUP_RETRY: async (current) => {
    if (!current.operationId) throw new Error('NO_OPERATION');
    return fromOperation(current, await retryCleanup(current.operationId));
  },
  LIFECYCLE_ARCHIVE_CLEANUP_RETRY: async (current) => {
    if (!current.operationId) throw new Error('NO_OPERATION');
    return fromOperation(current, await retryArchiveCleanup(current.operationId));
  },
  ARCHIVE_PREFLIGHT: async (current) => {
    if (!current.affectedUserId) throw new Error('NO_USER');
    const p = await archivePreflight(current.affectedUserId);
    if (p?.remediation) return p.remediation as RemediationResult;
    // The preflight checks vault readiness and running operations; a privacy
    // failure can only be re-checked by confirming the archive again.
    if (current.code === 'ARCHIVE_PRIVACY_FAILED') return stillPending(current);
    return resolved(current);
  },
  ARCHIVE_STORAGE_VERIFY: async (current) => {
    if (!current.affectedUserId) throw new Error('NO_USER');
    // Either a fresh privacy failure with its exact category, or "storage is
    // ready, confirm Archive again". Never a claim that the archive succeeded.
    const v = await verifyArchiveStorage(current.affectedUserId, current.operationId);
    return v.remediation;
  },
  VERIFIED_ARCHIVE_PREPARE: async (current) => {
    if (!current.affectedUserId) throw new Error('NO_USER');
    await prepareVerifiedArchive(current.affectedUserId, randomKey());
    // The repair is proven only by a fresh deletion check.
    const p = await permanentDeletePreflight(current.affectedUserId);
    if (p?.remediation) return p.remediation as RemediationResult;
    return p?.allowed ? resolved(current) : stillPending(current);
  },
  PERMANENT_DELETE_PREFLIGHT: async (current) => {
    if (!current.affectedUserId) throw new Error('NO_USER');
    const p = await permanentDeletePreflight(current.affectedUserId);
    if (p?.remediation) return p.remediation as RemediationResult;
    return p?.allowed ? resolved(current) : stillPending(current);
  },
};

/**
 * Maps dialog action ids to the typed clients above. Navigation, settings and
 * Copy Diagnostic are handled inside the dialog; this runs server actions only.
 */
export function createRemediationActionRunner() {
  return async (action: RemediationAction, current: RemediationResult): Promise<RemediationResult | void> => {
    if (action.kind === 'OPEN_ARCHIVE_FOLDER') {
      if (!current.affectedUserId) return;
      const { url } = await getArchiveFolder(current.affectedUserId);
      if (/^https:\/\/drive\.google\.com\//.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (action.kind !== 'RETRY_VERIFICATION' && action.kind !== 'SAFE_REPAIR') return;
    if (!current.retryEndpoint || !RETRY[current.retryEndpoint]) return;
    return RETRY[current.retryEndpoint](current);
  };
}
