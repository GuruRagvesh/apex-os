/**
 * Every folder an archive passes through must be private, not just the file.
 *
 * A folder shared after it was created would expose every archive later
 * placed in it, so the whole chain is checked, read-only, at each point where
 * it matters:
 *
 *   Apex OS Secure Archives / <environment> / <segments...>
 *
 * A folder passes only when:
 *   - it exists, is a folder, and is not trashed;
 *   - it lives in My Drive, not a Shared Drive;
 *   - its only permission is the archive account, as owner (no "anyone",
 *     link, domain, group or extra user entry);
 *   - its label is right: the root carries apexArchiveRoot=true, every other
 *     folder apexArchiveEnvironment=<environment>.
 *
 * The root is checked on its own first (verifyArchiveRoot), so a first archive
 * in a new environment can create <environment>/archived-users/<year> under a
 * root that is already proven private (ensureVerifiedFolderChain). A missing
 * child folder is never a privacy failure until something requires it to exist.
 *
 * Nothing is fixed automatically. Sharing is never removed by this tool: a
 * failure stops the operation and names the folder by its path inside the
 * archive tree plus a fixed category (no Drive ids, no identity of whoever the
 * folder is shared with, no credentials).
 */

import { DRIVE_ROOT_NAME, permissionIssue, permissionProblem, type ArchiveVault } from './drive-vault';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Why a folder or uploaded file failed, as a fixed category that is safe to store and show. */
export const PRIVACY_ISSUES = [
  'ROOT_MISSING_OR_INVALID',
  'ENVIRONMENT_FOLDER_MISSING',
  'FOLDER_MISSING',
  'DUPLICATE_FOLDER',
  'WRONG_LABEL',
  'TRASHED_OR_NOT_FOLDER',
  'SHARED_DRIVE',
  'PUBLIC_LINK',
  'DOMAIN_SHARE',
  'GROUP_SHARE',
  'EXTRA_USER',
  'WRONG_OWNER',
  'UPLOADED_FILE_NOT_PRIVATE',
] as const;
export type PrivacyIssue = (typeof PRIVACY_ISSUES)[number];

/** Issues that mean "not there (yet)" rather than "exposed". */
export const MISSING_FOLDER_ISSUES: readonly PrivacyIssue[] = ['ENVIRONMENT_FOLDER_MISSING', 'FOLDER_MISSING'];

export class FolderNotPrivate extends Error {
  constructor(readonly folderPath: string, readonly reason: string, readonly privacyIssue: PrivacyIssue) {
    super(`Archive folder "${folderPath}" failed the privacy check: ${reason}. Nothing was changed; fix the folder in Google Drive and run again.`);
    this.name = 'FolderNotPrivate';
  }

  /** The only failure details that may leave the process: a path inside the archive tree and a category. */
  safeDetails(): { folderPath: string; privacyIssue: PrivacyIssue } {
    return { folderPath: this.folderPath, privacyIssue: this.privacyIssue };
  }
}

type FolderInfo = { trashed: boolean; mimeType: string; driveId: string | null; appProperties: Record<string, string> };

function configured(vault: ArchiveVault, environment: string) {
  const { account, environment: env, rootFolderId } = vault.identity();
  if (environment !== env) throw new FolderNotPrivate(`${DRIVE_ROOT_NAME}/${environment}`, 'it is not the configured archive environment', 'WRONG_LABEL');
  if (!rootFolderId) throw new FolderNotPrivate(DRIVE_ROOT_NAME, 'GOOGLE_DRIVE_ARCHIVE_ROOT_FOLDER_ID is not set', 'ROOT_MISSING_OR_INVALID');
  return { account, rootFolderId };
}

/**
 * Checks only the configured root: it exists, is a folder, is not trashed, is
 * in My Drive, carries apexArchiveRoot=true and is owner-only. Does not need
 * the environment folder to exist. Creates nothing. Returns the root id.
 */
export async function verifyArchiveRoot(vault: ArchiveVault, environment: string): Promise<string> {
  const { account, rootFolderId } = configured(vault, environment);
  const root = await vault.stat(rootFolderId);
  if (!root || root.trashed || root.mimeType !== FOLDER_MIME) {
    throw new FolderNotPrivate(DRIVE_ROOT_NAME, 'it does not exist, is trashed, or is not a folder', 'ROOT_MISSING_OR_INVALID');
  }
  await checkOne(vault, root.fileId, root, DRIVE_ROOT_NAME, account, { apexArchiveRoot: 'true' });
  return root.fileId;
}

