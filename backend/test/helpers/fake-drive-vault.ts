/**
 * An in-memory stand-in for the Google Drive archive vault. Nothing leaves the
 * process. Each failure a real Drive could produce can be switched on, so the
 * tests can prove the purge refuses to delete when the archive is not provably
 * stored and private.
 */

import { readFileSync, writeFileSync } from 'fs';
import { permissionProblem, type ArchiveVault, type DriveFileInfo, type DrivePermission } from '../../src/modules/platform/backup-vault/drive-vault';

export interface FakeDriveOptions {
  account?: string;
  environment?: string;
  freeBytes?: number | null;
  /** Download returns bytes with one bit flipped. */
  corruptDownload?: boolean;
  /** Drive reports a different size than was uploaded. */
  wrongSize?: boolean;
  /** Uploaded files get an extra "anyone with the link" permission. */
  sharePublicly?: boolean;
  /** upload() throws. */
  failUpload?: boolean;
  /** remove() throws. */
  failRemove?: boolean;
}

const FOLDER = 'application/vnd.google-apps.folder';

interface Item {
  info: DriveFileInfo;
  bytes: Buffer;
  perms: DrivePermission[];
}

export class FakeDriveVault implements ArchiveVault {
  readonly provider = 'google-drive' as const;
  readonly files = new Map<string, Item>();
  readonly removed: string[] = [];
  /** Called after each upload; tests use it to change things mid-flow. */
  onUpload?: (fileId: string) => void;
  private seq = 0;
  readonly account_: string;
  readonly environment_: string;

  constructor(readonly opts: FakeDriveOptions = {}, readonly rootId = 'root-folder-0001') {
    this.account_ = (opts.account ?? 'archive-owner@example.test').toLowerCase();
    this.environment_ = opts.environment ?? 'staging';
    this.files.set(rootId, {
      info: { fileId: rootId, name: 'Apex OS Secure Archives', size: null, mimeType: FOLDER, trashed: false, parents: ['root'], appProperties: { apexArchiveRoot: 'true' }, driveId: null },
      bytes: Buffer.alloc(0),
      perms: [this.owner()],
    });
  }

  private owner(): DrivePermission {
    return { type: 'user', role: 'owner', emailAddress: this.account_ };
  }

  identity() {
    return { account: this.account_, environment: this.environment_, rootFolderId: this.rootId };
  }

  /** Stored, non-folder files (what a person would see as archives). */
  storedFiles() {
    return [...this.files.values()].filter((f) => f.info.mimeType !== FOLDER);
  }

  /** The id of the folder at <root>/<names...>, or undefined. */
  folderAt(...names: string[]): string | undefined {
    let parent = this.rootId;
    for (const n of names) {
      const f = [...this.files.values()].find((x) => x.info.parents.includes(parent) && x.info.name === n && x.info.mimeType === FOLDER);
      if (!f) return undefined;
      parent = f.info.fileId;
    }
    return parent;
  }

  /** Test helpers: change sharing, ownership, location or labels on any item. */
  addPermission(id: string, p: DrivePermission) {
    this.files.get(id)!.perms.push(p);
  }
  setOwner(id: string, email: string) {
    this.files.get(id)!.perms = [{ type: 'user', role: 'owner', emailAddress: email }];
  }
  setDriveId(id: string, driveId: string) {
    this.files.get(id)!.info.driveId = driveId;
  }
  setLabel(id: string, key: string, value: string) {
    this.files.get(id)!.info.appProperties[key] = value;
  }
  /** A folder created behind the tool's back (for example a duplicate made by hand). */
  addFolder(parentId: string, name: string, appProperties: Record<string, string>) {
    const id = `folder-${++this.seq}`;
    this.files.set(id, {
      info: { fileId: id, name, size: null, mimeType: FOLDER, trashed: false, parents: [parentId], appProperties, driveId: null },
      bytes: Buffer.alloc(0),
      perms: [this.owner()],
    });
    return id;
  }
  /** Every permission list, for "nothing was changed" assertions. */
  permissionSnapshot() {
    return JSON.stringify([...this.files.entries()].map(([id, f]) => [id, f.perms]));
  }

  async account() {
    return { email: this.account_, freeBytes: this.opts.freeBytes === undefined ? 10 * 1024 ** 3 : this.opts.freeBytes };
  }

  async stat(fileId: string) {
    const f = this.files.get(fileId);
    if (!f) return null;
    return { ...f.info, size: f.info.size === null ? null : this.opts.wrongSize ? f.info.size + 1 : f.info.size };
  }

  async findChildFolders(parentId: string, name: string) {
    return [...this.files.values()]
      .filter((f) => f.info.parents.includes(parentId) && f.info.name === name && f.info.mimeType === FOLDER && !f.info.trashed)
      .map((f) => ({ ...f.info }));
  }

  async permissions(fileId: string) {
    return [...(this.files.get(fileId)?.perms ?? [])];
  }

  async ensureFolder(environment: string, segments: string[]) {
    let parent = this.rootId;
    for (const name of [environment, ...segments]) {
      const existing = [...this.files.values()].find((f) => f.info.parents.includes(parent) && f.info.name === name && f.info.mimeType === FOLDER);
      if (existing) {
        if (existing.info.appProperties.apexArchiveEnvironment !== environment) {
          throw new Error(`folder "${name}" is labelled for ${existing.info.appProperties.apexArchiveEnvironment}`);
        }
        parent = existing.info.fileId;
        continue;
      }
      const id = `folder-${++this.seq}`;
      this.files.set(id, {
        info: { fileId: id, name, size: null, mimeType: FOLDER, trashed: false, parents: [parent], appProperties: { apexArchiveEnvironment: environment }, driveId: null },
        bytes: Buffer.alloc(0),
        perms: [this.owner()],
      });
      parent = id;
    }
    return parent;
  }

  async upload(folderId: string, name: string, localPath: string, appProperties: Record<string, string>) {
    if (this.opts.failUpload) throw new Error('simulated upload failure');
    const bytes = readFileSync(localPath);
    const id = `file-${++this.seq}`;
    const perms = [this.owner()];
    if (this.opts.sharePublicly) perms.push({ type: 'anyone', role: 'reader' });
    this.files.set(id, {
      info: { fileId: id, name, size: bytes.length, mimeType: 'application/octet-stream', trashed: false, parents: [folderId], appProperties, driveId: null },
      bytes,
      perms,
    });
    this.onUpload?.(id);
    return { fileId: id, size: bytes.length };
  }

  async download(fileId: string, destination: string) {
    const f = this.files.get(fileId);
    if (!f) throw new Error('404');
    const out = Buffer.from(f.bytes);
    if (this.opts.corruptDownload && out.length > 40) out[out.length - 20] ^= 1;
    writeFileSync(destination, out);
  }

  async isPrivate(fileId: string) {
    return permissionProblem(await this.permissions(fileId), this.account_) === null;
  }

  /** Like Drive: deleting a folder deletes everything inside it. */
  async remove(fileId: string) {
    if (this.opts.failRemove) throw new Error('simulated delete failure');
    const doomed = [fileId];
    for (let i = 0; i < doomed.length; i++) {
      for (const f of this.files.values()) if (f.info.parents.includes(doomed[i])) doomed.push(f.info.fileId);
    }
    for (const id of doomed) {
      this.files.delete(id);
      this.removed.push(id);
    }
  }

  async setAppProperties(fileId: string, appProperties: Record<string, string>) {
    const f = this.files.get(fileId);
    if (!f) throw new Error('404');
    f.info.appProperties = { ...f.info.appProperties, ...appProperties };
  }

  async createRoot() {
    return this.rootId;
  }
}
