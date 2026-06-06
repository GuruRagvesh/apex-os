const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const q = (sql) => prisma.$queryRawUnsafe(sql);
  const [neg, missingEnd, excessive, excessiveBreak, openBreaks, dupActive, logoutBeforeStart, badStatus] = await Promise.all([
    q(`SELECT count(*)::int c FROM work_sessions WHERE "totalWorkMinutes" < 0 OR "totalBreakMinutes" < 0`),
    q(`SELECT count(*)::int c FROM work_sessions WHERE "logoutAt" IS NULL AND "startWorkAt" IS NOT NULL AND "startWorkAt" < NOW() - INTERVAL '16 hours'`),
    q(`SELECT count(*)::int c FROM work_sessions WHERE "totalWorkMinutes" > 960`),
    q(`SELECT count(*)::int c FROM work_sessions WHERE "totalBreakMinutes" > 480`),
    q(`SELECT count(*)::int c FROM break_logs WHERE "endAt" IS NULL AND "startAt" < NOW() - INTERVAL '12 hours'`),
    q(`SELECT "userId", "date", count(*)::int c FROM work_sessions WHERE status IN ('WORKING','ON_BREAK','IDLE','LOGGED_IN') GROUP BY "userId","date" HAVING count(*) > 1`),
    q(`SELECT count(*)::int c FROM work_sessions WHERE "logoutAt" IS NOT NULL AND "startWorkAt" IS NOT NULL AND "logoutAt" < "startWorkAt"`),
    q(`SELECT status, count(*)::int c FROM work_sessions GROUP BY status ORDER BY c DESC`),
  ]);
  console.log(JSON.stringify({
    negativeDurations: neg[0].c,
    missingEndTimes_gt16h: missingEnd[0].c,
    excessiveWork_gt16h: excessive[0].c,
    excessiveBreak_gt8h: excessiveBreak[0].c,
    openBreaks_gt12h: openBreaks[0].c,
    duplicateActiveSessions: dupActive.length,
    logoutBeforeStart: logoutBeforeStart[0].c,
    statusBreakdown: badStatus,
  }, null, 2));
}
main().catch(e => console.error('ERR', e.message)).finally(() => prisma.$disconnect());
