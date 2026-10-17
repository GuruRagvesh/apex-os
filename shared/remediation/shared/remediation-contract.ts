// shared/remediation — framework-free contract (Phase 1, spec §3 and §11.1).
//
// Mirrors backend/src/common/remediation/remediation.types.ts. Pure TypeScript:
// no React, no HTTP client, so the backend's jest suite imports this file to
// prove both sides use the same vocabulary.

export const REMEDIATION_CLASSES = [
  'WARNING_NON_BLOCKING',
  'USER_FIXABLE',
  'ADMIN_FIXABLE_FRONTEND',
  'SYSTEM_REPAIRABLE',
  'MANUAL_EXTERNAL',
  'BACKEND_OPERATIONS',
  'SECURITY_OR_LEGAL_BLOCK',
] as const;
export type RemediationClass = (typeof REMEDIATION_CLASSES)[number];

export type RemediationSeverity = 'INFO' | 'WARNING' | 'BLOCKING';
export type BlockingScope = 'NONE' | 'OPERATION' | 'USER' | 'SUBSYSTEM';
export type RemediationStatus = 'OPEN' | 'RESOLVED' | 'PENDING';
export const RECIPIENT_GROUPS = ['SUPER_ADMIN', 'ADMIN', 'HR', 'HIERARCHY', 'SUBJECT'] as const;
export type RecipientGroup = (typeof RECIPIENT_GROUPS)[number];

export const ALLOWED_RETRY_ENDPOINTS = [
  'LIFECYCLE_CLEANUP_RETRY',
  'LIFECYCLE_ARCHIVE_CLEANUP_RETRY',
  'ARCHIVE_PREFLIGHT',
  'PERMANENT_DELETE_PREFLIGHT',
  'VERIFIED_ARCHIVE_PREPARE',
  'ARCHIVE_STORAGE_VERIFY',
] as const;
export type AllowedRetryEndpoint = (typeof ALLOWED_RETRY_ENDPOINTS)[number];

export const REMEDIATION_ACTION_IDS = [
  'RETRY_VERIFICATION',
  'SAFE_REPAIR',
  'COPY_DIAGNOSTIC',
  'OPEN_USER_PROFILE',
  'OPEN_USER_DIRECTORY',
  'OPEN_LEAVE_POLICY_SETTINGS',
  'OPEN_NOTIFICATION_SETTINGS',
  'OPEN_ARCHIVE_FOLDER',
  'OPEN_DEPARTMENTS',
  'CHOOSE_ANOTHER_ROLE',
  'CHOOSE_ANOTHER_DEPARTMENT',
  'CONTINUE_WITHOUT_DEPARTMENT',
] as const;
export type RemediationActionId = (typeof REMEDIATION_ACTION_IDS)[number];

export type RemediationActionKind = 'NAVIGATE' | 'RETRY_VERIFICATION' | 'SAFE_REPAIR' | 'OPEN_CONFIGURATION' | 'COPY_DIAGNOSTIC' | 'OPEN_ARCHIVE_FOLDER' | 'FORM_FIX';

export const ACTION_KIND: Record<RemediationActionId, RemediationActionKind> = {
  RETRY_VERIFICATION: 'RETRY_VERIFICATION',
  SAFE_REPAIR: 'SAFE_REPAIR',
  COPY_DIAGNOSTIC: 'COPY_DIAGNOSTIC',
  OPEN_USER_PROFILE: 'NAVIGATE',
  OPEN_USER_DIRECTORY: 'NAVIGATE',
  OPEN_LEAVE_POLICY_SETTINGS: 'OPEN_CONFIGURATION',
  OPEN_NOTIFICATION_SETTINGS: 'OPEN_CONFIGURATION',
  OPEN_ARCHIVE_FOLDER: 'OPEN_ARCHIVE_FOLDER',
  OPEN_DEPARTMENTS: 'NAVIGATE',
  // Handled by the form that raised the error; the form keeps every value.
  CHOOSE_ANOTHER_ROLE: 'FORM_FIX',
  CHOOSE_ANOTHER_DEPARTMENT: 'FORM_FIX',
  CONTINUE_WITHOUT_DEPARTMENT: 'FORM_FIX',
};

export interface RemediationAction {
  id: RemediationActionId;
  kind: RemediationActionKind;
  label: string;
  previewCount?: number;
}

export type RemediationDetailValue = string | number | boolean | string[];

