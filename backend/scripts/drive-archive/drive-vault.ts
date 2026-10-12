/**
 * The deleted-user archive vault: a private Google Drive, reached with OAuth
 * 2.0 offline access on behalf of one named account, scope `drive.file`.
 *
 * Cloudflare R2 is NOT used for deleted-user archives. (The full database
 * backup that permanent deletion also requires lives in R2; that is a separate
 * vault with separate credentials.)
 *
 * `drive.file` lets Apex OS see and manage only the files and folders it
 * created itself. The archive root folder must therefore be created by this
 * tool (`npm run admin:drive:verify -- --init-root`), not by hand.
 *
 * Layout under the configured root folder:
 *
 *   <root>/<environment>/deleted-users/<yyyy>/user-<receipt8>-<yyyymmddThhmmssZ>.enc
 *
 * Every folder the tool creates carries appProperties naming what it is and,
 * for the environment folder, which environment it belongs to. A staging run
 * that finds an environment folder labelled production (or the reverse)
 * refuses, so one Drive account can hold both without crossing them.
 *
 * Only two hosts are ever contacted: oauth2.googleapis.com and
 * www.googleapis.com. A resumable-upload session URL returned by Google is
 * checked against the same allowlist before it is used.
 *
 * No credential, access token or session URL is ever logged, returned in an
 * error, or written to disk.
 */

import { createReadStream, createWriteStream, statSync } from 'fs';
import { once } from 'events';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const ALLOWED_HOSTS = new Set(['oauth2.googleapis.com', 'www.googleapis.com']);
const FOLDER_MIME = 'application/vnd.google-apps.folder';
/** Resumable chunks must be multiples of 256 KiB. */
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_UPLOAD_RETRIES = 5;

export const DRIVE_ROOT_NAME = 'Apex OS Secure Archives';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export class DriveRefused extends Error {
  constructor(reason: string) {
    super(`Google Drive archive vault refused: ${reason}`);
    this.name = 'DriveRefused';
  }
}

export interface DriveConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  rootFolderId: string | null;
  account: string;
  environment: 'staging' | 'production';
}

/**
 * Reads the Drive configuration, or refuses. The declared archive environment
 * must equal the environment being operated on.
 */
export function readDriveConfig(env: NodeJS.ProcessEnv, environment: string, opts: { requireRoot?: boolean } = {}): DriveConfig {
  const required = ['GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET', 'GOOGLE_DRIVE_REFRESH_TOKEN', 'GOOGLE_DRIVE_ARCHIVE_ACCOUNT', 'GOOGLE_DRIVE_ARCHIVE_ENVIRONMENT'];
  if (opts.requireRoot !== false) required.push('GOOGLE_DRIVE_ARCHIVE_ROOT_FOLDER_ID');
  const missing = required.filter((k) => !(env[k] ?? '').trim());
  if (missing.length) throw new DriveRefused(`not configured. Missing: ${missing.join(', ')}.`);

  const declared = env.GOOGLE_DRIVE_ARCHIVE_ENVIRONMENT!.trim().toLowerCase();
  if (declared !== 'staging' && declared !== 'production') {
    throw new DriveRefused('GOOGLE_DRIVE_ARCHIVE_ENVIRONMENT must be "staging" or "production".');
  }
  if (declared !== environment) {
    throw new DriveRefused(`GOOGLE_DRIVE_ARCHIVE_ENVIRONMENT is "${declared}" but this run is for "${environment}".`);
  }
  const account = env.GOOGLE_DRIVE_ARCHIVE_ACCOUNT!.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)) throw new DriveRefused('GOOGLE_DRIVE_ARCHIVE_ACCOUNT is not an email address.');
  const root = (env.GOOGLE_DRIVE_ARCHIVE_ROOT_FOLDER_ID ?? '').trim() || null;
  if (root && !/^[A-Za-z0-9_-]{10,200}$/.test(root)) throw new DriveRefused('GOOGLE_DRIVE_ARCHIVE_ROOT_FOLDER_ID is not a Drive id.');

  return {
    clientId: env.GOOGLE_DRIVE_CLIENT_ID!.trim(),
    clientSecret: env.GOOGLE_DRIVE_CLIENT_SECRET!.trim(),
    refreshToken: env.GOOGLE_DRIVE_REFRESH_TOKEN!.trim(),
    rootFolderId: root,
    account,
    environment: declared,
  };
}

