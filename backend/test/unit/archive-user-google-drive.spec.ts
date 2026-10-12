import { createHash } from 'crypto';
import { FakeDriveVault, type FakeDriveOptions } from '../helpers/fake-drive-vault';

// "Archive user" stores the user's backup in the private Google Drive archive
// vault, never in R2, and only after proving the file is there, private and
// byte-identical. Every refusal leaves the account unchanged. Nothing here
// contacts Google: the vault is an in-memory fake.

const { BackupVaultService } = require('../../src/modules/platform/backup-vault/backup-vault.service');
const driveModule = require('../../src/modules/platform/backup-vault/drive-vault');

const ACCOUNT = 'archive-owner@example.test';
const DRIVE_ENV = (environment: string) => ({
  APP_ENV: environment,
  GOOGLE_DRIVE_CLIENT_ID: 'cid.apps.example.test',
  GOOGLE_DRIVE_CLIENT_SECRET: 'csecret-value',
  GOOGLE_DRIVE_REFRESH_TOKEN: 'rtoken-value',
  GOOGLE_DRIVE_ARCHIVE_ROOT_FOLDER_ID: 'root-folder-0001',
  GOOGLE_DRIVE_ARCHIVE_ACCOUNT: ACCOUNT,
  GOOGLE_DRIVE_ARCHIVE_ENVIRONMENT: environment,
});
const NOW = new Date('2026-10-12T12:00:00Z');
const FILE = 'archived-user-u-1-2026-10-12T12-00-00-000Z.xlsx';
const buffer = Buffer.from('PK\u0003\u0004 a spreadsheet archive of one employee, long enough to corrupt');
const sha = createHash('sha256').update(buffer).digest('hex');

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
  jest.restoreAllMocks();
});

/** A fake Drive where admin:drive:verify has already created <root>/<environment>. */
async function preparedDrive(environment = 'staging', opts: FakeDriveOptions = {}) {
  const drive = new FakeDriveVault({ account: ACCOUNT, environment, ...opts });
  await drive.ensureFolder(environment, []);
  return drive;
}

function service(drive: FakeDriveVault, environment = 'staging', env: Record<string, string> = {}) {
  Object.assign(process.env, DRIVE_ENV(environment), env);
  const create = jest.spyOn(driveModule, 'createDriveVault').mockReturnValue(drive);
  return { svc: new BackupVaultService(), create };
}

describe('Archive user stores the backup in Google Drive', () => {
  it('writes to <root>/staging/archived-users/<year>, then proves it by reading it back', async () => {
    const drive = await preparedDrive();
    const { svc } = service(drive);

    const result = await svc.archiveUserToDrive(FILE, buffer, NOW);

    expect(result).toEqual(expect.objectContaining({
      provider: 'google-drive',
      environment: 'staging',
      folderPath: 'Apex OS Secure Archives/staging/archived-users/2026',
      fileName: FILE,
      sizeBytes: buffer.length,
      sha256: sha,
    }));
    const stored = drive.storedFiles();
    expect(stored).toHaveLength(1);
    expect(stored[0].bytes.equals(buffer)).toBe(true);
    expect(stored[0].info.parents).toEqual([drive.folderAt('staging', 'archived-users', '2026')]);
    expect(stored[0].info.appProperties).toEqual({ apexArchiveKind: 'archived-user', apexArchiveEnvironment: 'staging', sha256: sha });
    expect(drive.removed).toEqual([]);
  });

  it('production uses the same Google keys but only its own folder', async () => {
    const drive = await preparedDrive('production');
    await drive.ensureFolder('staging', []);
    const { svc } = service(drive, 'production');

    const result = await svc.archiveUserToDrive(FILE, buffer, NOW);

    expect(result.folderPath).toBe('Apex OS Secure Archives/production/archived-users/2026');
    expect(drive.folderAt('production', 'archived-users', '2026')).toBeDefined();
    expect(drive.folderAt('staging', 'archived-users')).toBeUndefined();
  });

  it('never returns or logs a credential', async () => {
    const drive = await preparedDrive();
    const { svc } = service(drive);
    const logs: string[] = [];
    jest.spyOn((svc as any).logger, 'log').mockImplementation((m: any) => void logs.push(String(m)));

    const result = await svc.archiveUserToDrive(FILE, buffer, NOW);

    const out = JSON.stringify(result) + logs.join('\n');
    for (const secret of ['csecret-value', 'rtoken-value', 'cid.apps.example.test']) expect(out).not.toContain(secret);
  });
});