export interface RemediationResult {
  code: string;
  remediationClass: RemediationClass;
  severity: RemediationSeverity;
  blockingScope: BlockingScope;
  affectedUserId?: string;
  title: string;
  problem: string;
  whyItMatters: string;
  correctionSteps: string[];
  actions: RemediationAction[];
  canSystemRepair: boolean;
  requiresManualExternalAction: boolean;
  requiresBackendOperations: boolean;
  retryEndpoint?: AllowedRetryEndpoint;
  status: RemediationStatus;
  lastCheckedAt: string;
  operationId?: string;
  notificationRecipients: RecipientGroup[];
  details?: Record<string, RemediationDetailValue>;
}

/**
 * Fixed in-app routes for NAVIGATE actions. A payload never supplies a URL; at
 * most it supplies the affected user's id, which is path-encoded here.
 */
export const NAVIGATE_ROUTES: Partial<Record<RemediationActionId, (r: RemediationResult) => string | null>> = {
  OPEN_USER_PROFILE: (r) => (r.affectedUserId ? `/users/${encodeURIComponent(r.affectedUserId)}` : null),
  OPEN_USER_DIRECTORY: () => '/users',
  OPEN_DEPARTMENTS: () => '/departments',
};

/**
 * NAVIGATE actions raised from inside an open form. They open in a new tab so
 * the form, and every value typed into it, stays where it is.
 */
export const NEW_TAB_NAVIGATION: readonly RemediationActionId[] = ['OPEN_DEPARTMENTS'];

export type FormFixHandlers = Partial<Record<RemediationActionId, () => void | Promise<void>>>;
type ActionRunner = (action: RemediationAction, result: RemediationResult) => Promise<RemediationResult | void>;

/** Wraps a runner so FORM_FIX actions go to the form that raised the error. */
export function withFormFixes(runner: ActionRunner, fixes: FormFixHandlers): ActionRunner {
  return async (action, result) => {
    if (action.kind === 'FORM_FIX') {
      await fixes[action.id]?.();
      return;
    }
    return runner(action, result);
  };
}

/** Fixed settings routes for OPEN_CONFIGURATION actions. */
export const SETTINGS_ROUTES: Partial<Record<RemediationActionId, string>> = {
  OPEN_LEAVE_POLICY_SETTINGS: '/settings?tab=policies',
  OPEN_NOTIFICATION_SETTINGS: '/settings?tab=profile',
};

/** Keys never shown in the dialog, whatever a payload carries (case-insensitive, whole key). */
export const DENIED_DETAIL_KEYS: readonly string[] = [
  'password', 'passwordHash', 'newPassword', 'currentPassword', 'token', 'accessToken', 'refreshToken', 'idToken',
  'resetCode', 'otp', 'secret', 'clientSecret', 'apiKey', 'hmacKey', 'encryptionKey', 'privateKey', 'credentials',
  'authorization', 'cookie', 'providerFileId', 'driveFileId', 'driveFolderId', 'workbookFileId',
];

/** The detail keys the dialog may show, per code. Anything else is never rendered. */
export const DISPLAYABLE_DETAIL_KEYS: Record<string, string[]> = {
  LEGAL_HOLD_ACTIVE: ['holdStatus', 'otherBlockers'],
  LEGAL_HOLD_REQUESTED: ['holdStatus', 'otherBlockers'],
  LIFECYCLE_KEYS_MISSING: ['keyConfigurationIssues', 'otherBlockers'],
  RETENTION_POLICY_NOT_CONFIGURED: ['retentionCategories'],
  RETENTION_PERIOD_ACTIVE: ['retentionCategories', 'eligibleOn', 'otherBlockers'],
  ARCHIVE_PRIVACY_FAILED: ['folderPath', 'privacyIssue'],
  ARCHIVE_SNAPSHOT_MISSING: ['otherBlockers'],
  ARCHIVE_SNAPSHOT_STALE: ['otherBlockers'],
  OPERATION_IN_PROGRESS: ['otherBlockers'],
  CLEANUP_PENDING: ['pendingItems'],
  ROLE_NOT_FOUND_OR_REMOVED: ['field'],
  DEPARTMENT_NOT_FOUND_OR_REMOVED: ['field'],
};

/** True when an error (as the authenticated client rejects it) carries a remediation. */
export function isRemediationError(err: unknown): err is { error: 'REMEDIATION'; remediation: RemediationResult; status?: number } {
  const e = err as any;
  return !!e && typeof e === 'object' && e.error === 'REMEDIATION' && !!e.remediation && typeof e.remediation === 'object' && typeof e.remediation.code === 'string';
}

export function toRemediation(err: unknown): RemediationResult | null {
  return isRemediationError(err) ? err.remediation : null;
}

