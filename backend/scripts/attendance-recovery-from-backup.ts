/**
 * September attendance recovery — DRY RUN ONLY.
 *
 *   APP_ENV=staging \
 *   SOURCE_DATABASE_URL=<local apex_restore_test restored from the R2 backup> \
 *   STAGING_DATABASE_URL=<active staging EXTERNAL url> \
 *   FROM_DATE=2026-09-01 TO_DATE=2026-09-30 \
 *     npx ts-node --transpile-only scripts/attendance-recovery-from-backup.ts
 *
 * Reads two databases and compares them employee-day by employee-day using the
 * existing recovery domain (AttendanceDayBundle, classifyDay, checkReferences,
 * evaluateDamage). It reports what a missing-only recovery WOULD insert.
 *
 * This build has NO write path: the only database handle is a findMany-only
 * ReadOnlyDb, and DRY_RUN=false is refused. Nothing is created, updated,
 * upserted, deleted or migrated, on either side.
 *
 * Prints counts, hosts and database names only. Never a URL, user or password.
 * Optional: EMPLOYEE_NAME_FILTER="Name One,Name Two" prints those employees'
 * Monthly Register figures side by side; REPORT_PATH writes the per-day verdicts
 * (employee id, date, bucket, reason codes — no row content) as JSON.
 */
import { writeFileSync } from 'fs';
import { checkRecoveryTargets } from './attendance-recovery/recovery-targets';
import { openReadOnlyDb } from './attendance-recovery/read-only-db';
import { companyBusinessDate, companyTimezone, readSide, readTargetFacts } from './attendance-recovery/side-reader';
import { BUCKETS, compareRegisters, countBundles, reconcile, registerFor, REGISTER_FIELDS } from './attendance-recovery/reconcile-report';

const top = (counts: Record<string, number>, n = 15) =>
  Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);

