import { Module } from '@nestjs/common';
import { TicketsModule } from '../../../operations/tickets/tickets.module';
import { WorkdayModule } from '../../../platform/workday/workday.module';
import { UserLifecycleController } from './user-lifecycle.controller';
import { defaultLifecyclePorts, USER_LIFECYCLE_PORTS, UserLifecycleService } from './user-lifecycle.service';

@Module({
  imports: [TicketsModule, WorkdayModule],
  controllers: [UserLifecycleController],
  providers: [UserLifecycleService, { provide: USER_LIFECYCLE_PORTS, useFactory: defaultLifecyclePorts }],
  exports: [UserLifecycleService],
})
export class UserLifecycleModule {}
