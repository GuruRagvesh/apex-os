import { Module } from '@nestjs/common';
import { AttendanceActivityService } from './attendance-activity.service';
import { AttendanceActivityController } from './attendance-activity.controller';

/**
 * Employee-facing attendance provenance.
 *
 * No dependency on the events module: this is a narrow read projection over the
 * same OperationalEvent rows, not a second audit system and not a wrapper
 * around the generic /events authorization.
 *
 * PrismaService and TVAService come from the global CommonModule.
 */
@Module({
  controllers: [AttendanceActivityController],
  providers: [AttendanceActivityService],
  exports: [AttendanceActivityService],
})
export class AttendanceActivityModule {}
