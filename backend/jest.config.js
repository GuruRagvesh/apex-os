/**
 * Unit suites: fully mocked, no database. This is what `npm test` runs.
 *
 * The API integration suites (test/integration) boot the real app against a
 * database and run only through jest.api.config.js; the PostgreSQL suites
 * (test/integration-pg) run only through jest.integration.config.js.
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
  testMatch: [
    '<rootDir>/test/unit/**/*.spec.ts',
    '<rootDir>/src/**/*.spec.ts',
  ],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
  },
  testTimeout: 30000,
  // Show individual test names in output
  verbose: true,
  // Env vars available to all tests
  setupFiles: ['<rootDir>/test/jest.env.ts'],
};
