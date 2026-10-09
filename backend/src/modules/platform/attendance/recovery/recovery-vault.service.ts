import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { RecoveryFlagsService } from './recovery-flags';
import { resolveRecoveryVaultConfig, type RecoveryVaultConfig, type RecoveryVaultConfigResult, type RecoveryVaultRefusal } from './recovery-vault-config';
import { createR2RecoveryStore, type RecoveryObjectStore } from './recovery-vault-store';
import {
  QUARANTINE_CONTENT_TYPES,
  parseSnapshotName,
  quarantineExtensionOf,
  recoveryKeys,
  sanitizeOriginalName,
  RecoveryKeyError,
} from './recovery-vault-keys';
import {
  buildSnapshotDocument,
  serializeDocument,
  RECOVERY_MANIFEST_SCHEMA_VERSION,
  type RecoveryImportManifest,
  type RecoverySnapshotManifest,
} from './recovery-vault-documents';
import type { AttendanceDayBundle } from './recovery.types';

/**
 * AttendanceRecoveryVault — the ONLY client of the Attendance Recovery Vault.
 *
 *  - Bound to ATTENDANCE_RECOVERY_R2_BUCKET for its whole life. No method takes
 *    a bucket name; there is no delete, no overwrite, no force option, and no
 *    way to obtain the underlying S3 client.
 *  - Usable only when the configuration guard passes (environment, bucket
 *    identity, separation from the database-backup vault). Otherwise every
 *    operation returns a refusal code — it never throws into its caller and
 *    never falls back to another bucket.
 *  - Writes additionally require the AppSetting flag ATTENDANCE_RECOVERY_R2_ENABLED
 *    (default false). Valid credentials alone write nothing.
 *  - Append-only. Before every write: HEAD. Same content → ALREADY_EXISTS_IDENTICAL.
 *    Different content → IMMUTABILITY_CONFLICT. The PUT itself carries
 *    If-None-Match: *, so a race cannot overwrite either.
 *  - Nothing outside the recovery module depends on it; attendance, the
 *    register, exports and correction imports never wait on R2.
 *
 * Phase 3: no caller performs a write yet. The RECOVERY_IMPORT upload endpoint
 * still refuses, so putQuarantineFile is reachable only from tests.
 */

export type VaultWriteOutcome =
  | { status: 'WRITTEN'; key: string; sha256: string }
  | { status: 'ALREADY_EXISTS_IDENTICAL'; key: string; sha256: string }
  | { status: 'IMMUTABILITY_CONFLICT'; key: string }
  | { status: 'REFUSED'; code: RecoveryVaultRefusal | 'RECOVERY_VAULT_WRITES_DISABLED' | 'INVALID_INPUT' | 'SNAPSHOT_HASH_MISMATCH' | 'REVISION_RACE' | 'REVISION_LIMIT'; detail?: string }
  | { status: 'FAILED'; code: 'RECOVERY_VAULT_UNAVAILABLE' };

export type VaultHealth =
  | { status: 'NOT_CONFIGURED'; credentialsPresent: false; reason: RecoveryVaultRefusal }
  | { status: 'DISABLED'; credentialsPresent: true; reason?: RecoveryVaultRefusal }
  | { status: 'DEGRADED'; credentialsPresent: true; reason: RecoveryVaultRefusal | 'RECOVERY_VAULT_UNREACHABLE' }
  | { status: 'HEALTHY'; credentialsPresent: true };

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Factory seam so tests can supply an in-memory store; production uses R2. */
export type RecoveryStoreFactory = (config: RecoveryVaultConfig) => RecoveryObjectStore;

@Injectable()
export class AttendanceRecoveryVault {
  private readonly configResult: RecoveryVaultConfigResult;
  private readonly store: RecoveryObjectStore | null;

  constructor(
    private readonly flags: RecoveryFlagsService,
    env: NodeJS.ProcessEnv = process.env,
    storeFactory: RecoveryStoreFactory = createR2RecoveryStore,
  ) {
    this.configResult = resolveRecoveryVaultConfig(env);
    // No network at construction: building an S3 client opens no connection.
    this.store = this.configResult.ok && this.configResult.config ? storeFactory(this.configResult.config) : null;
  }

  /** Safe summary for callers; never a secret. */
  identity(): { usable: boolean; refusal: RecoveryVaultRefusal | null; credentialsPresent: boolean; environment: string | null } {
    const r = this.configResult;
    return { usable: r.ok, refusal: r.refusal, credentialsPresent: r.credentialsPresent, environment: r.config ? r.config.environment : null };
  }

  private refusalCode(): RecoveryVaultRefusal {
    return this.configResult.refusal ?? 'RECOVERY_VAULT_NOT_CONFIGURED';
  }

  /** Either a store to write to, or the refusal to return. Never both. */
  private async writable(): Promise<{ store: RecoveryObjectStore | null; outcome: VaultWriteOutcome | null }> {
    if (!this.configResult.ok || !this.store) return { store: null, outcome: { status: 'REFUSED', code: this.refusalCode() } };
    const { flags } = await this.flags.config();
    if (!flags.ATTENDANCE_RECOVERY_R2_ENABLED) return { store: null, outcome: { status: 'REFUSED', code: 'RECOVERY_VAULT_WRITES_DISABLED' } };
    return { store: this.store, outcome: null };
  }

