import { Module } from '@nestjs/common';
import { LeaveModule } from '../../operations/leave/leave.module';
import { TransitionsModule } from '../../core/users/transitions/transitions.module';
import { AttendanceConsoleModule } from '../attendance/console/attendance-console.module';
import { RegularizationModule } from '../attendance/regularization/regularization.module';
import { ReviewQueueController } from './review-queue.controller';
import { ReviewQueueService } from './review-queue.service';

@Module({
  imports: [LeaveModule, TransitionsModule, AttendanceConsoleModule, RegularizationModule],
  controllers: [ReviewQueueController],
  providers: [ReviewQueueService],
})
export class ReviewQueueModule {}
