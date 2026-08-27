/**
 * Retention sweep for the backup vault.
 *
 *   npm run backup:retention            # dry run — lists, deletes nothing
 *   npm run backup:retention -- --apply # deletes
 *
 * This is the only routine job that destroys recovery points, so it is built to
 * be timid and loud. Dry run is the default; `--apply` is required to delete
 * anything; and before the first deletion it proves the credential can actually
 * delete, using a throwaway probe object rather than an expired backup.
 *
 * That probe matters. A bucket-scoped token that turns out to lack delete
 * permission would otherwise fail partway through a sweep, leaving expired
 * objects behind and inviting somebody to widen the token to account-wide
 * admin to "fix" it. Better to find out against an object nobody needs.
 */

import { randomUUID } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  assertRetentionSane,
  classifyKey,
  DEFAULT_RETENTION,
  planRetention,
  type RetentionDecision,
  type VaultObject,
} from './backup-retention';
import { createR2Vault, readR2Config, type Vault } from './r2-vault';

export interface SweepDeps {
  vault: Vault;
  now: () => Date;
}

export interface SweepReport {
  scanned: number;
  keep: number;
  deleteCandidates: number;
  candidateBytes: number;
  deleted: number;
  applied: boolean;
  deletePermissionProven: boolean;
  failures: string[];
  decisions: RetentionDecision[];
}

/**
 * Proves the credential can delete, against an object created for the purpose.
 *
 * Round trip is put → head (present) → remove → head (absent). A token that
 * silently ignores deletes would pass the first three steps, so the final
 * absence check is the one that actually tests the permission.
 */
export async function proveDeletePermission(vault: Vault, now: Date): Promise<void> {
  const key = `probes/delete-check-${now.toISOString().slice(0, 10)}-${randomUUID()}.txt`;
  const dir = mkdtempSync(join(tmpdir(), 'apex-probe-'));
  const file = join(dir, 'probe.txt');

  try {
    writeFileSync(file, 'apex-os delete permission probe');
    await vault.put(key, file, 'text/plain');

    if (!(await vault.head(key))) {
      throw new Error('Probe object could not be read back after upload.');
    }
    await vault.remove(key);
    if (await vault.head(key)) {
      throw new Error(
        'Probe object still present after delete. The credential appears unable to delete.',
      );
    }
  } catch (err: any) {
    throw new Error(
      `Delete permission could not be proven: ${err?.message ?? err}. ` +
        'Fix the bucket-scoped token rather than widening it to account-wide access.',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function runSweep(deps: SweepDeps, apply: boolean): Promise<SweepReport> {
  const now = deps.now();

  // Whole vault, paginated by the client. A partial listing would make the
  // sweep believe fewer objects exist than really do.
  const listed = await deps.vault.list('');
  const objects: VaultObject[] = listed.map((o) => ({
    key: o.key,
    type: classifyKey(o.key),
    createdAt: o.lastModified,
    byteSize: o.byteSize,
  }));

  const decisions = planRetention(objects, now, DEFAULT_RETENTION);
  // Refuses a sweep that would empty the vault -- far likelier a clock fault
  // than a real expiry.
  assertRetentionSane(decisions);

  const candidates = decisions.filter((d) => d.action === 'DELETE');
  const byKey = new Map(objects.map((o) => [o.key, o]));
  const candidateBytes = candidates.reduce((sum, d) => sum + (byKey.get(d.key)?.byteSize ?? 0), 0);

  const report: SweepReport = {
    scanned: objects.length,
    keep: decisions.length - candidates.length,
    deleteCandidates: candidates.length,
    candidateBytes,
    deleted: 0,
    applied: apply,
    deletePermissionProven: false,
    failures: [],
    decisions,
  };

  if (!apply || candidates.length === 0) return report;

  await proveDeletePermission(deps.vault, now);
  report.deletePermissionProven = true;

  for (const candidate of candidates) {
    try {
      await deps.vault.remove(candidate.key);
      report.deleted += 1;
    } catch (err: any) {
      // One failed delete does not abort the sweep, but every one is reported:
      // a silently skipped object would keep accruing storage unnoticed.
      report.failures.push(`${candidate.key}: ${err?.message ?? err}`);
    }
  }
  return report;
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');

  (async () => {
    console.log('── Apex OS backup retention sweep ─────────────────────────────');
    console.log(`  mode            : ${apply ? 'APPLY (deletes)' : 'DRY RUN (deletes nothing)'}`);

    const vault = createR2Vault(readR2Config(process.env));
    const report = await runSweep({ vault, now: () => new Date() }, apply);

    console.log(`  scanned         : ${report.scanned}`);
    console.log(`  keep            : ${report.keep}`);
    console.log(`  delete candidates: ${report.deleteCandidates} (${report.candidateBytes} bytes)`);

    for (const d of report.decisions.filter((x) => x.action === 'DELETE')) {
      console.log(`    - ${d.key}  (${d.ageDays}d)  ${d.reason}`);
    }

    if (!apply) {
      console.log('\nDRY RUN COMPLETE. Nothing was deleted.');
      console.log('Re-run with --apply once the candidates above are correct.\n');
      return;
    }

    console.log(`  delete permission: ${report.deletePermissionProven ? 'proven' : 'not needed'}`);
    console.log(`  deleted         : ${report.deleted}`);

    if (report.failures.length > 0) {
      console.error(`\n${report.failures.length} object(s) could not be deleted:`);
      for (const f of report.failures) console.error(`  ${f}`);
      process.exit(1);
    }
    console.log('\nRETENTION SWEEP COMPLETE.\n');
  })().catch((err) => {
    console.error('\nRETENTION SWEEP ABORTED:', err?.message ?? err);
    process.exit(1);
  });
}
