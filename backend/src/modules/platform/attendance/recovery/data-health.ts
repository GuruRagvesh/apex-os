import type { RecoveryFlags } from './recovery-flags';
import type { VaultHealth } from './recovery-vault.service';

/**
 * Attendance Data Health — what the system can PROVE about recovery right now.
 *
 * Apex OS never calls itself healthy or synced without evidence. Phase 3 adds
 * the first real evidence: the Attendance Recovery Vault's own health. Mirror,
 * reconciliation and auto-repair do not exist yet, so they are DISABLED
 * whatever their flags say, and every count they would produce is `null`
 * (unknown — not zero).
 *
 * Recovery vault:
 *   credentials missing                   → NOT_CONFIGURED
 *   credentials present, flag off         → DISABLED
 *   enabled, bounded LIST succeeds        → HEALTHY
 *   enabled, identity refused or failure  → DEGRADED
 *
 * The OVERALL status can be HEALTHY only when every piece of the stricter
 * evidence below is present, which requires Phase 5/6:
 *   vault reachable AND mirror current AND last reconciliation succeeded AND
 *   recovery-only = 0 AND conflicts = 0 AND missing references = 0 AND no
 *   failed sync.
 */

export const HEALTH_STATUSES = [
  'NOT_CONFIGURED',
  'DISABLED',
  'HEALTHY',
  'SYNCING',
  'ATTENTION',
  'DEGRADED',
  'RECOVERY_REQUIRED',
] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export interface HealthEvidence {
  vaultReachable: boolean | null;
  mirrorCurrent: boolean | null;
  lastReconciliationSucceeded: boolean | null;
  recoveryOnly: number | null;
  conflicts: number | null;
  missingReferences: number | null;
  failedSyncs: number | null;
}

export const NO_EVIDENCE: HealthEvidence = {
  vaultReachable: null,
  mirrorCurrent: null,
  lastReconciliationSucceeded: null,
  recoveryOnly: null,
  conflicts: null,
  missingReferences: null,
  failedSyncs: null,
};

export function evidenceProvesHealthy(e: HealthEvidence): boolean {
  return (
    e.vaultReachable === true &&
    e.mirrorCurrent === true &&
    e.lastReconciliationSucceeded === true &&
    e.recoveryOnly === 0 &&
    e.conflicts === 0 &&
    e.missingReferences === 0 &&
    e.failedSyncs === 0
  );
}

export interface DataHealthInput {
  flags: RecoveryFlags;
  operationalAvailable: boolean;
  vault: VaultHealth;
  failedImports: number | null;
  evidence?: HealthEvidence;
}

export interface DataHealth {
  generatedAt: string;
  overall: HealthStatus;
  overallReasons: string[];
  operationalAttendance: 'AVAILABLE' | 'UNAVAILABLE';
  recovery: { enabled: boolean; status: HealthStatus };
  recoveryVault: { configured: boolean; credentialsPresent: boolean; status: HealthStatus; reason: string | null; note: string };
  reconciliation: { enabled: boolean; available: false; status: 'DISABLED'; lastRunAt: null };
  mirror: { enabled: boolean; available: false; status: 'DISABLED'; lastWriteAt: null };
  autoRepair: { enabled: boolean; available: false; status: 'DISABLED' };
  existingDatabaseBackup: { status: 'UNCHANGED'; note: string };
  counts: {
    productionOnly: number | null;
    recoveryOnly: number | null;
    conflicts: number | null;
    missingReferences: number | null;
    failedImports: number | null;
  };
  statuses: readonly HealthStatus[];
}

const VAULT_NOTE: Record<VaultHealth['status'], string> = {
  NOT_CONFIGURED: 'The Attendance Recovery Vault is not set up yet. It is a separate bucket from the database backups.',
  DISABLED: 'The Attendance Recovery Vault is configured but switched off.',
  HEALTHY: 'The Attendance Recovery Vault is reachable.',
  DEGRADED: 'The Attendance Recovery Vault is configured but cannot be used right now. Attendance itself is unaffected.',
};

export function computeDataHealth(input: DataHealthInput, now: Date): DataHealth {
  const evidence: HealthEvidence = { ...(input.evidence ?? NO_EVIDENCE), vaultReachable: input.vault.status === 'HEALTHY' ? true : (input.evidence?.vaultReachable ?? null) };
  const recoveryEnabled = input.flags.ATTENDANCE_RECOVERY_ENABLED;

  const overallReasons: string[] = [];
  let overall: HealthStatus;
  if (!recoveryEnabled) {
    overall = 'DISABLED';
  } else if (input.vault.status === 'NOT_CONFIGURED') {
    overall = 'NOT_CONFIGURED';
  } else if (input.vault.status === 'DEGRADED') {
    overall = 'DEGRADED';
    overallReasons.push(input.vault.reason);
  } else if (evidenceProvesHealthy(evidence)) {
    overall = 'HEALTHY';
  } else {
    // Vault fine or switched off, but nothing yet proves the data is protected.
    overall = 'ATTENTION';
    overallReasons.push(input.vault.status === 'DISABLED' ? 'RECOVERY_VAULT_DISABLED' : 'RECONCILIATION_NOT_AVAILABLE');
  }

  return {
    generatedAt: now.toISOString(),
    overall,
    overallReasons,
    operationalAttendance: input.operationalAvailable ? 'AVAILABLE' : 'UNAVAILABLE',
    recovery: { enabled: recoveryEnabled, status: overall },
    recoveryVault: {
      configured: input.vault.status === 'HEALTHY' || (input.vault.status === 'DISABLED' && !('reason' in input.vault && input.vault.reason)),
      credentialsPresent: input.vault.credentialsPresent,
      status: input.vault.status,
      reason: 'reason' in input.vault ? (input.vault.reason ?? null) : null,
      note: VAULT_NOTE[input.vault.status],
    },
    reconciliation: { enabled: input.flags.ATTENDANCE_RECONCILIATION_ENABLED, available: false, status: 'DISABLED', lastRunAt: null },
    mirror: { enabled: input.flags.ATTENDANCE_RECOVERY_R2_ENABLED, available: false, status: 'DISABLED', lastWriteAt: null },
    autoRepair: { enabled: input.flags.ATTENDANCE_AUTO_REPAIR_ENABLED, available: false, status: 'DISABLED' },
    existingDatabaseBackup: {
      status: 'UNCHANGED',
      note: 'The existing database backup system is unchanged and is not queried by this screen.',
    },
    counts: {
      productionOnly: null,
      recoveryOnly: evidence.recoveryOnly,
      conflicts: evidence.conflicts,
      missingReferences: evidence.missingReferences,
      failedImports: input.failedImports,
    },
    statuses: HEALTH_STATUSES,
  };
}
