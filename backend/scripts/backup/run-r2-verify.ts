/**
 * R2 database-backup vault health check. Backend-only.
 *
 *   npm run admin:r2:verify -- --environment=staging
 *
 * Proves the vault a database backup would go to is the right one and works,
 * without reading the database or any backup:
 *
 *   1. APP_ENV equals --environment, and assertBackupTarget accepts the target:
 *      the database identity in DATABASE_URL matches EXPECTED_<ENV>_DB_HOST /
 *      _NAME (string checks only; no connection is opened), production uses
 *      exactly the production vault, staging exactly EXPECTED_STAGING_VAULT_BUCKET.
 *   2. Random bytes are written to healthcheck/<environment>/<uuid>.
 *   3. The remote size is checked, the object downloaded, and SHA-256 compared.
 *   4. The object is deleted and confirmed gone.
 *   5. The local temporary file is removed.
 *
 * Never prints credentials or URLs. Exits non-zero on any failure, and removes
 * the remote test object whenever it was created.
 */

import { createHash, randomBytes, randomUUID } from 'crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createR2Vault, readR2Config, type Vault } from '../../src/modules/platform/backup-vault/r2-vault';
import { assertBackupTarget, mask, type BackupTarget } from './backup-identity';

export interface R2Check {
  step: string;
  ok: boolean;
  detail: string;
}

/** Resolves and validates the target. Throws TargetRefused without any credential in the message. */
export function r2Target(env: NodeJS.ProcessEnv, environment: string): BackupTarget {
  const wanted = (environment ?? '').trim().toLowerCase();
  if (wanted !== 'staging' && wanted !== 'production') throw new Error('--environment must be "staging" or "production".');
  const appEnv = (env.APP_ENV ?? '').trim().toLowerCase();
  if (appEnv !== wanted) throw new Error(`APP_ENV is "${appEnv || '(unset)'}" but --environment is "${wanted}".`);
  return assertBackupTarget(env);
}

export async function verifyR2Vault(vault: Vault, target: BackupTarget): Promise<R2Check[]> {
  const checks: R2Check[] = [{ step: 'target', ok: true, detail: `${target.environment} database ${mask(target.database)} -> vault ${target.bucket}` }];
  const fail = (step: string, detail: string) => {
    checks.push({ step, ok: false, detail });
    return checks;
  };
  const key = `healthcheck/${target.environment}/${randomUUID()}`;
  const dir = mkdtempSync(join(tmpdir(), 'apex-r2-verify-'));
  let created = false;
  try {
    const bytes = randomBytes(64 * 1024 + 17);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const local = join(dir, 'probe.bin');
    writeFileSync(local, bytes);

    await vault.put(key, local, 'application/octet-stream');
    created = true;
    checks.push({ step: 'upload', ok: true, detail: 'Test object written under healthcheck/.' });

    const head = await vault.head(key);
    if (!head || head.byteSize !== bytes.length) return fail('size', head ? `Remote size ${head.byteSize}, expected ${bytes.length}.` : 'Test object not found after upload.');
    checks.push({ step: 'size', ok: true, detail: 'Remote size matches.' });

    const back = join(dir, 'probe.download');
    await vault.getToFile(key, back);
    if (createHash('sha256').update(readFileSync(back)).digest('hex') !== sha) return fail('download', 'Downloaded copy has a different SHA-256.');
    checks.push({ step: 'download', ok: true, detail: 'Downloaded copy matches by SHA-256.' });

    await vault.remove(key);
    if (await vault.head(key)) return fail('delete', 'Test object still exists after deletion.');
    created = false;
    checks.push({ step: 'delete', ok: true, detail: 'Test object deleted and confirmed gone.' });
    return checks;
  } catch (err: any) {
    return fail('roundtrip', String(err?.message ?? err).split('\n')[0].slice(0, 200));
  } finally {
    if (created) await vault.remove(key).catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const environment = process.argv.slice(2).find((a) => a.startsWith('--environment='))?.split('=')[1] ?? '';
  console.log('── Apex OS R2 backup vault check ──────────────────────────────');
  const target = r2Target(process.env, environment);
  const checks = await verifyR2Vault(createR2Vault(readR2Config(process.env)), target);
  for (const c of checks) console.log(`  ${c.ok ? 'OK  ' : 'FAIL'} ${c.step.padEnd(9)} ${c.detail}`);
  const ok = checks.every((c) => c.ok) && checks.some((c) => c.step === 'delete');
  console.log(ok ? '\nBACKUP VAULT VERIFIED.\n' : '\nBACKUP VAULT CHECK FAILED.\n');
  return ok ? 0 : 1;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('\nR2 CHECK ABORTED:', err?.message ?? err);
      process.exit(1);
    });
}
