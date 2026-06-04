import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/platform/settings/settings.service';
import { formatInTimeZone } from 'date-fns-tz';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const isDryRun = args.includes('--dry-run') || !isApply;
  const userIdArg = args.find((a) => a.startsWith('--userId='))?.split('=')[1];
  const maxRowsArg = args.find((a) => a.startsWith('--maxRows='))?.split('=')[1];
  const maxRows = maxRowsArg ? parseInt(maxRowsArg, 10) : undefined;

  console.log(`Starting Workday Session Repair Script...`);
  console.log(`Mode: ${isApply ? 'APPLY (Mutating)' : 'DRY-RUN (Read Only)'}`);

  if (isApply && process.env.CONFIRM_REPAIR !== 'true') {
    console.error('Error: --apply mode requires CONFIRM_REPAIR=true environment variable.');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const settingsService = app.get(SettingsService);

  const policy = await settingsService.getWorkdayPolicy();
  const timezone = policy?.timezone || 'Asia/Kolkata';
  const autoCloseTime = policy?.autoCloseTime || '23:59';
  const nowGlobal = new Date();
  const currentCompanyDateStr = formatInTimeZone(nowGlobal, timezone, 'yyyy-MM-dd');

  let whereClause: any = {};
  if (userIdArg) whereClause.userId = userIdArg;

  const sessions = await prisma.workSession.findMany({
    where: whereClause,
    take: maxRows,
    include: { breakLogs: true },
    orderBy: { createdAt: 'asc' },
  });

  let scanned = sessions.length;
  let autoRepairCandidates = 0;
  let manualReviewCandidates = 0;
  let suspiciousBreakLogsCount = 0;

  const report = {
    scanned,
    suspiciousSessions: 0,
    autoRepairCandidates: 0,
    manualReview: 0,
    suspiciousBreakLogs: 0,
    proposedRepairs: [] as any[],
    manualReviewList: [] as any[],
  };

  for (const session of sessions) {
    const sessionCompanyDateStr = session.date instanceof Date 
      ? formatInTimeZone(session.date, timezone, 'yyyy-MM-dd') 
      : String(session.date).split('T')[0];

    const isPreviousDay = sessionCompanyDateStr < currentCompanyDateStr;
    const isLogoutNull = !session.logoutAt;
    const isImpossibleDuration = (session.totalWorkMinutes || 0) > 960;
    const logoutBeforeStart = session.logoutAt && session.startWorkAt && session.logoutAt < session.startWorkAt;
    const badStatus = ['WORKING', 'ON_BREAK', 'ACTIVE'].includes(session.status) && isPreviousDay;
    const badAutoClose = !session.autoClosed && session.closureReason && session.closureReason.includes('AUTO');

    const openBreaks = session.breakLogs.filter(b => !b.endAt);
    const hasOpenBreaks = openBreaks.length > 0;
    
    if (hasOpenBreaks && (!isLogoutNull || isPreviousDay)) {
      suspiciousBreakLogsCount += openBreaks.length;
    }

    let isSuspicious = false;
    let classification = null;
    let proposedChanges: any = null;

    if (isPreviousDay && isLogoutNull) {
      isSuspicious = true;
      classification = 'AUTO_REPAIR_CANDIDATE';
      
      const cutoffIso = `${sessionCompanyDateStr}T${autoCloseTime}:00.000`;
      const offsetString = formatInTimeZone(session.loginAt || session.createdAt, timezone, 'xxx');
      const cutoffUtc = new Date(`${cutoffIso}${offsetString}`);

      proposedChanges = {
        id: session.id,
        rule: 'Rule A - Previous company-date open session',
        proposed: {
          logoutAt: cutoffUtc,
          autoClosed: true,
          autoClosedAt: nowGlobal,
          closureReason: 'HISTORICAL_REPAIR_AUTO_CLOSE',
          status: 'AUTO_CLOSED',
        },
        breaks: [],
      };

      for (const breakLog of openBreaks) {
        proposedChanges.breaks.push({
          id: breakLog.id,
          rule: 'Rule B - Open break inside old repaired session',
          proposed: {
            endAt: new Date(Math.min(cutoffUtc.getTime(), nowGlobal.getTime())),
            source: 'HISTORICAL_REPAIR',
            durationMinutes: 'will be computed',
          }
        });
      }
    } else if (isImpossibleDuration || logoutBeforeStart || badStatus || badAutoClose || (hasOpenBreaks && !isLogoutNull)) {
      isSuspicious = true;
      classification = 'MANUAL_REVIEW';
      report.manualReviewList.push({
        id: session.id,
        reasons: { isImpossibleDuration, logoutBeforeStart, badStatus, badAutoClose, hasOpenBreaks },
        session,
      });
    }

    if (isSuspicious) {
      report.suspiciousSessions++;
      if (classification === 'AUTO_REPAIR_CANDIDATE') {
        autoRepairCandidates++;
        report.proposedRepairs.push(proposedChanges);

        if (isApply) {
          // Implement apply
          await prisma.workSession.update({
            where: { id: session.id },
            data: {
              logoutAt: proposedChanges.proposed.logoutAt,
              autoClosed: proposedChanges.proposed.autoClosed,
              autoClosedAt: proposedChanges.proposed.autoClosedAt,
              closureReason: proposedChanges.proposed.closureReason,
              status: proposedChanges.proposed.status,
            }
          });
          for (const breakLog of openBreaks) {
            const endAt = new Date(Math.min(proposedChanges.proposed.logoutAt.getTime(), nowGlobal.getTime()));
            const duration = Math.max(0, Math.floor((endAt.getTime() - breakLog.startAt.getTime()) / 60000));
            await prisma.breakLog.update({
              where: { id: breakLog.id },
              data: {
                endAt,
                source: 'HISTORICAL_REPAIR',
                durationMinutes: duration,
              }
            });
          }
        }
      } else {
        manualReviewCandidates++;
      }
    }
  }

  report.autoRepairCandidates = autoRepairCandidates;
  report.manualReview = manualReviewCandidates;
  report.suspiciousBreakLogs = suspiciousBreakLogsCount;

  console.log(`\n--- Dry Run Report ---`);
  console.log(`Total scanned: ${scanned}`);
  console.log(`Suspicious Sessions: ${report.suspiciousSessions}`);
  console.log(`Auto Repair Candidates: ${autoRepairCandidates}`);
  console.log(`Manual Review Needed: ${manualReviewCandidates}`);
  console.log(`Suspicious BreakLogs: ${suspiciousBreakLogsCount}`);

  const reportPath = path.join(process.cwd(), 'WORKDAY_SESSION_REPAIR_DRY_RUN_REPORT.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport written to ${reportPath}`);

  await app.close();
}

bootstrap().catch(err => {
  console.error(err);
  process.exit(1);
});
