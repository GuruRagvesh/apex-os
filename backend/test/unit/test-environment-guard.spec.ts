import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  ExternalNetworkBlockedError,
  UNIT_TEST_DATABASE_URL,
  enabledProviders,
  envFileKeyNames,
  isLoopbackHost,
  isProviderKey,
  neutraliseEnvironment,
} from '../test-environment-guard';

// Phase 5B: every Jest run fails closed against external services. The guard
// is installed by test/jest.env.ts before this file loads, so these tests also
// prove it is active in a real run.

describe('test environment guard', () => {
  it('is active: no provider is enabled and unit tests get an unreachable loopback database', () => {
    expect(enabledProviders(process.env)).toEqual([]);
    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env.DATABASE_URL).toBe(UNIT_TEST_DATABASE_URL);
  });

  it('classifies provider settings', () => {
    for (const k of ['CLOUDINARY_API_SECRET', 'RESEND_API_KEY', 'SMTP_HOST', 'R2_SECRET_ACCESS_KEY', 'MICROSOFT_CLIENT_SECRET',
      'ONEDRIVE_USER_ID', 'SENTRY_DSN', 'OPENAI_API_KEY', 'DATABASE_URL_Production', 'BACKUP_VAULT_PROVIDER', 'EMAIL_PROVIDER']) {
      expect(isProviderKey(k)).toBe(true);
    }
    for (const k of ['DATABASE_URL', 'JWT_SECRET', 'NODE_ENV', 'COMPANY_TIMEZONE']) expect(isProviderKey(k)).toBe(false);
  });

  it('refuses to run when the caller exported a provider credential (names only in the message)', () => {
    const env: NodeJS.ProcessEnv = { RESEND_API_KEY: 're_live_secret_value', NODE_ENV: 'test' };
    let message = '';
    try { neutraliseEnvironment(env, []); } catch (e: any) { message = e.message; }
    expect(message).toContain('RESEND_API_KEY');
    expect(message).not.toContain('re_live_secret_value');
  });

  it('pre-blanks every .env-declared variable except the allowed test ones, so no loader can fill them', () => {
    const env: NodeJS.ProcessEnv = { DATABASE_URL: 'postgresql://x@127.0.0.1:55432/apex_os_attendance_integration' };
    const blanked = neutraliseEnvironment(env, ['CLOUDINARY_API_KEY', 'DATABASE_URL_Production', 'SOME_OTHER_SETTING', 'DATABASE_URL', 'JWT_SECRET']);
    expect(blanked.sort()).toEqual(['CLOUDINARY_API_KEY', 'DATABASE_URL_Production', 'SOME_OTHER_SETTING']);
    expect(env.CLOUDINARY_API_KEY).toBe('');
    expect(env.DATABASE_URL_Production).toBe('');
    expect(env.DATABASE_URL).toContain('55432');
    expect(env.JWT_SECRET).toBeUndefined();
  });

  it('reads only variable names from a dotenv file', () => {
    const file = path.join(os.tmpdir(), `guard-${process.pid}.env`);
    fs.writeFileSync(file, '# comment\nA_KEY=secret-a\nexport B_KEY="secret b"\n  C_KEY = c\nnot a line\n');
    try {
      const names = envFileKeyNames(file);
      expect(names).toEqual(['A_KEY', 'B_KEY', 'C_KEY']);
      expect(JSON.stringify(names)).not.toContain('secret');
    } finally { fs.unlinkSync(file); }
    expect(envFileKeyNames(path.join(os.tmpdir(), 'does-not-exist.env'))).toEqual([]);
  });

  it('blocks outbound network to anything but loopback (fetch, http, https)', async () => {
    await expect(fetch('https://api.resend.com/emails')).rejects.toBeInstanceOf(ExternalNetworkBlockedError);
    await expect(fetch('https://api.cloudinary.com/v1_1/x/upload')).rejects.toThrow('host: api.cloudinary.com');
    expect(() => https.request('https://example.r2.cloudflarestorage.com/bucket')).toThrow(ExternalNetworkBlockedError);
    expect(() => http.get({ hostname: 'graph.microsoft.com', path: '/' })).toThrow(ExternalNetworkBlockedError);
    for (const h of ['127.0.0.1', 'localhost', '::1', '127.0.0.2']) expect(isLoopbackHost(h)).toBe(true);
    for (const h of ['example.com', 'apex-os-backend.onrender.com', '10.0.0.5']) expect(isLoopbackHost(h)).toBe(false);
  });

  it('the browser-QA launcher refuses any database but the loopback integration one, before starting anything', () => {
    const script = path.resolve(__dirname, '../../scripts/qa/run-isolated-backend.mjs');
    const run = (url: string) => spawnSync(process.execPath, [script], { env: { PATH: process.env.PATH, DATABASE_URL: url }, encoding: 'utf8', timeout: 20_000 });
    const remote = run('postgresql://u:p@db.example.render.com:5432/apex_os_attendance_integration');
    expect(remote.status).toBe(1);
    expect(remote.stderr).toContain('DATABASE_URL host must be loopback');
    expect(remote.stderr).not.toContain('u:p@');
    const wrongDb = run('postgresql://u@127.0.0.1:5432/apex_os');
    expect(wrongDb.status).toBe(1);
    expect(wrongDb.stderr).toContain('database must be apex_os_attendance_integration');
  });

  describe('API global setup order', () => {
    const saved = { url: process.env.DATABASE_URL, direct: process.env.DIRECT_URL };
    afterEach(() => { process.env.DATABASE_URL = saved.url; process.env.DIRECT_URL = saved.direct; });
    const run = async () => (await import('../integration/global-setup')).default();

    it('refuses a missing DATABASE_URL before anything else', async () => {
      delete process.env.DATABASE_URL;
      await expect(run()).rejects.toThrow('DATABASE_URL is not set');
    });

    it('refuses a remote or malformed DATABASE_URL, never printing it', async () => {
      process.env.DATABASE_URL = 'postgresql://user:hunter2@db.example.render.com:5432/apex_os_attendance_integration';
      const remote = await run().then(() => null, (e) => e);
      expect(remote?.message).toMatch(/forbidden pattern|loopback/i);
      expect(remote?.message).not.toContain('hunter2');
      process.env.DATABASE_URL = 'not a url';
      await expect(run()).rejects.toThrow(/parseable|loopback|forbidden/i);
    });

    it('installs isolation before loading Prisma (source order)', () => {
      const src = fs.readFileSync(path.resolve(__dirname, '../integration/global-setup.ts'), 'utf8');
      const guard = src.indexOf('installTestEnvironmentGuard();');
      const prismaImport = src.indexOf("await import('@prisma/client')");
      expect(guard).toBeGreaterThan(0);
      expect(prismaImport).toBeGreaterThan(guard);
      expect(src).not.toMatch(/^import .*@prisma\/client/m);
    });
  });
});
