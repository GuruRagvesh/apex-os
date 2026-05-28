/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: './tsconfig.json' }],
  },
  testMatch: [
    '<rootDir>/test/**/*.spec.ts',
    '<rootDir>/src/**/*.spec.ts',
  ],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
  },
  // Give integration tests more time — they boot a real NestJS app + DB
  testTimeout: 30000,
  // Show individual test names in output
  verbose: true,
  // Env vars available to all tests
  setupFiles: ['<rootDir>/test/jest.env.ts'],
};
