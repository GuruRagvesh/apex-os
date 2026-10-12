/**
 * One-time Google Drive authorization for the archive vault.
 *
 *   npm run admin:drive:authorize -- --token-out=C:\Users\<you>\.apex-os-secrets\staging\drive-refresh-token
 *   npm run admin:drive:authorize -- --token-out=<path> --create-parent   (create the folder if missing)
 *   npm run admin:drive:authorize -- --token-out=<path> --overwrite       (replace an existing token file)
 *
 * Run this on an operator's own machine, never on a server. It uses the
 * OAuth "installed app" loopback flow with PKCE:
 *
 *   1. Checks --token-out FIRST: it must be absolute, outside every Git
 *      working tree, and must not already exist (unless --overwrite).
 *   2. Starts a listener on 127.0.0.1 (a random free port) and prints a
 *      Google sign-in URL with access_type=offline, prompt=consent and
 *      scope=drive.file. Open it and sign in as the archive account.
 *   3. Receives the authorization code on the loopback address, checks the
 *      state value, and exchanges the code (with the PKCE verifier).
 *   4. Refuses unless the signed-in account is GOOGLE_DRIVE_ARCHIVE_ACCOUNT
 *      and the drive.file scope was granted.
 *   5. Writes the refresh token -- raw text, nothing else -- to --token-out:
 *      to a temporary file beside it first, restricted to the current user,
 *      then renamed into place. Any failure removes the temporary file.
 *
 * The refresh token is NEVER printed, logged or included in an error. The
 * only output is: success, the authorized account, the granted scope, and
 * the token file path. Load it into a PowerShell session privately with:
 *
 *   $env:GOOGLE_DRIVE_REFRESH_TOKEN = (Get-Content -Raw -LiteralPath '<token-file>').Trim()
 *
 * Needs GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET and
 * GOOGLE_DRIVE_ARCHIVE_ACCOUNT in the environment of this one command.
 */

import { createHash, randomBytes } from 'crypto';
import { execFileSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import { userInfo } from 'os';
import { dirname, isAbsolute, join, normalize, resolve, sep, win32 } from 'path';
import { DRIVE_SCOPE, isArchiveAccount } from './drive-vault';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ABOUT_URL = 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)';
const TIMEOUT_MS = 5 * 60 * 1000;

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

