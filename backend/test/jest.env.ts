/**
 * Test runtime, established explicitly by Jest.
 *
 * This file used to `dotenv.config()` a required `backend/.env` and throw if
 * JWT_SECRET was missing. That made a generic, auto-loaded file the thing that
 * decided whether tests ran — and the same file silently supplied a
 * DATABASE_URL to anything else launched from `backend/`, which for a long time
 * meant the PRODUCTION database.
 *
 * Now the test environment is stated here, in the only place that should own
 * it. `backend/.env` is not required and not expected to exist.
 *
 * Three deliberate properties:
 *
 *  1. No DATABASE_URL. Unit tests are fully mocked and need none. Integration
 *     tests that need a database must be given a DEDICATED test database
 *     explicitly — never staging, and never production.
 *  2. `??=` for secrets, so a value deliberately exported by the caller still
 *     wins and CI can inject its own.
 *  3. NODE_ENV is forced, not defaulted. A test run is a test run whatever a
 *     stray file or shell might claim.
 */

// backend/.env is deliberately NOT loaded. It used to be, "for convenience",
// and on a developer machine that file can point at a working copy of real
// data. A suite that needs a database is handed DATABASE_URL explicitly and
// then checked by test/integration-pg/db-guard.ts.

// Harmless, obviously-not-real values. Long enough to satisfy any minimum-length
// check without resembling a credential anybody might mistake for real.
process.env.JWT_SECRET ??=
  'jest-only-not-a-real-secret-0000000000000000000000000000000000000000';
process.env.JWT_EXPIRES_IN ??= '1h';

process.env.NODE_ENV = 'test';

// Fail closed against external services before anything imports Prisma (whose
// client would otherwise fill unset variables from backend/.env): provider
// settings blanked, an explicit DATABASE_URL checked, outbound network blocked.
// See test/test-environment-guard.ts.
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('./test-environment-guard').installTestEnvironmentGuard();

// DATABASE_URL is never set here. When the caller does not export one (unit
// tests), the guard above sets an unreachable loopback URL so nothing can fall
// back to a database named in backend/.env. Do not point it at staging to turn
// the integration suites green: they need the dedicated integration database,
// exported explicitly and checked by test/integration-pg/db-guard.ts.
