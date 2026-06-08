import { PrismaClient } from '@prisma/client';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { pipeline } from 'stream';
import { promisify } from 'util';

const pipe = promisify(pipeline);

const prisma = new PrismaClient();

async function run() {
  console.log('--- Database Backup Process Started ---');

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL is not defined in environment variables.');
  }

  // Parse Database URL (for basic pg_dump if needed, though pg_dump accepts URL)
  // Format: postgres://user:pass@host:port/dbname
  let dbName = 'nexus_db';
  try {
    const parsed = new URL(dbUrl);
    dbName = parsed.pathname.replace('/', '') || 'nexus_db';
  } catch (e) {
    console.warn('Could not parse database name from DATABASE_URL. Defaulting to nexus_db.');
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
  
  const rawFileName = `apex_backup_${timestamp}.sql`;
  const backupFileName = `apex_backup_${timestamp}.sql.gz`;
  const manifestFileName = `backup_manifest.json`;
  const reportFileName = `BACKUP_REPORT.md`;

  console.log(`Starting pg_dump to ${rawFileName}...`);

  // Execute pg_dump and redirect to .sql file
  const dumpCommand = `pg_dump "${dbUrl}" > "${rawFileName}"`;

  await new Promise<void>((resolve, reject) => {
    exec(dumpCommand, (error, stdout, stderr) => {
      if (error) {
        console.error('Backup failed:', stderr);
        return reject(error);
      }
      resolve();
    });
  });

  console.log('pg_dump completed successfully. Compressing using Node zlib...');

  // Compress using Node's zlib to ensure cross-platform compatibility
  const gzip = zlib.createGzip();
  const source = fs.createReadStream(rawFileName);
  const destination = fs.createWriteStream(backupFileName);

  await pipe(source, gzip, destination);
  console.log(`Compression complete. Created ${backupFileName}`);

  // Gather critical table counts
  console.log('Gathering critical table counts...');
  const counts = {
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

  // Generate checksum & size for the compressed file
  const fileBuffer = fs.readFileSync(backupFileName);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  const checksum = hashSum.digest('hex');
  const stats = fs.statSync(backupFileName);
  const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2) + ' MB';

  // Delete the raw .sql file ONLY after compression and checksum generation succeed
  if (fs.existsSync(rawFileName)) {
    fs.unlinkSync(rawFileName);
    console.log(`Deleted raw backup file: ${rawFileName}`);
  }

  const manifest = {
    backupTimestamp: now.toISOString(),
    databaseName: dbName,
    backupSize: fileSizeInMB,
    checksum,
    environment: process.env.APP_ENV || 'development',
    tableCounts: counts
  };

  fs.writeFileSync(manifestFileName, JSON.stringify(manifest, null, 2));
  console.log(`Manifest created: ${manifestFileName}`);

  const report = `
# Database Backup Report

## Backup Overview
- **Date/Time:** ${manifest.backupTimestamp}
- **Database Name:** ${manifest.databaseName}
- **Environment:** ${manifest.environment}
- **Backup File:** \`${backupFileName}\`
- **File Size:** ${manifest.backupSize}
- **Checksum (SHA-256):** \`${manifest.checksum}\`

## Critical Table Counts
| Table | Count |
|-------|-------|
| User | ${counts.User} |
| Ticket | ${counts.Ticket} |
| TicketHistory | ${counts.TicketHistory} |
| TicketAssignee | ${counts.TicketAssignee} |
| TicketTimeLog | ${counts.TicketTimeLog} |
| WorkSession | ${counts.WorkSession} |
| BreakLog | ${counts.BreakLog} |
| AttendanceEvent | ${counts.AttendanceEvent} |
| LeaveRequest | ${counts.LeaveRequest} |
| Department | ${counts.Department} |
| Project | ${counts.Project} |
| Notification | ${counts.Notification} |
| ActivityLog | ${counts.ActivityLog} |
| OperationalEvent | ${counts.OperationalEvent} |

> **Note:** This backup must be stored securely. Do not commit database dumps to version control.
  `.trim() + '\n';

  fs.writeFileSync(reportFileName, report);
  console.log(`Report created: ${reportFileName}`);

  console.log('--- Database Backup Process Complete ---');
}

run()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
