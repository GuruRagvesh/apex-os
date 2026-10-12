import { FolderNotPrivate, verifyFolderChain } from '../../scripts/drive-archive/folder-privacy';
import { permissionProblem } from '../../scripts/drive-archive/drive-vault';
import { verifyDriveVault } from '../../scripts/drive-archive/run-drive-verify';
import { FakeDriveVault } from '../helpers/fake-drive-vault';

// A shared folder would expose every archive later placed in it. These tests
// prove the whole folder chain is checked by the vault health check, and that
// a failure changes nothing and fixes nothing.

const ACCOUNT = 'archive-owner@example.test';
const config = { clientId: 'c', clientSecret: 's', refreshToken: 'r', rootFolderId: 'root-folder-0001', account: ACCOUNT, environment: 'staging' as const };

async function chain(vault: FakeDriveVault, segments = ['deleted-users', '2026']) {
  await vault.ensureFolder('staging', segments);
  return {
    root: vault.rootId,
    env: vault.folderAt('staging')!,
    leaf: vault.folderAt('staging', ...segments)!,
  };
}

describe('permission rules', () => {
  const owner = { type: 'user', role: 'owner', emailAddress: ACCOUNT };
  it.each([
    ['owner only', [owner], null],
    ['owner, different case', [{ ...owner, emailAddress: ACCOUNT.toUpperCase() }], null],
    ['public link', [owner, { type: 'anyone', role: 'reader' }], /publicly or with anyone who has the link/],
    ['domain', [owner, { type: 'domain', role: 'reader', domain: 'example.test' }], /whole domain/],
    ['group', [owner, { type: 'group', role: 'reader', emailAddress: 'team@example.test' }], /group/],
    ['extra user', [owner, { type: 'user', role: 'writer', emailAddress: 'colleague@example.test' }], /another user/],
    ['unexpected owner', [{ ...owner, emailAddress: 'someone-else@example.test' }], /not owned by the archive account/],
    ['no permissions at all', [], /not owned by the archive account/],
  ])('%s', (_l, perms, expected) => {
    const p = permissionProblem(perms as any, ACCOUNT);
    if (expected === null) expect(p).toBeNull();
    else expect(p).toMatch(expected as RegExp);
  });
});

