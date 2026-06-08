import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

async function run() {
  console.log('Starting dry run...');

  // 1. Get all TICKET_CREATED logs
  const createdLogs = await prisma.activityLog.findMany({
    where: {
      entityType: 'TICKET',
      action: 'TICKET_CREATED',
    },
    orderBy: {
      createdAt: 'asc', // earliest first
    },
  });

  const totalCreatedLogs = createdLogs.length;

  const ticketsMap = new Map<string, any>();
  let duplicateCreateEvents = 0;

  for (const log of createdLogs) {
    if (!log.entityId) continue;

    if (ticketsMap.has(log.entityId)) {
      duplicateCreateEvents++;
      continue;
    }

    const details = log.details as any || {};

    ticketsMap.set(log.entityId, {
      id: log.entityId,
      ticketId: details.ticketId || null,
      title: details.title || null,
      category: details.category || null,
      priority: details.priority || null,
      createdById: log.userId,
      createdAt: log.createdAt,
    });
  }

  const uniqueTicketIds = Array.from(ticketsMap.keys());
  
  // Get latest updatedAt for these tickets
  const latestActivityLogs = await prisma.activityLog.groupBy({
    by: ['entityId'],
    where: {
      entityType: 'TICKET',
      entityId: { in: uniqueTicketIds },
    },
    _max: {
      createdAt: true,
    },
  });

  const latestActivityMap = new Map<string, Date>();
  for (const item of latestActivityLogs) {
    if (item.entityId && item._max.createdAt) {
      latestActivityMap.set(item.entityId, item._max.createdAt);
    }
  }

  // Get latest STATUS_CHANGED logs for these tickets
  const statusChangedLogs = await prisma.activityLog.findMany({
    where: {
      entityType: 'TICKET',
      action: 'STATUS_CHANGED',
      entityId: { in: uniqueTicketIds },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  const latestStatusMap = new Map<string, string>();
  for (const log of statusChangedLogs) {
    if (log.entityId && !latestStatusMap.has(log.entityId)) {
      const details = log.details as any || {};
      if (details.newStatus) {
        latestStatusMap.set(log.entityId, details.newStatus);
      } else if (details.status) {
        latestStatusMap.set(log.entityId, details.status);
      }
    }
  }

  let missingTitleCount = 0;
  let missingCategoryCount = 0;
  let missingPriorityCount = 0;
  let statusRecoveredCount = 0;
  let perfectlyRecoverable = 0;

  const recoveredTickets = [];

  for (const [entityId, ticket] of ticketsMap.entries()) {
    ticket.updatedAt = latestActivityMap.get(entityId) || ticket.createdAt;
    
    if (latestStatusMap.has(entityId)) {
      ticket.status = latestStatusMap.get(entityId);
      statusRecoveredCount++;
    } else {
      ticket.status = 'OPEN';
    }

    if (!ticket.title) missingTitleCount++;
    if (!ticket.category) missingCategoryCount++;
    if (!ticket.priority) missingPriorityCount++;

    if (ticket.title && ticket.category && ticket.priority && ticket.ticketId) {
      perfectlyRecoverable++;
    }

    recoveredTickets.push(ticket);
  }

  const totalUnique = recoveredTickets.length;
  // Confidence score heuristic: 
  // Base 100, minus points for missing fields across the total tickets
  const totalMissing = missingTitleCount + missingCategoryCount + missingPriorityCount;
  const maxPossibleMissing = totalUnique * 3; 
  let confidenceScore = 100;
  if (maxPossibleMissing > 0) {
    confidenceScore = Math.max(0, 100 - ((totalMissing / maxPossibleMissing) * 100));
  } else if (totalUnique === 0) {
    confidenceScore = 0;
  }

  const outputJsonFile = 'recovered_tickets_dry_run.json';
  fs.writeFileSync(outputJsonFile, JSON.stringify(recoveredTickets, null, 2));

  const summaryMarkdown = `
# Ticket Recovery Dry Run Summary

- **Total \`TICKET_CREATED\` Logs:** ${totalCreatedLogs}
- **Unique Ticket \`entityId\`s:** ${totalUnique}
- **Duplicate Create Events:** ${duplicateCreateEvents}
- **Recoverable Tickets:** ${totalUnique}
- **Perfectly Recoverable (All core fields present):** ${perfectlyRecoverable}

## Missing Data Metrics
- **Missing Title:** ${missingTitleCount}
- **Missing Category:** ${missingCategoryCount}
- **Missing Priority:** ${missingPriorityCount}

## Status Recovery
- **Final Status Recoverable Count (from STATUS_CHANGED events):** ${statusRecoveredCount}

## Overall Confidence
- **Confidence Score:** ${confidenceScore.toFixed(2)}%

> **Note**: This was a dry run. No records were inserted into the database.
`;

  const outputMdFile = 'recovered_tickets_summary.md';
  fs.writeFileSync(outputMdFile, summaryMarkdown.trim() + '\n');

  console.log('Dry run complete. Output generated:');
  console.log(`- ${outputJsonFile}`);
  console.log(`- ${outputMdFile}`);
}

run()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
