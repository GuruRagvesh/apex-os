/**
 * Attendance Recovery Vault — configuration and identity guard (Phase 3).
 *
 * Decides, from the environment alone and before any network call, whether
 * this process may use the recovery vault at all. Fail closed at every step.
 *
 *  1. Credentials are the vault's OWN: ATTENDANCE_RECOVERY_R2_*. The generic
 *     R2_* credentials belong to the database-backup vault and are never used
 *     here — they are read only to prove the two are different.
 *  2. The environment is APP_ENV (never inferred from NODE_ENV). Each
 *     environment has exactly one permitted bucket:
 *        staging     → apex-os-attendance-recovery-staging
 *        production  → apex-os-attendance-recovery-production   (NOT enabled in Phase 3)
 *     Any other APP_ENV, or a bucket that is not the one for this environment,
 *     is refused. A staging backend therefore cannot be pointed at the
 *     production recovery bucket, and vice versa.
 *  3. The recovery bucket must not be the database-backup bucket (R2_BUCKET, or
 *     the known production backup bucket), and the recovery access key must not
 *     be the backup vault's access key.
 *
 * Nothing here returns or prints a secret. Refusals are codes.
 */

export const RECOVERY_VAULT_BUCKETS = {
  staging: 'apex-os-attendance-recovery-staging',
  production: 'apex-os-attendance-recovery-production',
} as const;

/** Environments allowed to WRITE in this phase. Production is deliberately absent. */
export const RECOVERY_VAULT_WRITABLE_ENVIRONMENTS = ['staging'] as const;

/** The database-backup bucket the backup job uses in production (backup-identity.ts). */
export const KNOWN_BACKUP_BUCKETS = ['apex-os-production-backups'];

export type RecoveryVaultRefusal =
  | 'RECOVERY_VAULT_NOT_CONFIGURED'
  | 'RECOVERY_VAULT_ENVIRONMENT_UNKNOWN'
  | 'RECOVERY_VAULT_PRODUCTION_NOT_ENABLED'
  | 'RECOVERY_VAULT_BUCKET_ENVIRONMENT_MISMATCH'
  | 'RECOVERY_VAULT_COLLIDES_WITH_BACKUP_VAULT'
  | 'RECOVERY_VAULT_REUSES_BACKUP_CREDENTIALS';

export interface RecoveryVaultConfig {
  environment: 'staging';
  bucket: string;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Flat on purpose: callers read fields directly, with no union narrowing to get wrong. */
export interface RecoveryVaultConfigResult {
  ok: boolean;
  config: RecoveryVaultConfig | null;
  refusal: RecoveryVaultRefusal | null;
  credentialsPresent: boolean;
}

const refuse = (refusal: RecoveryVaultRefusal, credentialsPresent: boolean): RecoveryVaultConfigResult => ({ ok: false, config: null, refusal, credentialsPresent });

const val = (env: NodeJS.ProcessEnv, k: string) => {
  const v = env[k];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};

export function resolveRecoveryVaultConfig(env: NodeJS.ProcessEnv): RecoveryVaultConfigResult {
  const accountId = val(env, 'ATTENDANCE_RECOVERY_R2_ACCOUNT_ID');
  const accessKeyId = val(env, 'ATTENDANCE_RECOVERY_R2_ACCESS_KEY_ID');
  const secretAccessKey = val(env, 'ATTENDANCE_RECOVERY_R2_SECRET_ACCESS_KEY');
  const bucket = val(env, 'ATTENDANCE_RECOVERY_R2_BUCKET');
  const credentialsPresent = !!(accountId && accessKeyId && secretAccessKey && bucket);
  if (!credentialsPresent) return refuse('RECOVERY_VAULT_NOT_CONFIGURED', credentialsPresent);

  const backupBucket = val(env, 'R2_BUCKET');
  if ((backupBucket && backupBucket === bucket) || KNOWN_BACKUP_BUCKETS.includes(bucket!)) {
    return refuse('RECOVERY_VAULT_COLLIDES_WITH_BACKUP_VAULT', credentialsPresent);
  }
  const backupKey = val(env, 'R2_ACCESS_KEY_ID');
  if (backupKey && backupKey === accessKeyId) {
    return refuse('RECOVERY_VAULT_REUSES_BACKUP_CREDENTIALS', credentialsPresent);
  }

  const appEnv = (env.APP_ENV ?? '').trim().toLowerCase();
  if (appEnv !== 'staging' && appEnv !== 'production') {
    return refuse('RECOVERY_VAULT_ENVIRONMENT_UNKNOWN', credentialsPresent);
  }
  if (bucket !== RECOVERY_VAULT_BUCKETS[appEnv]) {
    return refuse('RECOVERY_VAULT_BUCKET_ENVIRONMENT_MISMATCH', credentialsPresent);
  }
  if (!(RECOVERY_VAULT_WRITABLE_ENVIRONMENTS as readonly string[]).includes(appEnv)) {
    return refuse('RECOVERY_VAULT_PRODUCTION_NOT_ENABLED', credentialsPresent);
  }
  return { ok: true, refusal: null, credentialsPresent, config: { environment: 'staging', bucket: bucket!, accountId: accountId!, accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! } };
}
