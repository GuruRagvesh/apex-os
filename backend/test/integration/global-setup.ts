/**
 * Global setup for the API integration suites (jest.api.config.js).
 *
 * These suites boot the whole AppModule and write through the real API, so
 * they pass the same two gates as test/integration-pg: DATABASE_URL must name
 * the dedicated loopback integration database, and the server itself must
 * confirm that identity. Only then are the deterministic integration users
 * upserted. Nothing here ever reads backend/.env.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { assertIsolatedDatabase, assertServerIdentity } from '../integration-pg/db-guard';
import {
  INTEGRATION_DEPARTMENT,
  INTEGRATION_PASSWORD,
  INTEGRATION_ROLES,
  INTEGRATION_USERS,
} from '../helpers/integration-users';

export default async function globalSetup() {
  assertIsolatedDatabase(process.env.DATABASE_URL);

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
