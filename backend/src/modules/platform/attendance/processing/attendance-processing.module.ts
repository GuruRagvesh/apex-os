import { Module } from '@nestjs/common';
import { AttendanceProcessingService } from './attendance-processing.service';
import { AttendanceSchedulerService } from './attendance-scheduler.service';
import { DailyAttendanceModule } from '../evaluation/daily-attendance.module';
import { SettingsModule } from '../../settings/settings.module';
import { NotificationsModule } from '../../../operations/notifications/notifications.module';
import { AttendanceRegularizationReminderService } from './attendance-regularization-reminder.service';

/**
 * Attendance processing and scheduling (SS-1).
 *
 * The cron service and the HR console both depend on AttendanceProcessingService,
 * which depends on the AE-1 evaluator. That is the whole chain: one evaluator,
 * one processing service, two triggers.
 */
@Module({
  imports: [DailyAttendanceModule, SettingsModule, NotificationsModule],
  providers: [AttendanceProcessingService, AttendanceSchedulerService, AttendanceRegularizationReminderService],
  exports: [AttendanceProcessingService],
})
export class AttendanceProcessingModule {}