/** Checks <root>/<environment>/<segments...>. Throws FolderNotPrivate on the first failure. Creates nothing. */
export async function verifyFolderChain(vault: ArchiveVault, environment: string, segments: string[]): Promise<void> {
  const { account } = configured(vault, environment);
  let parent = await verifyArchiveRoot(vault, environment);
  let path = DRIVE_ROOT_NAME;
  const names = [environment, ...segments];
  for (let i = 0; i < names.length; i++) {
    path = `${path}/${names[i]}`;
    const found = await vault.findChildFolders(parent, names[i]);
    if (found.length === 0) throw missing(path, i);
    if (found.length > 1) throw duplicate(path);
    await checkOne(vault, found[0].fileId, found[0], path, account, { apexArchiveEnvironment: environment });
    parent = found[0].fileId;
  }
}

/**
 * Creates or reuses <root>/<environment>/<segments...>, verifying each folder
 * before anything is created inside it. The root must already pass
 * verifyArchiveRoot; nothing is ever created under a root or folder that is
 * shared, duplicated, mislabelled or in a Shared Drive. Returns the leaf id.
 */
export async function ensureVerifiedFolderChain(vault: ArchiveVault, environment: string, segments: string[]): Promise<string> {
  const { account } = configured(vault, environment);
  let parent = await verifyArchiveRoot(vault, environment);
  let path = DRIVE_ROOT_NAME;
  const names = [environment, ...segments];
  for (let i = 0; i < names.length; i++) {
    path = `${path}/${names[i]}`;
    let found = await vault.findChildFolders(parent, names[i]);
    if (found.length === 0) {
      // The parent was verified just above, so this folder is created inside a private chain.
      await vault.ensureFolder(environment, names.slice(1, i + 1));
      found = await vault.findChildFolders(parent, names[i]);
      if (found.length === 0) throw missing(path, i);
    }
    if (found.length > 1) throw duplicate(path);
    await checkOne(vault, found[0].fileId, found[0], path, account, { apexArchiveEnvironment: environment });
    parent = found[0].fileId;
  }
  return parent;
}

/**
 * Read-only readiness for archive storage: the root, then each folder of
 * <environment>/<segments...> that already exists. A folder that does not
 * exist yet is not a failure here, because Archive creates it under a parent
 * this check just proved private. Creates nothing; changes nothing.
 */
export async function inspectArchiveStorage(vault: ArchiveVault, environment: string, segments: string[]): Promise<{ missingFrom: string | null }> {
  const { account } = configured(vault, environment);
  let parent = await verifyArchiveRoot(vault, environment);
  let path = DRIVE_ROOT_NAME;
  for (const name of [environment, ...segments]) {
    path = `${path}/${name}`;
    const found = await vault.findChildFolders(parent, name);
    if (found.length === 0) return { missingFrom: path };
    if (found.length > 1) throw duplicate(path);
    await checkOne(vault, found[0].fileId, found[0], path, account, { apexArchiveEnvironment: environment });
    parent = found[0].fileId;
  }
  return { missingFrom: null };
}

function missing(path: string, index: number) {
  return new FolderNotPrivate(path, 'it does not exist', index === 0 ? 'ENVIRONMENT_FOLDER_MISSING' : 'FOLDER_MISSING');
}

function duplicate(path: string) {
  return new FolderNotPrivate(path, 'there is more than one folder with this name', 'DUPLICATE_FOLDER');
}

async function checkOne(vault: ArchiveVault, id: string, info: FolderInfo, path: string, account: string, labels: Record<string, string>) {
  if (info.trashed || info.mimeType !== FOLDER_MIME) throw new FolderNotPrivate(path, 'it is trashed or not a folder', 'TRASHED_OR_NOT_FOLDER');
  if (info.driveId) throw new FolderNotPrivate(path, 'it is in a Shared Drive, not the archive account\'s My Drive', 'SHARED_DRIVE');
  for (const [k, v] of Object.entries(labels)) {
    if (info.appProperties[k] !== v) throw new FolderNotPrivate(path, `its label ${k} is "${info.appProperties[k] ?? '(none)'}", expected "${v}"`, 'WRONG_LABEL');
  }
  const perms = await vault.permissions(id);
  const issue = permissionIssue(perms, account);
  if (issue) throw new FolderNotPrivate(path, permissionProblem(perms, account)!, issue);
}
