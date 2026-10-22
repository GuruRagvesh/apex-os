/**
 * The remediation registry: one entry per code the backend emits.
 *
 * Each entry fixes the class, scope, copy, actions and retry endpoint for its
 * code, so a payload cannot invent a button. Validation (validateRegistry) is a
 * build-failing unit test and also runs at module load in non-production code
 * paths through the serializer's Safe Repair gate.
 */

import {
  ACTION_KIND,
  AllowedRetryEndpoint,
  BlockingScope,
  RecipientGroup,
  RemediationAction,
  RemediationActionId,
  RemediationClass,
  RemediationSeverity,
} from './remediation.types';

export interface RegistryEntry {
  remediationClass: RemediationClass;
  severity: RemediationSeverity;
  blockingScope: BlockingScope;
  title: string;
  problem: string;
  whyItMatters: string;
  correctionSteps: string[];
  actions: RemediationActionId[];
  canSystemRepair: boolean;
  requiresManualExternalAction: boolean;
  requiresBackendOperations: boolean;
  retryEndpoint?: AllowedRetryEndpoint;
  notificationRecipients: RecipientGroup[];
  /** The only `details` keys this code may carry. */
  detailKeys: string[];
  /** Per-code button text, e.g. Safe Repair shown as "Rebuild Verified Archive". */
  actionLabels?: Partial<Record<RemediationActionId, string>>;
  /**
   * Copy chosen by one of the code's own detail values (for example the exact
   * archive privacy category), so the dialog names the real cause and its fix.
   * Only the text varies; class, flags and actions stay the entry's.
   */
  variants?: { detailKey: string; byValue: Record<string, RegistryVariant> };
}

export interface RegistryVariant {
  title?: string;
  problem: string;
  correctionSteps: string[];
}

/** The copy for `details`, or the entry's own when no variant matches. */
export function variantFor(e: RegistryEntry, details?: Record<string, unknown>): RegistryVariant | null {
  if (!e.variants || !details) return null;
  const value = details[e.variants.detailKey];
  return typeof value === 'string' ? e.variants.byValue[value] ?? null : null;
}

const REMOVE_EXTRA_ACCESS = [
  'Open the archive folder named below in Google Drive and select Manage access.',
  'Remove the extra access, keeping only the configured archive account as owner.',
  'Then retry verification. When storage is ready, confirm Archive again.',
];

const BACKEND_FOLDER_FIX = [
  'Ask backend operations to correct the archive folder configuration named below. Do not guess between duplicate folders and do not relabel folders by hand.',
  'Then retry verification. When storage is ready, confirm Archive again.',
];