describe('folder chain', () => {
  it('passes when every folder is owner-only, in My Drive and correctly labelled', async () => {
    const vault = new FakeDriveVault({ account: ACCOUNT });
    await chain(vault);
    await expect(verifyFolderChain(vault, 'staging', ['deleted-users', '2026'])).resolves.toBeUndefined();
  });

  it.each([
    ['the root is shared by link', (v: FakeDriveVault, c: any) => v.addPermission(c.root, { type: 'anyone', role: 'reader' }), /Apex OS Secure Archives".*anyone who has the link/],
    ['the environment folder is shared with a domain', (v: FakeDriveVault, c: any) => v.addPermission(c.env, { type: 'domain', role: 'reader', domain: 'example.test' }), /Apex OS Secure Archives\/staging".*whole domain/],
    ['the year folder has an extra user', (v: FakeDriveVault, c: any) => v.addPermission(c.leaf, { type: 'user', role: 'reader', emailAddress: 'x@example.test' }), /deleted-users\/2026".*another user/],
    ['a folder is shared with a group', (v: FakeDriveVault, c: any) => v.addPermission(c.leaf, { type: 'group', role: 'reader', emailAddress: 'g@example.test' }), /group/],
    ['a folder has an unexpected owner', (v: FakeDriveVault, c: any) => v.setOwner(c.env, 'someone-else@example.test'), /not owned by the archive account/],
    ['a folder is in a Shared Drive', (v: FakeDriveVault, c: any) => v.setDriveId(c.leaf, 'shared-drive-1'), /Shared Drive/],
    ['the environment label is wrong', (v: FakeDriveVault, c: any) => v.setLabel(c.env, 'apexArchiveEnvironment', 'production'), /label apexArchiveEnvironment is "production", expected "staging"/],
    ['the root label is missing', (v: FakeDriveVault, c: any) => v.setLabel(c.root, 'apexArchiveRoot', 'false'), /label apexArchiveRoot/],
  ])('fails when %s, and changes no permission', async (_l, mutate, msg) => {
    const vault = new FakeDriveVault({ account: ACCOUNT });
    const c = await chain(vault);
    mutate(vault, c);
    const before = JSON.stringify([...vault.files.values()].map((f) => f.perms));
    const err = await verifyFolderChain(vault, 'staging', ['deleted-users', '2026']).catch((e) => e);
    expect(err).toBeInstanceOf(FolderNotPrivate);
    expect(err.message).toMatch(msg as RegExp);
    // Fail safely: nothing is unshared or otherwise "fixed".
    expect(JSON.stringify([...vault.files.values()].map((f) => f.perms))).toBe(before);
  });

  it('fails when a folder in the chain is missing, and creates nothing', async () => {
    const vault = new FakeDriveVault({ account: ACCOUNT });
    await vault.ensureFolder('staging', ['healthcheck']);
    const count = vault.files.size;
    await expect(verifyFolderChain(vault, 'staging', ['deleted-users', '2026'])).rejects.toThrow(/deleted-users".*does not exist/);
    expect(vault.files.size).toBe(count);
  });

  it('refuses the other environment', async () => {
    const vault = new FakeDriveVault({ account: ACCOUNT });
    await expect(verifyFolderChain(vault, 'production', [])).rejects.toThrow(/not the configured archive environment/);
  });
});

describe('health check', () => {
  it('checks the chain before and after, uses only staging/healthcheck, and never creates deleted-users', async () => {
    const vault = new FakeDriveVault({ account: ACCOUNT });
    const checks = await verifyDriveVault(vault, config);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(checks.map((c) => c.step)).toEqual(['oauth', 'account', 'quota', 'folders', 'folders-private', 'upload', 'download', 'private', 'delete', 'folders-private-after']);
    expect(vault.folderAt('staging', 'healthcheck')).toBeDefined();
    expect(vault.folderAt('staging', 'deleted-users')).toBeUndefined();
    expect(vault.storedFiles()).toHaveLength(0);
  });

  it('reuses the healthcheck folder on repeated runs', async () => {
    const vault = new FakeDriveVault({ account: ACCOUNT });
    await verifyDriveVault(vault, config);
    const folders = vault.files.size;
    await verifyDriveVault(vault, config);
    expect(vault.files.size).toBe(folders);
  });

  it('refuses to upload into a shared healthcheck folder', async () => {
    const vault = new FakeDriveVault({ account: ACCOUNT });
    await vault.ensureFolder('staging', ['healthcheck']);
    vault.addPermission(vault.folderAt('staging', 'healthcheck')!, { type: 'anyone', role: 'reader' });
    const checks = await verifyDriveVault(vault, config);
    expect(checks.find((c) => !c.ok)?.step).toBe('folders-private');
    expect(vault.removed).toEqual([]);
    expect(vault.storedFiles()).toHaveLength(0);
  });

  it('still removes the temporary file when the folder becomes shared mid-check', async () => {
    const vault = new FakeDriveVault({ account: ACCOUNT });
    vault.onUpload = () => vault.addPermission(vault.folderAt('staging')!, { type: 'domain', role: 'reader', domain: 'example.test' });
    const checks = await verifyDriveVault(vault, config);
    expect(checks.find((c) => !c.ok)?.step).toBe('folders-private-after');
    expect(vault.storedFiles()).toHaveLength(0);
  });

  it('still removes the temporary file when a later step fails', async () => {
    const vault = new FakeDriveVault({ account: ACCOUNT, corruptDownload: true });
    const checks = await verifyDriveVault(vault, config);
    expect(checks.find((c) => !c.ok)?.step).toBe('download');
    expect(vault.storedFiles()).toHaveLength(0);
  });
});
