import {
  ensureVerifiedFolderChain,
  FolderNotPrivate,
  inspectArchiveStorage,
  PRIVACY_ISSUES,
  verifyArchiveRoot,
  verifyFolderChain,
} from '../../src/modules/platform/backup-vault/drive-folder-privacy';
import { permissionIssue } from '../../src/modules/platform/backup-vault/drive-vault';
import { verifyDriveVault } from '../../scripts/drive-archive/run-drive-verify';
import { ARCHIVE_PRIVACY_VARIANTS, REMEDIATION_REGISTRY, validateRegistry } from '../../src/common/remediation/remediation.registry';
import { buildRemediation } from '../../src/common/remediation';
import * as contract from '../../../shared/remediation/shared/remediation-contract';
import { FakeDriveVault } from '../helpers/fake-drive-vault';

// The first production archive failed with ARCHIVE_PRIVACY_FAILED because the
// chain check required <root>/production to exist before Archive could create
// it, and every failure collapsed into one generic message. These tests pin
// the corrected behaviour: the root is verified on its own, missing children
// are created only under a verified parent, and every failure carries an exact
// safe category and a path inside the archive tree -- never a Drive id or the
// identity of whoever a folder is shared with.

const ACCOUNT = 'archive-owner@example.test';
const OTHER = 'colleague@example.test';
const prodConfig = { clientId: 'c', clientSecret: 's', refreshToken: 'r', rootFolderId: 'root-folder-0001', account: ACCOUNT, environment: 'production' as const };

const prodVault = () => new FakeDriveVault({ account: ACCOUNT, environment: 'production' });

async function issueOf(p: Promise<unknown>) {
  const err: any = await p.catch((e) => e);
  expect(err).toBeInstanceOf(FolderNotPrivate);
  return err as FolderNotPrivate;
}

/** No Drive id, account or other party may appear in what leaves the process. */
function expectSafe(value: unknown, vault: FakeDriveVault) {
  const text = JSON.stringify(value);
  for (const id of vault.files.keys()) expect(text).not.toContain(id);
  expect(text).not.toContain(OTHER);
  expect(text).not.toContain('example.test');
  expect(text).not.toContain('team@');
}

describe('permission categories', () => {
  const owner = { type: 'user', role: 'owner', emailAddress: ACCOUNT };
  it.each([
    [[owner], null],
    [[owner, { type: 'anyone', role: 'reader' }], 'PUBLIC_LINK'],
    [[owner, { type: 'domain', role: 'reader', domain: 'example.test' }], 'DOMAIN_SHARE'],
    [[owner, { type: 'group', role: 'reader', emailAddress: 'team@example.test' }], 'GROUP_SHARE'],
    [[owner, { type: 'user', role: 'writer', emailAddress: OTHER }], 'EXTRA_USER'],
    [[{ ...owner, emailAddress: OTHER }], 'WRONG_OWNER'],
  ])('%j -> %s', (perms, expected) => {
    expect(permissionIssue(perms as any, ACCOUNT)).toBe(expected);
  });
});

describe('root-only verification', () => {
  it('passes for a private, labelled root even when the environment folder does not exist yet', async () => {
    const vault = prodVault();
    await expect(verifyArchiveRoot(vault, 'production')).resolves.toBe(vault.rootId);
    expect(vault.folderAt('production')).toBeUndefined();
  });

  it.each([
    ['root missing', (v: FakeDriveVault) => v.files.delete(v.rootId), 'ROOT_MISSING_OR_INVALID'],
    ['root trashed', (v: FakeDriveVault) => { v.files.get(v.rootId)!.info.trashed = true; }, 'ROOT_MISSING_OR_INVALID'],
    ['root shared publicly', (v: FakeDriveVault) => v.addPermission(v.rootId, { type: 'anyone', role: 'reader' }), 'PUBLIC_LINK'],
    ['root shared with a domain', (v: FakeDriveVault) => v.addPermission(v.rootId, { type: 'domain', role: 'reader', domain: 'example.test' }), 'DOMAIN_SHARE'],
    ['root shared with a group', (v: FakeDriveVault) => v.addPermission(v.rootId, { type: 'group', role: 'reader', emailAddress: 'team@example.test' }), 'GROUP_SHARE'],
    ['root shared with another user', (v: FakeDriveVault) => v.addPermission(v.rootId, { type: 'user', role: 'writer', emailAddress: OTHER }), 'EXTRA_USER'],
    ['root owned by the wrong account', (v: FakeDriveVault) => v.setOwner(v.rootId, OTHER), 'WRONG_OWNER'],
    ['root in a Shared Drive', (v: FakeDriveVault) => v.setDriveId(v.rootId, 'shared-drive-1'), 'SHARED_DRIVE'],
    ['root has the wrong label', (v: FakeDriveVault) => v.setLabel(v.rootId, 'apexArchiveRoot', 'false'), 'WRONG_LABEL'],
  ])('%s: fails as %s, creates nothing and changes no permission', async (_l, mutate, issue) => {
    const vault = prodVault();
    mutate(vault);
    const before = vault.permissionSnapshot();
    const count = vault.files.size;
    const err = await issueOf(ensureVerifiedFolderChain(vault, 'production', ['archived-users', '2026']));
    expect(err.privacyIssue).toBe(issue);
    expect(err.folderPath).toBe('Apex OS Secure Archives');
    expect(vault.files.size).toBe(count);
    expect(vault.permissionSnapshot()).toBe(before);
    expectSafe(err.safeDetails(), vault);
  });
});

