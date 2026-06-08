import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const statusLog = await prisma.activityLog.findFirst({
    where: { entityType: 'TICKET', action: 'STATUS_CHANGED' },
  });
  console.log('STATUS_CHANGED sample:', statusLog);

  const assignLog = await prisma.activityLog.findFirst({
    where: { entityType: 'TICKET', action: { in: ['ASSIGNED', 'TICKET_ASSIGNED'] } },
  });
  console.log('ASSIGN sample (action):', assignLog);

  const anyAssignLog = await prisma.activityLog.findFirst({
    where: {
      entityType: 'TICKET',
      details: {
        path: ['assignee'],
        not: null,
      } as any
    }
  });
  console.log('ASSIGN sample (details.assignee):', anyAssignLog);
  
  const depts = await prisma.department.findMany();
  console.log('Departments:', depts.map(d => ({ id: d.id, name: d.name })));
}

run().finally(() => prisma.$disconnect());
