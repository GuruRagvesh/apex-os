import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { GatewayModule } from '../gateway/gateway.module';
import { TicketsModule } from '../../operations/tickets/tickets.module';

@Module({
  imports: [GatewayModule, TicketsModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
