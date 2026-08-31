import {
  classifyHandoffFailure,
  describeHandoffFailure,
} from '../../../frontend/components/attendance/handoff-failure';
import {
  forgetToken,
  handoffSecretKey,
  parseTokenFromHash,
  recallToken,
  rememberToken,
  takeToken,
  type TokenEnv,
} from '../../../frontend/components/attendance/handoff-token';

/**
 * The QR fallback failed in production acceptance twice over, and both failures
 * were invisible to every gate this repo had:
 *
 *   - the desktop said "The phone link could not be created" for a 404, a 429
 *     and a 500 alike, so a deployment mismatch looked like a server fault;
 *   - the phone crashed outright on `use(params)`, which typechecks against
 *     @types/react 18.3.x but does not exist in the React 18.3.1 runtime.
 *
 * The frontend has no test runner, so the logic worth executing is kept
 * dependency-free and exercised here. What cannot be executed is guarded
 * statically in scripts/frontend/verify-punch-capture-paths.mjs.
 */

// ─────────────────────────────────────────────────────────────────────────────

function storage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

function env(over: Partial<TokenEnv> = {}): TokenEnv {
  return {
    hash: '',
    pathname: '/attendance/mobile-punch/ho-1',
    search: '',
    storage: storage(),
    ...over,
  };
}

describe('the desktop says which fault it hit', () => {
  const at = (status?: number, message?: string) =>
    status === undefined
      ? new Error('Network Error')
      : ({ response: { status, data: message === undefined ? {} : { message } } } as any);

  it('names a missing route instead of blaming the server', () => {
    // THE ACTUAL PRODUCTION FAILURE. The frontend was deployed ahead of the
    // backend, so the handoff route 404'd. A 404 body carries no `message`, so
    // the old code fell through to the generic sentence and the deployment gap
    // was invisible from the screen.
    const f = classifyHandoffFailure(at(404));

    expect(f.code).toBe('ROUTE_MISSING');
    expect(f.retryable).toBe(false);
    expect(f.message).toMatch(/does not support the phone link/i);
    expect(f.message).not.toMatch(/could not be created/i);
  });

  it.each([
    [401, 'SESSION_EXPIRED', false],
    [403, 'SESSION_EXPIRED', false],
    [429, 'THROTTLED', true],
    [500, 'SERVER_ERROR', true],
    [503, 'SERVER_ERROR', true],
  ])('maps %s to %s', (status, code, retryable) => {
    const f = classifyHandoffFailure(at(status as number));

    expect(f.code).toBe(code);
    expect(f.retryable).toBe(retryable);
  });

  it('treats a request that never completed as retryable', () => {
    const f = classifyHandoffFailure(at());

    expect(f.code).toBe('NETWORK');
    expect(f.retryable).toBe(true);
  });

  it('prefers the server explanation for a refusal it chose to explain', () => {
    const f = classifyHandoffFailure(at(400, 'Punching is disabled for your account today.'));

    expect(f.code).toBe('REFUSED');
    expect(f.message).toBe('Punching is disabled for your account today.');
  });

  it('falls back to plain words when a 4xx explains nothing', () => {
    expect(classifyHandoffFailure(at(400)).message).toBe('The phone link was not created.');
  });

  it('gives every failure a distinct sentence', () => {
    // If two faults read the same, the message cannot be used to diagnose
    // anything -- which is how the original defect survived.
    const messages = [404, 401, 429, 500].map((s) => describeHandoffFailure(at(s)));

    expect(new Set(messages).size).toBe(messages.length);
  });

  it('never tells the employee to retry something a retry cannot fix', () => {
    for (const status of [404, 401, 403]) {
      expect(classifyHandoffFailure(at(status)).retryable).toBe(false);
    }
  });
});

describe('the phone handles the secret without losing or leaking it', () => {
  it('reads the token from a bare fragment', () => {
    expect(parseTokenFromHash('#token=abc123')).toBe('abc123');
  });

  it('reads it when other fragment parameters come first', () => {
    expect(parseTokenFromHash('#a=1&token=abc123')).toBe('abc123');
  });

  it('decodes percent-escapes', () => {
    expect(parseTokenFromHash('#token=a%2Fb%2Bc')).toBe('a/b+c');
  });

  it.each([
    ['no fragment at all', ''],
    ['a fragment without a token', '#other=1'],
    ['an empty token', '#token='],
    ['a differently-named parameter', '#tokenish=abc'],
  ])('returns null for %s', (_label, hash) => {
    expect(parseTokenFromHash(hash)).toBeNull();
  });

  it('returns null for a malformed escape rather than a corrupted secret', () => {
    // decodeURIComponent throws on a lone '%'. Submitting the raw text would
    // send a secret the server can only refuse.
    expect(parseTokenFromHash('#token=%E0%A4%A')).toBeNull();
  });

  it('strips the secret from the address bar once it has been read', () => {
    const replaced: string[] = [];
    const e = env({
      hash: '#token=abc123',
      pathname: '/attendance/mobile-punch/ho-1',
      search: '?x=1',
      replaceUrl: (u) => void replaced.push(u),
    });

    expect(takeToken('ho-1', e)).toBe('abc123');
    expect(replaced).toEqual(['/attendance/mobile-punch/ho-1?x=1']);
    expect(replaced[0]).not.toContain('token');
  });

  it('stashes the secret so a login redirect cannot lose it', () => {
    const s = storage();
    takeToken('ho-1', env({ hash: '#token=abc123', storage: s }));

    expect(s.getItem(handoffSecretKey('ho-1'))).toBe('abc123');
  });

  it('recovers the secret on the way back from login, with no fragment left', () => {
    // The redirect carries only the handoff id, exactly so the secret is not in
    // a URL the login page could log.
    const s = storage({ [handoffSecretKey('ho-1')]: 'abc123' });

    expect(takeToken('ho-1', env({ hash: '', storage: s }))).toBe('abc123');
  });

  it('does not hand one handoff the secret of another', () => {
    const s = storage({ [handoffSecretKey('ho-1')]: 'abc123' });

    expect(recallToken('ho-2', s)).toBeNull();
  });

  it('returns null when there is no fragment and nothing stashed', () => {
    expect(takeToken('ho-1', env())).toBeNull();
  });

  it('forgets the secret so a shared phone keeps nothing', () => {
    const s = storage({ [handoffSecretKey('ho-1')]: 'abc123' });
    forgetToken('ho-1', s);

    expect(s.getItem(handoffSecretKey('ho-1'))).toBeNull();
  });

  it('still completes the punch when storage is blocked', () => {
    // Private browsing throws on setItem. Losing the stash costs only the
    // ability to survive a redirect; the punch in front of the employee must
    // still work.
    const hostile = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };

    expect(() => rememberToken('ho-1', 'abc', hostile)).not.toThrow();
    expect(recallToken('ho-1', hostile)).toBeNull();
    expect(() => forgetToken('ho-1', hostile)).not.toThrow();
    expect(takeToken('ho-1', env({ hash: '#token=abc123', storage: hostile }))).toBe('abc123');
  });

  it('survives a browser with no storage object at all', () => {
    expect(takeToken('ho-1', env({ hash: '#token=abc', storage: null }))).toBe('abc');
    expect(recallToken('ho-1', null)).toBeNull();
  });

  it('does not throw when the address bar cannot be rewritten', () => {
    const e = env({
      hash: '#token=abc123',
      replaceUrl: () => {
        throw new Error('blocked by sandbox');
      },
    });

    expect(takeToken('ho-1', e)).toBe('abc123');
  });
});
