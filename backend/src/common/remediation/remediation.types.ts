/**
 * The structured remediation contract (Phase 1 foundation, spec §3).
 *
 * Every failure a person can act on is described by one RemediationResult:
 * what happened, why it matters, the numbered steps, and only the actions the
 * server can actually perform. The frontend mirror lives in
 * shared/remediation/shared/remediation-contract.ts; a unit test keeps the two
 * vocabularies identical.
 */

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

/** Who is told about the issue, in the current authority model (no role bifurcation). */
export const RECIPIENT_GROUPS = ['SUPER_ADMIN', 'ADMIN', 'HR', 'HIERARCHY', 'SUBJECT'] as const;
export type RecipientGroup = (typeof RECIPIENT_GROUPS)[number];

/**
 * Server-side retries the dialog may trigger. Each maps to exactly one real
 * controller route (RETRY_ENDPOINT_ROUTES); a test resolves every one.
 */
export const ALLOWED_RETRY_ENDPOINTS = [
  'LIFECYCLE_CLEANUP_RETRY',
  'LIFECYCLE_ARCHIVE_CLEANUP_RETRY',
  'ARCHIVE_PREFLIGHT',
  'PERMANENT_DELETE_PREFLIGHT',
  'VERIFIED_ARCHIVE_PREPARE',
] as const;
export type AllowedRetryEndpoint = (typeof ALLOWED_RETRY_ENDPOINTS)[number];

export const RETRY_ENDPOINT_ROUTES: Record<AllowedRetryEndpoint, { method: 'GET' | 'POST'; path: string }> = {
  LIFECYCLE_CLEANUP_RETRY: { method: 'POST', path: 'user-lifecycle/operations/:operationId/cleanup-retry' },
  LIFECYCLE_ARCHIVE_CLEANUP_RETRY: { method: 'POST', path: 'user-lifecycle/operations/:operationId/archive-cleanup-retry' },
  ARCHIVE_PREFLIGHT: { method: 'GET', path: 'user-lifecycle/:userId/archive/preflight' },
  PERMANENT_DELETE_PREFLIGHT: { method: 'GET', path: 'user-lifecycle/:userId/permanent-delete/preflight' },
  VERIFIED_ARCHIVE_PREPARE: { method: 'POST', path: 'user-lifecycle/:userId/verified-archive' },
};

/** Server routes behind actions that are not retries (resolved at click time). */
export const ACTION_ENDPOINT_ROUTES: Partial<Record<RemediationActionId, { method: 'GET' | 'POST'; path: string }>> = {
  OPEN_ARCHIVE_FOLDER: { method: 'GET', path: 'user-lifecycle/:userId/archive-folder' },
};

/**
 * Action ids. Navigation and configuration ids resolve through fixed frontend
 * route maps; a payload never carries a URL.
 */
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
  /** SAFE_REPAIR only: what the confirm step tells the person will happen. */
  previewCount?: number;
}

export type RemediationDetailValue = string | number | boolean | string[];

export interface RemediationResult {
  code: string;
  remediationClass: RemediationClass;
  severity: RemediationSeverity;
  blockingScope: BlockingScope;
  /** Only on authorized surfaces. */
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
  /** Per-code allow-listed keys only. */
  details?: Record<string, RemediationDetailValue>;
}

/** The HTTP body every remediation error has: `{ statusCode, error: 'REMEDIATION', remediation }`. */
export interface RemediationErrorBody {
  statusCode: number;
  error: 'REMEDIATION';
  remediation: RemediationResult;
  /** Kept so existing callers that read `code`/`message` keep working. */
  code: string;
  message: string;
}
