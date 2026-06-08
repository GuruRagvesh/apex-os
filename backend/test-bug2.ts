import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { WorkdayService } from './src/modules/platform/workday/workday.service';
import { TicketsService } from './src/modules/operations/tickets/tickets.service';
import { TicketLedgerService } from './src/modules/operations/tickets/ticket-ledger.service';
import { PrismaService } from './src/prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const workdayService = app.get(WorkdayService);
  const ticketsService = app.get(TicketsService);
  const ticketLedger = app.get(TicketLedgerService);

  const user = await prisma.user.findFirst();
  if (!user) return console.log('No user');

  console.log('Testing with User ID:', user.id);

  // cleanup
  await prisma.ticketTimeLog.deleteMany({});
  await prisma.ticket.deleteMany({});
  await prisma.workSession.deleteMany({});

  // 1. Start work
  console.log('Starting work...');
  await workdayService.startWork(user.id);

  // 2. Start ticket
  console.log('Creating ticket...');
  const ticket = await ticketsService.create({
    title: 'Bug Test Ticket',
    category: 'IT',
    priority: 'MEDIUM',
  }, user.id, { id: user.id });

  console.log('Updating status to IN_PROGRESS...');
  await ticketsService.updateStatus(ticket.id, 'IN_PROGRESS', user.id, { id: user.id });

  // 3. Wait/check productive time
  const timers1 = await ticketLedger.getTicketTimers(ticket);
  console.log('Timers after starting ticket:', timers1);

  // simulate waiting
  await new Promise(r => setTimeout(r, 2000));

  const timers2 = await ticketLedger.getTicketTimers(ticket);
  console.log('Timers before break:', timers2);

  // 4. Start break
  console.log('Starting break...');
  await workdayService.startBreak(user.id, { breakType: 'LUNCH' });

  // 5. Wait 2 seconds
  await new Promise(r => setTimeout(r, 2000));

  // 6. Confirm ticket productive time does NOT increase
  const timers3 = await ticketLedger.getTicketTimers(ticket);
  console.log('Timers during break:', timers3);

  // 7. Resume work
  console.log('Ending break...');
  await workdayService.endBreak(user.id);

  await new Promise(r => setTimeout(r, 2000));

  // 8. Confirm ticket productive time starts increasing again
  const timers4 = await ticketLedger.getTicketTimers(ticket);
  console.log('Timers after resuming work:', timers4);

  await app.close();
}

bootstrap().catch(console.error);