/**
 * The one comparison every command uses: the account Google reports as signed
 * in must be exactly GOOGLE_DRIVE_ARCHIVE_ACCOUNT (email addresses compare
 * case-insensitively; nothing else is normalised). Never hardcoded.
 */
export function isArchiveAccount(signedIn: string | null | undefined, expected: string): boolean {
  const a = String(signedIn ?? '').trim().toLowerCase();
  const b = String(expected ?? '').trim().toLowerCase();
  return a.length > 0 && b.length > 0 && a === b;
}

export function assertArchiveAccount(signedIn: string | null | undefined, expected: string): void {
  if (!isArchiveAccount(signedIn, expected)) {
    throw new DriveRefused('the signed-in Google account is not GOOGLE_DRIVE_ARCHIVE_ACCOUNT.');
  }
}

export interface DriveFileInfo {
  fileId: string;
  name: string;
  size: number | null;
  mimeType: string;
  trashed: boolean;
  parents: string[];
  appProperties: Record<string, string>;
  /** Set when the item lives in a Shared Drive. Archive items must live in My Drive. */
  driveId: string | null;
}

/** One sharing entry on a Drive file or folder. */
export interface DrivePermission {
  type: string; // user | group | domain | anyone
  role: string; // owner | organizer | fileOrganizer | writer | commenter | reader
  emailAddress?: string;
  domain?: string;
}

/**
 * Why a permission list is not "owner only", or null when it is. The only
 * acceptable list is exactly one entry: the archive account, as owner.
 */
export function permissionProblem(perms: DrivePermission[], account: string): string | null {
  if (perms.some((p) => p.type === 'anyone')) return 'it is shared publicly or with anyone who has the link';
  if (perms.some((p) => p.type === 'domain')) return 'it is shared with a whole domain';
  if (perms.some((p) => p.type === 'group')) return 'it is shared with a group';
  const owners = perms.filter((p) => p.role === 'owner');
  if (owners.length !== 1 || !isArchiveAccount(owners[0].emailAddress, account) || owners[0].type !== 'user') {
    return 'it is not owned by the archive account';
  }
  if (perms.length !== 1) return 'it is shared with another user';
  return null;
}

/** What permanent deletion needs from an archive vault. Implemented by Drive and, in tests, by a fake. */
export interface ArchiveVault {
  readonly provider: 'google-drive';
  /** The configured account, environment and root folder (no credentials). */
  identity(): { account: string; environment: string; rootFolderId: string | null };
  /** The signed-in account and the free space, in bytes (null = unlimited). */
  account(): Promise<{ email: string; freeBytes: number | null }>;
  stat(fileId: string): Promise<DriveFileInfo | null>;
  /** Ensures <root>/<environment>/<...segments> exists, checking labels. Returns the leaf folder id. */
  ensureFolder(environment: string, segments: string[]): Promise<string>;
  /** Resumable upload. Returns the new file id and the size Drive recorded. */
  upload(folderId: string, name: string, localPath: string, appProperties: Record<string, string>): Promise<{ fileId: string; size: number }>;
  download(fileId: string, destination: string): Promise<void>;
  /** True only when the sole permission is the configured account as owner. */
  isPrivate(fileId: string): Promise<boolean>;
  /** Every sharing entry on a file or folder. */
  permissions(fileId: string): Promise<DrivePermission[]>;
  /** Non-trashed child folders of `parentId` with exactly this name. Creates nothing. */
  findChildFolders(parentId: string, name: string): Promise<DriveFileInfo[]>;
  remove(fileId: string): Promise<void>;
  /** Creates the archive root folder in My Drive. Used once, by --init-root. */
  createRoot(): Promise<string>;
}

type FetchLike = (url: string, init?: any) => Promise<any>;