/** ARCHIVE_PRIVACY_FAILED copy per privacyIssue (drive-folder-privacy PRIVACY_ISSUES). */
export const ARCHIVE_PRIVACY_VARIANTS: Record<string, RegistryVariant> = {
  ROOT_MISSING_OR_INVALID: {
    title: 'Archive root folder is not available',
    problem: 'The configured archive root folder does not exist, is trashed, or is not a folder, so the archive was not created.',
    correctionSteps: [
      'Ask backend operations to check GOOGLE_DRIVE_ARCHIVE_ROOT_FOLDER_ID for this environment and run the archive storage verification.',
      'Then retry verification. When storage is ready, confirm Archive again.',
    ],
  },
  ENVIRONMENT_FOLDER_MISSING: {
    title: 'Archive folder not initialized',
    problem: 'The archive folder for this environment has not been initialized, so the archive was not created.',
    correctionSteps: [
      'Ask an administrator to run the archive storage verification for this environment (admin:drive:verify).',
      'Then retry verification. When storage is ready, confirm Archive again.',
    ],
  },
  FOLDER_MISSING: {
    title: 'Archive folder is missing',
    problem: 'An archive folder this operation needs does not exist.',
    correctionSteps: [
      'Ask an administrator to run the archive storage verification for this environment (admin:drive:verify).',
      'Then retry verification.',
    ],
  },
  DUPLICATE_FOLDER: {
    title: 'Duplicate archive folder',
    problem: 'There is more than one archive folder with the same name at the location named below, so Apex OS will not choose between them.',
    correctionSteps: BACKEND_FOLDER_FIX,
  },
  WRONG_LABEL: {
    title: 'Archive folder has the wrong label',
    problem: 'An archive folder is not labelled for this environment, so Apex OS will not write into it.',
    correctionSteps: BACKEND_FOLDER_FIX,
  },
  TRASHED_OR_NOT_FOLDER: {
    title: 'Archive folder is trashed or invalid',
    problem: 'An archive folder is in the Drive trash or is not a folder.',
    correctionSteps: [
      'Ask the archive account owner to restore the folder from the Google Drive trash, or ask backend operations to correct the archive configuration.',
      'Then retry verification.',
    ],
  },
  SHARED_DRIVE: {
    title: 'Archive folder is in a Shared Drive',
    problem: 'This archive folder is in a Shared Drive. Archives may only be stored in a private My Drive folder owned by the archive account.',
    correctionSteps: [
      'Ask backend operations to configure a private My Drive folder owned by the archive account.',
      'Then retry verification.',
    ],
  },
  PUBLIC_LINK: {
    title: 'Archive folder is shared by link',
    problem: 'The archive folder named below is shared publicly or with anyone who has the link, so the archive was not created.',
    correctionSteps: REMOVE_EXTRA_ACCESS,
  },
  DOMAIN_SHARE: {
    title: 'Archive folder is shared with a domain',
    problem: 'The archive folder named below is shared with a whole domain, so the archive was not created.',
    correctionSteps: REMOVE_EXTRA_ACCESS,
  },
  GROUP_SHARE: {
    title: 'Archive folder is shared with a group',
    problem: 'The archive folder named below is shared with a group, so the archive was not created.',
    correctionSteps: REMOVE_EXTRA_ACCESS,
  },
  EXTRA_USER: {
    title: 'Archive folder is shared with another user',
    problem: 'The archive folder named below is shared with someone other than the archive account, so the archive was not created.',
    correctionSteps: REMOVE_EXTRA_ACCESS,
  },
  WRONG_OWNER: {
    title: 'Archive folder has the wrong owner',
    problem: 'The archive folder named below is not owned by the configured archive account.',
    correctionSteps: [
      'Do not transfer ownership or remove access automatically.',
      'Ask the archive administrator to configure a root folder created and owned by the archive account.',
      'Then retry verification.',
    ],
  },
  UPLOADED_FILE_NOT_PRIVATE: {
    title: 'Archived file was not private',
    problem: 'A file uploaded to the archive folder named below was shared beyond the archive account, so the archive was not created and the unfinished upload was removed.',
    correctionSteps: [
      'Ask the archive account owner to check the folder named below, and any Google Workspace policy, for sharing that applies to new files.',
      'Remove that sharing, keeping only the archive account as owner.',
      'Then retry verification. When storage is ready, confirm Archive again.',
    ],
  },
};

const ADMINS: RecipientGroup[] = ['SUPER_ADMIN', 'ADMIN'];

export const ACTION_LABELS: Record<RemediationActionId, string> = {
  RETRY_VERIFICATION: 'Retry verification',
  SAFE_REPAIR: 'Repair safely',
  COPY_DIAGNOSTIC: 'Copy diagnostic',
  OPEN_USER_PROFILE: 'Open user profile',
  OPEN_USER_DIRECTORY: 'Open user directory',
  OPEN_LEAVE_POLICY_SETTINGS: 'Open leave policy settings',
  OPEN_NOTIFICATION_SETTINGS: 'Open notification settings',
  OPEN_ARCHIVE_FOLDER: 'Open archive folder',
  OPEN_DEPARTMENTS: 'Open departments',
  CHOOSE_ANOTHER_ROLE: 'Choose another role',
  CHOOSE_ANOTHER_DEPARTMENT: 'Choose another department',
  CONTINUE_WITHOUT_DEPARTMENT: 'Continue without department',
};