function scrub(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join('***');
  return out.replace(/postgres(ql)?:\/\/[^\s'"`]+/gi, '<url>');
}

async function main() {
  const tz = companyTimezone();
  const companyToday = companyBusinessDate(new Date(), tz);
  const secrets: string[] = [];
  for (const raw of [process.env.SOURCE_DATABASE_URL, process.env.STAGING_DATABASE_URL]) {
    if (!raw) continue;
    secrets.push(raw);
    try { const u = new URL(raw); secrets.push(u.password, decodeURIComponent(u.password), u.username); } catch { /* reported by the target check */ }
  }

  console.log('Attendance recovery — September dry run (read-only)\n');
  const t = checkRecoveryTargets(process.env, companyToday);
  if (t.staging) console.log(`Target (staging)  host: ${t.staging.host}\n                  db:   ${t.staging.database}`);
  if (t.source) console.log(`Source (restored) host: ${t.source.host}\n                  db:   ${t.source.database}`);
  console.log(`APP_ENV: ${process.env.APP_ENV ?? '(unset)'}   company today: ${companyToday}`);
  if (!t.ok) {
    console.error(`\nREFUSED (${t.code}): ${t.reason}. No database was opened.`);
    process.exit(1);
  }
  const { from, to } = t;
  console.log(`Range: ${from} .. ${to}   DRY_RUN: true (no write path exists)\n`);

  const source = openReadOnlyDb(process.env.SOURCE_DATABASE_URL!);
  const target = openReadOnlyDb(process.env.STAGING_DATABASE_URL!);
  try {
    const src = await readSide(source.db, from!, to!, 'r2-backup-restore', tz);
    const tgt = await readSide(target.db, from!, to!, 'staging', tz);
    const facts = await readTargetFacts(target.db, tgt, src.bundles, from!, to!);

    const employees = (side: { bundles: Map<string, { employeeId: string }> }) => new Set([...side.bundles.values()].map((b) => b.employeeId)).size;
    const srcCounts = countBundles(src.bundles.values());
    const tgtCounts = countBundles(tgt.bundles.values());
    console.log('SOURCE (restored R2 backup)');
    console.log(`  employees: ${employees(src)}   employee-days: ${src.bundles.size}   unkeyed users (no employeeId): ${src.unkeyedUserIds.length}`);
    console.log(`  DailyAttendance ${srcCounts.dailyAttendance}  WorkSessions ${srcCounts.workSessions}  BreakLogs ${srcCounts.breakLogs}  PunchEvidence ${srcCounts.punchEvidence}  Regularizations ${srcCounts.regularizations}`);
    console.log('ACTIVE STAGING (before)');
    console.log(`  employees: ${employees(tgt)}   employee-days: ${tgt.bundles.size}   unkeyed users (no employeeId): ${tgt.unkeyedUserIds.length}`);
    console.log(`  DailyAttendance ${tgtCounts.dailyAttendance}  WorkSessions ${tgtCounts.workSessions}  BreakLogs ${tgtCounts.breakLogs}  PunchEvidence ${tgtCounts.punchEvidence}  Regularizations ${tgtCounts.regularizations}`);
    console.log(`  tombstone table: ${facts.tombstoneTableAbsent ? 'ABSENT (recovery migrations not applied; none could exist)' : `present (${facts.tombstones.length} in range)`}`);
    console.log(`  month close: ${[...facts.monthClose].map(([m, s]) => `${m}=${s}`).join(', ') || '(none recorded)'}`);

    const report = reconcile({
      companyToday,
      source: src.bundles,
      sourceProblems: src.problems,
      target: tgt.bundles,
      targetEmployeeIndex: facts.employeeIndex,
      referenceContext: facts.referenceContext,
      tombstones: facts.tombstones,
      monthClose: facts.monthClose,
      idCollisions: facts.idCollisions,
    });

    console.log('\nEMPLOYEE-DAY RECONCILIATION');
    for (const b of BUCKETS) console.log(`  ${b.padEnd(20)} ${report.buckets[b]}`);
    if (Object.keys(report.reasonCounts).length) {
      console.log('  reasons (blocked / invalid):');
      for (const [r, n] of top(report.reasonCounts)) console.log(`    ${r.padEnd(60)} ${n}`);
    }
    if (Object.keys(report.differingFieldCounts).length) {
      console.log('  fields that differ (DIFFERENT days):');
      for (const [f, n] of top(report.differingFieldCounts)) console.log(`    ${f.padEnd(60)} ${n}`);
    }

    console.log('\nWOULD INSERT (eligible SOURCE_ONLY days only)');
    console.log(`  DailyAttendance ${report.wouldInsert.dailyAttendance}  WorkSessions ${report.wouldInsert.workSessions}  BreakLogs ${report.wouldInsert.breakLogs}  PunchEvidence ${report.wouldInsert.punchEvidence}  Regularizations ${report.wouldInsert.regularizations}`);
    console.log(`  would update: ${report.wouldUpdate}   would delete: ${report.wouldDelete}`);
    console.log(`  damage verdict: ${report.damage.decision}${report.damage.reasons.length ? ` (${report.damage.reasons.join(', ')})` : ''}`);
    console.log('  DailyAttendance days per month  (month: staging / source)');
    for (const m of report.perMonth) console.log(`    ${m.month}: ${m.targetDays} / ${m.sourceDays}`);

    const deltas = compareRegisters(registerFor(src), registerFor(tgt));
    const mismatched = deltas.filter((d) => d.mismatchedFields.length > 0);
    console.log('\nMONTHLY REGISTER (same summarise() as the register), source vs staging');
    console.log(`  employees compared: ${deltas.length}   with any difference: ${mismatched.length}   identical: ${deltas.length - mismatched.length}`);
    const filters = (process.env.EMPLOYEE_NAME_FILTER ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const named = deltas.filter((d) => filters.some((f) => d.name.toLowerCase().includes(f)));
    const biggest = [...mismatched]
      .sort((a, b) => Math.abs((b.source?.present ?? 0) - (b.target?.present ?? 0)) - Math.abs((a.source?.present ?? 0) - (a.target?.present ?? 0)))
      .slice(0, 8);
    const show = [...new Map([...named, ...biggest].map((d) => [d.employeeId, d])).values()];
    for (const d of show) {
      console.log(`  ${d.employeeId} ${d.name}${named.includes(d) ? '   [requested]' : ''}`);
      for (const f of REGISTER_FIELDS) {
        const s = d.source?.[f];
        const x = d.target?.[f];
        if (d.mismatchedFields.includes(f) || named.includes(d)) console.log(`      ${f.padEnd(15)} source ${String(s ?? 'n/a').padStart(6)}   staging ${String(x ?? 'n/a').padStart(6)}${s !== x ? '   <-- differs' : ''}`);
      }
    }
    for (const f of filters) if (!named.some((d) => d.name.toLowerCase().includes(f))) console.log(`  (no employee matching "${f}" in either database)`);

    if (process.env.REPORT_PATH) {
      writeFileSync(process.env.REPORT_PATH, JSON.stringify({ from, to, buckets: report.buckets, verdicts: report.verdicts }, null, 2));
      console.log(`\nPer-day verdicts written to REPORT_PATH.`);
    }
    console.log('\nDRY RUN COMPLETE. Nothing was written to either database.');
  } catch (err: any) {
    console.error(`\nFAILED: ${scrub(String(err?.message ?? err), secrets)}`);
    process.exitCode = 1;
  } finally {
    await Promise.allSettled([source.close(), target.close()]);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Recovery tool failed:', String(e?.message ?? e).replace(/postgres(ql)?:\/\/[^\s'"`]+/gi, '<url>'));
    process.exit(1);
  });
}