function assertHost(url: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new DriveRefused('Google returned an unusable URL.');
  }
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) {
    throw new DriveRefused(`refusing to contact ${u.hostname}; only Google's Drive and OAuth hosts are allowed.`);
  }
}

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export function createDriveVault(config: DriveConfig, fetchImpl: FetchLike = (globalThis as any).fetch): ArchiveVault {
  let token: { value: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && Date.now() < token.expiresAt - 60_000) return token.value;
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    if (!res.ok) {
      // Google's error code only (e.g. invalid_grant); never the request.
      let code = `HTTP ${res.status}`;
      try {
        code = (await res.json())?.error ?? code;
      } catch {
        /* ignore */
      }
      throw new DriveRefused(`OAuth token refresh failed (${code}). The refresh token may be revoked or expired.`);
    }
    const body = await res.json();
    token = { value: body.access_token, expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000 };
    return token.value;
  }

  async function call(url: string, init: any = {}, okStatuses: number[] = [200]): Promise<any> {
    assertHost(url);
    const res = await fetchImpl(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${await accessToken()}` } });
    if (!okStatuses.includes(res.status)) {
      let reason = `HTTP ${res.status}`;
      try {
        const b = await res.json();
        reason = b?.error?.message ? `HTTP ${res.status}: ${String(b.error.message).slice(0, 160)}` : reason;
      } catch {
        /* ignore */
      }
      const err: any = new DriveRefused(`Drive request failed (${reason}).`);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  const FILE_FIELDS = 'id,name,size,mimeType,trashed,parents,appProperties,driveId';
  const toInfo = (f: any): DriveFileInfo => ({
    fileId: f.id,
    name: f.name,
    size: f.size === undefined ? null : Number(f.size),
    mimeType: f.mimeType,
    trashed: !!f.trashed,
    parents: f.parents ?? [],
    appProperties: f.appProperties ?? {},
    driveId: f.driveId ?? null,
  });

  async function stat(fileId: string): Promise<DriveFileInfo | null> {
    try {
      const res = await call(`${API}/files/${encodeURIComponent(fileId)}?fields=${FILE_FIELDS}`);
      return toInfo(await res.json());
    } catch (err: any) {
      if (err?.status === 404) return null;
      throw err;
    }
  }

  async function findFolder(parentId: string, name: string): Promise<DriveFileInfo[]> {
    const query = `'${q(parentId)}' in parents and name = '${q(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
    const res = await call(`${API}/files?q=${encodeURIComponent(query)}&fields=files(${FILE_FIELDS})&spaces=drive`);
    return ((await res.json()).files ?? []).map(toInfo);
  }

  async function createFolder(parentId: string, name: string, appProperties: Record<string, string>): Promise<string> {
    const res = await call(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId], appProperties }),
    });
    return (await res.json()).id;
  }

  async function child(parentId: string, name: string, labels: Record<string, string>): Promise<string> {
    const found = await findFolder(parentId, name);
    if (found.length > 1) throw new DriveRefused(`more than one "${name}" folder; refusing to guess.`);
    if (found.length === 1) {
      for (const [k, v] of Object.entries(labels)) {
        if (found[0].appProperties[k] !== v) {
          throw new DriveRefused(`folder "${name}" is labelled ${k}=${found[0].appProperties[k] ?? '(none)'}, expected ${v}.`);
        }
      }
      return found[0].fileId;
    }
    return createFolder(parentId, name, labels);
  }

  async function permissions(fileId: string): Promise<DrivePermission[]> {
    const res = await call(`${API}/files/${encodeURIComponent(fileId)}/permissions?fields=permissions(type,role,emailAddress,domain)`);
    return (await res.json()).permissions ?? [];
  }

  return {
    provider: 'google-drive',

    identity() {
      return { account: config.account, environment: config.environment, rootFolderId: config.rootFolderId };
    },

    permissions,

    findChildFolders: findFolder,

    async account() {
      const res = await call(`${API}/about?fields=user(emailAddress),storageQuota(limit,usage)`);
      const body = await res.json();
      const limit = body?.storageQuota?.limit;
      const usage = Number(body?.storageQuota?.usage ?? 0);
      return { email: String(body?.user?.emailAddress ?? '').toLowerCase(), freeBytes: limit === undefined ? null : Number(limit) - usage };
    },

    stat,

    async ensureFolder(environment, segments) {
      if (!config.rootFolderId) throw new DriveRefused('GOOGLE_DRIVE_ARCHIVE_ROOT_FOLDER_ID is not set.');
      if (environment !== config.environment) throw new DriveRefused('environment does not match the configured archive environment.');
      const root = await stat(config.rootFolderId);
      if (!root || root.trashed || root.mimeType !== FOLDER_MIME) throw new DriveRefused('the archive root folder does not exist or is not a folder.');
      if (root.appProperties.apexArchiveRoot !== 'true') {
        throw new DriveRefused('the configured root folder was not created by this tool (missing its label).');
      }
      let parent = await child(root.fileId, environment, { apexArchiveEnvironment: environment });
      for (const seg of segments) parent = await child(parent, seg, { apexArchiveEnvironment: environment });
      return parent;
    },

    async upload(folderId, name, localPath, appProperties) {
      const size = statSync(localPath).size;
      const start = await call(`${UPLOAD}?uploadType=resumable&fields=id,size`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=UTF-8',
          'x-upload-content-type': 'application/octet-stream',
          'x-upload-content-length': String(size),
        },
        body: JSON.stringify({ name, parents: [folderId], mimeType: 'application/octet-stream', appProperties }),
      });
      const session = start.headers.get('location');
      if (!session) throw new DriveRefused('Drive did not open an upload session.');
      assertHost(session);

      let offset = 0;
      let retries = 0;
      while (true) {
        try {
          const end = Math.min(offset + UPLOAD_CHUNK_BYTES, size) - 1;
          const body = size === 0 ? Buffer.alloc(0) : await readRange(localPath, offset, end);
          const res = await fetchImpl(session, {
            method: 'PUT',
            headers: {
              authorization: `Bearer ${await accessToken()}`,
              'content-length': String(body.length),
              'content-range': size === 0 ? 'bytes */0' : `bytes ${offset}-${end}/${size}`,
            },
            body,
          });
          if (res.status === 200 || res.status === 201) {
            const done = await res.json();
            return { fileId: done.id, size: Number(done.size ?? size) };
          }
          if (res.status === 308) {
            offset = nextOffset(res.headers.get('range'));
            retries = 0;
            continue;
          }
          if (res.status === 404 || res.status === 410) throw new DriveRefused('the upload session expired; start again.');
          throw Object.assign(new Error(`HTTP ${res.status}`), { retryable: res.status >= 500 || res.status === 429 });
        } catch (err: any) {
          if (err instanceof DriveRefused) throw err;
          if (++retries > MAX_UPLOAD_RETRIES) throw new DriveRefused(`upload failed after ${MAX_UPLOAD_RETRIES} retries.`);
          // Interrupted: ask Drive how much it already has, then resume there.
          const status = await fetchImpl(session, {
            method: 'PUT',
            headers: { authorization: `Bearer ${await accessToken()}`, 'content-length': '0', 'content-range': `bytes */${size}` },
          });
          if (status.status === 200 || status.status === 201) {
            const done = await status.json();
            return { fileId: done.id, size: Number(done.size ?? size) };
          }
          if (status.status === 308) offset = nextOffset(status.headers.get('range'));
          else if (status.status === 404 || status.status === 410) throw new DriveRefused('the upload session expired; start again.');
        }
      }
    },

    async download(fileId, destination) {
      const res = await call(`${API}/files/${encodeURIComponent(fileId)}?alt=media`);
      if (!res.body) throw new DriveRefused('Drive returned no content.');
      const out = createWriteStream(destination);
      try {
        await pipeline(Readable.fromWeb(res.body), out);
      } catch (err) {
        out.destroy();
        throw err;
      }
    },

    async isPrivate(fileId) {
      return permissionProblem(await permissions(fileId), config.account) === null;
    },

    async remove(fileId) {
      await call(`${API}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' }, [204, 200]);
    },

    async createRoot() {
      return createFolder('root', DRIVE_ROOT_NAME, { apexArchiveRoot: 'true' });
    },
  };
}

function nextOffset(range: string | null): number {
  // "bytes=0-1048575" means the first 1048576 bytes are stored.
  if (!range) return 0;
  const m = /bytes=0-(\d+)/.exec(range);
  return m ? Number(m[1]) + 1 : 0;
}

async function readRange(path: string, start: number, end: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of createReadStream(path, { start, end })) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/** Writes a buffer to a file (small helper shared by the commands). */
export async function writeFileStream(path: string, data: Buffer) {
  const out = createWriteStream(path);
  out.write(data);
  out.end();
  await once(out, 'close');
}
