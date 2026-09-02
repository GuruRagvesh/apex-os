/**
 * PostgreSQL-backed integration tests.
 *
 * Deliberately a SEPARATE config from jest.config.js. The unit suites are fully
 * mocked and must keep running on any machine with no database at all; making
 * ordinary CI depend on a developer's production-like database is how a test
 * run ends up pointed somewhere it should never have been.
 *
 * These suites refuse to run unless DATABASE_URL names the dedicated isolated
 * database. See test/integration-pg/db-guard.ts.
 *
 *   npm run test:int
 *
 * @type {import('jest').Config}
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: './tsconfig.json' }],
  },
  testMatch: ['<rootDir>/test/integration-pg/**/*.int-spec.ts'],
  moduleNameMapper: { '^src/(.*)$': '<rootDir>/src/$1' },
  // Real locks, real contention, real waiting.
  testTimeout: 120000,
  verbose: true,
  // One worker: these suites share one database and several of them
  // deliberately create lock contention. Parallel workers would produce
  // failures that say nothing about the code.
  maxWorkers: 1,
  setupFiles: ['<rootDir>/test/jest.env.ts'],
};
