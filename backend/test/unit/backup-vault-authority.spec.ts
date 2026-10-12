/**
 * ONE AUTHORITATIVE PRODUCTION VAULT.
 *
 * Apex OS briefly had two: R2 for database and photo backups, and OneDrive for
 * user archival -- the latter with an unresolved 404 and no verification after
 * upload, yet it was what gated making an account unusable.
 *
 * The OneDrive method still exists so a future business-readable archive has
 * somewhere to start. These tests make sure it cannot quietly become a safety
 * path again.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

const SRC = resolve(__dirname, '../../src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('R2 is the only vault that can gate production safety', () => {
  it('nothing in production code calls the OneDrive save()', () => {
    const offenders = walk(SRC)
      .filter((f) => !f.endsWith('backup-vault.service.ts'))
      .filter((f) => /\.save\(\s*buffer|backupVaultService\.save\(|vaultService\.save\(/.test(
        readFileSync(f, 'utf8'),
      ))
      .map((f) => f.slice(SRC.length + 1));

    expect(offenders).toEqual([]);
  });

  it('archival goes through the verified R2 path', () => {
    const users = readFileSync(
      resolve(SRC, 'modules/core/users/users.service.ts'),
      'utf8',
    );

    expect(users).toContain('archiveToVault(');
    expect(users).not.toContain('backupVaultService.save(');
  });

  it('the verified path reads the object back rather than trusting the upload', () => {
    const vault = readFileSync(
      resolve(SRC, 'modules/platform/backup-vault/backup-vault.service.ts'),
      'utf8',
    );
    const fn = vault.slice(vault.indexOf('async archiveToVault'));
    const body = fn.slice(0, fn.indexOf('\n  async '));

    expect(body).toContain('vault.head(');
    expect(body).toContain('head.byteSize !== buffer.length');
    // Missing configuration is a refusal, not a silent skip.
    expect(body).toContain('VaultNotConfigured');
  });

  it('the OneDrive method is marked as not a safety path', () => {
    const vault = readFileSync(
      resolve(SRC, 'modules/platform/backup-vault/backup-vault.service.ts'),
      'utf8',
    );

    expect(vault).toMatch(/@deprecated[\s\S]{0,120}archiveToVault/);
  });

  it('every backup script uses the shared R2 client, not its own', () => {
    const scripts = resolve(__dirname, '../../scripts/backup');
    const offenders: string[] = [];

    for (const f of readdirSync(scripts).filter((n) => n.endsWith('.ts'))) {
      const src = readFileSync(join(scripts, f), 'utf8');
      if (!/vault|Vault/.test(src)) continue;
      // A second S3Client anywhere would be a second credential path.
      if (/new S3Client\(/.test(src)) offenders.push(f);
    }

    expect(offenders).toEqual([]);
  });
});

describe('the backup cron fits in the memory it is given', () => {
  // Render's cron gave the process roughly a 256 MB heap. Plain `ts-node`
  // builds the whole type graph before running a line, exhausted it, and the
  // job died with exit 134 -- so pg_dump, R2 and every verification step in
  // this repository were never reached, and a green-looking config proved
  // nothing at all.
  //
  // --transpile-only skips typechecking at RUNTIME only. It is safe because
  // the types are still checked by `npm run typecheck:scripts`, which covers
  // scripts/**/* -- so the guarantee moves to the gate rather than being lost.

  const pkg = JSON.parse(
    readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };

  const backupScripts = Object.entries(pkg.scripts).filter(([name]) =>
    name.startsWith('backup:'),
  );

  it('every backup entrypoint runs transpile-only', () => {
    expect(backupScripts.length).toBeGreaterThan(0);

    for (const [name, cmd] of backupScripts) {
      if (!cmd.includes('ts-node')) continue;
      expect([name, cmd.includes('--transpile-only')]).toEqual([name, true]);
    }
  });

  it('the types are still checked somewhere', () => {
    // Without this, transpile-only would mean the backup scripts are never
    // typechecked at all.
    expect(pkg.scripts['typecheck:scripts']).toContain('tsconfig.scripts.json');

    const scriptsConfig = JSON.parse(
      readFileSync(resolve(__dirname, '../../tsconfig.scripts.json'), 'utf8'),
    ) as { include: string[] };
    expect(scriptsConfig.include.some((i) => i.startsWith('scripts/'))).toBe(true);
  });

  it('the cron command stays simple, with the flag in package.json', () => {
    // Render runs `npm run backup:database`. Putting the flag in the dashboard
    // instead would mean the repository and production disagree about how the
    // backup is executed.
    expect(pkg.scripts['backup:database']).toBe(
      'ts-node --transpile-only scripts/backup/run-database-backup.ts',
    );
  });

  it('none of the safety steps were traded away for memory', () => {
    const src = readFileSync(
      resolve(__dirname, '../../scripts/backup/run-database-backup.ts'),
      'utf8',
    );

    // The OOM was a runtime-execution problem. Nothing about what the backup
    // proves should have changed to fix it.
    expect(src).toContain('assertProductionTarget');   // right database
    expect(src).toContain('cannot dump a PostgreSQL');  // pg_dump version gate
    expect(src).toContain('sha256File');                // checksum
    expect(src).toContain('vault.put');                 // upload
    expect(src).toContain('vault.head');                // read-back
  });
});
