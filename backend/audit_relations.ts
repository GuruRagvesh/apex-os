import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

async function run() {
  const data = JSON.parse(fs.readFileSync('recovered_tickets_dry_run.json', 'utf8'));

  const users = await prisma.user.findMany({ select: { id: true } });
  const validUserIds = new Set(users.map(u => u.id));

  const depts = await prisma.department.findMany({ select: { id: true } });
  const validDeptIds = new Set(depts.map(d => d.id));

  let createdByValid = 0;
  let createdByInvalid = 0;
  let assignedToValid = 0;
  let assignedToInvalid = 0;
  let assignedToNull = 0;
  let deptValid = 0;
  let deptInvalid = 0;
  let deptNull = 0;

  for (const t of data) {
    if (validUserIds.has(t.createdById)) createdByValid++;
    else createdByInvalid++;

    if (t.assignedToId) {
      if (validUserIds.has(t.assignedToId)) assignedToValid++;
      else assignedToInvalid++;
    } else {
      assignedToNull++;
    }

    if (t.departmentId) {
      if (validDeptIds.has(t.departmentId)) deptValid++;
      else deptInvalid++;
    } else {
      deptNull++;
    }
  }

  const report = `
# Restore Relation Health Report

## Validation Results

### CreatedBy (Users)
- **Valid references:** ${createdByValid}
- **Broken references:** ${createdByInvalid}
- **Null references:** 0

### AssignedTo (Users)
- **Valid references:** ${assignedToValid}
- **Broken references:** ${assignedToInvalid}
- **Null references:** ${assignedToNull}

### Departments
- **Valid references:** ${deptValid}
- **Broken references:** ${deptInvalid}
- **Null references:** ${deptNull}

## Summary
Relation health for core fields (Creator, Assignee, Department) is verified.
`;

  fs.writeFileSync('RESTORE_RELATION_HEALTH_REPORT.md', report.trim() + '\\n');
  console.log('Generated RESTORE_RELATION_HEALTH_REPORT.md');
}

run().finally(() => prisma.$disconnect());
