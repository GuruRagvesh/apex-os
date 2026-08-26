/**
 * Production database backup.
 *
 *   npx ts-node scripts/backup/run-database-backup.ts
 *   npx ts-node scripts/backup/run-database-backup.ts --type=PRE_MIGRATION
 *
 * Intended to be driven by a Render Cron Job, NOT by the API process. The
 * backup lifecycle must not depend on the application staying alive, and a
 * multi-replica API would otherwise run one backup per replica.
 *
 * Render cron schedules are UTC. The business schedule is 02:30 Asia/Kolkata,
 * which is UTC+05:30, so the cron expression is:
 *
 *     0 21 * * *        21:00 UTC = 02:30 IST the following calendar day
 *
 * Environment (all supplied by the operator, never committed):
 *
 *   APP_ENV=production
 *   DATABASE_URL
 *   EXPECTED_PRODUCTION_DB_HOST     read independently from the dashboard
 *   EXPECTED_PRODUCTION_DB_NAME     likewise
 *   R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET
 *
 * Exits non-zero on FAILED so the cron platform reports it. A backup that
 * fails quietly is worse than none, because it removes the reason to look.
 */

import { execFile } from 'child_process';
import { mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { assertProductionTarget, mask, TargetRefused } from './backup-identity';
import {
  applyRun,
  markFailed,
  objectKeyFor,
  startManifest,
  verifyAndComplete,
  type BackupManifest,
  type BackupState,
  type BackupStatus,
  type BackupType,
} from './backup-manifest';
import { createR2Vault, readR2Config, sha256File, type Vault } from './r2-vault';

const execFileAsync = promisify(execFile);

export interface BackupDeps {
  vault: Vault;
  /** Runs pg_dump. Injected so the orchestrator is testable without a database. */
  dump: (databaseUrl: string, outPath: string) => Promise<void>;
  /** Reads the server version, so client compatibility can be proven. */
  serverVersion: (databaseUrl: string) => Promise<string>;
  /** The local pg_dump major version. */
  clientMajorVersion: () => Promise<number>;
  now: () => Date;
  loadState: () => Promise<BackupState>;
  saveState: (state: BackupState) => Promise<void>;
  saveManifest: (manifest: BackupManifest) => Promise<void>;
}

export function majorVersion(versionString: string): number {
  const m = /(\d+)/.exec(versionString.trim());
  return m ? Number(m[1]) : Number.NaN;
}

export interface BackupOutcome {
  manifest: BackupManifest;
  state: BackupState;
}

/**
 * One backup run.
 *
 * Every early return is a FAILED manifest rather than a thrown error, because
 * the FAILURE ITSELF is a thing that must be recorded. Throwing would leave no
 * trace beyond a cron exit code.
 */
export async function runBackup(
  env: NodeJS.ProcessEnv,
  type: BackupType,
  deps: BackupDeps,
): Promise<BackupOutcome> {
  const startedAt = deps.now().toISOString();
  const state = await deps.loadState();

  let manifest = startManifest({
    backupId: randomUUID(),
    type,
    environment: 'production',
    databaseName: '(unverified)',
    startedAt,
  });

  const fail = async (reason: string): Promise<BackupOutcome> => {
    const failed = markFailed(manifest, reason, deps.now().toISOString());
    const next = applyRun(state, failed);
    // Best effort: if the vault is the thing that is broken, recording the
    // failure there will fail too. The run is still FAILED and the caller
    // still exits non-zero -- losing the record must not lose the signal.
    try {
      await deps.saveManifest(failed);
      await deps.saveState(next);
    } catch (err: any) {
      console.error(`  (failure record could not be persisted: ${err?.message ?? err})`);
    }
    return { manifest: failed, state: next };
  };

  // 1. Prove which database this is before reading a byte of it.
  let identity;
  try {
    identity = assertProductionTarget(env);
  } catch (err) {
    return fail(err instanceof TargetRefused ? err.message : String(err));
  }
  manifest = { ...manifest, databaseName: mask(identity.database) };

  const databaseUrl = env.DATABASE_URL!;

  // 2. Prove the client can dump this server. An older pg_dump refuses a newer
  //    server, and finding that out mid-window is the wrong moment.
  let serverVersion: string;
  try {
    serverVersion = await deps.serverVersion(databaseUrl);
    const serverMajor = majorVersion(serverVersion);
    const clientMajor = await deps.clientMajorVersion();
    if (!Number.isFinite(serverMajor) || !Number.isFinite(clientMajor)) {
      return fail(`Could not determine PostgreSQL versions (server "${serverVersion}").`);
    }
    if (clientMajor < serverMajor) {
      return fail(
        `pg_dump major version ${clientMajor} cannot dump a PostgreSQL ${serverMajor} server. ` +
          'Upgrade the client in the backup image.',
      );
    }
  } catch (err: any) {
    return fail(`Could not read server version: ${err?.message ?? err}`);
  }
  manifest = { ...manifest, serverVersion };

  // 3. Vault must be configured BEFORE producing a dump, so a misconfiguration
  //    never leaves a temporary file behind for nothing.
  let vault: Vault;
  try {
    vault = deps.vault;
  } catch (err: any) {
    return fail(err?.message ?? String(err));
  }

  const workDir = mkdtempSync(join(tmpdir(), 'apex-backup-'));
  const localPath = join(workDir, 'apex-os.dump');

  try {
    await deps.dump(databaseUrl, localPath);

    const byteSize = statSync(localPath).size;
    const sha256 = await sha256File(localPath);
    const objectKey = objectKeyFor(type, deps.now(), 'prod');

    await vault.put(objectKey, localPath);

    // 4. The only thing that makes this a backup: a verified remote copy.
    const remote = await vault.head(objectKey);
    manifest = verifyAndComplete(
      manifest,
      { objectKey, byteSize, sha256 },
      remote,
      deps.now().toISOString(),
    );
  } catch (err: any) {
    return fail(err?.message ?? String(err));
  } finally {
    // The temporary file is not the backup and must never outlive the run,
    // succeeded or failed. Render's disk is ephemeral anyway; leaving files
    // behind only risks filling it mid-job.
    rmSync(workDir, { recursive: true, force: true });
  }

  if (manifest.status !== 'SUCCESS') {
    return fail(manifest.failureReason ?? 'Backup did not complete.');
  }

  // The dump object alone is not a usable backup. Without a durable manifest
  // and last-successful marker there is no record of what was taken, what its
  // checksum was, or whether last night's run worked -- and those cannot live
  // on Render's ephemeral disk. If they cannot be persisted, the run FAILED.
  try {
    await deps.saveManifest(manifest);
    await deps.saveState(applyRun(state, manifest));
  } catch (err: any) {
    return fail(
      `Dump uploaded and verified, but its manifest/state could not be persisted: ` +
        `${err?.message ?? err}`,
    );
  }

  return { manifest, state: applyRun(state, manifest) };
}

/**
 * The process exit code for a finished run.
 *
 * A FAILED manifest with exit 0 is the worst combination available: Render
 * marks the cron execution successful, nobody looks, and the gap is discovered
 * when a restore is needed. The status and the exit code must agree.
 */
export function exitCodeFor(status: BackupStatus): number {
  return status === 'SUCCESS' ? 0 : 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Real dependencies
// ─────────────────────────────────────────────────────────────────────────────

async function readServerVersion(databaseUrl: string): Promise<string> {
  // Prisma rather than a second Postgres driver: it is already a dependency,
  // and this is a single read-only query.
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const rows = await prisma.$queryRaw<Array<{ server_version: string }>>`SHOW server_version`;
    return String(rows[0]?.server_version ?? '');
  } finally {
    await prisma.$disconnect();
  }
}

async function readClientMajor(): Promise<number> {
  const { stdout } = await execFileAsync('pg_dump', ['--version']);
  // "pg_dump (PostgreSQL) 18.4"
  const m = /(\d+)\.\d+/.exec(stdout);
  return m ? Number(m[1]) : Number.NaN;
}

async function pgDump(databaseUrl: string, outPath: string): Promise<void> {
  // Custom format: compressed, and the only format pg_restore can filter and
  // reorder from. A plain SQL dump would restore, but far less flexibly.
  await execFileAsync(
    'pg_dump',
    ['--format=custom', '--compress=9', '--no-owner', '--no-privileges', '--file', outPath, databaseUrl],
    { maxBuffer: 64 * 1024 * 1024 },
  );
}

if (require.main === module) {
  const typeArg = process.argv.find((a) => a.startsWith('--type='));
  const type = (typeArg?.split('=')[1] ?? 'DAILY') as BackupType;

  (async () => {
    console.log('── Apex OS production database backup ─────────────────────────');
    console.log(`  type            : ${type}`);

    const vault = createR2Vault(readR2Config(process.env));
    const statePath = join(tmpdir(), 'apex-backup-state.json');

    const outcome = await runBackup(process.env, type, {
      vault,
      dump: pgDump,
      serverVersion: readServerVersion,
      clientMajorVersion: readClientMajor,
      now: () => new Date(),
      // State lives in the vault, not on the ephemeral disk. The local file is
      // only a scratch copy for this process.
      loadState: async () => {
        try {
          await vault.getToFile('state/backup-state.json', statePath);
          const { readFileSync } = await import('fs');
          return JSON.parse(readFileSync(statePath, 'utf8'));
        } catch {
          return {
            lastSuccessfulAt: null,
            lastSuccessfulObjectKey: null,
            lastAttemptAt: null,
            lastAttemptStatus: null,
          };
        }
      },
      saveState: async (state) => {
        const { writeFileSync } = await import('fs');
        writeFileSync(statePath, JSON.stringify(state, null, 2));
        await vault.put('state/backup-state.json', statePath, 'application/json');
      },
      saveManifest: async (manifest) => {
        const p = join(tmpdir(), `manifest-${manifest.backupId}.json`);
        const { writeFileSync } = await import('fs');
        writeFileSync(p, JSON.stringify(manifest, null, 2));
        await vault.put(`manifests/${manifest.startedAt.slice(0, 10)}/${manifest.backupId}.json`, p, 'application/json');
        rmSync(p, { force: true });
      },
    });

    console.log(`  database        : ${outcome.manifest.databaseName}`);
    console.log(`  server version  : ${outcome.manifest.serverVersion ?? '(unknown)'}`);
    console.log(`  object          : ${outcome.manifest.objectKey ?? '(none)'}`);
    console.log(`  bytes           : ${outcome.manifest.byteSize ?? '(none)'}`);
    console.log(`  status          : ${outcome.manifest.status}`);

    if (outcome.manifest.status !== 'SUCCESS') {
      console.error(`\nBACKUP FAILED: ${outcome.manifest.failureReason}\n`);
      console.error(`Last successful backup remains: ${outcome.state.lastSuccessfulAt ?? 'NONE'}`);
      process.exit(exitCodeFor(outcome.manifest.status));
    }
    console.log(`\nBACKUP VERIFIED IN VAULT. Last successful: ${outcome.state.lastSuccessfulAt}\n`);
  })().catch((err) => {
    console.error('\nBACKUP ABORTED:', err?.message ?? err);
    process.exit(1);
  });
}
