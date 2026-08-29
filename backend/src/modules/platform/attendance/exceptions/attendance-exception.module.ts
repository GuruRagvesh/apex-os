import { Module } from '@nestjs/common';
import { AttendanceExceptionService } from './attendance-exception.service';
import { AttendanceExceptionController } from './attendance-exception.controller';
import { AttendanceConsoleModule } from '../console/attendance-console.module';

/**
 * Attendance Exception Queue (EQ-1).
 *
 * Imports the console module for one thing only: resolveScope(). The rule about
 * which employees a manager may see already exists and is already tested, and a
 * second copy of it here would be a second place for it to be wrong.
 *
 * No other module is imported, and nothing is exported: the queue reads the
 * official records and points at the services that own the corrections. It is
 * a leaf, on purpose.
 */
@Module({
  imports: [AttendanceConsoleModule],
  controllers: [AttendanceExceptionController],
  providers: [AttendanceExceptionService],
})
export class AttendanceExceptionModule {}
