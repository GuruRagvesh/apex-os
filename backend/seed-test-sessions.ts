import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedTestSessions() {
  const users = await prisma.user.findMany({ take: 4 });
  if (users.length < 4) return console.error('Not enough users');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 1. Working
  await prisma.workSession.create({
    data: {
      userId: users[0].id,
      date: today,
      startWorkAt: new Date(new Date().getTime() - 4 * 60 * 60 * 1000), // 4 hours ago
      status: 'WORKING',
    }
  });

  // 2. Ended
  await prisma.workSession.create({
    data: {
      userId: users[1].id,
      date: today,
      startWorkAt: new Date(new Date().getTime() - 8 * 60 * 60 * 1000),
      logoutAt: new Date(new Date().getTime() - 1 * 60 * 60 * 1000),
      status: 'LOGGED_OUT',
      autoClosed: false,
    }
  });

  // 3. Auto-closed
  await prisma.workSession.create({
    data: {
      userId: users[2].id,
      date: today,
      startWorkAt: new Date(new Date().getTime() - 10 * 60 * 60 * 1000),
      logoutAt: new Date(new Date().getTime() - 2 * 60 * 60 * 1000),
      status: 'LOGGED_OUT',
      autoClosed: true,
    }
  });

  // 4. Not started - users[3] has no session today

  console.log('Seed done!');
}

seedTestSessions().catch(console.error).finally(() => prisma.$disconnect());
