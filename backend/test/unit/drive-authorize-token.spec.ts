import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildAuthUrl,
  completeAuthorization,
  isStrictlyAbsolute,
  parseAuthorizeArgs,
  TokenOutputRefused,
  validateTokenOut,
  writeTokenFile,
} from '../../scripts/drive-archive/run-drive-authorize';

// The refresh token grants lasting access to the archive Drive. These tests
// prove it only ever lands in the one file the operator chose, restricted to
// them, and never in output, errors or a repository.

const TOKEN = '1//synthetic-refresh-token-DO-NOT-LEAK-7f3a9c';
const ACCOUNT = 'ai.technoedge@gmail.com';
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drive-authorize-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const noRestrict = () => undefined;
const leftovers = (d: string) => readdirSync(d).filter((n) => n.endsWith('.token-tmp'));

function googleFake(over: { email?: string; scope?: string; status?: number; refresh?: string | null } = {}) {
  return jest.fn(async (url: string) => {
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      if (over.status) return { ok: false, status: over.status, json: async () => ({ error: 'invalid_grant', error_description: TOKEN }) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'ya29.synthetic-access',
          refresh_token: over.refresh === undefined ? TOKEN : over.refresh,
          scope: over.scope ?? 'https://www.googleapis.com/auth/drive.file',
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ user: { emailAddress: over.email ?? 'AI.TechnoEdge@gmail.com' } }) };
  });
}

/** Runs fn with console output captured, so tests can prove nothing sensitive was printed. */
async function captureOutput<T>(fn: () => Promise<T>): Promise<{ result?: T; error?: any; out: string }> {
  const lines: string[] = [];
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    jest.spyOn(console, m).mockImplementation((...a: any[]) => {
      lines.push(a.map(String).join(' '));
    }),
  );
  const writes = [process.stdout, process.stderr].map((s) =>
    jest.spyOn(s, 'write').mockImplementation(((chunk: any) => {
      lines.push(String(chunk));
      return true;
    }) as any),
  );
  try {
    return { result: await fn(), out: lines.join('\n') };
  } catch (error) {
    return { error, out: lines.join('\n') };
  } finally {
    [...spies, ...writes].forEach((s) => s.mockRestore());
  }
}

const complete = (target: string, over: Parameters<typeof googleFake>[0] = {}, extra: Partial<Parameters<typeof completeAuthorization>[0]> = {}) =>
  completeAuthorization({
    code: '4/synthetic-auth-code',
    redirectUri: 'http://127.0.0.1:5555/oauth2callback',
    verifier: 'v'.repeat(64),
    clientId: 'client-id.apps.googleusercontent.com',
    clientSecret: 'GOCSPX-synthetic-client-secret',
    account: ACCOUNT,
    tokenPath: target,
    overwrite: false,
    fetchImpl: googleFake(over),
    restrict: noRestrict,
    ...extra,
  });

describe('--token-out options', () => {
  it('is required, and only known options are accepted', () => {
    expect(() => parseAuthorizeArgs([])).toThrow(/--token-out=<absolute file path> is required/);
    expect(() => parseAuthorizeArgs(['--token-out=C:\\x\\t', '--print-token'])).toThrow(/unknown option --print-token/);
    expect(parseAuthorizeArgs(['--token-out=C:\\x\\t', '--overwrite', '--create-parent'])).toEqual({ path: 'C:\\x\\t', overwrite: true, createParent: true });
  });

  it('rejects relative and rooted-but-driveless paths', () => {
    for (const p of ['token', '.\\token', '..\\token', 'secrets/token', '\\token']) {
      expect([p, isStrictlyAbsolute(p, 'win32')]).toEqual([p, false]);
      expect(() => validateTokenOut({ path: p, overwrite: false, createParent: false }, [])).toThrow(TokenOutputRefused);
    }
    expect(isStrictlyAbsolute('C:\\Users\\me\\.apex-os-secrets\\t', 'win32')).toBe(true);
    expect(isStrictlyAbsolute('\\\\server\\share\\t', 'win32')).toBe(true);
  });

  it('rejects a path inside the repository', () => {
    const repo = join(dir, 'apex-os');
    mkdirSync(join(repo, 'backend'), { recursive: true });
    expect(() => validateTokenOut({ path: join(repo, 'backend', 'token'), overwrite: false, createParent: false }, [repo])).toThrow(/inside the Apex OS repository/);
    expect(() => validateTokenOut({ path: join(repo, 'token'), overwrite: false, createParent: false }, [repo.toUpperCase()])).toThrow(/inside the Apex OS repository/);
  });

  it('rejects a path inside any Git working tree, including one it would have to create', () => {
    const other = join(dir, 'other-repo');
    mkdirSync(join(other, '.git'), { recursive: true });
    mkdirSync(join(other, 'sub'));
    expect(() => validateTokenOut({ path: join(other, 'sub', 'token'), overwrite: false, createParent: false }, [])).toThrow(/inside a Git working tree/);
    expect(() => validateTokenOut({ path: join(other, 'new', 'deep', 'token'), overwrite: false, createParent: true }, [])).toThrow(/inside a Git working tree/);
    expect(existsSync(join(other, 'new'))).toBe(false);
  });

  it('rejects an existing destination unless --overwrite', () => {
    const target = join(dir, 'token');
    writeFileSync(target, 'old');
    expect(() => validateTokenOut({ path: target, overwrite: false, createParent: false }, [])).toThrow(/already exists/);
    expect(validateTokenOut({ path: target, overwrite: true, createParent: false }, [])).toBe(target);
  });

  it('creates the parent folder only with --create-parent', () => {
    const target = join(dir, 'secrets', 'staging', 'token');
    expect(() => validateTokenOut({ path: target, overwrite: false, createParent: false }, [])).toThrow(/does not exist/);
    expect(existsSync(join(dir, 'secrets'))).toBe(false);
    expect(validateTokenOut({ path: target, overwrite: false, createParent: true }, [])).toBe(target);
    expect(existsSync(join(dir, 'secrets', 'staging'))).toBe(true);
  });
});

