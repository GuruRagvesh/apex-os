/**
 * Global setup for the API integration suites (jest.api.config.js).
 *
 * These suites boot the whole AppModule and write through the real API, so
 * they pass the same two gates as test/integration-pg: DATABASE_URL must name
 * the dedicated loopback integration database, and the server itself must
 * confirm that identity. Only then are the deterministic integration users
 * upserted. No value from backend/.env is ever used (the guard reads only
 * variable names there, to blank them).
 *
 * The test-environment guard runs first, in this (parent) process, because the
 * generated Prisma client fills unset variables from backend/.env as soon as it
 * is loaded and every test worker inherits this environment. The client is
 * therefore loaded only after the guard (dynamic import below).
 */
import * as bcrypt from 'bcryptjs';
import { installTestEnvironmentGuard } from '../test-environment-guard';
import { assertIsolatedDatabase, assertServerIdentity } from '../integration-pg/db-guard';
import {
  INTEGRATION_DEPARTMENT,
  INTEGRATION_PASSWORD,
  INTEGRATION_ROLES,
  INTEGRATION_USERS,
} from '../helpers/integration-users';

export default async function globalSetup() {
  // 1. The caller must name the database explicitly (the guard would otherwise
  //    give unit runs an unreachable placeholder).
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. The API suites need the isolated integration database, exported explicitly.');
  }
  // 2. Isolation first: provider settings blanked, the explicit DATABASE_URL
  //    checked by the integration gate (remote or malformed URLs are refused,
  //    never printed), outbound network blocked.
  installTestEnvironmentGuard();
  // 3. The same gate once more, on the value Prisma will use.
  assertIsolatedDatabase(process.env.DATABASE_URL);

  // 4. Only now load the Prisma client (it fills unset variables from backend/.env).
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    await assertServerIdentity(prisma);

    for (const r of INTEGRATION_ROLES) {
      await prisma.role.upsert({ where: { name: r.name }, update: {}, create: { ...r } });
    }

    // One department everyone belongs to, so department- and team-scoped
    // endpoints have something to scope.
    const department = await prisma.department.upsert({
      where: { name: INTEGRATION_DEPARTMENT },
      update: {},
      create: { name: INTEGRATION_DEPARTMENT, description: 'Integration tests only' },
    });

    const password = await bcrypt.hash(INTEGRATION_PASSWORD, 10);
    for (const u of Object.values(INTEGRATION_USERS)) {
      const role = await prisma.role.findUniqueOrThrow({ where: { name: u.role } });
      const data = {
        name: u.name,
        roleId: role.id,
        departmentId: department.id,
        password,
        isActive: true,
        mustChangePassword: false,
      };
      await prisma.user.upsert({ where: { email: u.email }, update: data, create: { email: u.email, ...data } });
    }
  } finally {
    await prisma.$disconnect();
  }
}
