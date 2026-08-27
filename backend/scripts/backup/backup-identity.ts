/**
 * Which database a backup or restore is allowed to touch.
 *
 * Two different questions, and conflating them is how a restore test
 * overwrites production:
 *
 *   assertProductionTarget  — I am about to READ production. Prove it IS
 *                             production, or refuse.
 *   assertNonProductionTarget — I am about to WRITE. Prove it is NOT
 *                             production, or refuse.
 *
 * Both take the environment explicitly so they can be tested without real
 * credentials, and neither ever returns a password or a connection string.
 */

/** Identifiers that are known not to be production. */
const NON_PRODUCTION_MARKERS = [
  /dpg-d95pamvaqgkc73fdurig/i,
  /apex_os_staging/i,
  /staging/i,
  /localhost/i,
  /127\.0\.0\.1/,
  /_test\b/i,
];

/** Identifiers known to BE production. Used to refuse a restore. */
const PRODUCTION_MARKERS = [/dpg-d8259omk1jcs73e37fbg/i, /apex_db_dugl/i, /prod\.technoedge/i];

export class TargetRefused extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'TargetRefused';
  }
}

export interface TargetIdentity {
  host: string;
  database: string;
}

/** Keeps the shape, reveals neither the full host nor the database name. */
export function mask(value: string): string {
  if (!value) return '(empty)';
  if (value.length <= 6) return '***';
  return `${value.slice(0, 3)}***${value.slice(-4)}`;
}

