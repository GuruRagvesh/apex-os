import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

const VALID_TICKET_STATUSES = new Set(['OPEN', 'IN_PROGRESS', 'REVIEW', 'DONE', 'CLOSED']);
const VALID_PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const VALID_CATEGORIES = new Set(['IT', 'FACILITIES', 'HR', 'OPERATIONS', 'PROJECT', 'ADMIN']);

async function run() {
  console.log('--- Ticket Recovery Script ---');

  const isDryRun = process.env.EXECUTE_TICKET_RECOVERY !== 'true';
  if (isDryRun) {
    console.log('Running in DRY-RUN mode. Set EXECUTE_TICKET_RECOVERY=true to execute insert.');
  } else {
    console.log('Running in EXECUTE mode.');
  }

  // Idempotency / Safety check
  const existingTickets = await prisma.ticket.count();
  if (existingTickets > 0) {
    console.error(`ERROR: Ticket table is not empty. Found ${existingTickets} tickets. Aborting to maintain idempotency.`);
    process.exit(1);
  }

  // Validations prep
  const departments = await prisma.department.findMany();
  const deptMap = new Map<string, string>();
  const validDepartmentIds = new Set<string>();
  for (const d of departments) {
    deptMap.set(d.name, d.id);
    validDepartmentIds.add(d.id);
  }

  const users = await prisma.user.findMany({ select: { id: true } });
  const validUserIds = new Set<string>();
  for (const u of users) {
    validUserIds.add(u.id);
  }

  // All relevant TICKET logs
  const allTicketLogs = await prisma.activityLog.findMany({
    where: { entityType: 'TICKET' },
    orderBy: { createdAt: 'asc' },
  });

  // Group by ticketId
  const entityToTicketId = new Map<string, string>();
  const ticketIdToEntities = new Map<string, string[]>();
  const entityLogCount = new Map<string, number>();
  const entityMaxUpdatedAt = new Map<string, Date>();
  const entityMinCreatedAt = new Map<string, Date>();
  
  for (const log of allTicketLogs) {
    if (!log.entityId) continue;
    
    const details = log.details as any || {};
    let ticketId = details.ticketId || entityToTicketId.get(log.entityId);
    
    if (log.action === 'TICKET_CREATED' && details.ticketId) {
      ticketId = details.ticketId;
    }

    if (!ticketId) continue; // Skip logs without ticketId context

    if (!entityToTicketId.has(log.entityId)) {
      entityToTicketId.set(log.entityId, ticketId);
    }
    
    if (!ticketIdToEntities.has(ticketId)) {
      ticketIdToEntities.set(ticketId, []);
    }
    const arr = ticketIdToEntities.get(ticketId)!;
    if (!arr.includes(log.entityId)) {
      arr.push(log.entityId);
    }

    entityLogCount.set(log.entityId, (entityLogCount.get(log.entityId) || 0) + 1);
    
    const currMax = entityMaxUpdatedAt.get(log.entityId);
    if (!currMax || log.createdAt > currMax) entityMaxUpdatedAt.set(log.entityId, log.createdAt);

    const currMin = entityMinCreatedAt.get(log.entityId);
    if (!currMin || log.createdAt < currMin) entityMinCreatedAt.set(log.entityId, log.createdAt);
  }

  const duplicateTicketIds: string[] = [];
  const resolutionDetails: any[] = [];
  const canonicalEntityMap = new Map<string, string>(); // Maps ANY entityId to its CANONICAL entityId
  const canonicalToTicketId = new Map<string, string>(); 

  for (const [ticketId, entities] of ticketIdToEntities.entries()) {
    if (entities.length > 1) {
      duplicateTicketIds.push(ticketId);
      
      // Sort entities to find canonical
      const sorted = [...entities].sort((a, b) => {
        const countDiff = (entityLogCount.get(b) || 0) - (entityLogCount.get(a) || 0);
        if (countDiff !== 0) return countDiff;

        const maxA = entityMaxUpdatedAt.get(a)?.getTime() || 0;
        const maxB = entityMaxUpdatedAt.get(b)?.getTime() || 0;
        if (maxB !== maxA) return maxB - maxA;

        const minA = entityMinCreatedAt.get(a)?.getTime() || 0;
        const minB = entityMinCreatedAt.get(b)?.getTime() || 0;
        return minB - minA;
      });

      const canonical = sorted[0];
      for (const e of entities) {
        canonicalEntityMap.set(e, canonical);
      }
      canonicalToTicketId.set(canonical, ticketId);

      resolutionDetails.push({
        ticketId,
        canonicalEntityId: canonical,
        mergedEntityIds: sorted.slice(1)
      });
    } else {
      const canonical = entities[0];
      canonicalEntityMap.set(canonical, canonical);
      canonicalToTicketId.set(canonical, ticketId);
    }
  }

  // --- Process Data using Canonical Mappings ---
  const recoveredTickets = new Map<string, any>(); // canonicalEntityId -> Ticket
  const recoveredHistory: any[] = [];
  const finalAssignees = new Map<string, string>(); // canonicalEntityId -> assignedToId

  const statusLogs = allTicketLogs.filter(l => l.action === 'STATUS_CHANGED');
  const assignLogs = allTicketLogs.filter(l => l.action === 'ASSIGNED' || l.action === 'TICKET_ASSIGNED');
  const createdLogs = allTicketLogs.filter(l => l.action === 'TICKET_CREATED');

  // History (Merge all duplicates into canonical)
  for (const log of statusLogs) {
    if (!log.entityId) continue;
    const canonical = canonicalEntityMap.get(log.entityId);
    if (!canonical) continue;

    const details = log.details as any || {};
    recoveredHistory.push({
      ticketId: canonical,
      field: 'status',
      oldValue: details.previousStatus || null,
      newValue: details.newStatus || null,
      changedById: log.userId,
      changedAt: log.createdAt,
    });
  }

  // Assignees
  for (const log of assignLogs) {
    if (!log.entityId) continue;
    const canonical = canonicalEntityMap.get(log.entityId);
    if (!canonical) continue;

    const details = log.details as any || {};
    const assignedToId = details.assignedToId || details.assignee || details.assignedTo;
    
    // We keep the latest assignment for the canonical ticket
    // Since assignLogs are sorted ascending, simply setting it handles latest automatically
    if (assignedToId) {
      finalAssignees.set(canonical, assignedToId);
    }
  }

  const recoveredAssignees: any[] = [];
  for (const [ticketId, assignedToId] of finalAssignees.entries()) {
    recoveredAssignees.push({ ticketId, userId: assignedToId, assignedAt: new Date() });
  }

  // Tickets
  const latestStatusMap = new Map<string, string>();
  for (const log of statusLogs) {
    if (!log.entityId) continue;
    const canonical = canonicalEntityMap.get(log.entityId);
    if (!canonical) continue;
    const details = log.details as any || {};
    if (details.newStatus) latestStatusMap.set(canonical, details.newStatus);
  }

  for (const log of createdLogs) {
    if (!log.entityId) continue;
    const canonical = canonicalEntityMap.get(log.entityId);
    if (!canonical) continue;
    
    // Process only once per canonical entity
    if (recoveredTickets.has(canonical)) continue;

    const ticketId = canonicalToTicketId.get(canonical)!;
    const details = log.details as any || {};
    
    const category = details.category || 'IT';
    const priority = details.priority || 'MEDIUM';

    let departmentId = null;
    if (category === 'IT') departmentId = deptMap.get('IT') || deptMap.get('AI and R&D') || null;
    else if (category === 'HR') departmentId = deptMap.get('HR') || null;
    else if (category === 'OPERATIONS') departmentId = deptMap.get('Company / Operations') || deptMap.get('Operations') || null;
    else if (category === 'PROJECT') departmentId = deptMap.get('Project/Operations') || null;

    const assignedToId = finalAssignees.get(canonical) || null;
    
    // Use max updatedAt across ALL merged entities
    let finalUpdatedAt = log.createdAt;
    for (const [eId, canId] of canonicalEntityMap.entries()) {
      if (canId === canonical) {
        const d = entityMaxUpdatedAt.get(eId);
        if (d && d > finalUpdatedAt) finalUpdatedAt = d;
      }
    }

    const status = latestStatusMap.get(canonical) || 'OPEN';

    recoveredTickets.set(canonical, {
      id: canonical,
      ticketId,
      title: details.title || 'Recovered Ticket',
      category: category as any,
      status: status as any,
      priority: priority as any,
      createdById: log.userId,
      createdAt: entityMinCreatedAt.get(canonical) || log.createdAt,
      updatedAt: finalUpdatedAt,
      departmentId,
      assignedToId
    });
  }

  const finalRecoveredTickets = Array.from(recoveredTickets.values());

  // Generate Audit Markdown
  const auditMd = `
# Ticket Duplicate Resolution Audit

## Overview
- **Total Duplicate \`ticketId\`s found:** ${duplicateTicketIds.length}
- **Final Ticket Count after deduplication:** ${finalRecoveredTickets.length}
- **Final History Count after merge:** ${recoveredHistory.length}
- **Final Assignee Count after merge:** ${recoveredAssignees.length}

## Deduplication Details
${duplicateTicketIds.length === 0 ? 'No duplicates found.' : ''}
${resolutionDetails.map(r => `
### ${r.ticketId}
- **Canonical Entity ID:** ${r.canonicalEntityId}
- **Merged/Discarded Entity IDs:** ${r.mergedEntityIds.join(', ')}
`).join('\\n')}
  `.trim();

  fs.writeFileSync('TICKET_DUPLICATE_RESOLUTION_AUDIT.md', auditMd + '\\n');
  console.log('Generated TICKET_DUPLICATE_RESOLUTION_AUDIT.md');

  // --- VALIDATIONS ---
  console.log(`\\n--- Validating Data ---`);
  console.log(`Tickets to insert: ${finalRecoveredTickets.length}`);
  console.log(`History records to insert: ${recoveredHistory.length}`);
  console.log(`Assignees to insert: ${recoveredAssignees.length}`);

  let errors = 0;
  const tktIdSet = new Set<string>();
  const entityIdSet = new Set<string>();

  for (const t of finalRecoveredTickets) {
    if (!validUserIds.has(t.createdById)) { console.error(`Invalid createdById: ${t.createdById}`); errors++; }
    if (t.assignedToId && !validUserIds.has(t.assignedToId)) { console.error(`Invalid assignedToId: ${t.assignedToId}`); t.assignedToId = null; }
    if (t.departmentId && !validDepartmentIds.has(t.departmentId)) { console.error(`Invalid departmentId: ${t.departmentId}`); t.departmentId = null; }
    
    if (!VALID_CATEGORIES.has(t.category)) { console.error(`Invalid category: ${t.category}`); errors++; }
    if (!VALID_PRIORITIES.has(t.priority)) { console.error(`Invalid priority: ${t.priority}`); errors++; }
    if (!VALID_TICKET_STATUSES.has(t.status)) { console.error(`Invalid status: ${t.status}`); errors++; }

    if (!t.ticketId) { console.error(`Missing ticketId for entity: ${t.id}`); errors++; }
    else if (tktIdSet.has(t.ticketId)) { console.error(`Duplicate ticketId: ${t.ticketId}`); errors++; }
    else { tktIdSet.add(t.ticketId); }

    if (entityIdSet.has(t.id)) { console.error(`Duplicate entityId: ${t.id}`); errors++; }
    else { entityIdSet.add(t.id); }
  }

  for (const h of recoveredHistory) {
    if (!validUserIds.has(h.changedById)) { console.error(`Invalid changedById in history: ${h.changedById}`); errors++; }
    if (h.oldValue && !VALID_TICKET_STATUSES.has(h.oldValue)) { console.error(`Invalid old status: ${h.oldValue}`); errors++; }
    if (h.newValue && !VALID_TICKET_STATUSES.has(h.newValue)) { console.error(`Invalid new status: ${h.newValue}`); errors++; }
  }

  for (const a of recoveredAssignees) {
    if (!validUserIds.has(a.userId)) { console.error(`Invalid assignee user: ${a.userId}`); errors++; }
  }

  if (errors > 0) {
    console.error(`\\nValidation failed with ${errors} errors. Aborting.`);
    process.exit(1);
  } else {
    console.log('All validations passed!');
  }

  // --- 3. CREATE JSON SNAPSHOTS ---
  fs.writeFileSync('snapshot_tickets.json', JSON.stringify(finalRecoveredTickets, null, 2));
  fs.writeFileSync('snapshot_history.json', JSON.stringify(recoveredHistory, null, 2));
  fs.writeFileSync('snapshot_assignees.json', JSON.stringify(recoveredAssignees, null, 2));

  // --- 4. EXECUTE RESTORE ---
  if (!isDryRun) {
    console.log('\\n--- Executing Restore via Transaction ---');
    try {
      await prisma.$transaction(async (tx) => {
        await tx.ticket.createMany({ data: finalRecoveredTickets });
        console.log('Tickets inserted.');

        await tx.ticketHistory.createMany({ data: recoveredHistory });
        console.log('TicketHistory inserted.');

        await tx.ticketAssignee.createMany({ data: recoveredAssignees });
        console.log('TicketAssignee inserted.');
      });

      console.log('\\n--- Post-Restore Metrics ---');
      const countTickets = await prisma.ticket.count();
      const countHistory = await prisma.ticketHistory.count();
      const countAssignees = await prisma.ticketAssignee.count();
      
      console.log(`Final Ticket count: ${countTickets}`);
      console.log(`Final TicketHistory count: ${countHistory}`);
      console.log(`Final TicketAssignee count: ${countAssignees}`);

      const sample = await prisma.ticket.findMany({ take: 10 });

      const report = `
# Ticket Recovery Execution Report

## Execution Summary
- **Execution Date:** ${new Date().toISOString()}
- **Tickets Inserted:** ${countTickets}
- **TicketHistory Inserted:** ${countHistory}
- **TicketAssignee Inserted:** ${countAssignees}

## Sample Recovered Tickets
\`\`\`json
${JSON.stringify(sample, null, 2)}
\`\`\`
      `.trim();

      fs.writeFileSync('TICKET_RECOVERY_EXECUTION_REPORT.md', report);
      console.log('\\nRecovery successfully executed. Report generated: TICKET_RECOVERY_EXECUTION_REPORT.md');
    } catch (e) {
      console.error('\\nTransaction failed. Rolled back changes.');
      console.error(e);
      process.exit(1);
    }
  } else {
    console.log('\\nDry run complete. No data was inserted.');
  }
}

run()
  .catch(console.error)
  .finally(async () => await prisma.$disconnect());
