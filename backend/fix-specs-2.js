const fs = require('fs');
const path = require('path');

const mock = "{ now: () => new Date(), companyTimezone: () => 'Asia/Kolkata', companyDayStart: () => new Date(), companyDayEnd: () => new Date(), elapsedSeconds: () => 0 } as any";

const patch1 = 'test/unit/p1d.attachment-security.spec.ts';
if(fs.existsSync(patch1)) {
  let c1 = fs.readFileSync(patch1, 'utf8');
  c1 = c1.replace(/\{ startReviewCycle/g, mock + ', { startReviewCycle');
  fs.writeFileSync(patch1, c1);
}

const patch2 = 'test/unit/ticket.permissions.spec.ts';
if(fs.existsSync(patch2)) {
  let c2 = fs.readFileSync(patch2, 'utf8');
  c2 = c2.replace(/\{ startReviewCycle/g, mock + ', { startReviewCycle');
  fs.writeFileSync(patch2, c2);
}

const patch3 = 'test/unit/blocked-ticket.spec.ts';
if(fs.existsSync(patch3)) {
  let c3 = fs.readFileSync(patch3, 'utf8');
  c3 = c3.replace(/new TicketTimingService\(mockPrisma as any\)/g, 'new TicketTimingService(mockPrisma as any, ' + mock + ')');
  fs.writeFileSync(patch3, c3);
}

const patch4 = 'test/unit/p1d.dashboard-consistency.spec.ts';
if(fs.existsSync(patch4)) {
  let c4 = fs.readFileSync(patch4, 'utf8');
  c4 = c4.replace(/\{\} as any \/\/ Mock LeaveBalanceService/g, '{} as any, ' + mock);
  fs.writeFileSync(patch4, c4);
}

const patch5 = 'test/unit/p0.ticket-access-timing.spec.ts';
if(fs.existsSync(patch5)) {
  let c5 = fs.readFileSync(patch5, 'utf8');
  c5 = c5.replace(/new TicketTimingService\(prisma\)/g, 'new TicketTimingService(prisma, ' + mock + ')');
  fs.writeFileSync(patch5, c5);
}

const patch6 = 'test/unit/tva-date-authority.spec.ts';
if(fs.existsSync(patch6)) {
  let c6 = fs.readFileSync(patch6, 'utf8');
  c6 = c6.replace(/new CompanyDateService\(\)/g, 'new CompanyDateService(' + mock + ')');
  fs.writeFileSync(patch6, c6);
}

function processDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDir(fullPath);
    } else if (fullPath.endsWith('.spec.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes("formatZoned: () => 'mock' } }")) {
        content = content.replace(/formatZoned: \(\) => 'mock' \} \}/g, "formatZoned: () => 'mock', companyDayEnd: () => new Date(), elapsedSeconds: () => 0 } }");
        fs.writeFileSync(fullPath, content);
      }
    }
  }
}
processDir('test');
processDir('src');

console.log('Done');
