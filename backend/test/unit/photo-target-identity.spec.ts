import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  assertPhotoTarget,
  PRODUCTION_VAULT_BUCKET,
  TargetRefused,
} from '../../scripts/backup/backup-identity';

// Both photo runners used a bare `new PrismaClient()`: whatever DATABASE_URL
// happened to be loaded won, with nothing asserting it was the database anyone
// intended. Archive keys carry no environment namespace either, so staging
// evidence written to the production vault would be indistinguishable from
// real attendance records afterwards.

const SECRET = 'S3nt1nel-Pa55w0rd-DoNotLeak';

const PROD_HOST = 'dpg-d8259omk1jcs73e37fbg-a.oregon-postgres.render.com';
const PROD_DB = 'apex_db_dugl';
const STAGING_HOST = 'dpg-d95pamvaqgkc73fdurig-a.oregon-postgres.render.com';
const STAGING_DB = 'apex_os_staging_db';
const STAGING_BUCKET = 'apex-os-staging-backups';

const url = (host: string, db: string) => `postgresql://u:${SECRET}@${host}:5432/${db}`;

const production = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  APP_ENV: 'production',
  DATABASE_URL: url(PROD_HOST, PROD_DB),
  EXPECTED_PRODUCTION_DB_HOST: PROD_HOST,
  EXPECTED_PRODUCTION_DB_NAME: PROD_DB,
  R2_BUCKET: PRODUCTION_VAULT_BUCKET,
  ...over,
});

const staging = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  APP_ENV: 'staging',
  DATABASE_URL: url(STAGING_HOST, STAGING_DB),
  EXPECTED_STAGING_DB_HOST: STAGING_HOST,
  EXPECTED_STAGING_DB_NAME: STAGING_DB,
  R2_BUCKET: STAGING_BUCKET,
  ...over,
});

describe('a correctly declared target is accepted', () => {
  it('accepts production', () => {
    const target = assertPhotoTarget(production());

    expect(target.environment).toBe('production');
    expect(target.database).toBe(PROD_DB);
    expect(target.bucket).toBe(PRODUCTION_VAULT_BUCKET);
  });

  it('accepts staging', () => {
    const target = assertPhotoTarget(staging());

    expect(target.environment).toBe('staging');
    expect(target.database).toBe(STAGING_DB);
    expect(target.bucket).toBe(STAGING_BUCKET);
  });
});

describe('the declared environment must match the actual database', () => {
  it('refuses a production host mismatch', () => {
    expect(() =>
      assertPhotoTarget(production({ DATABASE_URL: url('somewhere-else.render.com', PROD_DB) })),
    ).toThrow(/Host mismatch/i);
  });

  it('refuses a production database mismatch', () => {
    expect(() =>
      assertPhotoTarget(production({ DATABASE_URL: url(PROD_HOST, 'apex_db_something_else') })),
    ).toThrow(/Database mismatch/i);
  });

  it('refuses a staging host mismatch', () => {
    expect(() =>
      assertPhotoTarget(staging({ DATABASE_URL: url('elsewhere.render.com', STAGING_DB) })),
    ).toThrow(/Host mismatch/i);
  });

  it('refuses a staging database mismatch', () => {
    expect(() =>
      assertPhotoTarget(staging({ DATABASE_URL: url(STAGING_HOST, 'apex_os_other_db') })),
    ).toThrow(/Database mismatch/i);
  });

  it('refuses staging pointed at a production database', () => {
    expect(() =>
      assertPhotoTarget(
        staging({
          DATABASE_URL: url(PROD_HOST, PROD_DB),
          EXPECTED_STAGING_DB_HOST: PROD_HOST,
          EXPECTED_STAGING_DB_NAME: PROD_DB,
        }),
      ),
    ).toThrow(/production marker/i);
  });
});

describe('the expected identity must be supplied independently', () => {
  // Checking DATABASE_URL against itself would prove only that it parsed.
  it('refuses production without an expected host', () => {
    expect(() => assertPhotoTarget(production({ EXPECTED_PRODUCTION_DB_HOST: '' }))).toThrow(
      TargetRefused,
    );
  });

  it('refuses production without an expected database name', () => {
    expect(() => assertPhotoTarget(production({ EXPECTED_PRODUCTION_DB_NAME: '' }))).toThrow(
      TargetRefused,
    );
  });

  it('refuses staging without an expected host', () => {
    expect(() => assertPhotoTarget(staging({ EXPECTED_STAGING_DB_HOST: '' }))).toThrow(
      /EXPECTED_STAGING_DB_HOST/,
    );
  });

  it('refuses staging without an expected database name', () => {
    expect(() => assertPhotoTarget(staging({ EXPECTED_STAGING_DB_NAME: '' }))).toThrow(
      /EXPECTED_STAGING_DB_NAME/,
    );
  });

  it('refuses when DATABASE_URL is absent', () => {
    expect(() => assertPhotoTarget(staging({ DATABASE_URL: '' }))).toThrow(/DATABASE_URL/);
  });
});