/** The consent URL. Offline access and forced consent so Google returns a refresh token. */
export function buildAuthUrl(p: { clientId: string; redirectUri: string; state: string; challenge: string; loginHint?: string }): string {
  const u = new URL(AUTH_URL);
  u.searchParams.set('client_id', p.clientId);
  u.searchParams.set('redirect_uri', p.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', DRIVE_SCOPE);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'false');
  u.searchParams.set('state', p.state);
  u.searchParams.set('code_challenge', p.challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  if (p.loginHint) u.searchParams.set('login_hint', p.loginHint);
  return u.toString();
}

// ── Token output ─────────────────────────────────────────────────────────────

/** A refusal about the token file. Messages name paths only, never contents. */
export class TokenOutputRefused extends Error {
  constructor(reason: string) {
    super(`Token output refused: ${reason}`);
    this.name = 'TokenOutputRefused';
  }
}

export interface TokenOutOptions {
  path: string;
  overwrite: boolean;
  createParent: boolean;
}

export function parseAuthorizeArgs(argv: string[]): TokenOutOptions {
  const out = argv.find((a) => a.startsWith('--token-out='))?.slice('--token-out='.length) ?? '';
  for (const a of argv) {
    if (a.startsWith('--') && !a.startsWith('--token-out=') && a !== '--overwrite' && a !== '--create-parent') {
      throw new TokenOutputRefused(`unknown option ${a.split('=')[0]}.`);
    }
  }
  if (!out.trim()) throw new TokenOutputRefused('--token-out=<absolute file path> is required. The refresh token is never printed.');
  return { path: out.trim(), overwrite: argv.includes('--overwrite'), createParent: argv.includes('--create-parent') };
}

/** True for an absolute path on this platform, and on Windows only a drive or UNC path (not "\foo"). */
export function isStrictlyAbsolute(p: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === 'win32') return win32.isAbsolute(p) && /^([A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(p);
  return isAbsolute(p);
}

/** The nearest ancestor (or the directory itself) that holds a `.git` entry, or null. */
export function enclosingGitRoot(dir: string): string | null {
  let current = resolve(dir);
  while (true) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** The repository (or worktree) this script belongs to: three levels above scripts/drive-archive. */
export const REPOSITORY_ROOT = resolve(__dirname, '..', '..', '..');

const within = (child: string, parent: string) => {
  const c = normalize(resolve(child)).toLowerCase();
  const p = normalize(resolve(parent)).toLowerCase();
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
};

/**
 * Checks where the token may be written, before any browser step. Creates the
 * parent folder only when --create-parent was given. Returns the resolved path.
 */
export function validateTokenOut(opts: TokenOutOptions, repoRoots: string[] = [REPOSITORY_ROOT]): string {
  if (!isStrictlyAbsolute(opts.path)) throw new TokenOutputRefused('--token-out must be an absolute path (for example C:\\Users\\<you>\\.apex-os-secrets\\staging\\drive-refresh-token).');
  const target = resolve(opts.path);
  for (const root of repoRoots) {
    if (within(target, root)) throw new TokenOutputRefused('--token-out is inside the Apex OS repository. Choose a folder outside every repository.');
  }
  const parent = dirname(target);
  if (!existsSync(parent)) {
    if (!opts.createParent) throw new TokenOutputRefused('the folder for --token-out does not exist. Create it, or pass --create-parent.');
    // Check the would-be location before creating anything.
    let probe = parent;
    while (!existsSync(probe)) probe = dirname(probe);
    if (enclosingGitRoot(probe)) throw new TokenOutputRefused('--token-out is inside a Git working tree. Choose a folder outside every repository.');
    mkdirSync(parent, { recursive: true });
  }
  if (!statSync(parent).isDirectory()) throw new TokenOutputRefused('the parent of --token-out is not a folder.');
  if (enclosingGitRoot(parent)) throw new TokenOutputRefused('--token-out is inside a Git working tree. Choose a folder outside every repository.');
  if (existsSync(target)) {
    if (!opts.overwrite) throw new TokenOutputRefused('--token-out already exists. Pass --overwrite to replace it.');
    if (!statSync(target).isFile()) throw new TokenOutputRefused('--token-out exists and is not a file.');
  }
  return target;
}

/** Restricts a file to the current user: an ACL with only that user on Windows, mode 0600 elsewhere. */
export function restrictToCurrentUser(path: string, platform: NodeJS.Platform = process.platform): void {
  if (platform === 'win32') {
    const user = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${userInfo().username}` : userInfo().username;
    // /inheritance:r drops inherited entries; /grant:r replaces any explicit ones.
    execFileSync('icacls', [path, '/inheritance:r', '/grant:r', `${user}:F`], { stdio: 'ignore', windowsHide: true });
  } else {
    chmodSync(path, 0o600);
  }
}

/**
 * Writes the token atomically: a temporary file in the same folder, created
 * exclusively, restricted, then renamed over the target. On any failure the
 * temporary file is removed and a token-free error is thrown.
 */
export function writeTokenFile(
  target: string,
  token: string,
  opts: { overwrite: boolean; restrict?: (path: string) => void },
): void {
  if (!token) throw new TokenOutputRefused('there is no token to write.');
  const restrict = opts.restrict ?? ((p: string) => restrictToCurrentUser(p));
  const temp = join(dirname(target), `.${randomBytes(8).toString('hex')}.token-tmp`);
  try {
    writeFileSync(temp, token, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    restrict(temp);
    if (existsSync(target) && !opts.overwrite) throw new TokenOutputRefused('--token-out appeared while authorizing; refusing to overwrite it.');
    renameSync(temp, target);
  } catch (err: any) {
    rmSync(temp, { force: true });
    // Never pass the underlying error through: some fs errors quote arguments.
    if (err instanceof TokenOutputRefused) throw err;
    throw new TokenOutputRefused(`the token file could not be written securely (${err?.code ?? 'error'}).`);
  }
}

// ── Code exchange ────────────────────────────────────────────────────────────

type FetchLike = (url: string, init?: any) => Promise<any>;

export interface CompletedAuthorization {
  account: string;
  scope: string;
  tokenPath: string;
}

/**
 * Exchanges the authorization code, checks the account and scope, and writes
 * the refresh token to `tokenPath`. Every message it produces -- returned or
 * thrown -- is free of the code, tokens and client secret.
 */
export async function completeAuthorization(p: {
  code: string;
  redirectUri: string;
  verifier: string;
  clientId: string;
  clientSecret: string;
  account: string;
  tokenPath: string;
  overwrite: boolean;
  fetchImpl?: FetchLike;
  restrict?: (path: string) => void;
}): Promise<CompletedAuthorization> {
  const fetchImpl = p.fetchImpl ?? ((globalThis as any).fetch as FetchLike);
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: p.code,
      client_id: p.clientId,
      client_secret: p.clientSecret,
      redirect_uri: p.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: p.verifier,
    }).toString(),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = typeof body?.error === 'string' && /^[a-z_]{1,40}$/.test(body.error) ? body.error : `HTTP ${res.status}`;
    throw new Error(`Code exchange failed (${code}).`);
  }
  if (!body.refresh_token) throw new Error('Google returned no refresh token. Remove the app from the account\'s third-party access and run again.');
  const scopes = String(body.scope ?? '').split(' ').filter(Boolean);
  if (!scopes.includes(DRIVE_SCOPE)) throw new Error('The drive.file scope was not granted.');

  const about = await fetchImpl(ABOUT_URL, { headers: { authorization: `Bearer ${body.access_token}` } });
  const who = (await about.json().catch(() => ({})))?.user?.emailAddress;
  // The token is never written for any account other than the archive account.
  if (!isArchiveAccount(who, p.account)) throw new Error('You signed in as a different Google account. Run again and choose the archive account.');

  writeTokenFile(p.tokenPath, String(body.refresh_token), { overwrite: p.overwrite, restrict: p.restrict });
  return { account: String(who).toLowerCase(), scope: DRIVE_SCOPE, tokenPath: p.tokenPath };
}

async function main() {
  // The output location is checked before any browser step.
  const out = parseAuthorizeArgs(process.argv.slice(2));
  const tokenPath = validateTokenOut(out);

  const clientId = (process.env.GOOGLE_DRIVE_CLIENT_ID ?? '').trim();
  const clientSecret = (process.env.GOOGLE_DRIVE_CLIENT_SECRET ?? '').trim();
  const account = (process.env.GOOGLE_DRIVE_ARCHIVE_ACCOUNT ?? '').trim().toLowerCase();
  if (!clientId || !clientSecret || !account) {
    throw new Error('Set GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET and GOOGLE_DRIVE_ARCHIVE_ACCOUNT for this command.');
  }

  const state = b64url(randomBytes(24));
  const { verifier, challenge } = pkcePair();

  const code = await new Promise<{ code: string; redirectUri: string }>((resolveCode, reject) => {
    let redirectUri = '';
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/oauth2callback') {
        res.writeHead(404).end();
        return;
      }
      const ok = url.searchParams.get('state') === state && !!url.searchParams.get('code');
      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/plain' });
      res.end(ok ? 'Authorization received. You can close this tab and return to the terminal.' : 'Authorization failed. Return to the terminal.');
      server.close();
      clearTimeout(timer);
      const error = url.searchParams.get('error');
      if (!ok) reject(new Error(error && /^[a-z_]{1,40}$/.test(error) ? `Google returned "${error}".` : 'The state value did not match; refusing.'));
      else resolveCode({ code: url.searchParams.get('code')!, redirectUri });
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Timed out waiting for authorization.'));
    }, TIMEOUT_MS);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as any).port;
      redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
      console.log('── Apex OS Google Drive archive authorization ──────────────────');
      console.log(`\nOpen this URL and sign in as ${account}:\n`);
      console.log(buildAuthUrl({ clientId, redirectUri, state, challenge, loginHint: account }));
      console.log('\nWaiting for Google to redirect back to this machine...');
    });
  });

  const done = await completeAuthorization({ ...code, verifier, clientId, clientSecret, account, tokenPath, overwrite: out.overwrite });
  console.log('\nAuthorization successful.');
  console.log(`  Authorized Google account : ${done.account}`);
  console.log(`  Granted scope             : ${done.scope}`);
  console.log(`  Token output path         : ${done.tokenPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    // Only messages this script built; none contains a token, code or secret.
    console.error('\nAUTHORIZATION FAILED:', err instanceof Error ? err.message : 'unexpected error');
    process.exit(1);
  });
}
