import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';

const prisma = new PrismaClient();

async function run() {
  console.log('--- Backup Verification Process Started ---');

  const manifestPath = 'backup_manifest.json';
  if (!fs.existsSync(manifestPath)) {
    throw new Error('backup_manifest.json not found. Run backup-database.ts first.');
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log(`Loaded manifest for backup from ${manifest.backupTimestamp}`);

  // Find the exact backup file matching the manifest timestamp
  const now = new Date(manifest.backupTimestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestampStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
  
  // Note: users might pass a specific filename, but we assume it matches the timestamp here
  const backupFileName = `apex_backup_${timestampStr}.sql.gz`;

  if (!fs.existsSync(backupFileName)) {
    throw new Error(`Expected backup file ${backupFileName} not found.`);
  }

  // 1. Verify File Size
  const stats = fs.statSync(backupFileName);
  const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2) + ' MB';
  const isSizeMatch = fileSizeInMB === manifest.backupSize;
  
  // 2. Verify Checksum
  console.log('Calculating checksum for verification...');
  const fileBuffer = fs.readFileSync(backupFileName);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  const calculatedChecksum = hashSum.digest('hex');
  const isChecksumMatch = calculatedChecksum === manifest.checksum;

  // 3. Verify Critical Table Counts
  console.log('Verifying current database table counts against manifest...');
  const currentCounts = {
    User: await prisma.user.count(),
    Ticket: await prisma.ticket.count(),
    TicketHistory: await prisma.ticketHistory.count(),
    TicketAssignee: await prisma.ticketAssignee.count(),
    TicketTimeLog: await prisma.ticketTimeLog.count(),
    WorkSession: await prisma.workSession.count(),
    BreakLog: await prisma.breakLog.count(),
    AttendanceEvent: await prisma.attendanceEvent.count(),
    LeaveRequest: await prisma.leaveRequest.count(),
    Department: await prisma.department.count(),
    Project: await prisma.project.count(),
    Notification: await prisma.notification.count(),
    ActivityLog: await prisma.activityLog.count(),
    OperationalEvent: await prisma.operationalEvent.count(),
  };

  const tableDiscrepancies = [];
  for (const [table, manifestCount] of Object.entries(manifest.tableCounts)) {
    const currentCount = currentCounts[table as keyof typeof currentCounts];
    if (currentCount !== manifestCount) {
      tableDiscrepancies.push(`${table}: Manifest has ${manifestCount}, Database has ${currentCount}`);
    }
  }

  const allChecksPassed = isSizeMatch && isChecksumMatch && tableDiscrepancies.length === 0;

  const report = `
# Backup Verification Report

## Verification Overview
- **Verification Date:** ${new Date().toISOString()}
- **Backup Timestamp:** ${manifest.backupTimestamp}
- **Backup File:** \`${backupFileName}\`
- **Status:** ${allChecksPassed ? '✅ PASSED' : '❌ FAILED'}

## Integrity Checks
- **File Exists:** ✅ Yes
- **File Size Match:** ${isSizeMatch ? '✅ Passed' : '❌ Failed'} (Expected: ${manifest.backupSize}, Actual: ${fileSizeInMB})
- **Checksum Match:** ${isChecksumMatch ? '✅ Passed' : '❌ Failed'} (Expected: \`${manifest.checksum}\`, Actual: \`${calculatedChecksum}\`)

## Data Drift (Current DB vs Backup)
${tableDiscrepancies.length === 0 ? '✅ No data drift detected. DB matches backup exactly.' : '⚠️ **Data Drift Detected:**\\n' + tableDiscrepancies.map(d => '- ' + d).join('\\n')}

> **Note:** Data drift is normal if the database has been actively used since the backup was taken. However, if this verification is run immediately after backup, there should be zero drift.
  `.trim() + '\\n';

  fs.writeFileSync('BACKUP_VERIFICATION_REPORT.md', report);
  console.log(`Report created: BACKUP_VERIFICATION_REPORT.md`);

  if (!allChecksPassed) {
    console.error('Backup verification FAILED. See BACKUP_VERIFICATION_REPORT.md for details.');
    process.exit(1);
  } else {
    console.log('--- Backup Verification Complete - ALL PASSED ---');
  }
}

run()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
