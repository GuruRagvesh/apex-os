import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- DATABASE COUNT ---');
  const userCount = await prisma.user.count();
  const ticketCount = await prisma.ticket.count();
  const projectCount = await prisma.project.count();
  const leaveCount = await prisma.leaveRequest.count();
  const eventCount = await (prisma as any).operationalEvent.count();
  const activityCount = await prisma.activityLog.count();
  const workSessionCount = await prisma.workSession.count();

  console.log('Users:', userCount);
  console.log('Tickets:', ticketCount);
  console.log('Projects:', projectCount);
  console.log('Leave Requests:', leaveCount);
  console.log('Operational Events:', eventCount);
  console.log('Activity Logs:', activityCount);
  console.log('Work Sessions:', workSessionCount);

  if (ticketCount > 0) {
    const sample = await prisma.ticket.findFirst();
    console.log('Sample Ticket:', sample);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