  /** HEAD, compare, then PUT-if-absent. The single write path for every object. */
  private async appendOnly(store: RecoveryObjectStore, key: string, body: Buffer, contentType: string, metadata?: Record<string, string>): Promise<VaultWriteOutcome> {
    const hash = sha256(body);
    try {
      const existing = await store.head(key);
      if (existing) {
        return existing.sha256 === hash && existing.byteSize === body.length
          ? { status: 'ALREADY_EXISTS_IDENTICAL', key, sha256: hash }
          : { status: 'IMMUTABILITY_CONFLICT', key };
      }
      const { written } = await store.putIfAbsent(key, body, { contentType, sha256: hash, metadata });
      if (written) return { status: 'WRITTEN', key, sha256: hash };
      // Lost a race: something appeared at this key. Look, never overwrite.
      const now = await store.head(key);
      return now && now.sha256 === hash && now.byteSize === body.length
        ? { status: 'ALREADY_EXISTS_IDENTICAL', key, sha256: hash }
        : { status: 'IMMUTABILITY_CONFLICT', key };
    } catch {
      return { status: 'FAILED', code: 'RECOVERY_VAULT_UNAVAILABLE' };
    }
  }

  /** Stores an uploaded recovery file UNCHANGED under quarantine/<batch>/original.<ext>. */
  async putQuarantineFile(input: { importBatchId: string; fileName: string; body: Buffer; uploadedBy: string; uploadedAt: Date }): Promise<VaultWriteOutcome & { manifest?: RecoveryImportManifest }> {
    const w = await this.writable();
    if (!w.store) return w.outcome!;
    let key: string;
    let ext;
    try {
      ext = quarantineExtensionOf(input.fileName);
      key = recoveryKeys.quarantine(input.importBatchId, ext);
    } catch (e) {
      return { status: 'REFUSED', code: 'INVALID_INPUT', detail: e instanceof RecoveryKeyError ? e.code : 'INVALID' };
    }
    if (!Buffer.isBuffer(input.body) || input.body.length === 0) return { status: 'REFUSED', code: 'INVALID_INPUT', detail: 'EMPTY_FILE' };
    const contentType = QUARANTINE_CONTENT_TYPES[ext];
    const outcome = await this.appendOnly(w.store, key, input.body, contentType, {
      'import-batch-id': input.importBatchId,
      'uploaded-by': input.uploadedBy,
      'uploaded-at': input.uploadedAt.toISOString(),
      'original-name': sanitizeOriginalName(input.fileName),
    });
    if (outcome.status !== 'WRITTEN' && outcome.status !== 'ALREADY_EXISTS_IDENTICAL') return outcome;
    const manifest: RecoveryImportManifest = {
      schemaVersion: RECOVERY_MANIFEST_SCHEMA_VERSION,
      manifestType: 'RECOVERY_IMPORT',
      environment: 'staging',
      importBatchId: input.importBatchId,
      sourceObjectKey: key,
      sourceSha256: outcome.sha256,
      sourceSize: input.body.length,
      sourceContentType: contentType,
      sourceFileName: sanitizeOriginalName(input.fileName),
      createdAt: input.uploadedAt.toISOString(),
      createdBy: input.uploadedBy,
      status: 'QUARANTINED',
    };
    return { ...outcome, manifest };
  }

  /** manifests/imports/<batch>.json — deterministic JSON, secrets refused. */
  async putManifest(manifest: RecoveryImportManifest): Promise<VaultWriteOutcome> {
    const w = await this.writable();
    if (!w.store) return w.outcome!;
    let key: string;
    let body: Buffer;
    try {
      key = recoveryKeys.importManifest(manifest.importBatchId);
      body = serializeDocument(manifest);
    } catch (e: any) {
      return { status: 'REFUSED', code: 'INVALID_INPUT', detail: e?.code ?? e?.message };
    }
    return this.appendOnly(w.store, key, body, 'application/json');
  }

