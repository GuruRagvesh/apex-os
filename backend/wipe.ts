import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  await prisma.ticketTimeLog.deleteMany({});
  await prisma.ticketHistory.deleteMany({});
  await prisma.ticketAssignee.deleteMany({});
  await prisma.ticket.deleteMany({});
  console.log('Cleaned up 1 remaining ticket.');
}
run().finally(() => prisma.$disconnect());
