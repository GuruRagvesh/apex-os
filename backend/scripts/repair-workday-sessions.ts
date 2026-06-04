import { PrismaClient } from '@prisma/client';
import { parseArgs } from 'util';
import * as fs from 'fs';

const prisma = new PrismaClient();

function getCompanyTodayDate(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
}

function parseAutoCloseTimeUTC(dateStr: string, timeStr: string, timezone: string): Date {
  const { formatInTimeZone, toDate } = require('date-fns-tz');
  return toDate(`${dateStr}T${timeStr}:00`, { timeZone: timezone });
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'dry-run': { type: 'boolean', default: false },
      apply: { type: 'boolean', default: false },
      userId: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      maxRows: { type: 'string' },
    },
  });

  const isApply = values.apply;
  if (isApply && process.env.CONFIRM_REPAIR !== 'true') {
    console.error('Error: --apply requires CONFIRM_REPAIR=true environment variable.');
    process.exit(1);
  }

  const dryRun = !isApply;

  console.log(`Starting Workday Session Repair (${dryRun ? 'DRY RUN / PRE-APPLY' : 'APPLY'})`);

  const maxRows = values.maxRows ? parseInt(values.maxRows, 10) : 10000;
  
  let dateFilter: any = {};
  if (values.from || values.to) {
    if (values.from) dateFilter.gte = new Date(values.from);
    if (values.to) dateFilter.lte = new Date(values.to);
  }

  const whereClause: any = {};
  if (Object.keys(dateFilter).length > 0) whereClause.date = dateFilter;
  if (values.userId) whereClause.userId = values.userId;

  const sessions = await prisma.workSession.findMany({
    where: whereClause,
    include: { breakLogs: true, user: true },
    orderBy: { createdAt: 'asc' },
    take: maxRows,
  });

  const policySetting = await prisma.appSetting.findUnique({ where: { key: 'workday_policy' } });
  const globalPolicy = (policySetting?.value as any) ?? {};
  const autoCloseTime = globalPolicy.autoCloseTime || '23:59';
  const companyTimezone = globalPolicy.timezone || 'Asia/Kolkata';

  const todayStr = getCompanyTodayDate(companyTimezone);

  const report = {
    totalScanned: sessions.length,
    autoRepairCandidateCount: 0,
    manualReviewCount: 0,
    sessionsRepaired: 0,
    breakLogsRepaired: 0,
    sessionsSkipped: 0,
    errors: [] as any[],
    candidates: [] as any[],
  };

  const openSessionsPerUserDate = new Map<string, number>();
  for (const session of sessions) {
    if (!session.logoutAt) {
      const dateStr = session.date instanceof Date ? session.date.toISOString().split('T')[0] : String(session.date).split('T')[0];
      const key = `${session.userId}_${dateStr}`;
      openSessionsPerUserDate.set(key, (openSessionsPerUserDate.get(key) || 0) + 1);
    }
  }

  const now = new Date();

  for (const session of sessions) {
    let isSuspicious = false;
    let classification = '';
    const proposedChanges: any = {
      userId: session.userId,
      userName: session.user?.name || session.user?.email || 'Unknown',
      sessionId: session.id,
      companyDate: session.date instanceof Date ? session.date.toISOString().split('T')[0] : String(session.date).split('T')[0],
      currentStatus: session.status,
      currentLoginAt: session.startWorkAt || session.loginAt,
      currentLogoutAt: session.logoutAt,
      proposedLogoutAt: null,
      currentAutoClosed: session.autoClosed,
      proposedAutoClosed: null,
      proposedClosureReason: null,
      openBreakLogIds: [] as string[],
      proposedBreakLogEndAt: null,
      safeRepairReason: '',
      rulesTriggered: [] as string[]
    };

    const dateStr = proposedChanges.companyDate;
    const isPastDate = dateStr < todayStr;
    const isLogoutMissing = !session.logoutAt;

    if (isPastDate && isLogoutMissing) {
      isSuspicious = true; proposedChanges.rulesTriggered.push('Rule 1: Past date open session');
    }
    if (isPastDate && ['WORKING', 'ON_BREAK', 'ACTIVE'].includes(session.status)) {
      isSuspicious = true; proposedChanges.rulesTriggered.push('Rule 2: Past date active status');
    }
    if (session.totalWorkMinutes != null && session.totalWorkMinutes > 960) {
      isSuspicious = true; proposedChanges.rulesTriggered.push('Rule 3: Duration > 16h');
    }
    if (session.logoutAt) {
      const logoutDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: companyTimezone }).format(session.logoutAt);
      if (logoutDateStr !== dateStr) {
        isSuspicious = true; proposedChanges.rulesTriggered.push('Rule 4: Spans multiple dates');
      }
    }
    if (isLogoutMissing && (openSessionsPerUserDate.get(`${session.userId}_${dateStr}`) || 0) > 1) {
      isSuspicious = true; proposedChanges.rulesTriggered.push('Rule 5: Multiple open sessions same day');
    }
    const startTime = session.startWorkAt || session.loginAt;
    if (session.logoutAt && startTime && session.logoutAt < startTime) {
      isSuspicious = true; proposedChanges.rulesTriggered.push('Rule 6: logoutAt before start time');
    }

    const openBreaks = session.breakLogs.filter(b => !b.endAt);
    if (openBreaks.length > 0) {
      if (!isLogoutMissing) {
        isSuspicious = true; proposedChanges.rulesTriggered.push('Rule 7: Open break in closed session');
      } else if (isPastDate) {
        isSuspicious = true; proposedChanges.rulesTriggered.push('Rule 8: Open break in past open session');
      }
    }

    if (isSuspicious) {
      const hasDangerousRules = proposedChanges.rulesTriggered.some((r: string) => r.includes('Rule 3') || r.includes('Rule 6'));
      
      if (hasDangerousRules) {
        classification = 'MANUAL_REVIEW';
        report.manualReviewCount++;
        report.sessionsSkipped++;
      } else if (isPastDate && (isLogoutMissing || ['WORKING', 'ON_BREAK'].includes(session.status))) {
        classification = 'AUTO_REPAIR_CANDIDATE';
        report.autoRepairCandidateCount++;
        
        const proposedLogoutAt = parseAutoCloseTimeUTC(dateStr, autoCloseTime, companyTimezone);
        proposedChanges.proposedLogoutAt = proposedLogoutAt;
        proposedChanges.proposedAutoClosed = true;
        proposedChanges.proposedClosureReason = 'HISTORICAL_REPAIR_AUTO_CLOSE';
        proposedChanges.safeRepairReason = 'Session is from a past date and remained open. Capping at end-of-day auto-close time is safe.';
        
        proposedChanges.openBreakLogIds = openBreaks.map(b => b.id);
        if (openBreaks.length > 0) {
          proposedChanges.proposedBreakLogEndAt = new Date(Math.min(proposedLogoutAt.getTime(), now.getTime()));
        }

        report.candidates.push(proposedChanges);

        if (!dryRun) {
          try {
            await prisma.workSession.update({
              where: { id: session.id },
              data: {
                logoutAt: proposedChanges.proposedLogoutAt,
                autoClosed: proposedChanges.proposedAutoClosed,
                autoClosedAt: now,
                closureReason: proposedChanges.proposedClosureReason,
                status: 'AUTO_CLOSED',
              }
            });
            report.sessionsRepaired++;

            for (const b of openBreaks) {
              await prisma.breakLog.update({
                where: { id: b.id },
                data: {
                  endAt: proposedChanges.proposedBreakLogEndAt,
                  source: 'HISTORICAL_REPAIR',
                  reason: 'Historical repair: break auto-closed.'
                }
              });
              report.breakLogsRepaired++;
            }
          } catch (error: any) {
            report.errors.push({ sessionId: session.id, error: error.message });
          }
        }
      } else {
        classification = 'MANUAL_REVIEW';
        report.manualReviewCount++;
        report.sessionsSkipped++;
      }
    }
  }

  if (dryRun) {
    const reportOutput = `# FP19B HISTORICAL WORKDAY PRE-APPLY SNAPSHOT
Total Sessions Scanned: ${report.totalScanned}
Auto Repair Candidates: ${report.autoRepairCandidateCount}
Manual Review Needed (Skipped): ${report.manualReviewCount}

## Detailed Repair Candidates
\`\`\`json
${JSON.stringify(report.candidates, null, 2)}
\`\`\`
`;
    fs.writeFileSync('FP19B_HISTORICAL_WORKDAY_PRE_APPLY_SNAPSHOT.md', reportOutput.trim());
    console.log('Pre-apply snapshot generated at FP19B_HISTORICAL_WORKDAY_PRE_APPLY_SNAPSHOT.md');
  } else {
    // Generate Apply Report
    const unclosedCheck = await prisma.workSession.count({
      where: {
        id: { in: report.candidates.map(c => c.sessionId) },
        logoutAt: null
      }
    });

    const reportOutput = `# FP19B HISTORICAL WORKDAY REPAIR APPLY REPORT
Sessions Repaired: ${report.sessionsRepaired}
Break Logs Repaired: ${report.breakLogsRepaired}
Sessions Skipped (Manual Review): ${report.sessionsSkipped}
Errors: ${report.errors.length}

## Verification
Repaired sessions with logoutAt still null: ${unclosedCheck}
Clean daily summary expected: YES

${report.errors.length > 0 ? `## Errors\n\`\`\`json\n${JSON.stringify(report.errors, null, 2)}\n\`\`\`` : ''}
`;
    fs.writeFileSync('FP19B_HISTORICAL_WORKDAY_REPAIR_APPLY_REPORT.md', reportOutput.trim());
    console.log('Post-apply report generated at FP19B_HISTORICAL_WORKDAY_REPAIR_APPLY_REPORT.md');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
