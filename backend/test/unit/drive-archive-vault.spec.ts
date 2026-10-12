import { randomBytes } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { assertArchiveAccount, createDriveVault, isArchiveAccount, readDriveConfig, DriveRefused, UPLOAD_CHUNK_BYTES } from '../../src/modules/platform/backup-vault/drive-vault';
import { verifyDriveVault } from '../../scripts/drive-archive/run-drive-verify';
import { buildAuthUrl, pkcePair } from '../../scripts/drive-archive/run-drive-authorize';
import { FakeDriveVault } from '../helpers/fake-drive-vault';

// The Google Drive archive vault: configuration, the HTTP client (faked; no
// network), the health check and the authorization request.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drive-archive-vault-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// ── Google Drive client (HTTP faked) ────────────────────────────────────────

describe('Google Drive client', () => {
  const env = {
    GOOGLE_DRIVE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
    GOOGLE_DRIVE_CLIENT_SECRET: 'client-secret-value',
    GOOGLE_DRIVE_REFRESH_TOKEN: 'refresh-token-value',
    GOOGLE_DRIVE_ARCHIVE_ROOT_FOLDER_ID: 'rootFolderId0001',
    GOOGLE_DRIVE_ARCHIVE_ACCOUNT: 'Archive-Owner@Example.test',
    GOOGLE_DRIVE_ARCHIVE_ENVIRONMENT: 'staging',
  };

  it('requires its configuration and the matching environment', () => {
    expect(readDriveConfig(env, 'staging').account).toBe('archive-owner@example.test');
    expect(() => readDriveConfig(env, 'production')).toThrow(/is "staging" but this run is for "production"/);
    expect(() => readDriveConfig({ ...env, GOOGLE_DRIVE_REFRESH_TOKEN: '' }, 'staging')).toThrow(/GOOGLE_DRIVE_REFRESH_TOKEN/);
    expect(() => readDriveConfig({ ...env, GOOGLE_DRIVE_ARCHIVE_ENVIRONMENT: 'dev' }, 'staging')).toThrow(DriveRefused);
  });

  const json = (status: number, body: any, headers: Record<string, string> = {}) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  });

  it('never puts a credential into a token-refresh error', async () => {
    const fetchImpl = jest.fn(async () => json(400, { error: 'invalid_grant' }));
    const vault = createDriveVault(readDriveConfig(env, 'staging'), fetchImpl);
    const err = await vault.account().catch((e) => e);
    expect(err.message).toMatch(/invalid_grant/);
    for (const secret of ['client-secret-value', 'refresh-token-value']) expect(err.message).not.toContain(secret);
  });

  it('resumes an interrupted upload from the offset Drive reports', async () => {
    const size = UPLOAD_CHUNK_BYTES + 1000;
    const local = join(dir, 'big');
    writeFileSync(local, randomBytes(size));
    const puts: string[] = [];
    let failedOnce = false;
    const fetchImpl = jest.fn(async (url: string, init: any = {}) => {
      if (url.includes('oauth2.googleapis.com')) return json(200, { access_token: 'at', expires_in: 3600 });
      if (url.includes('uploadType=resumable')) return json(200, {}, { location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=abc' });
      if (init.method === 'PUT') {
        const range = init.headers['content-range'];
        puts.push(range);
        if (range === `bytes */${size}`) return json(308, {}, { range: `bytes=0-${UPLOAD_CHUNK_BYTES - 1}` });
        if (range.startsWith(`bytes ${UPLOAD_CHUNK_BYTES}-`) && !failedOnce) {
          failedOnce = true;
          throw new Error('socket hang up');
        }
        if (range.startsWith('bytes 0-')) return json(308, {}, { range: `bytes=0-${UPLOAD_CHUNK_BYTES - 1}` });
        return json(200, { id: 'newFileId', size: String(size) });
      }
      throw new Error(`unexpected ${url}`);
    });
    const vault = createDriveVault(readDriveConfig(env, 'staging'), fetchImpl);
    const r = await vault.upload('folderId0001', 'x.enc', local, {});
    expect(r).toEqual({ fileId: 'newFileId', size });
    expect(puts).toEqual([`bytes 0-${UPLOAD_CHUNK_BYTES - 1}/${size}`, `bytes ${UPLOAD_CHUNK_BYTES}-${size - 1}/${size}`, `bytes */${size}`, `bytes ${UPLOAD_CHUNK_BYTES}-${size - 1}/${size}`]);
  });

  it('refuses an upload session on a host that is not Google Drive', async () => {
    const local = join(dir, 'f');
    writeFileSync(local, 'x');
    const fetchImpl = jest.fn(async (url: string) => {
      if (url.includes('oauth2.googleapis.com')) return json(200, { access_token: 'at', expires_in: 3600 });
      return json(200, {}, { location: 'https://evil.example.test/upload' });
    });
    const vault = createDriveVault(readDriveConfig(env, 'staging'), fetchImpl);
    await expect(vault.upload('folderId0001', 'x.enc', local, {})).rejects.toThrow(/refusing to contact evil.example.test/);
  });

  it('treats a file as private only when the archive account is its sole owner', async () => {
    let perms: any[] = [];
    const fetchImpl = jest.fn(async (url: string) => {
      if (url.includes('oauth2.googleapis.com')) return json(200, { access_token: 'at', expires_in: 3600 });
      return json(200, { permissions: perms });
    });
    const vault = createDriveVault(readDriveConfig(env, 'staging'), fetchImpl);
    perms = [{ type: 'user', role: 'owner', emailAddress: 'archive-owner@example.test' }];
    expect(await vault.isPrivate('f')).toBe(true);
    perms = [...perms, { type: 'anyone', role: 'reader' }];
    expect(await vault.isPrivate('f')).toBe(false);
    perms = [{ type: 'user', role: 'owner', emailAddress: 'someone-else@example.test' }];
    expect(await vault.isPrivate('f')).toBe(false);
  });

  it('refuses an environment folder labelled for the other environment', async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      if (url.includes('oauth2.googleapis.com')) return json(200, { access_token: 'at', expires_in: 3600 });
      if (url.includes('/files/rootFolderId0001')) {
        return json(200, { id: 'rootFolderId0001', name: 'root', mimeType: 'application/vnd.google-apps.folder', appProperties: { apexArchiveRoot: 'true' } });
      }
      return json(200, { files: [{ id: 'envFolder', name: 'staging', mimeType: 'application/vnd.google-apps.folder', appProperties: { apexArchiveEnvironment: 'production' } }] });
    });
    const vault = createDriveVault(readDriveConfig(env, 'staging'), fetchImpl);
    await expect(vault.ensureFolder('staging', ['deleted-users'])).rejects.toThrow(/labelled apexArchiveEnvironment=production/);
  });
});