describe('staging may never write into the production vault', () => {
  it('refuses the production bucket under staging', () => {
    expect(() => assertPhotoTarget(staging({ R2_BUCKET: PRODUCTION_VAULT_BUCKET }))).toThrow(
      /production vault/i,
    );
  });

  it('explains why, since the reason is not obvious from the rule', () => {
    try {
      assertPhotoTarget(staging({ R2_BUCKET: PRODUCTION_VAULT_BUCKET }));
      throw new Error('should have refused');
    } catch (err: any) {
      expect(err.message).toMatch(/no\s+environment namespace|indistinguishable/i);
    }
  });

  it('requires production to use the production vault', () => {
    expect(() => assertPhotoTarget(production({ R2_BUCKET: STAGING_BUCKET }))).toThrow(
      /must use the production vault/i,
    );
  });

  it('refuses when no bucket is named at all', () => {
    expect(() => assertPhotoTarget(staging({ R2_BUCKET: '' }))).toThrow(/R2_BUCKET/);
  });
});

describe('an ambiguous environment is refused, not guessed', () => {
  for (const appEnv of ['', 'dev', 'development', 'test', 'prod', 'PRODUCTION_LIKE', 'stage']) {
    it(`refuses APP_ENV="${appEnv}"`, () => {
      expect(() => assertPhotoTarget(staging({ APP_ENV: appEnv }))).toThrow(/APP_ENV/);
    });
  }

  it('accepts the declared values case-insensitively', () => {
    expect(assertPhotoTarget(staging({ APP_ENV: 'STAGING' })).environment).toBe('staging');
    expect(assertPhotoTarget(production({ APP_ENV: 'Production' })).environment).toBe('production');
  });
});

describe('no diagnostic carries a password', () => {
  const refusals = [
    () => assertPhotoTarget(production({ DATABASE_URL: url('wrong.host', PROD_DB) })),
    () => assertPhotoTarget(staging({ DATABASE_URL: url(STAGING_HOST, 'wrong_db') })),
    () => assertPhotoTarget(staging({ R2_BUCKET: PRODUCTION_VAULT_BUCKET })),
    () => assertPhotoTarget(staging({ APP_ENV: 'dev' })),
    () => assertPhotoTarget(staging({ DATABASE_URL: url(PROD_HOST, PROD_DB) })),
  ];

  it.each(refusals.map((fn, i) => [i, fn]))('refusal %i leaks nothing', (_i, fn: any) => {
    try {
      fn();
      throw new Error('should have refused');
    } catch (err: any) {
      expect(err.message).not.toContain(SECRET);
      expect(err.message).not.toContain('postgresql://');
    }
  });

  it('returns an identity without a password or connection string', () => {
    const target = assertPhotoTarget(production());

    expect(JSON.stringify(target)).not.toContain(SECRET);
    expect(JSON.stringify(target)).not.toContain('postgresql://');
  });
});

describe('both runners actually call the guard', () => {
  // A guard nothing invokes protects nothing.
  const read = (name: string) =>
    readFileSync(resolve(__dirname, '../../scripts/backup', name), 'utf8');

  for (const runner of ['run-photo-archive.ts', 'run-photo-reconcile.ts']) {
    it(`${runner} asserts its target before connecting`, () => {
      const src = read(runner);

      expect(src).toMatch(/assertPhotoTarget\(process\.env\)/);

      const guardAt = src.indexOf('assertPhotoTarget(process.env)');
      const clientAt = src.indexOf('new PrismaClient(');
      expect(guardAt).toBeGreaterThan(-1);
      expect(clientAt).toBeGreaterThan(guardAt);
    });

    it(`${runner} prints no connection string`, () => {
      const src = read(runner);
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

      expect(code).not.toMatch(/console\.\w+\([^)]*DATABASE_URL/);
      expect(code).not.toMatch(/console\.\w+\([^)]*R2_SECRET/);
      expect(code).not.toMatch(/console\.\w+\([^)]*CLOUDINARY_API_SECRET/);
    });
  }
});