describe('writing the token', () => {
  it('writes raw token text only, atomically, with nothing left behind', () => {
    const target = join(dir, 'token');
    const restricted: string[] = [];
    writeTokenFile(target, TOKEN, { overwrite: false, restrict: (p) => restricted.push(p) });
    expect(readFileSync(target, 'utf8')).toBe(TOKEN);
    // Restriction was applied to the temporary file, before it became the token file.
    expect(restricted).toHaveLength(1);
    expect(restricted[0]).not.toBe(target);
    expect(leftovers(dir)).toEqual([]);
  });

  it('removes the temporary file and keeps the token out of the error when restriction fails', () => {
    const target = join(dir, 'token');
    let err: any;
    try {
      writeTokenFile(target, TOKEN, {
        overwrite: false,
        restrict: () => {
          throw Object.assign(new Error(`icacls failed on ${TOKEN}`), { code: 'EACCES' });
        },
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TokenOutputRefused);
    expect(String(err.message)).not.toContain(TOKEN);
    expect(JSON.stringify(err)).not.toContain(TOKEN);
    expect(existsSync(target)).toBe(false);
    expect(leftovers(dir)).toEqual([]);
  });

  it('does not overwrite a file that appeared meanwhile, and cleans up', () => {
    const target = join(dir, 'token');
    expect(() =>
      writeTokenFile(target, TOKEN, {
        overwrite: false,
        restrict: () => writeFileSync(target, 'someone else'),
      }),
    ).toThrow(/appeared while authorizing/);
    expect(readFileSync(target, 'utf8')).toBe('someone else');
    expect(leftovers(dir)).toEqual([]);
  });

  (process.platform === 'win32' ? it : it.skip)('on Windows, leaves only the current user on the file ACL', () => {
    const target = join(dir, 'token');
    writeTokenFile(target, TOKEN, { overwrite: false });
    const acl = execFileSync('icacls', [target], { encoding: 'utf8' });
    const entries = acl.split(/\r?\n/).filter((l) => /:\(/.test(l));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/\(F\)/);
    expect(acl).not.toMatch(/Everyone|BUILTIN\\Users|Authenticated Users/i);
  });
});

describe('completing authorization', () => {
  it('writes the token for the archive account and prints nothing sensitive', async () => {
    const target = join(dir, 'token');
    const { result, error, out } = await captureOutput(() => complete(target));
    expect(error).toBeUndefined();
    expect(result).toEqual({ account: ACCOUNT, scope: 'https://www.googleapis.com/auth/drive.file', tokenPath: target });
    expect(readFileSync(target, 'utf8')).toBe(TOKEN);
    for (const secret of [TOKEN, 'ya29.synthetic-access', 'GOCSPX-synthetic-client-secret', '4/synthetic-auth-code']) {
      expect(out).not.toContain(secret);
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  });

  it.each([
    ['another Google account', { email: 'someone-else@gmail.com' }, /different Google account/],
    ['the old misspelt address', { email: 'ai.technology@gmail.com' }, /different Google account/],
    ['a missing drive.file grant', { scope: 'openid email' }, /drive.file scope was not granted/],
    ['no refresh token', { refresh: null }, /no refresh token/],
    ['a failed code exchange', { status: 400 }, /Code exchange failed \(invalid_grant\)/],
  ])('refuses %s, writes no file, and keeps secrets out of output and errors', async (_l, over, msg) => {
    const target = join(dir, 'token');
    const { error, out } = await captureOutput(() => complete(target, over as any));
    expect(error?.message).toMatch(msg as RegExp);
    for (const secret of [TOKEN, 'ya29.synthetic-access', 'GOCSPX-synthetic-client-secret', '4/synthetic-auth-code']) {
      expect(String(error?.message)).not.toContain(secret);
      expect(String(error?.stack)).not.toContain(secret);
      expect(out).not.toContain(secret);
    }
    expect(existsSync(target)).toBe(false);
    expect(leftovers(dir)).toEqual([]);
  });

  it('refuses to replace an existing token file without --overwrite, and replaces it with it', async () => {
    const target = join(dir, 'token');
    writeFileSync(target, 'previous-token');
    const { error } = await captureOutput(() => complete(target));
    expect(error).toBeInstanceOf(TokenOutputRefused);
    expect(readFileSync(target, 'utf8')).toBe('previous-token');
    const ok = await captureOutput(() => complete(target, {}, { overwrite: true }));
    expect(ok.error).toBeUndefined();
    expect(readFileSync(target, 'utf8')).toBe(TOKEN);
    expect(leftovers(dir)).toEqual([]);
  });

  it('still asks Google for offline access, forced consent and only drive.file', () => {
    const u = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:5555/oauth2callback', state: 's', challenge: 'c', loginHint: ACCOUNT }));
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
  });

  it('the script never prints the refresh token', () => {
    const src = readFileSync(join(__dirname, '../../scripts/drive-archive/run-drive-authorize.ts'), 'utf8');
    expect(src).not.toMatch(/console\.\w+\([^)]*refresh_token/);
    expect(src).not.toMatch(/console\.\w+\([^)]*body\b/);
  });
});