describe('first archive in a new environment', () => {
  it('creates production/archived-users/<year> under a verified root, then the whole chain verifies', async () => {
    const vault = prodVault();
    // The exact production failure: the old order checked <root>/production before creating it.
    const old = await issueOf(verifyFolderChain(vault, 'production', []));
    expect(old.privacyIssue).toBe('ENVIRONMENT_FOLDER_MISSING');

    const leaf = await ensureVerifiedFolderChain(vault, 'production', ['archived-users', '2026']);
    expect(leaf).toBe(vault.folderAt('production', 'archived-users', '2026'));
    await expect(verifyFolderChain(vault, 'production', ['archived-users', '2026'])).resolves.toBeUndefined();
    // Reuses on the next run.
    const size = vault.files.size;
    await ensureVerifiedFolderChain(vault, 'production', ['archived-users', '2026']);
    expect(vault.files.size).toBe(size);
  });

  it('refuses a duplicate production folder without choosing one, and creates nothing under it', async () => {
    const vault = prodVault();
    vault.addFolder(vault.rootId, 'production', { apexArchiveEnvironment: 'production' });
    vault.addFolder(vault.rootId, 'production', { apexArchiveEnvironment: 'production' });
    const count = vault.files.size;
    const err = await issueOf(ensureVerifiedFolderChain(vault, 'production', ['archived-users', '2026']));
    expect(err.safeDetails()).toEqual({ folderPath: 'Apex OS Secure Archives/production', privacyIssue: 'DUPLICATE_FOLDER' });
    expect(vault.files.size).toBe(count);
  });

  it('refuses an environment folder labelled for another environment', async () => {
    const vault = prodVault();
    vault.addFolder(vault.rootId, 'production', { apexArchiveEnvironment: 'staging' });
    const err = await issueOf(ensureVerifiedFolderChain(vault, 'production', ['archived-users', '2026']));
    expect(err.safeDetails()).toEqual({ folderPath: 'Apex OS Secure Archives/production', privacyIssue: 'WRONG_LABEL' });
    expect(vault.folderAt('production', 'archived-users')).toBeUndefined();
  });

  it('names the exact year folder that is shared, without naming who it is shared with', async () => {
    const vault = prodVault();
    await vault.ensureFolder('production', ['archived-users', '2026']);
    vault.addPermission(vault.folderAt('production', 'archived-users', '2026')!, { type: 'user', role: 'reader', emailAddress: OTHER });
    const err = await issueOf(ensureVerifiedFolderChain(vault, 'production', ['archived-users', '2026']));
    expect(err.safeDetails()).toEqual({ folderPath: 'Apex OS Secure Archives/production/archived-users/2026', privacyIssue: 'EXTRA_USER' });
    expectSafe(err.safeDetails(), vault);
    expect(err.message).not.toContain(OTHER);
  });
});

describe('read-only storage inspection (Retry Verification)', () => {
  it('reports ready when only the not-yet-created folders are missing, and creates nothing', async () => {
    const vault = prodVault();
    const count = vault.files.size;
    await expect(inspectArchiveStorage(vault, 'production', ['archived-users', '2026'])).resolves.toEqual({ missingFrom: 'Apex OS Secure Archives/production' });
    expect(vault.files.size).toBe(count);
  });

  it('still fails on sharing in an existing folder, and changes no permission', async () => {
    const vault = prodVault();
    await vault.ensureFolder('production', ['archived-users']);
    vault.addPermission(vault.folderAt('production')!, { type: 'anyone', role: 'reader' });
    const before = vault.permissionSnapshot();
    const err = await issueOf(inspectArchiveStorage(vault, 'production', ['archived-users', '2026']));
    expect(err.privacyIssue).toBe('PUBLIC_LINK');
    expect(vault.permissionSnapshot()).toBe(before);
  });
});