export const REMEDIATION_REGISTRY: Record<string, RegistryEntry> = {
  ARCHIVE_VAULT_NOT_READY: {
    remediationClass: 'BACKEND_OPERATIONS',
    severity: 'BLOCKING',
    blockingScope: 'SUBSYSTEM',
    title: 'Archive storage is not ready',
    problem: 'The archive vault this server writes user archives to is not available, so the archive could not be created.',
    whyItMatters: 'A user is archived only after a complete, verified copy of their records exists. Nothing about this user was changed.',
    correctionSteps: [
      'Ask the system administrator to check the archive vault configuration for this environment.',
      'Once the vault is ready, open Archive again and confirm.',
    ],
    actions: ['RETRY_VERIFICATION', 'COPY_DIAGNOSTIC'],
    canSystemRepair: false,
    requiresManualExternalAction: false,
    requiresBackendOperations: true,
    retryEndpoint: 'ARCHIVE_PREFLIGHT',
    notificationRecipients: ADMINS,
    detailKeys: [],
  },
  ARCHIVE_PRIVACY_FAILED: {
    remediationClass: 'MANUAL_EXTERNAL',
    severity: 'BLOCKING',
    blockingScope: 'OPERATION',
    title: 'Archive privacy check failed',
    problem: 'An archive folder failed the privacy check, so the archive was not created.',
    whyItMatters: 'Archived records must be private to the archive account. Nothing about this user was changed.',
    correctionSteps: [
      'Ask the archive account owner to remove the extra sharing from the archive folders.',
      'Then open Archive again and confirm.',
    ],
    actions: ['OPEN_ARCHIVE_FOLDER', 'RETRY_VERIFICATION', 'COPY_DIAGNOSTIC'],
    canSystemRepair: false,
    requiresManualExternalAction: true,
    requiresBackendOperations: false,
    // Read-only root and folder-chain check; never archives the user.
    retryEndpoint: 'ARCHIVE_STORAGE_VERIFY',
    notificationRecipients: ADMINS,
    // A path inside the archive tree and a fixed category: never a Drive id or a sharing identity.
    detailKeys: ['folderPath', 'privacyIssue'],
    variants: { detailKey: 'privacyIssue', byValue: ARCHIVE_PRIVACY_VARIANTS },
  },
  ARCHIVE_STORAGE_READY: {
    remediationClass: 'WARNING_NON_BLOCKING',
    severity: 'INFO',
    blockingScope: 'NONE',
    title: 'Archive storage is ready',
    problem: 'Archive storage is ready. Close this message and confirm Archive again.',
    whyItMatters: 'This check only read the archive folders. Nothing was archived and nothing about this user changed; Archive repeats every check when you confirm it.',
    correctionSteps: ['Close this message.', 'Confirm Archive again.'],
    actions: ['COPY_DIAGNOSTIC'],
    canSystemRepair: false,
    requiresManualExternalAction: false,
    requiresBackendOperations: false,
    notificationRecipients: [],
    detailKeys: [],
  },
  LEGAL_HOLD_ACTIVE: {
    remediationClass: 'SECURITY_OR_LEGAL_BLOCK',
    severity: 'BLOCKING',
    blockingScope: 'USER',
    title: 'Legal hold active',
    problem: 'This user has an active legal hold, so their records cannot be permanently deleted.',
    whyItMatters: 'A legal hold preserves records for a legal or audit matter. It does not affect access or any other module.',
    correctionSteps: [
      'Confirm with the person responsible for the hold whether it can be released.',
      'When the hold is released, retry verification.',
    ],
    actions: ['RETRY_VERIFICATION', 'COPY_DIAGNOSTIC'],
    canSystemRepair: false,
    requiresManualExternalAction: false,
    requiresBackendOperations: false,
    retryEndpoint: 'PERMANENT_DELETE_PREFLIGHT',
    notificationRecipients: ADMINS,
    detailKeys: ['holdStatus', 'otherBlockers'],
  },
  LEGAL_HOLD_REQUESTED: {
    remediationClass: 'SECURITY_OR_LEGAL_BLOCK',
    severity: 'BLOCKING',
    blockingScope: 'USER',
    title: 'Awaiting hold review',
    problem: 'A legal hold has been requested for this user and is awaiting review, so their records cannot be permanently deleted.',
    whyItMatters: 'A requested hold blocks deletion until an Admin or Super Admin confirms or rejects it, or the requester withdraws it.',
    correctionSteps: [
      'Ask an Admin or Super Admin to review the requested hold.',
      'When it is rejected or withdrawn, retry verification.',
    ],
    actions: ['RETRY_VERIFICATION', 'COPY_DIAGNOSTIC'],
    canSystemRepair: false,
    requiresManualExternalAction: false,
    requiresBackendOperations: false,
    retryEndpoint: 'PERMANENT_DELETE_PREFLIGHT',
    notificationRecipients: ADMINS,
    detailKeys: ['holdStatus', 'otherBlockers'],
  },
  LIFECYCLE_KEYS_MISSING: {
    remediationClass: 'BACKEND_OPERATIONS',
    severity: 'BLOCKING',
    blockingScope: 'SUBSYSTEM',
    title: 'Permanent deletion is not configured',
    problem: 'This server is missing the keys that protect file references during permanent deletion.',
    whyItMatters: 'Without them the deleted user\'s original files could not be cleaned up safely, so deletion is refused.',
    correctionSteps: [
      'Configure LIFECYCLE_HANDLE_ENCRYPTION_KEY and LIFECYCLE_HANDLE_HMAC_KEY on the backend as two different random 32-byte Base64 values.',
      'Restart or redeploy the backend after saving the variables. Do not add these keys to the frontend or database.',
      'Then retry verification.',
    ],
    actions: ['RETRY_VERIFICATION', 'COPY_DIAGNOSTIC'],
    canSystemRepair: false,
    requiresManualExternalAction: false,
    requiresBackendOperations: true,
    retryEndpoint: 'PERMANENT_DELETE_PREFLIGHT',
    notificationRecipients: ADMINS,
    detailKeys: ['keyConfigurationIssues', 'otherBlockers'],
  },
  RETENTION_POLICY_NOT_CONFIGURED: {
    remediationClass: 'WARNING_NON_BLOCKING',
    severity: 'WARNING',
    blockingScope: 'NONE',
    title: 'No retention rule is configured',
    problem: 'No approved record-retention rule is configured for this user\'s attendance, leave or payroll records.',
    whyItMatters: 'This is a configuration warning and does not block deletion: a complete verified archive keeps the records, and no approved rule requires the live copies to remain.',
    correctionSteps: [
      'If the company requires live records to be kept for a period, ask an administrator to approve that retention rule.',
      'Otherwise no action is needed.',
    ],
    actions: ['COPY_DIAGNOSTIC'],
    canSystemRepair: false,
    requiresManualExternalAction: false,
    requiresBackendOperations: false,
    retryEndpoint: 'PERMANENT_DELETE_PREFLIGHT',
    notificationRecipients: [],
    detailKeys: ['retentionCategories'],
  },
  RETENTION_PERIOD_ACTIVE: {
    remediationClass: 'SECURITY_OR_LEGAL_BLOCK',
    severity: 'BLOCKING',
    blockingScope: 'USER',
    title: 'Approved retention period has not elapsed',
    problem: 'An approved retention rule requires this user\'s live records to remain until the retention period has passed.',
    whyItMatters: 'Records covered by an approved retention rule cannot be removed early, even with a verified archive.',
    correctionSteps: [
      'Wait until the eligibility date shown here.',
      'Then retry verification.',
    ],
    actions: ['RETRY_VERIFICATION', 'COPY_DIAGNOSTIC'],
    canSystemRepair: false,
    requiresManualExternalAction: false,
    requiresBackendOperations: false,
    retryEndpoint: 'PERMANENT_DELETE_PREFLIGHT',
    notificationRecipients: ADMINS,
    detailKeys: ['retentionCategories', 'eligibleOn', 'otherBlockers'],
  },
  ARCHIVE_SNAPSHOT_MISSING: {
    remediationClass: 'SYSTEM_REPAIRABLE',
    severity: 'BLOCKING',
    blockingScope: 'USER',
    title: 'No verified archive exists yet',
    problem: 'This user was archived before verified archive snapshots existed, so there is no verified archive to check.',
    whyItMatters: 'Permanent Delete only proceeds after a complete archive has been written and read back. The user stays archived; nothing is reopened.',
    correctionSteps: [
      'Use Prepare Verified Archive. Apex OS scans the current records and files, uploads them to the private archive and verifies every byte.',
      'Then retry verification.',
    ],
    actions: ['SAFE_REPAIR', 'COPY_DIAGNOSTIC'],
    actionLabels: { SAFE_REPAIR: 'Prepare Verified Archive' },
    canSystemRepair: true,
    requiresManualExternalAction: false,
    requiresBackendOperations: false,
    retryEndpoint: 'VERIFIED_ARCHIVE_PREPARE',
    notificationRecipients: ADMINS,
    detailKeys: ['otherBlockers'],
  },
  ARCHIVE_SNAPSHOT_STALE: {
    remediationClass: 'SYSTEM_REPAIRABLE',
    severity: 'BLOCKING',
    blockingScope: 'USER',
    title: 'The verified archive is out of date',
    problem: 'This user\'s records or files no longer match the verified archive, or the stored archive is missing or damaged.',
    whyItMatters: 'Deleting now could lose records that are not in the archive. The existing archive stays in place until a replacement is verified.',
    correctionSteps: [
      'Use Rebuild Verified Archive. Apex OS writes a new archive version and verifies it before replacing the old one.',
      'Then retry verification.',
    ],
    actions: ['SAFE_REPAIR', 'COPY_DIAGNOSTIC'],
    actionLabels: { SAFE_REPAIR: 'Rebuild Verified Archive' },
    canSystemRepair: true,
    requiresManualExternalAction: false,
    requiresBackendOperations: false,
    retryEndpoint: 'VERIFIED_ARCHIVE_PREPARE',
    notificationRecipients: ADMINS,
    detailKeys: ['otherBlockers'],
  },
  OPERATION_IN_PROGRESS: {
    remediationClass: 'WARNING_NON_BLOCKING',
    severity: 'WARNING',
    blockingScope: 'OPERATION',
    title: 'Another operation is running',
    problem: 'An archive, rehire or deletion is already running for this user.',
    whyItMatters: 'Only one lifecycle operation can run for a person at a time. Nothing else is affected.',
    correctionSteps: ['Wait for the running operation to finish, then retry verification.'],
    actions: ['RETRY_VERIFICATION', 'COPY_DIAGNOSTIC'],
    canSystemRepair: false,
    requiresManualExternalAction: false,
    requiresBackendOperations: false,
    retryEndpoint: 'PERMANENT_DELETE_PREFLIGHT',
    notificationRecipients: [],
    detailKeys: ['otherBlockers'],
  },
  CLEANUP_PENDING: {
    remediationClass: 'SYSTEM_REPAIRABLE',
    severity: 'WARNING',
    blockingScope: 'OPERATION',
    title: 'File cleanup is still pending',
    problem: 'The user\'s records were deleted, but some original files could not be removed yet.',
    whyItMatters: 'The person can no longer sign in. The remaining originals are removed by retrying cleanup; nothing needs to be re-entered.',
    correctionSteps: ['Use Repair safely to retry the file cleanup.', 'If it keeps failing, copy the diagnostic for the system administrator.'],
    actions: ['SAFE_REPAIR', 'COPY_DIAGNOSTIC'],
    canSystemRepair: true,
    requiresManualExternalAction: false,
    requiresBackendOperations: false,
    retryEndpoint: 'LIFECYCLE_CLEANUP_RETRY',
    notificationRecipients: ADMINS,
    detailKeys: ['pendingItems'],
  },
  // Phase 4: employee transitions and compliance.
  OPEN_EXIT_CASE: {
    remediationClass: 'ADMIN_FIXABLE_FRONTEND',
    severity: 'BLOCKING',
    blockingScope: 'USER',
    title: 'Exit still in progress',
    problem: 'This user has an open exit case: notice is running, clearance is in progress, or F&F has not been released.',
    whyItMatters: 'Archiving or deleting now would remove records the exit and the final settlement still need.',
    correctionSteps: [
      'Open the user profile and finish the exit: complete clearance and release F&F, or record the withdrawal.',
      'Then retry verification.',
    ],
    actions: ['OPEN_USER_PROFILE', 'RETRY_VERIFICATION', 'COPY_DIAGNOSTIC'],
    canSystemRepair: false,
    requiresManualExternalAction: false,
    requiresBackendOperations: false,
    retryEndpoint: 'PERMANENT_DELETE_PREFLIGHT',
    notificationRecipients: ADMINS,
    detailKeys: ['otherBlockers'],
  },
  PROBATION_STATUS_UNVERIFIED: {
    remediationClass: 'ADMIN_FIXABLE_FRONTEND',
    severity: 'BLOCKING',
    blockingScope: 'OPERATION',
    title: 'Probation status not verified',
    problem: 'HR has not yet confirmed whether this person is on probation or confirmed, which decides the notice period (15 or 30 days).',
    whyItMatters: 'Without it the last working day could be wrong. Nothing was saved, and the form keeps what you entered.',
    correctionSteps: [
      'HR opens the user profile, Exit tab, and verifies the probation status.',
      'Then submit the resignation again.',
    ],
    actions: ['OPEN_USER_PROFILE', 'COPY_DIAGNOSTIC'],
    canSystemRepair: false,
    requiresManualExternalAction: false,
    requiresBackendOperations: false,
    notificationRecipients: [],
    detailKeys: [],
  },
  RESIGNATION_WITHDRAWAL_CLOSED: {
    remediationClass: 'WARNING_NON_BLOCKING',
    severity: 'WARNING',
    blockingScope: 'OPERATION',
    title: 'Withdrawal window closed',
    problem: 'A resignation can be withdrawn only before the last working day starts.',
    whyItMatters: 'The last working day has begun, so separation goes ahead. Nothing was changed.',
    correctionSteps: ['Contact HR if you want to discuss staying or returning.'],
    actions: ['COPY_DIAGNOSTIC'],
    canSystemRepair: false,
    requiresManualExternalAction: false,
    requiresBackendOperations: false,
    notificationRecipients: [],
    detailKeys: [],
  },
  TRANSFER_EXIT_CASE_OPEN: {
    remediationClass: 'ADMIN_FIXABLE_FRONTEND',
    severity: 'BLOCKING',
    blockingScope: 'OPERATION',
    title: 'Exit in progress',
    problem: 'This person has an open exit case, so they cannot be transferred.',
    whyItMatters: 'A transfer during notice or clearance would reroute work that the exit is already handing over. Nothing was saved.',
    correctionSteps: ['Finish or withdraw the exit first.', 'Then preview the transfer again.'],
    actions: ['OPEN_USER_PROFILE', 'COPY_DIAGNOSTIC'],
    canSystemRepair: false,
    requiresManualExternalAction: false,
    requiresBackendOperations: false,
    notificationRecipients: [],
    detailKeys: [],
  },
  PAYROLL_UNRESOLVED_ACK_REQUIRED: {
    remediationClass: 'USER_FIXABLE',
    severity: 'BLOCKING',
    blockingScope: 'OPERATION',
    title: 'Acknowledge unresolved leave setup',
    problem: 'Some leave days in this month are waiting on leave setup and were not counted as paid or unpaid.',
    whyItMatters: 'Finalizing locks the month. You must confirm you have seen exactly which days were left out.',
    correctionSteps: [
      'Review the unresolved setup panel on the payroll page, or resolve the setup first.',
      'Tick the acknowledgement and finalize again.',
    ],
    actions: ['COPY_DIAGNOSTIC'],
    canSystemRepair: false,
    requiresManualExternalAction: false,
    requiresBackendOperations: false,
    notificationRecipients: [],
    detailKeys: ['unresolvedEmployees', 'unresolvedSettlements'],
  },
  RETENTION_POLICY_REQUIRED: {
    remediationClass: 'SECURITY_OR_LEGAL_BLOCK',
    severity: 'BLOCKING',
    blockingScope: 'USER',
    title: 'Approved retention rule required',
    problem: 'This server requires an approved, active retention rule for every protected record category before permanent deletion, and at least one is missing, inactive or invalid.',
    whyItMatters: 'Without an approved rule the company cannot show that these records were kept for the required period.',
    correctionSteps: [
      'In Settings, Compliance, propose the missing retention rule with its policy reference.',
      'A different Admin or Super Admin approves it.',
      'Then retry verification.',
    ],
    actions: ['RETRY_VERIFICATION', 'COPY_DIAGNOSTIC'],
    canSystemRepair: false,
    requiresManualExternalAction: false,
    requiresBackendOperations: false,
    retryEndpoint: 'PERMANENT_DELETE_PREFLIGHT',
    notificationRecipients: ADMINS,
    detailKeys: ['retentionCategories', 'otherBlockers'],
  },
  // Create User / Reactivate / Rehire (Phase 2, B8). The form stays open with
  // every value; only the stale selection is cleared.
  ROLE_NOT_FOUND_OR_REMOVED: {
    remediationClass: 'ADMIN_FIXABLE_FRONTEND',
    severity: 'BLOCKING',
    blockingScope: 'OPERATION',
    title: 'The selected role is no longer available',
    problem: 'The role chosen in this form was removed after the form was opened.',
    whyItMatters: 'Every account needs a role to decide what it can do. Nothing was saved, and the other values in the form are kept.',
    correctionSteps: ['Choose another role from the refreshed list.', 'Submit the form again.'],
    actions: ['CHOOSE_ANOTHER_ROLE', 'COPY_DIAGNOSTIC'],
    canSystemRepair: false,
    requiresManualExternalAction: false,
    requiresBackendOperations: false,
    notificationRecipients: [],
    detailKeys: ['field'],
  },
  DEPARTMENT_NOT_FOUND_OR_REMOVED: {
    remediationClass: 'ADMIN_FIXABLE_FRONTEND',
    severity: 'BLOCKING',
    blockingScope: 'OPERATION',
    title: 'The selected department is no longer available',
    problem: 'The department chosen in this form was removed after the form was opened.',
    whyItMatters: 'A department is optional. Nothing was saved, and the other values in the form are kept.',
    correctionSteps: [
      'Choose another department, or continue without one and assign it later.',
      'To add a department first, open Departments, then submit the form again.',
    ],
    actions: ['CHOOSE_ANOTHER_DEPARTMENT', 'CONTINUE_WITHOUT_DEPARTMENT', 'OPEN_DEPARTMENTS', 'COPY_DIAGNOSTIC'],
    canSystemRepair: false,
    requiresManualExternalAction: false,
    requiresBackendOperations: false,
    notificationRecipients: [],
    detailKeys: ['field'],
  },
};

