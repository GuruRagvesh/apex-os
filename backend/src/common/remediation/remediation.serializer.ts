/**
 * Builds and sanitizes remediation payloads. Nothing reaches a client or the
 * attempt history without passing sanitizeRemediation():
 *
 *   1. Output allow-list: only the RemediationResult fields are copied.
 *   2. `details` keeps only the keys registered for that code.
 *   3. Exact-name deny-list as a second guard (case-insensitive on the whole
 *      key, never a substring, so dedupeKey/policyKey/idempotencyKey survive).
 *   4. Unknown action ids, unknown retry endpoints and any SAFE_REPAIR that
 *      violates the gate are dropped; a dropped Safe Repair is logged by code.
 */

import { Logger } from '@nestjs/common';
import {
  ACTION_KIND,
  ALLOWED_RETRY_ENDPOINTS,
  AllowedRetryEndpoint,
  RECIPIENT_GROUPS,
  REMEDIATION_ACTION_IDS,
  REMEDIATION_CLASSES,
  RemediationAction,
  RemediationDetailValue,
  RemediationResult,
  RemediationStatus,
} from './remediation.types';
import { DELETE_BLOCKER_PRECEDENCE, REMEDIATION_REGISTRY, actionsFor, safeRepairAllowed } from './remediation.registry';

export const DENIED_KEYS: readonly string[] = [
  'password', 'passwordHash', 'newPassword', 'currentPassword', 'token', 'accessToken', 'refreshToken', 'idToken',
  'resetCode', 'otp', 'secret', 'clientSecret', 'apiKey', 'hmacKey', 'encryptionKey', 'privateKey', 'credentials',
  'authorization', 'cookie', 'providerFileId', 'driveFileId', 'driveFolderId', 'workbookFileId',
];
const DENIED = new Set(DENIED_KEYS.map((k) => k.toLowerCase()));

export function isDeniedKey(key: string): boolean {
  return DENIED.has(key.toLowerCase());
}

const SEVERITIES = ['INFO', 'WARNING', 'BLOCKING'];
const SCOPES = ['NONE', 'OPERATION', 'USER', 'SUBSYSTEM'];
const STATUSES = ['OPEN', 'RESOLVED', 'PENDING'];
const logger = new Logger('Remediation');

