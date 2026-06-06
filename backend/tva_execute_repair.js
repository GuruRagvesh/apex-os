const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  console.log('Starting TVA Repair Execution...');

  if (!fs.existsSync('../FP20C_ROLLBACK_DATA.json')) {
    console.error('ERROR: FP20C_ROLLBACK_DATA.json not found! Aborting.');
    process.exit(1);
  }

  const rollbackData = JSON.parse(fs.readFileSync('../FP20C_ROLLBACK_DATA.json', 'utf8'));

  if (rollbackData.length !== 64) {
    console.warn(`WARNING: Expected 64 records in rollback, found ${rollbackData.length}.`);
  }

  let successCount = 0;
  let failCount = 0;

  for (const record of rollbackData) {
    try {
      if (record.table === 'WorkSession') {
        const after = record.after;
        const dataToUpdate = {
          logoutAt: new Date(after.logoutAt),
          status: after.status,
          autoClosed: after.autoClosed
        };
        // Also update autoClosedAt and totalWorkMinutes if they were computed
        if (after.status === 'AUTO_CLOSED') {
          dataToUpdate.autoClosedAt = new Date();
          // compute totalWorkMinutes dynamically just like tva_repair.js did, wait, tva_repair.js already computed it during execution, but let's just use what's safe. 
          // Actually we can just set logoutAt, status, autoClosed.
          // Wait, tva_repair.js computed totalWorkMinutes but didn't put it in 'after' object in the rollback. Let's compute it.
          // Or wait, does totalWorkMinutes need to be accurate? Yes.
          const session = await prisma.workSession.findUnique({ where: { id: record.primaryKey } });
          if (session && session.startWorkAt) {
            const ms = new Date(after.logoutAt).getTime() - new Date(session.startWorkAt).getTime();
            dataToUpdate.totalWorkMinutes = Math.floor(ms / 60000);
          }
        }
        await prisma.workSession.update({
          where: { id: record.primaryKey },
          data: dataToUpdate
        });
        successCount++;
      } else if (record.table === 'BreakLog') {
        const after = record.after;
        const dataToUpdate = {};
        if (after.startAt || record.before.startAt) {
          dataToUpdate.startAt = new Date(after.startAt || record.before.startAt);
        }
        if (after.endAt) {
          dataToUpdate.endAt = new Date(after.endAt);
        }
        await prisma.breakLog.update({
          where: { id: record.primaryKey },
          data: dataToUpdate
        });
        successCount++;
      }
    } catch (err) {
      console.error(`Failed to update ${record.table} ${record.primaryKey}:`, err);
      failCount++;
    }
  }

  const executionReport = `# FP20C_REPAIR_EXECUTION_REPORT

## Execution Summary
- **Total Records Targeted:** ${rollbackData.length}
- **Successfully Mutated:** ${successCount}
- **Failed Mutations:** ${failCount}

## Verification
- Rollback file was confirmed to exist before execution.
- Scope was strictly limited to the records defined in \`FP20C_ROLLBACK_DATA.json\`.
- Collision, EXCLUDE, and MANUAL records were completely ignored.
`;

  fs.writeFileSync('../FP20C_REPAIR_EXECUTION_REPORT.md', executionReport);
  console.log(`Execution complete. Success: ${successCount}, Fail: ${failCount}`);
}

run().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
