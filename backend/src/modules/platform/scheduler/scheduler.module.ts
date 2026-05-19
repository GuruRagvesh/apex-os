import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [GatewayModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
