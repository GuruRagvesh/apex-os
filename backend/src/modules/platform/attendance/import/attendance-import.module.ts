import { Module } from '@nestjs/common';
import { AttendanceImportService } from './attendance-import.service';
import { AttendanceImportController } from './attendance-import.controller';
import { DailyAttendanceModule } from '../evaluation/daily-attendance.module';
import { BackupVaultModule } from '../../backup-vault/backup-vault.module';

/**
 * Attendance Data Control (Phase 4).
 *
 * Preparation and review only. There is no approve or apply route, and nothing
 * in this module can write an attendance record: it imports the evaluator
 * module for LeaveFactsService, which it uses to ASK whether approved leave
 * exists, never to create any.
 *
 * PrismaService, TVAService and AccessPolicyService arrive through the global
 * CommonModule.
 */
@Module({
  imports: [DailyAttendanceModule, BackupVaultModule],
  controllers: [AttendanceImportController],
  providers: [AttendanceImportService],
  exports: [AttendanceImportService],
})
export class AttendanceImportModule {}
