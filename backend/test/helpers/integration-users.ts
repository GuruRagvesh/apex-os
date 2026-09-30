/**
 * Deterministic users for the API integration suites (test/integration).
 *
 * These accounts exist only in the dedicated isolated integration database:
 * test/integration/global-setup.ts refuses any other database before it seeds
 * them. The password is a fixed, obviously-test value. It is not, and must
 * never become, the password of any real or shared account.
 */
export const INTEGRATION_PASSWORD = 'integration-only-not-a-real-password';

export const INTEGRATION_DEPARTMENT = 'Integration Operations';

export const INTEGRATION_USERS = {
  superadmin: { email: 'superadmin@integration.invalid', name: 'Integration Super Admin', role: 'SUPER_ADMIN' },
  admin:      { email: 'admin@integration.invalid',      name: 'Integration Admin',       role: 'ADMIN' },
  manager:    { email: 'manager@integration.invalid',    name: 'Integration Manager',     role: 'MANAGER' },
  teamlead:   { email: 'teamlead@integration.invalid',   name: 'Integration Team Lead',   role: 'TEAM_LEAD' },
  employee:   { email: 'employee@integration.invalid',   name: 'Integration Employee',    role: 'EMPLOYEE' },
  intern:     { email: 'intern@integration.invalid',     name: 'Integration Intern',      role: 'INTERN' },
} as const;

export const INTEGRATION_ROLES = [
  { name: 'SUPER_ADMIN', level: 0, description: 'Super administrator' },
  { name: 'ADMIN',       level: 1, description: 'Administrator' },
  { name: 'MANAGER',     level: 2, description: 'Manager' },
  { name: 'TEAM_LEAD',   level: 3, description: 'Team Lead' },
  { name: 'EMPLOYEE',    level: 4, description: 'Employee' },
  { name: 'INTERN',      level: 5, description: 'Intern' },
] as const;
