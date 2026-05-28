/**
 * Auth helpers for integration tests.
 * Returns a valid JWT for each test-role account.
 */
import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';

export const TEST_USERS = {
  superadmin: { email: 'superadmin@apex.local', password: 'Apex@local1' },
  admin:      { email: 'admin@apex.local',      password: 'Apex@local1' },
  manager:    { email: 'manager@apex.local',    password: 'Apex@local1' },
  teamlead:   { email: 'teamlead@apex.local',   password: 'Apex@local1' },
  employee:   { email: 'employee@apex.local',   password: 'Apex@local1' },
  intern:     { email: 'intern@apex.local',     password: 'Apex@local1' },
} as const;

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