/** Precedence when several delete blockers coexist (erratum E2). Lower runs first. */
export const DELETE_BLOCKER_PRECEDENCE: string[] = [
  'LEGAL_HOLD_ACTIVE',
  'LEGAL_HOLD_REQUESTED',
  'LIFECYCLE_KEYS_MISSING',
  'OPEN_EXIT_CASE',
  'RETENTION_POLICY_REQUIRED',
  'RETENTION_PERIOD_ACTIVE',
  'ARCHIVE_PRIVACY_FAILED',
  'ARCHIVE_SNAPSHOT_MISSING',
  'ARCHIVE_SNAPSHOT_STALE',
];

/** Classes that may never offer Safe Repair, whatever their flags say. */
export const NO_SAFE_REPAIR_CLASSES: RemediationClass[] = ['MANUAL_EXTERNAL', 'BACKEND_OPERATIONS', 'SECURITY_OR_LEGAL_BLOCK'];

export function safeRepairAllowed(e: { remediationClass: RemediationClass; canSystemRepair: boolean; requiresManualExternalAction: boolean; requiresBackendOperations: boolean }): boolean {
  return e.canSystemRepair && !e.requiresManualExternalAction && !e.requiresBackendOperations && !NO_SAFE_REPAIR_CLASSES.includes(e.remediationClass);
}

