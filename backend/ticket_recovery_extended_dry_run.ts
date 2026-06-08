import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

// Enums from Prisma Schema
const VALID_TICKET_STATUSES = new Set(['OPEN', 'IN_PROGRESS', 'REVIEW', 'DONE', 'CLOSED']);
const VALID_PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const VALID_CATEGORIES = new Set(['IT', 'FACILITIES', 'HR', 'OPERATIONS', 'PROJECT', 'ADMIN']);

async function run() {
  console.log('Starting extended dry run...');

  const departments = await prisma.department.findMany();
  const deptMap = new Map<string, string>(); // name to ID
  for (const d of departments) {
    deptMap.set(d.name, d.id);
  }

  // 1. Recover TicketHistory from STATUS_CHANGED
  const statusLogs = await prisma.activityLog.findMany({
    where: { entityType: 'TICKET', action: 'STATUS_CHANGED' },
    orderBy: { createdAt: 'asc' },
  });

  const recoveredHistory = [];
  let invalidStatusValues = 0;

  for (const log of statusLogs) {
    if (!log.entityId) continue;
    const details = log.details as any || {};
    
    const oldVal = details.previousStatus || null;
    const newVal = details.newStatus || null;

    if (oldVal && !VALID_TICKET_STATUSES.has(oldVal)) invalidStatusValues++;
    if (newVal && !VALID_TICKET_STATUSES.has(newVal)) invalidStatusValues++;

    recoveredHistory.push({
      ticketId: log.entityId,
      oldValue: oldVal,
      newValue: newVal,
      changedById: log.userId,
      changedAt: log.createdAt,
      details: details
    });
  }

  // 2. Recover TicketAssignee
  const assignLogs = await prisma.activityLog.findMany({
    where: {
      entityType: 'TICKET',
      action: { in: ['ASSIGNED', 'TICKET_ASSIGNED'] }
    },
    orderBy: { createdAt: 'asc' }
  });

  const finalAssignees = new Map<string, string>(); // ticketId -> assignedToId
  let missingAssigneeCount = 0;

  for (const log of assignLogs) {
    if (!log.entityId) continue;
    const details = log.details as any || {};
    const assignedToId = details.assignedToId || details.assignee || details.assignedTo;
    
    if (assignedToId) {
      finalAssignees.set(log.entityId, assignedToId);
    }
  }

  // 3. Process TICKET_CREATED
  const createdLogs = await prisma.activityLog.findMany({
    where: { entityType: 'TICKET', action: 'TICKET_CREATED' },
    orderBy: { createdAt: 'asc' },
  });

  const recoveredTickets = [];
  let missingDepartmentCount = 0;
  let enumErrors = 0;
  const uniqueTickets = new Set<string>();

  for (const log of createdLogs) {
    if (!log.entityId) continue;
    if (uniqueTickets.has(log.entityId)) continue;
    uniqueTickets.add(log.entityId);

    const details = log.details as any || {};
    const category = details.category || null;
    const priority = details.priority || null;

    // Validate enums
    if (category && !VALID_CATEGORIES.has(category)) enumErrors++;
    if (priority && !VALID_PRIORITIES.has(priority)) enumErrors++;

    // Map department safely
    let departmentId = null;
    if (category === 'IT') {
      departmentId = deptMap.get('IT') || deptMap.get('AI and R&D') || null;
    } else if (category === 'HR') {
      departmentId = deptMap.get('HR') || null;
    } else if (category === 'OPERATIONS') {
      departmentId = deptMap.get('Company / Operations') || deptMap.get('Operations') || null;
    } else if (category === 'PROJECT') {
      departmentId = deptMap.get('Project/Operations') || null;
    }

    if (!departmentId) {
      missingDepartmentCount++;
    }

    const assignedToId = finalAssignees.get(log.entityId) || null;
    if (!assignedToId) {
      missingAssigneeCount++; // Note: we count missing assignees per unique ticket
    }

    recoveredTickets.push({
      id: log.entityId,
      ticketId: details.ticketId || null,
      title: details.title || null,
      category,
      priority,
      createdById: log.userId,
      createdAt: log.createdAt,
      departmentId,
      assignedToId
    });
  }

  // Convert finalAssignees map to array for JSON output
  const recoveredAssigneesArray = Array.from(finalAssignees.entries()).map(([ticketId, assignedToId]) => ({
    ticketId,
    assignedToId
  }));

  // Output files
  fs.writeFileSync('recovered_ticket_history_dry_run.json', JSON.stringify(recoveredHistory, null, 2));
  fs.writeFileSync('recovered_ticket_assignees_dry_run.json', JSON.stringify(recoveredAssigneesArray, null, 2));

  const md = `
# Extended Ticket Recovery Preview

## 1. TicketHistory Recovery
- **STATUS_CHANGED logs processed:** ${statusLogs.length}
- **Recovered History records:** ${recoveredHistory.length}
- **Invalid Status enum values detected:** ${invalidStatusValues}

## 2. TicketAssignee Recovery
- **ASSIGNED logs processed:** ${assignLogs.length}
- **Unique Tickets with recovered assignee:** ${finalAssignees.size}
- **Tickets missing assignee:** ${missingAssigneeCount}

## 3. Department Mapping
- **Tickets missing safe department mapping:** ${missingDepartmentCount}
- **Total Unique Tickets Processed:** ${recoveredTickets.length}

## 4. Enum Compatibility
- **Enum validation errors (Category/Priority):** ${enumErrors}

> **Note**: This was an extended dry run. No records were inserted into the database.
  `.trim() + '\n';

  fs.writeFileSync('recovered_ticket_restore_preview.md', md);

  console.log('Extended dry run complete.');
}

run()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