/** The Safe Repair gate, as the dialog applies it. */
export function safeRepairAllowed(r: Pick<RemediationResult, 'canSystemRepair' | 'requiresManualExternalAction' | 'requiresBackendOperations'>): boolean {
  return r.canSystemRepair === true && r.requiresManualExternalAction === false && r.requiresBackendOperations === false;
}

/**
 * The actions the dialog may render: known ids only, Safe Repair only through
 * the gate, retries only to an allowed endpoint, navigation only to a fixed
 * route, and Copy Diagnostic when there is something to copy.
 */
export function visibleActions(r: RemediationResult): RemediationAction[] {
  const out: RemediationAction[] = [];
  for (const a of Array.isArray(r.actions) ? r.actions : []) {
    if (!a || !(REMEDIATION_ACTION_IDS as readonly string[]).includes(a.id)) continue;
    const kind = ACTION_KIND[a.id];
    if (kind === 'SAFE_REPAIR' && (!safeRepairAllowed(r) || !r.retryEndpoint || !(ALLOWED_RETRY_ENDPOINTS as readonly string[]).includes(r.retryEndpoint))) continue;
    if (kind === 'RETRY_VERIFICATION' && (!r.retryEndpoint || !(ALLOWED_RETRY_ENDPOINTS as readonly string[]).includes(r.retryEndpoint))) continue;
    if (kind === 'NAVIGATE' && !NAVIGATE_ROUTES[a.id]?.(r)) continue;
    if (kind === 'OPEN_CONFIGURATION' && !SETTINGS_ROUTES[a.id]) continue;
    if (kind === 'COPY_DIAGNOSTIC' && !r.code && !r.operationId) continue;
    // Resolved by the server for the affected user at click time.
    if (kind === 'OPEN_ARCHIVE_FOLDER' && !r.affectedUserId) continue;
    if (out.some((x) => x.id === a.id)) continue;
    out.push({ ...a, kind });
  }
  return out;
}

/** Detail entries that may be shown for this payload. */
export function displayableDetails(r: RemediationResult): [string, RemediationDetailValue][] {
  const allowed = DISPLAYABLE_DETAIL_KEYS[r.code] ?? [];
  const denied = new Set(DENIED_DETAIL_KEYS.map((k) => k.toLowerCase()));
  return Object.entries(r.details ?? {}).filter(([k]) => allowed.includes(k) && !denied.has(k.toLowerCase()));
}

/** What Copy Diagnostic puts on the clipboard: the code and the operation id, nothing else. */
export function diagnosticText(r: RemediationResult): string {
  return [`code: ${r.code}`, ...(r.operationId ? [`operationId: ${r.operationId}`] : [])].join('\n');
}

export type LeaveSetupStatus = 'RESOLVED' | 'POLICY_SETUP_PENDING' | 'LEGACY_UNASSESSED';

export function displayLeaveSetupStatus(status: string | null | undefined): { label: string; tone: 'ok' | 'warning' | 'muted' } {
  if (status === 'RESOLVED') return { label: 'Policy resolved', tone: 'ok' };
  if (status === 'POLICY_SETUP_PENDING') return { label: 'Policy setup pending', tone: 'warning' };
  return { label: 'Not assessed (legacy)', tone: 'muted' };
}

export type NotificationChannel = 'popup' | 'push' | 'email';

/**
 * Effective channels for one event (spec §4): a legacy `false` turns all three
 * off, `channels[eventKey]` wins key by key, and the global inApp / pushEnabled
 * switches still apply. The Notification Center row is always kept.
 */
export function effectiveChannels(prefs: Record<string, any> | null | undefined, eventKey: string): Record<NotificationChannel, boolean> {
  const p = prefs ?? {};
  const legacyOn = p[eventKey] !== false;
  const own = (p.channels && typeof p.channels === 'object' ? p.channels[eventKey] : null) ?? {};
  const pick = (c: NotificationChannel) => (typeof own[c] === 'boolean' ? own[c] : legacyOn);
  return {
    popup: pick('popup') && p.inApp !== false,
    push: pick('push') && p.pushEnabled !== false,
    email: pick('email'),
  };
}

/** The severity badge: text and an icon name, never colour alone. */
export function severityBadge(severity: RemediationSeverity): { text: string; icon: 'info' | 'warning' | 'blocking' } {
  if (severity === 'INFO') return { text: 'Information', icon: 'info' };
  if (severity === 'WARNING') return { text: 'Warning', icon: 'warning' };
  return { text: 'Blocked', icon: 'blocking' };
}

export function scopeLabel(scope: BlockingScope): string {
  return { NONE: 'Nothing is blocked', OPERATION: 'This operation', USER: 'This user', SUBSYSTEM: 'This feature, for everyone' }[scope] ?? 'This operation';
}