function parse(url: string): TargetIdentity {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TargetRefused('DATABASE_URL could not be parsed.');
  }
  return { host: parsed.hostname, database: parsed.pathname.replace(/^\//, '') };
}

/**
 * Proves the target IS production before reading it.
 *
 * The expected host and database must be supplied independently, from the
 * provider's dashboard: that the connection reached the database named in the
 * URL proves only that the URL was followed, not that the URL was right.
 */
export function assertProductionTarget(env: NodeJS.ProcessEnv): TargetIdentity {
  const appEnv = (env.APP_ENV ?? '').toLowerCase();
  const url = env.DATABASE_URL ?? '';
  const expectedHost = (env.EXPECTED_PRODUCTION_DB_HOST ?? '').trim();
  const expectedName = (env.EXPECTED_PRODUCTION_DB_NAME ?? '').trim();

  if (!url) throw new TargetRefused('DATABASE_URL is not set.');
  if (appEnv !== 'production') {
    throw new TargetRefused(`APP_ENV is "${appEnv || '(unset)'}", not "production".`);
  }
  if (!expectedHost || !expectedName) {
    throw new TargetRefused(
      'EXPECTED_PRODUCTION_DB_HOST and EXPECTED_PRODUCTION_DB_NAME must both be set, ' +
        'read independently from the provider dashboard.',
    );
  }

  for (const marker of NON_PRODUCTION_MARKERS) {
    if (marker.test(url) || marker.test(expectedHost) || marker.test(expectedName)) {
      throw new TargetRefused(
        `Target matches a non-production marker (${marker}); this job backs up production.`,
      );
    }
  }

  const identity = parse(url);
  if (identity.host !== expectedHost) {
    throw new TargetRefused('Host mismatch between DATABASE_URL and EXPECTED_PRODUCTION_DB_HOST.');
  }
  if (identity.database !== expectedName) {
    throw new TargetRefused(
      'Database mismatch between DATABASE_URL and EXPECTED_PRODUCTION_DB_NAME.',
    );
  }
  return identity;
}

/**
 * Proves the target is NOT production before writing to it.
 *
 * Restoring is destructive by nature, so this fails closed in the opposite
 * direction: anything that looks like production, or any environment that
 * merely fails to say it is not production, is refused.
 */
export function assertNonProductionTarget(env: NodeJS.ProcessEnv): TargetIdentity {
  const appEnv = (env.APP_ENV ?? '').toLowerCase();
  const url = env.RESTORE_TARGET_DATABASE_URL ?? '';

  if (!url) throw new TargetRefused('RESTORE_TARGET_DATABASE_URL is not set.');
  if (appEnv === 'production') {
    throw new TargetRefused('APP_ENV is "production". A restore test may never target production.');
  }

  const identity = parse(url);
  for (const marker of PRODUCTION_MARKERS) {
    if (marker.test(url) || marker.test(identity.host) || marker.test(identity.database)) {
      throw new TargetRefused(
        `Restore target matches a known production marker (${marker}). Refusing.`,
      );
    }
  }

  // A target must positively identify itself as disposable. Silence is not
  // consent: an unrecognised database could be anything, including production
  // behind a hostname this list has never seen.
  const looksDisposable = NON_PRODUCTION_MARKERS.some(
    (m) => m.test(identity.host) || m.test(identity.database),
  );
  if (!looksDisposable) {
    throw new TargetRefused(
      'Restore target does not identify itself as a test database. Name it so it ' +
        'is obviously disposable (e.g. contains "test" or "staging").',
    );
  }
  return identity;
}

/**
 * The production evidence vault. Staging must never write into it.
 *
 * Archive keys carry no environment namespace -- a photograph is stored at
 * `attendance-photos/YYYY/MM/<photoId>` whichever database it came from. Two
 * environments sharing one bucket would put synthetic staging evidence in the
 * same keyspace as real attendance records, indistinguishable afterwards. The
 * separation therefore has to be the bucket.
 */
export const PRODUCTION_VAULT_BUCKET = 'apex-os-production-backups';

export type PhotoRunnerEnvironment = 'production' | 'staging';

export interface PhotoTarget extends TargetIdentity {
  environment: PhotoRunnerEnvironment;
  bucket: string;
}

/**
 * Which database and vault the photo jobs may touch.
 *
 * Both runners previously used a bare PrismaClient: whatever DATABASE_URL
 * happened to be loaded won, with nothing asserting whether that was the
 * database anyone intended. This makes the operator declare the environment
 * and then proves the declaration.
 *
 * The expected host and database are supplied independently, never derived
 * from DATABASE_URL -- checking a URL against itself proves only that it was
 * parsed. They are read from the provider dashboard, so a mismatch means the
 * connection string is not what the operator believed.
 */
export function assertPhotoTarget(env: NodeJS.ProcessEnv): PhotoTarget {
  const appEnv = (env.APP_ENV ?? '').trim().toLowerCase();
  const bucket = (env.R2_BUCKET ?? '').trim();

  if (!bucket) throw new TargetRefused('R2_BUCKET is not set.');

  // Silence is not a default. An unrecognised APP_ENV could be anything, and
  // guessing is how staging writes into the production vault.
  if (appEnv !== 'production' && appEnv !== 'staging') {
    throw new TargetRefused(
      `APP_ENV is "${appEnv || '(unset)'}". Declare "production" or "staging" explicitly; ` +
        'an ambiguous environment is refused rather than guessed.',
    );
  }

  if (appEnv === 'production') {
    // Reuses the guard the database backup already trusts, so there is one
    // definition of "this is production" rather than two that can drift.
    const identity = assertProductionTarget(env);

    if (bucket !== PRODUCTION_VAULT_BUCKET) {
      throw new TargetRefused(
        `Production photo archive must use the production vault, not "${bucket}".`,
      );
    }
    return { ...identity, environment: 'production', bucket };
  }

  const url = env.DATABASE_URL ?? '';
  const expectedHost = (env.EXPECTED_STAGING_DB_HOST ?? '').trim();
  const expectedName = (env.EXPECTED_STAGING_DB_NAME ?? '').trim();

  if (!url) throw new TargetRefused('DATABASE_URL is not set.');
  if (!expectedHost || !expectedName) {
    throw new TargetRefused(
      'EXPECTED_STAGING_DB_HOST and EXPECTED_STAGING_DB_NAME must both be set, ' +
        'read independently from the provider dashboard.',
    );
  }

  if (bucket === PRODUCTION_VAULT_BUCKET) {
    throw new TargetRefused(
      'Staging may not write to the production vault. Archive keys carry no ' +
        'environment namespace, so synthetic staging evidence would be stored ' +
        'alongside real attendance records and be indistinguishable from them.',
    );
  }

  const identity = parse(url);

  for (const marker of PRODUCTION_MARKERS) {
    if (marker.test(url) || marker.test(identity.host) || marker.test(identity.database)) {
      throw new TargetRefused(
        `APP_ENV says staging but the target matches a production marker (${marker}). Refusing.`,
      );
    }
  }

  if (identity.host !== expectedHost) {
    throw new TargetRefused('Host mismatch between DATABASE_URL and EXPECTED_STAGING_DB_HOST.');
  }
  if (identity.database !== expectedName) {
    throw new TargetRefused('Database mismatch between DATABASE_URL and EXPECTED_STAGING_DB_NAME.');
  }

  return { ...identity, environment: 'staging', bucket };
}
