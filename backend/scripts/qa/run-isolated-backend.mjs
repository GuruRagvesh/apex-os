#!/usr/bin/env node
/**
 * Runs the BUILT backend (backend/dist/main.js) for local browser QA against
 * the throwaway integration database only, with every external provider off.
 *
 *   DATABASE_URL="postgresql://apex_test@127.0.0.1:55432/apex_os_attendance_integration?schema=public" \
 *     node backend/scripts/qa/run-isolated-backend.mjs [--port 3001]
 *
 * Why this exists: the generated Prisma client loads backend/.env into the
 * process for every variable that is not already set. Starting the backend
 * normally, even with an explicit test DATABASE_URL, therefore still picks up
 * the developer's real Cloudinary, Resend, R2, Microsoft Graph or Sentry
 * settings. This launcher:
 *
 *  - refuses any DATABASE_URL that is not loopback + apex_os_attendance_integration;
 *  - starts from an empty environment (PATH and OS basics only);
 *  - pre-sets every variable named in backend/.env and backend/.env.local, and
 *    every known provider variable, to '' so nothing can be filled in
 *    (names are read, values never are, and nothing is printed);
 *  - generates a throwaway JWT secret;
 *  - runs from the OS temp directory, not backend/;
 *  - after start-up, checks /api/health and stops the server if attendance
 *    photo storage reports configured.
 *
 * Never point this at a real database. Never use it in production.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAIN = join(BACKEND, 'dist', 'main.js');
const INTEGRATION_DB = 'apex_os_attendance_integration';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const PROVIDERS = [
  'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET',
  'RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'EMAIL_PROVIDER',
  'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_TENANT_ID',
  'ONEDRIVE_USER_ID', 'ONEDRIVE_BACKUP_FOLDER_PATH', 'BACKUP_VAULT_PROVIDER',
  'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET',
  'SENTRY_DSN', 'SENTRY_ENVIRONMENT', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DATABASE_URL_Production',
];

function fail(message) {
  console.error(`[isolated-backend] ${message}`);
  process.exit(1);
}

function checkDatabaseUrl(url) {
  if (!url) fail('DATABASE_URL is required and must name the throwaway integration database.');
  let parsed;
  try { parsed = new URL(url); } catch { fail('DATABASE_URL is not a parseable URL.'); }
  if (!LOOPBACK.has(parsed.hostname)) fail('DATABASE_URL host must be loopback.');
  if (parsed.pathname.replace(/^\//, '') !== INTEGRATION_DB) fail(`DATABASE_URL database must be ${INTEGRATION_DB}.`);
  if (/render\.com|amazonaws|neon\.tech|supabase|prod|staging/i.test(url)) fail('DATABASE_URL matches a forbidden pattern.');
}

function envKeyNames(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split(/\r?\n/)
    .map((line) => /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1])
    .filter(Boolean);
}

const args = process.argv.slice(2);
const port = args.includes('--port') ? args[args.indexOf('--port') + 1] : '3001';
const databaseUrl = process.env.DATABASE_URL;
checkDatabaseUrl(databaseUrl);
if (!existsSync(MAIN)) fail('backend/dist/main.js not found. Run `npm run build` in backend first.');

const env = {};
for (const key of ['PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC']) {
  if (process.env[key] !== undefined) env[key] = process.env[key];
}
for (const key of [...envKeyNames(join(BACKEND, '.env')), ...envKeyNames(join(BACKEND, '.env.local')), ...PROVIDERS]) env[key] = '';
Object.assign(env, {
  NODE_ENV: 'development',
  APP_ENV: 'development',
  PORT: port,
  FRONTEND_URL: 'http://localhost:3000',
  JWT_SECRET: randomBytes(48).toString('hex'),
  JWT_EXPIRES_IN: '8h',
  DATABASE_URL: databaseUrl,
  DIRECT_URL: databaseUrl,
});

const child = spawn(process.execPath, [MAIN], { cwd: tmpdir(), env, stdio: 'inherit' });
const stop = () => { if (!child.killed) child.kill(); };
process.on('SIGINT', () => { stop(); process.exit(130); });
process.on('SIGTERM', () => { stop(); process.exit(143); });
child.on('exit', (code) => process.exit(code ?? 0));

// After start-up: refuse to keep running with a real storage provider.
(async () => {
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
      if (health?.attendancePhotoStorage?.configured) {
        console.error('[isolated-backend] photo storage is configured: refusing to run QA against a real provider.');
        stop();
        process.exit(1);
      }
      console.log(`[isolated-backend] ready on http://127.0.0.1:${port}/api (database ${INTEGRATION_DB}; external providers off)`);
      return;
    } catch { /* not up yet */ }
  }
  console.error('[isolated-backend] backend did not become healthy in 60s');
  stop();
  process.exit(1);
})();
