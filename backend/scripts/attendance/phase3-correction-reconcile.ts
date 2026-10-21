/**
 * Gated, resumable reconciliation of legacy MANAGER_APPROVED corrections.
 * Dry-run is the default. Never rewrites legacy HR_APPROVED or REJECTED rows.
 */
import { writeFileSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CorrectionDecisionService } from '../../src/modules/platform/attendance/regularization/correction-decision.service';

function targetOf(url: string) { const u = new URL(url); return `${u.hostname}:${u.port || '5432'}/${u.pathname.replace(/^\//, '')}`; }
export function legacyRole(row: any, event: any): string {
  if (row.entrySource === 'MANUAL_RECOVERY' && row.actorRoleAtEntry) return row.actorRoleAtEntry;
  if (String(event?.toState ?? '').includes('admin override')) return 'ADMIN_OVERRIDE';
  const role = event?.metadata && typeof event.metadata === 'object' ? event.metadata.role : null;
  return role === 'TEAM_LEAD' || role === 'MANAGER' ? role : 'UNKNOWN_LEGACY';
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const value = (name: string) => args.find((x) => x.startsWith(`--${name}=`))?.slice(name.length + 3);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const target = targetOf(url);
  console.log(`Target: ${target}`);
  if (execute && value('confirm-target') !== target) throw new Error(`Refusing to write: pass --confirm-target=${target}`);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  try {
    const prisma = app.get(PrismaService);
    const service = app.get(CorrectionDecisionService);
    const rows = await prisma.attendanceRegularization.findMany({ where: { status: 'MANAGER_APPROVED' }, orderBy: [{ date: 'asc' }, { id: 'asc' }] });
    const proposals = [] as any[];
    for (const row of rows) {
      const event = await prisma.operationalEvent.findFirst({ where: { entityType: 'AttendanceRegularization', entityId: row.id, action: 'REGULARIZATION_MANAGER_APPROVED' }, orderBy: { timestamp: 'desc' } });
      proposals.push({ id: row.id, userId: row.userId, date: row.date.toISOString().slice(0, 10), actorId: row.managerApproverId, decidedByRole: legacyRole(row, event) });
    }
    if (!execute) { console.log(JSON.stringify({ dryRun: true, target, candidates: proposals.length, proposals }, null, 2)); return; }
    const results: any[] = [];
    for (const item of proposals) {
      if (!item.actorId) { results.push({ ...item, outcome: 'SKIPPED_NO_ACTOR' }); continue; }
      try { results.push({ ...item, outcome: await service.reconcileLegacyManagerApproval(item.id, item.actorId, item.decidedByRole) }); }
      catch (e) { results.push({ ...item, outcome: 'FAILED', error: e instanceof Error ? e.message.slice(0, 200) : 'unknown' }); }
    }
    const file = value('report-file') ?? `phase3-correction-reconcile-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    writeFileSync(file, JSON.stringify({ target, ranAt: new Date().toISOString(), note: 'Decision history is immutable. This report is audit evidence, not an undo script.', results }, null, 2));
    console.log(`Report written to ${file}`);
  } finally { await app.close(); }
}
if (require.main === module) main().catch((e) => { console.error(e instanceof Error ? e.message : 'Reconciliation failed'); process.exit(1); });
