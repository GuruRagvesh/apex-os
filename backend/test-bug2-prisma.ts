import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst();
  console.log('User:', user?.id);

  // create a dummy ticket
  const ticket = await prisma.ticket.create({
    data: {
      ticketId: 'PRISMA-TEST-1',
      title: 'Prisma Test',
      category: 'IT',
      priority: 'LOW',
      createdById: user!.id,
      assignedToId: user!.id,
    }
  });

  // start a log
  const log = await prisma.ticketTimeLog.create({
    data: {
      ticketId: ticket.id,
      userId: user!.id,
      stage: 'IN_PROGRESS',
      ownerType: 'ASSIGNEE',
      source: 'TEST',
      startedAt: new Date(Date.now() - 100000), // 100 seconds ago
    }
  });

  console.log('Log created:', log.id);

  // check active logs
  let activeLogs = await prisma.ticketTimeLog.findMany({
    where: { ticketId: ticket.id, endedAt: null },
  });
  console.log('Active logs before pause:', activeLogs.length);

  // pause
  const endedAt = new Date();
  for (const l of activeLogs) {
    const durationSeconds = Math.floor((endedAt.getTime() - l.startedAt.getTime()) / 1000);
    await prisma.ticketTimeLog.update({
      where: { id: l.id },
      data: {
        endedAt,
        durationSeconds,
        pauseReason: 'BREAK',
      }
    });
  }

  // check active logs again
  activeLogs = await prisma.ticketTimeLog.findMany({
    where: { ticketId: ticket.id, endedAt: null },
  });
  console.log('Active logs after pause:', activeLogs.length);

  // simulate getTicketTimers
  const assigneeLogs = await prisma.ticketTimeLog.aggregate({
    where: { ticketId: ticket.id, ownerType: 'ASSIGNEE' },
    _sum: { durationSeconds: true },
  });
  console.log('Duration sum:', assigneeLogs._sum.durationSeconds);
}

main().catch(console.error).finally(() => prisma.$disconnect());
