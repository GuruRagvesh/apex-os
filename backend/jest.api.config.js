/**
 * API integration suites (test/integration): the whole AppModule over HTTP.
 *
 * Separate from jest.config.js, which is unit-only and needs no database. These
 * suites refuse to start unless DATABASE_URL names the dedicated isolated
 * database (see test/integration/global-setup.ts), and they seed their own
 * deterministic users there.
 *
 *   DATABASE_URL=... npm run test:api
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
  testMatch: ['<rootDir>/test/integration/**/*.spec.ts'],
  moduleNameMapper: { '^src/(.*)$': '<rootDir>/src/$1' },
  globalSetup: '<rootDir>/test/integration/global-setup.ts',
  testTimeout: 60000,
  verbose: true,
  // One shared database; suites create and read the same rows.
  maxWorkers: 1,
  setupFiles: ['<rootDir>/test/jest.env.ts'],
};
