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

// DATABASE_URL is intentionally absent. Do not add one here, and do not point
// it at staging to turn the integration suites green: those suites failing on
// "Environment variable not found: DATABASE_URL" is the system correctly
// refusing to guess which database it should touch.
