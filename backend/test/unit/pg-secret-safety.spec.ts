import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  redactConnectionString,
  redactSecrets,
  toPgTarget,
} from '../../scripts/backup/pg-connection';
import { runRestoreTest, type RestoreDeps } from '../../scripts/backup/run-restore-test';
import type { Vault } from '../../scripts/backup/r2-vault';
import { BASELINE_TABLES } from '../../scripts/backup/schema-expectations';

// A real incident: a failed restore printed the whole pg_restore command,
// which carried the live database password, into the terminal. The same text
// would have reached Render and CI logs.
//
// The password is a sentinel here so any leak is unambiguous — if it appears
// anywhere in output, a report, or a thrown error, one of these fails.

const SENTINEL = 'S3nt1nel-Pa55w0rd-DoNotLeak';
const TARGET_URL = `postgresql://apex_user:${SENTINEL}@localhost:5432/apex_restore_test`;

describe('connection strings never carry a password into a command', () => {
  it('strips the password from the printable connection string', () => {
    const target = toPgTarget(TARGET_URL);

    expect(target.safeConnectionString).not.toContain(SENTINEL);
    expect(target.password).toBe(SENTINEL);
  });

  it('keeps what makes an error diagnosable', () => {
    const target = toPgTarget(TARGET_URL);

    expect(target.host).toBe('localhost');
    expect(target.port).toBe('5432');
    expect(target.database).toBe('apex_restore_test');
    expect(target.user).toBe('apex_user');
  });

  it('rebuilds rather than string-replacing, so odd passwords still go', () => {
    // A password full of regex or URL metacharacters would survive a naive
    // replace and leak.
    const nasty = encodeURIComponent('p@ss:w/rd?&=+$#%');
    const target = toPgTarget(`postgresql://u:${nasty}@h:5432/db`);

    expect(target.safeConnectionString).not.toContain(nasty);
    expect(target.safeConnectionString).not.toContain('p%40ss');
  });

  it('redacts a password inside arbitrary text', () => {
    const line = `pg_restore --dbname ${TARGET_URL} /tmp/x.dump`;

    expect(redactConnectionString(line)).not.toContain(SENTINEL);
  });

  it('redacts known secrets from tool output', () => {
    expect(redactSecrets(`error near ${SENTINEL} while connecting`, [SENTINEL])).not.toContain(
      SENTINEL,
    );
  });

  it('does not mangle text when there is no secret to remove', () => {
    expect(redactSecrets('plain message', [null, undefined, ''])).toBe('plain message');
  });

  it('ignores implausibly short secrets rather than shredding output', () => {
    expect(redactSecrets('a boring message', ['a'])).toBe('a boring message');
  });
});

describe('the restore report never carries the password', () => {
  const env = { APP_ENV: 'test', RESTORE_TARGET_DATABASE_URL: TARGET_URL };

  const vault: Vault = {
    async getToFile(_key, dest) {
      const { writeFileSync } = await import('fs');
      writeFileSync(dest, Buffer.alloc(2_000_000, 3));
    },
    async put() {},
    async head() {
      return null;
    },
    async list() {
      return [];
    },
    async remove() {},
  };

  const deps = (over: Partial<RestoreDeps> = {}): RestoreDeps => ({
    vault,
    restore: async () => {},
    countRows: async () => 42,
    listTables: async () => [...BASELINE_TABLES],
    listAppliedMigrations: async () => ['20260101000000_init'],
    migrationTables: () => ({}),
    now: () => new Date(),
    ...over,
  });

  it('is absent from a successful report', async () => {
    const report = await runRestoreTest(env, 'database/daily/a.dump', null, deps());

    expect(JSON.stringify(report)).not.toContain(SENTINEL);
  });

  it('is absent when pg_restore fails with the command in its message', async () => {
    // This is the exact shape of the original leak: the exec error message
    // embedding the full command line.
    const report = await runRestoreTest(
      env,
      'database/daily/a.dump',
      null,
      deps({
        restore: async () => {
          throw new Error(
            `Command failed: pg_restore --dbname ${TARGET_URL} /tmp/restore.dump`,
          );
        },
      }),
    );

    expect(report.passed).toBe(false);
    expect(JSON.stringify(report)).not.toContain(SENTINEL);
    expect(report.failureReason).toContain('***');
  });

  it('is absent when a table check throws with connection details', async () => {
    const report = await runRestoreTest(
      env,
      'database/daily/a.dump',
      null,
      deps({
        countRows: async () => {
          throw new Error(`connect failed for ${TARGET_URL}`);
        },
      }),
    );

    expect(JSON.stringify(report.checks)).not.toContain(SENTINEL);
  });

  it('still names the failure usefully after redaction', async () => {
    // Redaction must not turn a diagnosable error into a blank one.
    const report = await runRestoreTest(
      env,
      'database/daily/a.dump',
      null,
      deps({
        restore: async () => {
          throw new Error(`pg_restore failed: password authentication failed`);
        },
      }),
    );

    expect(report.failureReason).toContain('password authentication failed');
  });
});

describe('neither runner puts a connection string in argv', () => {
  const read = (name: string) =>
    readFileSync(resolve(__dirname, '../../scripts/backup', name), 'utf8');

  it('pg_restore receives the password-free target', () => {
    const src = read('run-restore-test.ts');

    expect(src).toMatch(/runPgTool\(\s*'pg_restore'/);
    expect(src).toMatch(/target\.safeConnectionString/);
    // The raw URL must not be handed to the tool.
    expect(src).not.toMatch(/'--dbname',\s*databaseUrl/);
  });

  it('pg_dump receives the password-free target too', () => {
    // The backup path had the same defect: a failure would have copied the
    // production password into the manifest and then into R2.
    const src = read('run-database-backup.ts');

    expect(src).toMatch(/runPgTool\(\s*'pg_dump'/);
    expect(src).toMatch(/target\.safeConnectionString/);
    expect(src).not.toMatch(/'--file',\s*outPath,\s*databaseUrl/);
  });

  it('passes the password through the environment instead', () => {
    const src = read('pg-connection.ts');

    expect(src).toMatch(/PGPASSWORD: target\.password/);
  });

  it('never logs the restore target variable', () => {
    const src = read('run-restore-test.ts');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code).not.toMatch(/console\.\w+\([^)]*RESTORE_TARGET_DATABASE_URL/);
    expect(code).not.toMatch(/console\.\w+\([^)]*targetUrl/);
  });
});
