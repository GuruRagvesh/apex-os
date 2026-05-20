import { Module } from '@nestjs/common';
import { TaskTypesController } from './task-types.controller';
import { TaskTypesService } from './task-types.service';

@Module({
  controllers: [TaskTypesController],
  providers: [TaskTypesService],
  exports: [TaskTypesService],
})
export class TaskTypesModule {}
