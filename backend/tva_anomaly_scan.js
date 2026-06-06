const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

const prisma = new PrismaClient();

async function run() {
  const anomalies = {};

  // WorkSession Checks
  
  // 1. logoutAt < startWorkAt
  anomalies.WS_01 = await prisma.workSession.findMany({
    where: {
      logoutAt: { not: null },
      startWorkAt: { not: null },
    },
    include: { user: true }
  }).then(res => res.filter(s => s.logoutAt < s.startWorkAt));

  // 2. startWorkAt IS NULL AND logoutAt IS NOT NULL
  anomalies.WS_02 = await prisma.workSession.findMany({
    where: {
      startWorkAt: null,
      logoutAt: { not: null },
    },
    include: { user: true }
  });

  // 3. logoutAt IS NULL (Active/Open Sessions)
  anomalies.WS_03 = await prisma.workSession.findMany({
    where: { logoutAt: null },
    include: { user: true }
  });

  // 4. startWorkAt older than 12h AND logoutAt IS NULL
  const twelveHoursAgo = new Date(Date.now() - 12 * 3600000);
  anomalies.WS_04 = await prisma.workSession.findMany({
    where: {
      logoutAt: null,
      startWorkAt: { lt: twelveHoursAgo },
    },
    include: { user: true }
  });

  // 5. totalWorkMinutes > 600 (10 hours)
  anomalies.WS_05 = await prisma.workSession.findMany({
    where: {
      totalWorkMinutes: { gt: 600 }
    },
    include: { user: true }
  });

  // 6. totalWorkMinutes > 960 (16 hours)
  anomalies.WS_06 = await prisma.workSession.findMany({
    where: {
      totalWorkMinutes: { gt: 960 }
    },
    include: { user: true }
  });

  // 7. totalBreakMinutes > 240 (4 hours)
  anomalies.WS_07 = await prisma.workSession.findMany({
    where: {
      totalBreakMinutes: { gt: 240 }
    },
    include: { user: true }
  });

  // 8 & 9. duplicates & overlaps 
  // Fetch all sessions to calculate manually
  const allSessions = await prisma.workSession.findMany({
    include: { user: true },
    orderBy: { loginAt: 'asc' }
  });

  const duplicateActive = [];
  const overlaps = [];

  const userSessions = {};
  for (const s of allSessions) {
    if (!userSessions[s.userId]) userSessions[s.userId] = [];
    userSessions[s.userId].push(s);
  }

  for (const userId in userSessions) {
    const sessions = userSessions[userId];
    const active = sessions.filter(s => s.logoutAt === null);
    if (active.length > 1) {
      duplicateActive.push(...active);
    }

    for (let i = 0; i < sessions.length; i++) {
      for (let j = i + 1; j < sessions.length; j++) {
        const s1 = sessions[i];
        const s2 = sessions[j];
        // Check overlap logic
        const start1 = s1.startWorkAt || s1.loginAt || s1.createdAt;
        const end1 = s1.logoutAt;
        const start2 = s2.startWorkAt || s2.loginAt || s2.createdAt;
        const end2 = s2.logoutAt;
        
        if (start1 && start2 && end1) {
          if (start2 >= start1 && start2 < end1) {
            overlaps.push({ s1, s2 });
          }
        }
      }
    }
  }

  anomalies.WS_08 = duplicateActive;
  anomalies.WS_09 = overlaps;

  // 10. terminal status without logout
  anomalies.WS_10 = await prisma.workSession.findMany({
    where: {
      status: { in: ['COMPLETED', 'AUTO_CLOSED'] },
      logoutAt: null,
    },
    include: { user: true }
  });

  // 11. autoClosed sessions with missing autoClosedAt
  anomalies.WS_11 = await prisma.workSession.findMany({
    where: {
      autoClosed: true,
      autoClosedAt: null,
    },
    include: { user: true }
  });

  // 12. continuation sessions with invalid parent session
  const continuationSessions = await prisma.workSession.findMany({
    where: { continuationOfSessionId: { not: null } },
    include: { user: true }
  });

  const invalidParents = [];
  for (const s of continuationSessions) {
    const parent = await prisma.workSession.findUnique({ where: { id: s.continuationOfSessionId }});
    if (!parent || parent.userId !== s.userId) {
      invalidParents.push(s);
    }
  }
  anomalies.WS_12 = invalidParents;


  // BreakLog Checks
  const allBreaks = await prisma.breakLog.findMany({
    include: { workSession: { include: { user: true } } }
  });

  // 1. endAt IS NULL
  anomalies.BL_01 = allBreaks.filter(b => b.endAt === null);

  // 2. durationMinutes > 240
  anomalies.BL_02 = allBreaks.filter(b => b.durationMinutes > 240);

  // 3. endAt < startAt
  anomalies.BL_03 = allBreaks.filter(b => b.endAt && b.endAt < b.startAt);

  // 4. break outside parent session window
  anomalies.BL_04 = allBreaks.filter(b => {
    if (!b.workSession) return false;
    const ws = b.workSession;
    const sStart = ws.startWorkAt || ws.loginAt;
    const sEnd = ws.logoutAt;
    
    if (sStart && b.startAt < sStart) return true;
    if (sEnd && b.endAt && b.endAt > sEnd) return true;
    if (sEnd && !b.endAt && b.startAt > sEnd) return true;
    return false;
  });

  // 5. break attached to missing/invalid WorkSession
  anomalies.BL_05 = allBreaks.filter(b => !b.workSession);

  // Process data for easy output
  const report = {};
  for (const key of Object.keys(anomalies)) {
    let items = anomalies[key];
    if (!Array.isArray(items)) items = [items];
    
    // Normalize format
    const count = items.length;
    let users = new Set();
    let dates = new Set();
    
    items.forEach(item => {
      let uId;
      if (item.s1) {
        uId = item.s1.userId;
        dates.add(item.s1.createdAt.toISOString().split('T')[0]);
      } else if (item.user) {
        uId = item.userId;
        dates.add(item.createdAt.toISOString().split('T')[0]);
      } else if (item.workSession) {
        uId = item.workSession.userId;
        dates.add(item.createdAt.toISOString().split('T')[0]);
      } else {
        uId = item.userId;
        if(item.createdAt) dates.add(item.createdAt.toISOString().split('T')[0]);
      }
      if (uId) users.add(uId);
    });
    
    report[key] = {
      count,
      users: Array.from(users),
      dates: Array.from(dates),
      samples: items.slice(0, 3)
    };
  }

  fs.writeFileSync('anomaly_raw.json', JSON.stringify(report, null, 2));
}

run().then(() => {
  console.log('Scan complete.');
  process.exit(0);
}).catch(e => {
  console.error(e);
  process.exit(1);
});
