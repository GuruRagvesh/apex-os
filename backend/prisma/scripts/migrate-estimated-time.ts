import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const tickets = await prisma.ticket.findMany({
    where: { estimatedTime: { not: null } },
  });
  console.log(`Migrating ${tickets.length} tickets...`);
  for (const ticket of tickets) {
    if (ticket.estimatedTime && !ticket.estimatedMinutes) {
      const minutes = Math.round((ticket.estimatedTime as number) * 60);
      await prisma.ticket.update({ where: { id: ticket.id }, data: { estimatedMinutes: minutes } });
      console.log(`  ${ticket.ticketId}: ${ticket.estimatedTime}h → ${minutes} min`);
    }
  }
  console.log('Migration complete.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
