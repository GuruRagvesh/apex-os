/** Phase 3 attendance-profile continuity repair. Dry-run by default. */
import { writeFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';

const BASELINE = new Date('2020-12-01T00:00:00.000Z');
function targetOf(url: string) { const u = new URL(url); return `${u.hostname}:${u.port || '5432'}/${u.pathname.replace(/^\//, '')}`; }
function value(args: string[], name: string) { return args.find((x) => x.startsWith(`--${name}=`))?.slice(name.length + 3); }
function later(a: Date, b: Date) { return a > b ? a : b; }

type Proposal = { userId: string; profileId: string; oldEffectiveFrom: string; newEffectiveFrom: string; basis: 'EMPLOYMENT_PERIOD' | 'JOINING_DATE' };
type Skip = { userId: string; profileId?: string; reason: string };

export async function planProfileContinuity(prisma: PrismaClient) {
  const users = await prisma.user.findMany({
    where: { isSystemAccount: false }, select: { id: true, joiningDate: true }, orderBy: { id: 'asc' },
  });
  const proposals: Proposal[] = [];
  const skipped: Skip[] = [];
  for (const user of users) {
    const earliest = await prisma.employeeAttendanceProfile.findFirst({ where: { userId: user.id }, orderBy: [{ effectiveFrom: 'asc' }, { id: 'asc' }] });
    if (!earliest) { skipped.push({ userId: user.id, reason: 'NO_PROFILE' }); continue; }
    const period = await prisma.employmentPeriod.findFirst({
      where: { userId: user.id, startDate: { lte: earliest.effectiveFrom }, OR: [{ endDate: null }, { endDate: { gte: earliest.effectiveFrom } }] },
      orderBy: { startDate: 'desc' },
    });
    if (!period && !user.joiningDate) { skipped.push({ userId: user.id, profileId: earliest.id, reason: 'MISSING_JOINING_DATE' }); continue; }
    // A containing employment period is stronger than a mutable user field and
    // guarantees the extension cannot cross an inactive employment gap.
    const employmentStart = period?.startDate ?? user.joiningDate!;
    const target = later(employmentStart, BASELINE);
    if (target >= earliest.effectiveFrom) continue;
    const protectedDay = await prisma.dailyAttendance.findFirst({
      where: { userId: user.id, date: { gte: target, lt: earliest.effectiveFrom }, OR: [{ evaluationState: 'FINALIZED' }, { locked: true }] },
      select: { date: true, evaluationState: true, locked: true }, orderBy: { date: 'asc' },
    });
    if (protectedDay) { skipped.push({ userId: user.id, profileId: earliest.id, reason: `PROTECTED_ATTENDANCE_${protectedDay.date.toISOString().slice(0, 10)}` }); continue; }
    proposals.push({ userId: user.id, profileId: earliest.id, oldEffectiveFrom: earliest.effectiveFrom.toISOString(), newEffectiveFrom: target.toISOString(), basis: period ? 'EMPLOYMENT_PERIOD' : 'JOINING_DATE' });
  }
  return { proposals, skipped };
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const target = targetOf(url);
  const actorId = value(args, 'updated-by');
  if (execute && value(args, 'confirm-target') !== target) throw new Error(`Refusing to write: pass --confirm-target=${target}`);
  if (execute && !actorId) throw new Error('Refusing to write: pass --updated-by=<active HR/Admin user id>');
  const prisma = new PrismaClient();
  try {
    if (execute) {
      const actor = await prisma.user.findFirst({ where: { id: actorId, isActive: true, isSystemAccount: false }, include: { role: true } });
      if (!actor || !(actor.isHR || ['ADMIN', 'SUPER_ADMIN'].includes(actor.role.name))) throw new Error('The updating actor must be active HR, Admin or Super Admin');
    }
    const plan = await planProfileContinuity(prisma);
    console.log(JSON.stringify({ dryRun: !execute, target, baseline: '2020-12-01', ...plan }, null, 2));
    if (!execute || !actorId || plan.proposals.length === 0) return;
    await prisma.$transaction(async (tx) => {
      for (const item of plan.proposals) {
        const changed = await tx.employeeAttendanceProfile.updateMany({ where: { id: item.profileId, effectiveFrom: new Date(item.oldEffectiveFrom) }, data: { effectiveFrom: new Date(item.newEffectiveFrom), updatedById: actorId } });
        if (changed.count !== 1) throw new Error(`Profile changed after dry-run: ${item.profileId}`);
      }
    });
    const reportFile = value(args, 'report-file') ?? `phase3-profile-continuity-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    writeFileSync(reportFile, JSON.stringify({ target, executedAt: new Date().toISOString(), updatedById: actorId, changed: plan.proposals, rollback: plan.proposals.map((x) => ({ profileId: x.profileId, restoreEffectiveFrom: x.oldEffectiveFrom, onlyIfCurrentEffectiveFrom: x.newEffectiveFrom })) }, null, 2));
    console.log(`Execution report and conditional rollback values written to ${reportFile}`);
  } finally { await prisma.$disconnect(); }
}
if (require.main === module) main().catch((error) => { console.error(error instanceof Error ? error.message : 'Profile continuity failed'); process.exit(1); });