/** Registry problems; empty when valid. Run by a unit test that fails the build. */
export function validateRegistry(registry: Record<string, RegistryEntry> = REMEDIATION_REGISTRY): string[] {
  const problems: string[] = [];
  for (const [code, e] of Object.entries(registry)) {
    if (e.actions.includes('SAFE_REPAIR') && !safeRepairAllowed(e)) problems.push(`${code}: SAFE_REPAIR listed without a safe-repair-eligible class and flags`);
    if (e.actions.includes('RETRY_VERIFICATION') && !e.retryEndpoint) problems.push(`${code}: RETRY_VERIFICATION without a retryEndpoint`);
    if (e.actions.includes('SAFE_REPAIR') && !e.retryEndpoint) problems.push(`${code}: SAFE_REPAIR without an endpoint to run`);
    if (e.correctionSteps.length === 0) problems.push(`${code}: no correction steps`);
    if (new Set(e.actions).size !== e.actions.length) problems.push(`${code}: duplicate actions`);
  }
  return problems;
}

export function actionsFor(ids: RemediationActionId[], previewCount?: number, labels: Partial<Record<RemediationActionId, string>> = {}): RemediationAction[] {
  return ids.map((id) => ({ id, kind: ACTION_KIND[id], label: labels[id] ?? ACTION_LABELS[id], ...(id === 'SAFE_REPAIR' && previewCount !== undefined ? { previewCount } : {}) }));
}
