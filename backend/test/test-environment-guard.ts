/**
 * Fail-closed isolation for every Jest run (unit, PostgreSQL, API).
 *
 * The generated Prisma client loads backend/.env into process.env when it is
 * imported, for every variable not already set. A developer's .env can hold
 * real Cloudinary, Resend, R2, Microsoft Graph or Sentry settings, and even a
 * production database URL under another name. With DATABASE_URL set
 * explicitly the database was always the test one, but the provider settings
 * still arrived. This guard runs first (from test/jest.env.ts, before any test
 * imports Prisma) and:
 *
 *  1. refuses to run if the caller exported a provider credential;
 *  2. pre-sets every provider variable, and every other variable named in
 *     backend/.env or .env.local (names only; values are never read or
 *     printed), to an empty string, so the Prisma loader cannot fill them;
 *  3. gives unit tests an unreachable loopback DATABASE_URL, so nothing can
 *     silently connect to a database named in .env;
 *  4. validates any explicit DATABASE_URL with the integration gate;
 *  5. blocks outbound network from the test process to anything but
 *     loopback (fetch, http, https), naming only the host when it refuses.
 */
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import { assertIsolatedDatabase } from './integration-pg/db-guard';

/** Provider settings: any of these set means a real external service could be called. */
export const PROVIDER_ENV_PATTERNS: RegExp[] = [
  /^CLOUDINARY_/,
  /^RESEND_/,
  /^SMTP_/,
  /^MAIL_/,
  /^EMAIL_PROVIDER$/,
  /^MICROSOFT_/,
  /^ONEDRIVE_/,
  /^R2_/,
  /^BACKUP_VAULT_/,
  /^AWS_/,
  /^SENTRY_/,
  /^OPENAI_API_KEY$/,
  /^ANTHROPIC_API_KEY$/,
  /^RENDER_/,
  /^VERCEL_/,
  /^DATABASE_URL_/,
];

/** Variables a test run may legitimately set itself. */
export const TEST_ENV_ALLOWED = new Set([
  'DATABASE_URL', 'DIRECT_URL', 'NODE_ENV', 'JWT_SECRET', 'JWT_EXPIRES_IN', 'TZ', 'PORT',
  'FRONTEND_URL', 'APP_ENV', 'COMPANY_TIMEZONE', 'FINANCIAL_YEAR_START_MODE', 'FINANCIAL_YEAR_START_MONTH',
]);

/** Unit tests never need a database; anything that tries to connect fails fast, locally. */
export const UNIT_TEST_DATABASE_URL = 'postgresql://unit-test-no-database@127.0.0.1:1/apex_os_attendance_integration';

export const isProviderKey = (key: string) => PROVIDER_ENV_PATTERNS.some((p) => p.test(key));

/** Names declared in a dotenv file. Values are never returned. */
export function envFileKeyNames(file: string): string[] {
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const names = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m) names.add(m[1]);
  }
  return [...names];
}

/**
 * Throws if the caller exported a provider credential with a value, then
 * pre-sets every provider and every .env-declared variable (except the allowed
 * test variables) to '' so no loader can fill it. Returns the keys it blanked.
 */
export function neutraliseEnvironment(env: NodeJS.ProcessEnv, envFileKeys: string[]): string[] {
  const exported = Object.keys(env).filter((k) => isProviderKey(k) && (env[k] ?? '') !== '');
  if (exported.length > 0) {
    throw new Error(
      `Refusing to run tests: external-service settings are set in the environment (${exported.sort().join(', ')}). ` +
        'Unset them; tests must never reach real providers.',
    );
  }
  const blanked: string[] = [];
  for (const key of envFileKeys) {
    if (TEST_ENV_ALLOWED.has(key)) continue;
    if (env[key] === undefined) { env[key] = ''; blanked.push(key); }
  }
  return blanked;
}

/** Provider variables that are set to something non-empty (should be none). */
export function enabledProviders(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env).filter((k) => isProviderKey(k) && (env[k] ?? '') !== '').sort();
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0']);
export const isLoopbackHost = (host: string | undefined | null) =>
  !!host && (LOOPBACK_HOSTS.has(host.toLowerCase()) || /^127\./.test(host));

export class ExternalNetworkBlockedError extends Error {
  constructor(host: string) {
    super(`External network access is blocked in tests (host: ${host}).`);
    this.name = 'ExternalNetworkBlockedError';
  }
}

function hostOf(target: unknown): string {
  try {
    if (typeof target === 'string') return new URL(target).hostname;
    if (target instanceof URL) return target.hostname;
    const t = target as any;
    if (t?.url) return new URL(t.url).hostname;              // fetch Request
    return String(t?.hostname ?? t?.host ?? 'localhost').replace(/:\d+$/, '');
  } catch {
    return 'unknown';
  }
}

let installed = false;
/** Refuses fetch/http/https requests to any non-loopback host. Idempotent. */
export function installNetworkGuard() {
  if (installed) return;
  installed = true;
  const originalFetch = (globalThis as any).fetch;
  if (typeof originalFetch === 'function') {
    (globalThis as any).fetch = (input: any, init?: any) => {
      const host = hostOf(input);
      if (!isLoopbackHost(host)) return Promise.reject(new ExternalNetworkBlockedError(host));
      return originalFetch(input, init);
    };
  }
  for (const mod of [http, https] as any[]) {
    for (const method of ['request', 'get']) {
      const original = mod[method];
      mod[method] = function guarded(this: unknown, ...args: any[]) {
        const host = hostOf(args[0]);
        if (!isLoopbackHost(host)) throw new ExternalNetworkBlockedError(host);
        return original.apply(this, args);
      };
    }
  }
}

/** Everything above, in order. Called once per test file from test/jest.env.ts. */
export function installTestEnvironmentGuard(env: NodeJS.ProcessEnv = process.env) {
  const backendDir = path.resolve(__dirname, '..');
  const fileKeys = [
    ...envFileKeyNames(path.join(backendDir, '.env')),
    ...envFileKeyNames(path.join(backendDir, '.env.local')),
  ];
  neutraliseEnvironment(env, fileKeys);

  if (env.DATABASE_URL) {
    assertIsolatedDatabase(env.DATABASE_URL);
    if (env.DIRECT_URL) assertIsolatedDatabase(env.DIRECT_URL);
  } else {
    env.DATABASE_URL = UNIT_TEST_DATABASE_URL;
  }

  const leaked = enabledProviders(env);
  if (leaked.length > 0) throw new Error(`Refusing to run tests: providers still enabled (${leaked.join(', ')}).`);

  installNetworkGuard();
}
