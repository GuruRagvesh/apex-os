import { Module } from '@nestjs/common';
import { WorkdayController } from './workday.controller';
import { WorkdayService } from './workday.service';

@Module({
  controllers: [WorkdayController],
  providers: [WorkdayService],
  exports: [WorkdayService],
})
export class WorkdayModule {}