describe('Archive user refuses, and changes nothing, when Drive is not provably safe', () => {
  const expectRefusal = async (svc: any, drive: FakeDriveVault | null, message: RegExp) => {
    await expect(svc.archiveUserToDrive(FILE, buffer, NOW)).rejects.toThrow(message);
    await expect(svc.archiveUserToDrive(FILE, buffer, NOW)).rejects.toThrow(/account has not been changed/);
  };

  it.each([
    ['APP_ENV is unset', ''],
    ['APP_ENV is development', 'development'],
  ])('refuses when %s, before contacting Drive', async (_l, appEnv) => {
    const drive = await preparedDrive();
    const { svc, create } = service(drive, 'staging', { APP_ENV: appEnv });
    await expectRefusal(svc, drive, /only from staging or production/);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses when Drive is not configured, naming only the missing variables', async () => {
    const drive = await preparedDrive();
    const { svc, create } = service(drive, 'staging', { GOOGLE_DRIVE_REFRESH_TOKEN: '', GOOGLE_DRIVE_ARCHIVE_ROOT_FOLDER_ID: '' });
    await expectRefusal(svc, drive, /not ready.*Missing: GOOGLE_DRIVE_REFRESH_TOKEN, GOOGLE_DRIVE_ARCHIVE_ROOT_FOLDER_ID/);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses when the Drive keys are declared for the other environment', async () => {
    const drive = await preparedDrive();
    const { svc, create } = service(drive, 'staging', { GOOGLE_DRIVE_ARCHIVE_ENVIRONMENT: 'production' });
    await expectRefusal(svc, drive, /GOOGLE_DRIVE_ARCHIVE_ENVIRONMENT is "production" but this run is for "staging"/);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses when Google is signed in as another account', async () => {
    const drive = new FakeDriveVault({ account: 'someone-else@example.test' });
    await drive.ensureFolder('staging', []);
    const { svc } = service(drive);
    await expectRefusal(svc, drive, /different account from GOOGLE_DRIVE_ARCHIVE_ACCOUNT/);
    expect(drive.storedFiles()).toEqual([]);
  });

  it.each([
    ['the root is shared by link', (d: FakeDriveVault) => d.addPermission(d.rootId, { type: 'anyone', role: 'reader' }), /Apex OS Secure Archives".*anyone who has the link/],
    ['the environment folder is shared with a domain', (d: FakeDriveVault) => d.addPermission(d.folderAt('staging')!, { type: 'domain', role: 'reader', domain: 'example.test' }), /Apex OS Secure Archives\/staging".*whole domain/],
    ['the environment folder is labelled production', (d: FakeDriveVault) => d.setLabel(d.folderAt('staging')!, 'apexArchiveEnvironment', 'production'), /apexArchiveEnvironment/],
    ['the environment folder is in a Shared Drive', (d: FakeDriveVault) => d.setDriveId(d.folderAt('staging')!, 'shared-drive-1'), /Shared Drive/],
    ['the environment folder does not exist yet', (d: FakeDriveVault) => d.files.delete(d.folderAt('staging')!), /does not exist/],
  ])('refuses when %s, uploads nothing and fixes nothing', async (_l, mutate, message) => {
    const drive = await preparedDrive();
    mutate(drive);
    const { svc } = service(drive);
    const permsBefore = JSON.stringify([...drive.files.values()].map((f) => f.perms));
    await expectRefusal(svc, drive, message as RegExp);
    expect(drive.storedFiles()).toEqual([]);
    expect(JSON.stringify([...drive.files.values()].map((f) => f.perms))).toBe(permsBefore);
  });

  it('refuses when the new year folder turns out to be shared', async () => {
    const drive = await preparedDrive();
    await drive.ensureFolder('staging', ['archived-users', '2026']);
    drive.addPermission(drive.folderAt('staging', 'archived-users', '2026')!, { type: 'user', role: 'reader', emailAddress: 'colleague@example.test' });
    const { svc } = service(drive);
    await expectRefusal(svc, drive, /archived-users\/2026/);
    expect(drive.storedFiles()).toEqual([]);
  });

  it.each([
    ['the upload fails', { failUpload: true }, /could not be uploaded/],
    ['Drive reports a different size', { wrongSize: true }, /bytes but \d+ were sent/],
    ['the uploaded file is shared publicly', { sharePublicly: true }, /shared beyond the archive account/],
    ['the downloaded bytes differ', { corruptDownload: true }, /does not match what was sent/],
  ])('refuses when %s', async (_l, opts, message) => {
    const drive = await preparedDrive('staging', opts as FakeDriveOptions);
    const { svc } = service(drive);
    await expectRefusal(svc, drive, message as RegExp);
  });

  it('refuses a file name that could escape its folder', async () => {
    const drive = await preparedDrive();
    const { svc } = service(drive);
    await expect(svc.archiveUserToDrive('../x.xlsx', buffer, NOW)).rejects.toThrow(/file name is not valid/);
    expect(drive.storedFiles()).toEqual([]);
  });
});

describe('the user archive file name carries no personal data', () => {
  it('is built from the user id and time only', () => {
    const src: string = require('fs').readFileSync(require('path').resolve(__dirname, '../../src/modules/core/users/users.service.ts'), 'utf8');
    const line = src.split('\n').find((l) => l.includes('const archiveFileName'))!;
    expect(line).toContain('archived-user-${userId}-');
    expect(line).not.toMatch(/email|name\b|user\.name/);
  });
});
