import { bundleHash as computeBundleHash, canonicalBundle, stableStringify } from './bundle-canonical';
import type { AttendanceDayBundle, RecoveryProvenance } from './recovery.types';

/**
 * Documents stored in the Attendance Recovery Vault. Versioned, deterministic
 * JSON (keys sorted at every level), and free of secrets: no credential, no
 * URL with a token, and no personal data beyond what the attendance bundle
 * itself is.
 */

export const RECOVERY_MANIFEST_SCHEMA_VERSION = 1 as const;
export const RECOVERY_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export interface RecoveryImportManifest {
  schemaVersion: typeof RECOVERY_MANIFEST_SCHEMA_VERSION;
  manifestType: 'RECOVERY_IMPORT';
  environment: 'staging';
  importBatchId: string;
  sourceObjectKey: string;
  sourceSha256: string;
  sourceSize: number;
  sourceContentType: string;
  /** Display-safe original name (sanitised). */
  sourceFileName: string;
  createdAt: string;
  /** A User id or employeeId — never a name, email or token. */
  createdBy: string;
  status: 'QUARANTINED';
}

export interface RecoverySnapshotDocument {
  schemaVersion: typeof RECOVERY_SNAPSHOT_SCHEMA_VERSION;
  bundleVersion: number;
  employeeId: string;
  businessDate: string;
  bundleHash: string;
  provenance: RecoveryProvenance;
  /** The canonical bundle exactly as hashed. */
  bundle: Record<string, unknown>;
}

export interface RecoverySnapshotManifest {
  schemaVersion: typeof RECOVERY_MANIFEST_SCHEMA_VERSION;
  manifestType: 'RECOVERY_SNAPSHOT';
  environment: 'staging';
  employeeId: string;
  businessDate: string;
  bundleHash: string;
  snapshotObjectKey: string;
  revision: number;
  createdAt: string;
  sourceType: RecoveryProvenance['sourceType'];
}

/** Keys a manifest must never carry, at any depth. */
const FORBIDDEN_KEY = /secret|password|token|access[_-]?key|credential|authorization|cookie|aadhaar|^pan(number)?$|bank|salary|ifsc/i;

export function assertNoSecrets(value: unknown, path = 'document'): void {
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEY.test(k)) throw new Error(`FORBIDDEN_FIELD:${path}.${k}`);
      assertNoSecrets(v, `${path}.${k}`);
    }
  }
}

export function serializeDocument(doc: object): Buffer {
  assertNoSecrets(doc);
  return Buffer.from(stableStringify(doc), 'utf8');
}

/**
 * Builds the snapshot document, recomputing the hash from the bundle. A
 * declared hash that does not match is refused: what is stored under a hash
 * must be exactly what hashes to it.
 */
export function buildSnapshotDocument(bundle: AttendanceDayBundle, declaredHash?: string): RecoverySnapshotDocument {
  const canonical = canonicalBundle(bundle);
  const hash = computeBundleHash(bundle);
  if (declaredHash !== undefined && declaredHash !== hash) throw new Error('SNAPSHOT_HASH_MISMATCH');
  return {
    schemaVersion: RECOVERY_SNAPSHOT_SCHEMA_VERSION,
    bundleVersion: bundle.bundleVersion,
    employeeId: bundle.employeeId,
    businessDate: bundle.businessDate,
    bundleHash: hash,
    provenance: bundle.provenance,
    bundle: canonical,
  };
}