describe('admin:drive:verify', () => {
  it('works on a first run in a new environment and creates only <environment>/healthcheck', async () => {
    const vault = prodVault();
    const before = vault.permissionSnapshot();
    const checks = await verifyDriveVault(vault, prodConfig);
    expect(checks.map((c) => [c.step, c.ok])).toEqual([
      ['oauth', true], ['account', true], ['quota', true], ['root-private', true], ['folders', true], ['folders-private', true],
      ['upload', true], ['download', true], ['private', true], ['delete', true], ['folders-private-after', true],
    ]);
    expect(vault.folderAt('production', 'healthcheck')).toBeDefined();
    expect(vault.folderAt('production', 'archived-users')).toBeUndefined();
    expect(vault.storedFiles()).toHaveLength(0);
    // Existing permissions untouched (new folders get only the owner).
    for (const [id, perms] of JSON.parse(before)) expect(vault.files.get(id)!.perms).toEqual(perms);
  });

  it('stops at root-private before creating anything when the root is shared', async () => {
    const vault = prodVault();
    vault.addPermission(vault.rootId, { type: 'domain', role: 'reader', domain: 'example.test' });
    const count = vault.files.size;
    const checks = await verifyDriveVault(vault, prodConfig);
    expect(checks.find((c) => !c.ok)?.step).toBe('root-private');
    expect(vault.files.size).toBe(count);
  });
});

describe('ARCHIVE_PRIVACY_FAILED remediation', () => {
  it('has corrective copy for every privacy category', () => {
    for (const issue of PRIVACY_ISSUES) expect([issue, !!ARCHIVE_PRIVACY_VARIANTS[issue]]).toEqual([issue, true]);
    expect(validateRegistry()).toEqual([]);
  });

  it('carries only folderPath and privacyIssue, with the matching correction', () => {
    const r = buildRemediation('ARCHIVE_PRIVACY_FAILED', {
      affectedUserId: 'u1',
      operationId: 'op1',
      details: { folderPath: 'Apex OS Secure Archives/production/archived-users/2026', privacyIssue: 'EXTRA_USER', driveFolderId: 'abc', emailAddress: OTHER, providerFileId: 'f' },
    });
    expect(r.details).toEqual({ folderPath: 'Apex OS Secure Archives/production/archived-users/2026', privacyIssue: 'EXTRA_USER' });
    expect(r.correctionSteps.join(' ')).toMatch(/Manage access/);
    expect(r.correctionSteps.join(' ')).toMatch(/keeping only the configured archive account as owner/);
    expect(r.retryEndpoint).toBe('ARCHIVE_STORAGE_VERIFY');
    expect(JSON.stringify(r)).not.toContain(OTHER);
  });

  it.each([
    ['ENVIRONMENT_FOLDER_MISSING', /has not been initialized/, /archive storage verification/],
    ['WRONG_OWNER', /not owned by the configured archive account/, /Do not transfer ownership or remove access automatically/],
    ['SHARED_DRIVE', /Shared Drive/, /private My Drive folder owned by the archive account/],
    ['DUPLICATE_FOLDER', /more than one archive folder/, /Do not guess between duplicate folders/],
    ['WRONG_LABEL', /not labelled for this environment/, /backend operations/i],
    ['PUBLIC_LINK', /publicly or with anyone who has the link/, /Manage access/],
    ['DOMAIN_SHARE', /whole domain/, /Manage access/],
    ['GROUP_SHARE', /with a group/, /Manage access/],
    ['UPLOADED_FILE_NOT_PRIVATE', /file uploaded/, /keeping only the archive account as owner/],
  ])('%s shows its own problem and correction', (issue, problem, step) => {
    const r = buildRemediation('ARCHIVE_PRIVACY_FAILED', { details: { folderPath: 'Apex OS Secure Archives/production', privacyIssue: issue } });
    expect(r.problem).toMatch(problem);
    expect(r.correctionSteps.join(' ')).toMatch(step);
  });

  it('an unknown category falls back to the generic copy', () => {
    const r = buildRemediation('ARCHIVE_PRIVACY_FAILED', { details: { privacyIssue: 'SOMETHING_ELSE' } });
    expect(r.problem).toBe(REMEDIATION_REGISTRY.ARCHIVE_PRIVACY_FAILED.problem);
  });

  it('the storage-ready result tells the person to confirm Archive again and claims nothing else', () => {
    const r = buildRemediation('ARCHIVE_STORAGE_READY');
    expect(r.problem).toBe('Archive storage is ready. Close this message and confirm Archive again.');
    expect(r.severity).toBe('INFO');
    expect(r.actions.map((a) => a.id)).toEqual(['COPY_DIAGNOSTIC']);
    expect(JSON.stringify(r)).not.toMatch(/archived successfully|has been archived/i);
  });

  it('the dialog may display the two safe keys and nothing else for this code', () => {
    expect(contract.DISPLAYABLE_DETAIL_KEYS.ARCHIVE_PRIVACY_FAILED).toEqual(['folderPath', 'privacyIssue']);
    expect(REMEDIATION_REGISTRY.ARCHIVE_PRIVACY_FAILED.detailKeys).toEqual(['folderPath', 'privacyIssue']);
  });
});
