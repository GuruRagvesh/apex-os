/**
 * Auth helpers for integration tests.
 * Returns a valid JWT for each integration-only role account, seeded by
 * test/integration/global-setup.ts into the isolated integration database.
 */
import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { INTEGRATION_PASSWORD, INTEGRATION_USERS } from './integration-users';

export const TEST_USERS = Object.fromEntries(
  Object.entries(INTEGRATION_USERS).map(([key, u]) => [key, { email: u.email, password: INTEGRATION_PASSWORD }]),
) as { [K in keyof typeof INTEGRATION_USERS]: { email: string; password: string } };

export type RoleKey = keyof typeof TEST_USERS;

/** Cache tokens within a test run to avoid repeated logins */
const tokenCache = new Map<RoleKey, string>();

export async function loginAs(app: INestApplication, role: RoleKey): Promise<string> {
  if (tokenCache.has(role)) return tokenCache.get(role)!;

  const { email, password } = TEST_USERS[role];
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(201);

  const token: string = res.body.accessToken;
  expect(token).toBeDefined();
  tokenCache.set(role, token);
  return token;
}

/** Clear cached tokens (call in afterAll if needed) */
export function clearTokenCache() {
  tokenCache.clear();
}

/** Convenience: get Authorization header for a role */
export async function bearerFor(app: INestApplication, role: RoleKey) {
  const token = await loginAs(app, role);
  return `Bearer ${token}`;
}