function str(v: unknown, max = 600): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function cleanDetails(code: string, raw: unknown): Record<string, RemediationDetailValue> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const allowed = REMEDIATION_REGISTRY[code]?.detailKeys ?? [];
  const out: Record<string, RemediationDetailValue> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.includes(k) || isDeniedKey(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out[k] = (v as string[]).slice(0, 20).map((x) => x.slice(0, 80));
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The output allow-list, deny-list and Safe Repair gate. Accepts anything; returns only contract fields. */
export function sanitizeRemediation(raw: any): RemediationResult {
  const code = str(raw?.code, 80);
  const remediationClass = (REMEDIATION_CLASSES as readonly string[]).includes(raw?.remediationClass) ? raw.remediationClass : 'BACKEND_OPERATIONS';
  const flags = {
    remediationClass,
    canSystemRepair: raw?.canSystemRepair === true,
    requiresManualExternalAction: raw?.requiresManualExternalAction === true,
    requiresBackendOperations: raw?.requiresBackendOperations === true,
  };
  const actions: RemediationAction[] = [];
  for (const a of Array.isArray(raw?.actions) ? raw.actions : []) {
    if (!(REMEDIATION_ACTION_IDS as readonly string[]).includes(a?.id)) continue;
    if (a.id === 'SAFE_REPAIR' && !safeRepairAllowed(flags)) {
      logger.warn(`Dropped a SAFE_REPAIR action that violates the gate for ${code || 'UNKNOWN'}`);
      continue;
    }
    if (actions.some((x) => x.id === a.id)) continue;
    actions.push({
      id: a.id,
      kind: ACTION_KIND[a.id as keyof typeof ACTION_KIND],
      label: str(a.label, 80) || a.id,
      ...(a.id === 'SAFE_REPAIR' && Number.isInteger(a.previewCount) ? { previewCount: a.previewCount } : {}),
    });
  }
  const retryEndpoint = (ALLOWED_RETRY_ENDPOINTS as readonly string[]).includes(raw?.retryEndpoint) ? (raw.retryEndpoint as AllowedRetryEndpoint) : undefined;
  const out: RemediationResult = {
    code,
    remediationClass,
    severity: SEVERITIES.includes(raw?.severity) ? raw.severity : 'BLOCKING',
    blockingScope: SCOPES.includes(raw?.blockingScope) ? raw.blockingScope : 'OPERATION',
    title: str(raw?.title, 160),
    problem: str(raw?.problem),
    whyItMatters: str(raw?.whyItMatters),
    correctionSteps: (Array.isArray(raw?.correctionSteps) ? raw.correctionSteps : []).filter((s: unknown) => typeof s === 'string').slice(0, 10).map((s: string) => s.slice(0, 300)),
    actions: actions.filter((a) => a.kind !== 'RETRY_VERIFICATION' || !!retryEndpoint).filter((a) => a.kind !== 'SAFE_REPAIR' || !!retryEndpoint),
    canSystemRepair: flags.canSystemRepair,
    requiresManualExternalAction: flags.requiresManualExternalAction,
    requiresBackendOperations: flags.requiresBackendOperations,
    status: STATUSES.includes(raw?.status) ? raw.status : 'OPEN',
    lastCheckedAt: typeof raw?.lastCheckedAt === 'string' && !Number.isNaN(Date.parse(raw.lastCheckedAt)) ? new Date(raw.lastCheckedAt).toISOString() : new Date().toISOString(),
    notificationRecipients: (Array.isArray(raw?.notificationRecipients) ? raw.notificationRecipients : []).filter((g: unknown) => (RECIPIENT_GROUPS as readonly string[]).includes(g as string)),
  };
  if (retryEndpoint) out.retryEndpoint = retryEndpoint;
  if (typeof raw?.affectedUserId === 'string') out.affectedUserId = raw.affectedUserId.slice(0, 80);
  if (typeof raw?.operationId === 'string') out.operationId = raw.operationId.slice(0, 80);
  const details = cleanDetails(code, raw?.details);
  if (details) out.details = details;
  return out;
}

export interface BuildOptions {
  affectedUserId?: string;
  operationId?: string;
  details?: Record<string, unknown>;
  status?: RemediationStatus;
  now?: Date;
  previewCount?: number;
}

/** A registered code's remediation, sanitized. Throws for an unregistered code: the registry is the source of truth. */
export function buildRemediation(code: string, opts: BuildOptions = {}): RemediationResult {
  const e = REMEDIATION_REGISTRY[code];
  if (!e) throw new Error(`REMEDIATION_CODE_NOT_REGISTERED:${code}`);
  return sanitizeRemediation({
    code,
    ...e,
    actions: actionsFor(e.actions, opts.previewCount, e.actionLabels),
    status: opts.status ?? 'OPEN',
    lastCheckedAt: (opts.now ?? new Date()).toISOString(),
    affectedUserId: opts.affectedUserId,
    operationId: opts.operationId,
    details: opts.details,
  });
}

/**
 * The highest-precedence remediation code among `codes` (erratum E2), plus
 * every other blocker for `details.otherBlockers`. Codes not in the precedence
 * list keep their given order after it.
 */
export function pickByPrecedence(codes: string[]): { primary: string | null; others: string[] } {
  const unique = [...new Set(codes)];
  const rank = (c: string) => {
    const i = DELETE_BLOCKER_PRECEDENCE.indexOf(c);
    return i < 0 ? DELETE_BLOCKER_PRECEDENCE.length : i;
  };
  const sorted = unique.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map((x) => x.c);
  const primary = sorted.find((c) => !!REMEDIATION_REGISTRY[c]) ?? null;
  return { primary, others: sorted.filter((c) => c !== primary) };
}
