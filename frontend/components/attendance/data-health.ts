/**
 * Attendance Data Health — transport and wording (Phase 2A).
 *
 * The screen states what the SERVER can prove and nothing more. It never
 * computes a status, never turns an unknown count into zero, and has no words
 * for "synced": the backend decides HEALTHY from evidence that does not exist
 * yet, so in this phase every recovery component reads Disabled or Not
 * configured.
 */
import { api, unwrap as r } from '@apex/shared-auth';

export type HealthStatus =
  | 'NOT_CONFIGURED'
  | 'DISABLED'
  | 'HEALTHY'
  | 'SYNCING'
  | 'ATTENTION'
  | 'DEGRADED'
  | 'RECOVERY_REQUIRED';

export interface DataHealth {
  generatedAt: string;
  overall: HealthStatus;
  operationalAttendance: 'AVAILABLE' | 'UNAVAILABLE';
  recovery: { enabled: boolean; status: HealthStatus };
  overallReasons?: string[];
  recoveryVault: { configured: boolean; credentialsPresent: boolean; status: HealthStatus; reason?: string | null; note: string };
  reconciliation: { enabled: boolean; available?: boolean; status: HealthStatus; lastRunAt: string | null };
  mirror: { enabled: boolean; available?: boolean; status: HealthStatus; lastWriteAt: string | null };
  autoRepair: { enabled: boolean; available?: boolean; status: HealthStatus };
  existingDatabaseBackup: { status: 'UNCHANGED'; note: string };
  counts: {
    productionOnly: number | null;
    recoveryOnly: number | null;
    conflicts: number | null;
    missingReferences: number | null;
    failedImports: number | null;
  };
}

export function getDataHealth(): Promise<DataHealth> {
  return r<DataHealth>(api.get('/attendance/data-manager/health'));
}

export type HealthTone = 'positive' | 'muted' | 'warn' | 'danger' | 'info';

/** Wording for one component's status. Never "Synced". */
export const STATUS_TEXT: Record<HealthStatus, { label: string; tone: HealthTone }> = {
  NOT_CONFIGURED: { label: 'Not configured', tone: 'muted' },
  DISABLED: { label: 'Disabled', tone: 'muted' },
  HEALTHY: { label: 'Healthy', tone: 'positive' },
  SYNCING: { label: 'Syncing', tone: 'info' },
  ATTENTION: { label: 'Needs attention', tone: 'warn' },
  DEGRADED: { label: 'Degraded', tone: 'warn' },
  RECOVERY_REQUIRED: { label: 'Recovery required', tone: 'danger' },
};

export function statusText(status: string): { label: string; tone: HealthTone } {
  return STATUS_TEXT[status as HealthStatus] ?? { label: 'Unknown', tone: 'muted' };
}

/** The badge beside "Import / Update Data". Describes recovery, not attendance. */
export function badgeText(health: DataHealth): string {
  switch (health.overall) {
    case 'DISABLED':
      return 'Recovery disabled';
    case 'NOT_CONFIGURED':
      return 'Recovery not configured';
    default:
      return statusText(health.overall).label;
  }
}

/** An unknown count is a dash, never a zero. */
export function displayCount(n: number | null): string {
  return n === null || n === undefined ? '—' : String(n);
}

/** The Historical Recovery card's status line, from the vault's reported state. */
export function vaultStatusLine(status: HealthStatus | undefined): string {
  switch (status) {
    case 'HEALTHY':
      return 'Recovery vault ready';
    case 'DISABLED':
      return 'Recovery vault configured, switched off';
    case 'DEGRADED':
      return 'Recovery vault unavailable';
    default:
      return 'Recovery vault not configured';
  }
}

/** Uploads stay off until the recovery upload phase, whatever the vault reports. */
export const HISTORICAL_RECOVERY_UPLOAD_PENDING = 'Historical recovery uploads are not enabled yet.';

export const HISTORICAL_RECOVERY_UNAVAILABLE =
  'Historical recovery uploads will become available after the Attendance Recovery Vault is configured.';
