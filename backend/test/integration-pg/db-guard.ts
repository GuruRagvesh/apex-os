/**
 * The gate every PostgreSQL-backed test passes through.
 *
 * These suites write real rows, hold real advisory locks and run the real
 * attendance evaluator. Pointed at the wrong database they would corrupt live
 * attendance, so the connection is not trusted because a developer meant well:
 * it is checked, and the checks fail closed.
 *
 * Two independent gates, and both must pass:
 *
 *  1. A DENY list. Anything that looks remotely like a hosted or shared
 *     database is refused outright -- render.com, any non-loopback host, the
 *     word production. This catches the accident of a real URL being exported.
 *  2. An ALLOW list. The host must be loopback, and the database name must be
 *     the dedicated integration name. This catches the subtler accident of a
 *     local-but-real database: a developer's own working copy of the app on
 *     127.0.0.1:5432 is NOT a test database, and losing a day of local work to
 *     a truncate is still losing data.
 *
 * The port is deliberately not fixed here -- a container maps ports freely --
 * but the default 5432/5433 are rejected unless the database name matches,
 * which is what actually distinguishes the throwaway from the working copy.
 */

export const INTEGRATION_DB_NAME = 'apex_os_attendance_integration';

const DENY = [
  /render\.com/i,
  /amazonaws\.com/i,
  /\bprod\b/i,
  /production/i,
  /staging/i,
  /neon\.tech/i,
  /supabase/i,
];

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export interface DbIdentity {
  host: string;
  port: string;
  database: string;
  user: string;
}

/**
 * Parses and validates DATABASE_URL, or throws.
 *
 * Never returns the password and never puts the raw URL in a message: a thrown
 * error ends up in CI logs, and a credential in a log is a credential leaked.
 */
export function assertIsolatedDatabase(url = process.env.DATABASE_URL): DbIdentity {
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. PostgreSQL integration tests require an explicitly ' +
        `named isolated database (${INTEGRATION_DB_NAME}). They must never guess.`,
    );
  }

  for (const pattern of DENY) {
    if (pattern.test(url)) {
      throw new Error(
        `DATABASE_URL matches a forbidden pattern (${pattern}). ` +
          'Integration tests refuse to run against hosted, staging or production databases.',
      );
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DATABASE_URL is not a parseable URL.');
  }

  const host = parsed.hostname;
  const database = parsed.pathname.replace(/^\//, '');

  if (!LOOPBACK.has(host)) {
    throw new Error(
      `DATABASE_URL host is "${host}". Integration tests only run against a loopback address.`,
    );
  }

  if (database !== INTEGRATION_DB_NAME) {
    throw new Error(
      `DATABASE_URL names database "${database}", not "${INTEGRATION_DB_NAME}". ` +
        'A local database that is not the dedicated integration database may be real work.',
    );
  }

  return { host, port: parsed.port || '5432', database, user: parsed.username };
}

/**
 * Asks the SERVER who it is, rather than believing the connection string.
 *
 * A URL says where we intended to connect. Only the server can say where we
 * actually are -- through a tunnel, a proxy, or a pgbouncer pointed somewhere
 * else, those two are not the same fact.
 */
export async function assertServerIdentity(prisma: {
  $queryRawUnsafe: (sql: string) => Promise<any>;
}): Promise<Record<string, string>> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    // host() rather than a plain ::text cast: inet renders with its netmask,
    // so the loopback address arrives as "127.0.0.1/32" and matches nothing.
    `SELECT current_database()             AS db,
            current_user                   AS usr,
            host(inet_server_addr())       AS addr,
            inet_server_port()::text       AS port,
            version()                      AS ver`,
  );
  const row = rows[0];

  if (row.db !== INTEGRATION_DB_NAME) {
    throw new Error(`Server reports database "${row.db}", refusing to continue.`);
  }
  if (row.addr && !LOOPBACK.has(String(row.addr))) {
    throw new Error(`Server reports address "${row.addr}", which is not loopback.`);
  }

  return row;
}
