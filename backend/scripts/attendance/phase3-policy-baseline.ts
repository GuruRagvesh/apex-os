/**
 * Phase 3 policy-baseline repair. Dry-run by default.
 *
 * Creates an additive copy of the earliest policy in each series when no row
 * covers 2020-12-01. Existing versions are never edited. Execute mode is
 * deliberately gated by both the exact database target and a named active
 * Admin/Super Admin actor.
 */
import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import { Prisma, PrismaClient } from '@prisma/client';

const BASELINE = new Date('2020-12-01T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
type Family = 'attendance' | 'shift' | 'leave' | 'holiday' | 'weeklyOff';

function targetOf(url: string) {
  const u = new URL(url);
  return `${u.hostname}:${u.port || '5432'}/${u.pathname.replace(/^\//, '')}`;
}
function value(args: string[], name: string) {
  return args.find((x) => x.startsWith(`--${name}=`))?.slice(name.length + 3);
}
function priorDay(date: Date) { return new Date(date.getTime() - DAY); }

export interface BaselineProposal {
  family: Family;
  sourceId: string;
  policyKey: string;
  sourceEffectiveFrom: string;
  effectiveTo: string;
  proposedId: string;
  proposedVersion: number;
}

async function proposals(prisma: PrismaClient): Promise<BaselineProposal[]> {
  const out: BaselineProposal[] = [];
  const versioned: Array<{ family: Exclude<Family, 'weeklyOff'>; delegate: any }> = [
    { family: 'attendance', delegate: prisma.attendancePolicy },
    { family: 'shift', delegate: prisma.shiftPolicy },
    { family: 'leave', delegate: prisma.leavePolicy },
    { family: 'holiday', delegate: prisma.holidayCalendar },
  ];
  for (const { family, delegate } of versioned) {
    const rows = await delegate.findMany({ orderBy: [{ policyKey: 'asc' }, { effectiveFrom: 'asc' }, { version: 'asc' }] });
    const byKey = new Map<string, any[]>();
    for (const row of rows) byKey.set(row.policyKey, [...(byKey.get(row.policyKey) ?? []), row]);
    for (const [policyKey, series] of byKey) {
      if (series.some((row) => row.effectiveFrom <= BASELINE && (!row.effectiveTo || row.effectiveTo >= BASELINE))) continue;
      const earliest = series[0];
      if (earliest.effectiveFrom <= BASELINE) continue;
      out.push({ family, sourceId: earliest.id, policyKey, sourceEffectiveFrom: earliest.effectiveFrom.toISOString(), effectiveTo: priorDay(earliest.effectiveFrom).toISOString(), proposedId: randomUUID(), proposedVersion: Math.min(...series.map((x) => x.version)) - 1 });
    }
  }
  const weekly = await prisma.weeklyOffPolicy.findMany({ orderBy: [{ effectiveFrom: 'asc' }, { id: 'asc' }] });
  // Weekly-off policies do not yet have a series key. Treat each named policy
  // as one series, without changing that approved Phase 1 schema contract.
  const weeklyByName = new Map<string, typeof weekly>();
  for (const row of weekly) weeklyByName.set(row.name, [...(weeklyByName.get(row.name) ?? []), row]);
  for (const [name, series] of weeklyByName) {
    if (series.some((row) => row.effectiveFrom <= BASELINE && (!row.effectiveTo || row.effectiveTo >= BASELINE))) continue;
    const earliest = series[0];
    if (earliest.effectiveFrom <= BASELINE) continue;
    out.push({ family: 'weeklyOff', sourceId: earliest.id, policyKey: name, sourceEffectiveFrom: earliest.effectiveFrom.toISOString(), effectiveTo: priorDay(earliest.effectiveFrom).toISOString(), proposedId: randomUUID(), proposedVersion: 0 });
  }
  return out;
}

async function applyOne(tx: Prisma.TransactionClient, item: BaselineProposal, actorId: string) {
  const now = new Date();
  if (item.family === 'attendance') {
    const source = await tx.attendancePolicy.findUniqueOrThrow({ where: { id: item.sourceId } });
    const { id: _id, createdAt: _ca, updatedAt: _ua, supersededById: _sb, ...copy } = source;
    await tx.attendancePolicy.create({ data: { ...copy, id: item.proposedId, version: item.proposedVersion, status: 'SUPERSEDED', isActive: false, effectiveFrom: BASELINE, effectiveTo: new Date(item.effectiveTo), approvedById: actorId, approvedAt: now, createdById: actorId, supersededById: source.id } });
  } else if (item.family === 'shift') {
    const source = await tx.shiftPolicy.findUniqueOrThrow({ where: { id: item.sourceId } });
    const { id: _id, createdAt: _ca, updatedAt: _ua, supersededById: _sb, ...copy } = source;
    await tx.shiftPolicy.create({ data: { ...copy, id: item.proposedId, version: item.proposedVersion, status: 'SUPERSEDED', isActive: false, effectiveFrom: BASELINE, effectiveTo: new Date(item.effectiveTo), approvedById: actorId, approvedAt: now, createdById: actorId, supersededById: source.id } });
  } else if (item.family === 'leave') {
    const source = await tx.leavePolicy.findUniqueOrThrow({ where: { id: item.sourceId } });
    const { id: _id, createdAt: _ca, updatedAt: _ua, supersededById: _sb, ...copy } = source;
    await tx.leavePolicy.create({ data: { ...copy, id: item.proposedId, version: item.proposedVersion, status: 'SUPERSEDED', isActive: false, effectiveFrom: BASELINE, effectiveTo: new Date(item.effectiveTo), approvedById: actorId, approvedAt: now, createdById: actorId, supersededById: source.id } });
  } else if (item.family === 'holiday') {
    const source = await tx.holidayCalendar.findUniqueOrThrow({ where: { id: item.sourceId } });
    const { id: _id, createdAt: _ca, updatedAt: _ua, supersededById: _sb, ...copy } = source;
    await tx.holidayCalendar.create({ data: { ...copy, id: item.proposedId, version: item.proposedVersion, status: 'SUPERSEDED', isActive: false, effectiveFrom: BASELINE, effectiveTo: new Date(item.effectiveTo), approvedById: actorId, approvedAt: now, createdById: actorId, supersededById: source.id } });
    const holidays = await tx.holiday.findMany({ where: { calendarId: source.id } });
    for (const holiday of holidays) {
      const { id: _id, calendarId: _calendar, createdAt: _ca, updatedAt: _ua, ...copyHoliday } = holiday;
      await tx.holiday.create({ data: { ...copyHoliday, id: randomUUID(), calendarId: item.proposedId } });
    }
  } else {
    const source = await tx.weeklyOffPolicy.findUniqueOrThrow({ where: { id: item.sourceId } });
    const { id: _id, createdAt: _ca, updatedAt: _ua, ...copy } = source;
    await tx.weeklyOffPolicy.create({ data: { ...copy, id: item.proposedId, isActive: false, effectiveFrom: BASELINE, effectiveTo: new Date(item.effectiveTo) } });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const target = targetOf(url);
  const actorId = value(args, 'approved-by');
  if (execute && value(args, 'confirm-target') !== target) throw new Error(`Refusing to write: pass --confirm-target=${target}`);
  if (execute && !actorId) throw new Error('Refusing to write: pass --approved-by=<active Admin or Super Admin user id>');
  const prisma = new PrismaClient();
  try {
    if (execute) {
      const actor = await prisma.user.findFirst({ where: { id: actorId, isActive: true, isSystemAccount: false }, include: { role: true } });
      if (!actor || !['ADMIN', 'SUPER_ADMIN'].includes(actor.role.name)) throw new Error('The approving actor must be an active Admin or Super Admin');
    }
    const proposed = await proposals(prisma);
    console.log(JSON.stringify({ dryRun: !execute, target, baseline: '2020-12-01', proposals: proposed }, null, 2));
    if (!execute || !actorId || proposed.length === 0) return;
    await prisma.$transaction(async (tx) => { for (const item of proposed) await applyOne(tx, item, actorId); });
    const reportFile = value(args, 'report-file') ?? `phase3-policy-baseline-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    writeFileSync(reportFile, JSON.stringify({ target, executedAt: new Date().toISOString(), approvedById: actorId, inserted: proposed, rollback: { action: 'DELETE_INSERTED_IDS_ONLY', ids: proposed.map((x) => x.proposedId) } }, null, 2));
    console.log(`Execution report and rollback identifiers written to ${reportFile}`);
  } finally { await prisma.$disconnect(); }
}
if (require.main === module) main().catch((error) => { console.error(error instanceof Error ? error.message : 'Policy baseline failed'); process.exit(1); });