// ── Commands ────────────────────────────────────────────────────────────────

describe('admin:drive:verify', () => {
  const config = { clientId: 'c', clientSecret: 's', refreshToken: 'r', rootFolderId: 'root-folder-0001', account: 'archive-owner@example.test', environment: 'staging' as const };

  it('passes every step and leaves nothing behind', async () => {
    const vault = new FakeDriveVault();
    const checks = await verifyDriveVault(vault, config);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(checks.map((c) => c.step)).toEqual(['oauth', 'account', 'quota', 'folders', 'folders-private', 'upload', 'download', 'private', 'delete', 'folders-private-after']);
    expect(vault.storedFiles()).toHaveLength(0);
  });

  it.each([
    ['a different signed-in account', { account: 'someone@example.test' }, 'account'],
    ['no free storage', { freeBytes: 1 }, 'quota'],
    ['a corrupted download', { corruptDownload: true }, 'download'],
    ['a publicly shared test file', { sharePublicly: true }, 'private'],
  ])('fails on %s and still removes the test file', async (_l, opts, step) => {
    const vault = new FakeDriveVault(opts as any);
    const checks = await verifyDriveVault(vault, config);
    expect(checks.find((c) => !c.ok)?.step).toBe(step);
    expect(vault.storedFiles()).toHaveLength(0);
  });
});

describe('archive account check (authorize and verify both use it)', () => {
  const expected = 'ai.technoedge@gmail.com';

  it('accepts only the configured archive account', () => {
    expect(isArchiveAccount('ai.technoedge@gmail.com', expected)).toBe(true);
    expect(isArchiveAccount(' AI.TechnoEdge@Gmail.com ', expected)).toBe(true);
    for (const other of ['ai.technology@gmail.com', 'someone@gmail.com', 'ai.technoedge@gmail.co', '', null, undefined]) {
      expect([other, isArchiveAccount(other as any, expected)]).toEqual([other, false]);
    }
    expect(isArchiveAccount('ai.technoedge@gmail.com', '')).toBe(false);
    expect(() => assertArchiveAccount('ai.technology@gmail.com', expected)).toThrow(DriveRefused);
  });

  it('the commands read the account from configuration, never from code', () => {
    const src = (f: string) => require('fs').readFileSync(require('path').join(__dirname, '../../scripts/drive-archive', f), 'utf8');
    const app = (f: string) => require('fs').readFileSync(require('path').join(__dirname, '../../src/modules/platform/backup-vault', f), 'utf8');
    for (const f of ['run-drive-authorize.ts', 'run-drive-verify.ts']) {
      expect([f, /@gmail\.com/.test(src(f))]).toEqual([f, false]);
    }
    for (const f of ['drive-vault.ts', 'drive-folder-privacy.ts', 'backup-vault.service.ts']) {
      expect([f, /@gmail\.com/.test(app(f))]).toEqual([f, false]);
    }
    expect(src('run-drive-authorize.ts')).toContain('isArchiveAccount(who, p.account)');
    expect(src('run-drive-verify.ts')).toContain('isArchiveAccount(account.email, config.account)');
  });
});

describe('admin:drive:authorize', () => {
  it('asks for offline access, forced consent, only drive.file, with PKCE', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    const u = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:5555/oauth2callback', state: 'st', challenge, loginHint: 'owner@example.test' }));
    expect(u.host).toBe('accounts.google.com');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:/);
  });
});
