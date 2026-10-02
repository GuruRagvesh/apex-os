/**
 * THE GUARD THAT DECIDES WHETHER A WIPE SCRIPT RUNS AGAINST PRODUCTION.
 *
 * It used to test `APP_ENV === 'production'` and nothing else, so a
 * production service whose APP_ENV was never set had no guard at all. Nothing
 * failed without that variable and it was undocumented, which is the worst
 * combination a safety check can have: silently absent exactly where it
 * matters.
 *
 * The five cases below are the whole contract. Two of them (missing APP_ENV)
 * are the ones that were broken.
 */
import {
  isProductionEnvironment,
  preventDestructiveOperation,
  resolveEnvironment,
} from '../../src/common/safety/destructive-operation-guard';

describe('resolving which environment this is', () => {
  it.each([
    ['APP_ENV=production', { APP_ENV: 'production', NODE_ENV: 'production' }, 'production', true],
    ['APP_ENV=staging', { APP_ENV: 'staging', NODE_ENV: 'production' }, 'staging', false],
    ['APP_ENV=development', { APP_ENV: 'development', NODE_ENV: 'development' }, 'development', false],
    ['APP_ENV missing + NODE_ENV=production', { NODE_ENV: 'production' }, 'production', true],
    ['APP_ENV missing + NODE_ENV=development', { NODE_ENV: 'development' }, 'development', false],
  ])('%s', (_label, env, expected, isProd) => {
    expect(resolveEnvironment(env as any)).toBe(expected);
    expect(isProductionEnvironment(env as any)).toBe(isProd);
  });

  it('FALLS BACK TO NODE_ENV WHEN APP_ENV IS ABSENT -- the hole this closes', () => {
    // The case that had no protection. A deployed service always sets
    // NODE_ENV=production, so this is the condition that was reachable in
    // practice and unguarded.
    expect(isProductionEnvironment({ NODE_ENV: 'production' })).toBe(true);
  });

  it('LETS AN EXPLICIT APP_ENV OVERRIDE NODE_ENV, which staging depends on', () => {
    // Staging runs NODE_ENV=production because it is a production build. It
    // is APP_ENV that says it is staging, and a guard that ignored that
    // would treat every staging box as production.
    expect(isProductionEnvironment({ APP_ENV: 'staging', NODE_ENV: 'production' })).toBe(false);
    expect(resolveEnvironment({ APP_ENV: 'staging', NODE_ENV: 'production' })).toBe('staging');
  });

  it('DOES NOT FAIL CLOSED when neither is set', () => {
    // Deliberate. Refusing whenever the environment cannot be proven would be
    // safer in the abstract and would break ordinary local development, where
    // neither variable is set and seeding is routine.
    expect(resolveEnvironment({})).toBe('development');
    expect(isProductionEnvironment({})).toBe(false);
  });

  it('treats an emptied APP_ENV as absent, not as an environment named ""', () => {
    // A dashboard field somebody cleared. Without this it would resolve to ''
    // and never equal 'production', putting the hole straight back.
    expect(isProductionEnvironment({ APP_ENV: '', NODE_ENV: 'production' })).toBe(true);
    expect(isProductionEnvironment({ APP_ENV: '   ', NODE_ENV: 'production' })).toBe(true);
  });

  it('is case-insensitive about the value', () => {
    expect(isProductionEnvironment({ APP_ENV: 'PRODUCTION' })).toBe(true);
    expect(isProductionEnvironment({ NODE_ENV: 'Production' })).toBe(true);
  });
});

describe('the guard itself', () => {
  const ORIGINAL = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  const withEnv = (env: Record<string, string | undefined>) => {
    process.env = { ...ORIGINAL };
    for (const key of ['APP_ENV', 'NODE_ENV', 'ALLOW_DESTRUCTIVE_OPERATIONS']) {
      delete process.env[key];
    }
    Object.assign(process.env, env);
  };

  it('BLOCKS when APP_ENV says production', () => {
    withEnv({ APP_ENV: 'production', NODE_ENV: 'production' });
    expect(() => preventDestructiveOperation('reset-seed')).toThrow(/BLOCKED/);
  });

  it('BLOCKS when APP_ENV IS MISSING and NODE_ENV says production', () => {
    // The regression this change exists to prevent.
    withEnv({ NODE_ENV: 'production' });
    expect(() => preventDestructiveOperation('reset-seed')).toThrow(/BLOCKED/);
  });

  it('ALLOWS on staging, even though NODE_ENV is production there', () => {
    withEnv({ APP_ENV: 'staging', NODE_ENV: 'production' });
    expect(() => preventDestructiveOperation('reset-seed')).not.toThrow();
  });

  it('ALLOWS in local development with neither variable set', () => {
    withEnv({});
    expect(() => preventDestructiveOperation('reset-seed')).not.toThrow();
  });

  it('ALLOWS in development when APP_ENV says so', () => {
    withEnv({ APP_ENV: 'development', NODE_ENV: 'development' });
    expect(() => preventDestructiveOperation('reset-seed')).not.toThrow();
  });

  it('still honours the explicit override in production', () => {
    withEnv({
      APP_ENV: 'production',
      ALLOW_DESTRUCTIVE_OPERATIONS: 'YES_I_UNDERSTAND',
    });
    expect(() => preventDestructiveOperation('reset-seed')).not.toThrow();
  });

  it('refuses a near-miss override value', () => {
    // Anything other than the exact phrase leaves the guard in place.
    withEnv({ APP_ENV: 'production', ALLOW_DESTRUCTIVE_OPERATIONS: 'yes' });
    expect(() => preventDestructiveOperation('reset-seed')).toThrow(/BLOCKED/);
  });

  it('names the operation in the refusal', () => {
    withEnv({ NODE_ENV: 'production' });
    expect(() => preventDestructiveOperation('truncate-attendance')).toThrow(
      /truncate-attendance/,
    );
  });

  it('writes a real newline in the message, not the characters backslash-n', () => {
    // The original used an escaped \\n inside a template literal, so the
    // error text contained the two characters rather than a line break and
    // the message arrived as one unreadable run-on.
    withEnv({ NODE_ENV: 'production' });
    try {
      preventDestructiveOperation('reset-seed');
      throw new Error('should have thrown');
    } catch (err: any) {
      expect(err.message).toContain('\n');
      expect(err.message).not.toContain('\\n');
    }
  });
});
