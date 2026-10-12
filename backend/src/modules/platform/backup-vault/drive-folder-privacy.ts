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
 * Nothing is fixed automatically. Sharing is never removed by this tool: a
 * failure stops the operation and names the folder by its path inside the
 * archive tree (no ids of people, no credentials).
 */

import { permissionProblem, type ArchiveVault } from './drive-vault';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

export class FolderNotPrivate extends Error {
  constructor(readonly folderPath: string, readonly reason: string) {
    super(`Archive folder "${folderPath}" failed the privacy check: ${reason}. Nothing was changed; fix the folder in Google Drive and run again.`);
    this.name = 'FolderNotPrivate';
  }
}

/** Checks <root>/<environment>/<segments...>. Throws FolderNotPrivate on the first failure. Creates nothing. */
export async function verifyFolderChain(vault: ArchiveVault, environment: string, segments: string[]): Promise<void> {
  const { account, environment: configured, rootFolderId } = vault.identity();
  if (environment !== configured) throw new FolderNotPrivate(environment, 'it is not the configured archive environment');
  if (!rootFolderId) throw new FolderNotPrivate('(root)', 'GOOGLE_DRIVE_ARCHIVE_ROOT_FOLDER_ID is not set');

  const rootPath = 'Apex OS Secure Archives';
  const root = await vault.stat(rootFolderId);
  if (!root || root.trashed || root.mimeType !== FOLDER_MIME) throw new FolderNotPrivate(rootPath, 'it does not exist or is not a folder');
  await checkOne(vault, root.fileId, root, rootPath, account, { apexArchiveRoot: 'true' });

  let parent = root.fileId;
  let path = rootPath;
  for (const name of [environment, ...segments]) {
    path = `${path}/${name}`;
    const found = await vault.findChildFolders(parent, name);
    if (found.length === 0) throw new FolderNotPrivate(path, 'it does not exist');
    if (found.length > 1) throw new FolderNotPrivate(path, 'there is more than one folder with this name');
    await checkOne(vault, found[0].fileId, found[0], path, account, { apexArchiveEnvironment: environment });
    parent = found[0].fileId;
  }
}

async function checkOne(
  vault: ArchiveVault,
  id: string,
  info: { trashed: boolean; mimeType: string; driveId: string | null; appProperties: Record<string, string> },
  path: string,
  account: string,
  labels: Record<string, string>,
) {
  if (info.trashed || info.mimeType !== FOLDER_MIME) throw new FolderNotPrivate(path, 'it is trashed or not a folder');
  if (info.driveId) throw new FolderNotPrivate(path, 'it is in a Shared Drive, not the archive account\'s My Drive');
  for (const [k, v] of Object.entries(labels)) {
    if (info.appProperties[k] !== v) throw new FolderNotPrivate(path, `its label ${k} is "${info.appProperties[k] ?? '(none)'}", expected "${v}"`);
  }
  const problem = permissionProblem(await vault.permissions(id), account);
  if (problem) throw new FolderNotPrivate(path, problem);
}