  /**
   * snapshots/<yyyy>/<mm>/<employeeId>/<date>/r<NNNN>-<hash>.json plus its manifest.
   *
   * The hash is recomputed and must match any declared hash. If this exact hash
   * is already stored for the day, nothing new is written (ALREADY_EXISTS_IDENTICAL).
   * Otherwise the next revision number is taken from the listing; the PUT is
   * conditional, so a concurrent writer cannot overwrite — the loser gets
   * REVISION_RACE and may retry. (Strict ordering across writers would need DB
   * coordination; deliberately not built in Phase 3.)
   */
  async putSnapshot(bundle: AttendanceDayBundle, declaredHash?: string, createdAt = new Date()): Promise<VaultWriteOutcome & { manifestKey?: string }> {
    const w = await this.writable();
    if (!w.store) return w.outcome!;
    let doc;
    let prefix: string;
    try {
      doc = buildSnapshotDocument(bundle, declaredHash);
      prefix = recoveryKeys.snapshotPrefix(doc.employeeId, doc.businessDate);
    } catch (e: any) {
      if (e?.message === 'SNAPSHOT_HASH_MISMATCH') return { status: 'REFUSED', code: 'SNAPSHOT_HASH_MISMATCH' };
      return { status: 'REFUSED', code: 'INVALID_INPUT', detail: e?.code ?? 'INVALID_BUNDLE' };
    }
    let existing: string[];
    try {
      existing = await w.store.list(prefix);
    } catch {
      return { status: 'FAILED', code: 'RECOVERY_VAULT_UNAVAILABLE' };
    }
    const revisions = existing.map(parseSnapshotName).filter(Boolean) as Array<{ revision: number; hash: string }>;
    const same = revisions.find((r) => r.hash === doc.bundleHash);
    if (same) return { status: 'ALREADY_EXISTS_IDENTICAL', key: recoveryKeys.snapshot(doc.employeeId, doc.businessDate, same.revision, doc.bundleHash), sha256: doc.bundleHash };
    const next = revisions.reduce((m, r) => Math.max(m, r.revision), 0) + 1;
    if (next > 9999) return { status: 'REFUSED', code: 'REVISION_LIMIT' };

    const key = recoveryKeys.snapshot(doc.employeeId, doc.businessDate, next, doc.bundleHash);
    let body: Buffer;
    try {
      body = serializeDocument(doc);
    } catch (e: any) {
      return { status: 'REFUSED', code: 'INVALID_INPUT', detail: e?.message };
    }
    const outcome = await this.appendOnly(w.store, key, body, 'application/json', { 'bundle-hash': doc.bundleHash });
    if (outcome.status === 'IMMUTABILITY_CONFLICT') return { status: 'REFUSED', code: 'REVISION_RACE' };
    if (outcome.status !== 'WRITTEN') return outcome;

    const manifest: RecoverySnapshotManifest = {
      schemaVersion: RECOVERY_MANIFEST_SCHEMA_VERSION,
      manifestType: 'RECOVERY_SNAPSHOT',
      environment: 'staging',
      employeeId: doc.employeeId,
      businessDate: doc.businessDate,
      bundleHash: doc.bundleHash,
      snapshotObjectKey: key,
      revision: next,
      createdAt: createdAt.toISOString(),
      sourceType: doc.provenance.sourceType,
    };
    const manifestKey = recoveryKeys.snapshotManifest(doc.employeeId, doc.businessDate, doc.bundleHash);
    await this.appendOnly(w.store, manifestKey, serializeDocument(manifest), 'application/json');
    return { ...outcome, manifestKey };
  }

  // ── reads (configuration must be valid; the write flag is not required) ──
  async headObject(key: string) {
    if (!this.store) return { status: 'REFUSED' as const, code: this.refusalCode() };
    try { return { status: 'OK' as const, object: await this.store.head(key) }; } catch { return { status: 'FAILED' as const, code: 'RECOVERY_VAULT_UNAVAILABLE' as const }; }
  }

  async getObject(key: string) {
    if (!this.store) return { status: 'REFUSED' as const, code: this.refusalCode() };
    try { return { status: 'OK' as const, body: await this.store.get(key) }; } catch { return { status: 'FAILED' as const, code: 'RECOVERY_VAULT_UNAVAILABLE' as const }; }
  }

  async listObjects(prefix: string, maxKeys = 1000) {
    if (!this.store) return { status: 'REFUSED' as const, code: this.refusalCode() };
    try { return { status: 'OK' as const, keys: await this.store.list(prefix, maxKeys) }; } catch { return { status: 'FAILED' as const, code: 'RECOVERY_VAULT_UNAVAILABLE' as const }; }
  }

  /**
   * Non-mutating health check: one bounded LIST (MaxKeys 1) on the bound
   * bucket. Writes nothing, touches no other bucket, never throws.
   *
   *   credentials missing                 → NOT_CONFIGURED
   *   credentials present, flag off       → DISABLED   (no network call)
   *   identity refused (env / collision)  → DEGRADED   with the refusal code
   *   enabled and the LIST succeeds       → HEALTHY
   *   enabled and the LIST fails          → DEGRADED
   */
  async health(): Promise<VaultHealth> {
    const r = this.configResult;
    if (!r.credentialsPresent) return { status: 'NOT_CONFIGURED', credentialsPresent: false, reason: this.refusalCode() };
    const { flags } = await this.flags.config();
    if (!flags.ATTENDANCE_RECOVERY_R2_ENABLED) return { status: 'DISABLED', credentialsPresent: true, ...(r.refusal ? { reason: r.refusal } : {}) };
    if (!r.ok || !this.store) return { status: 'DEGRADED', credentialsPresent: true, reason: this.refusalCode() };
    try {
      await this.store.list('manifests/', 1);
      return { status: 'HEALTHY', credentialsPresent: true };
    } catch {
      return { status: 'DEGRADED', credentialsPresent: true, reason: 'RECOVERY_VAULT_UNREACHABLE' };
    }
  }
}
