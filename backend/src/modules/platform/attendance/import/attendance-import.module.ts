import { Module } from '@nestjs/common';
import { AttendanceImportService } from './attendance-import.service';
import { AttendanceImportApplyService } from './attendance-import-apply.service';
import { AttendanceImportController } from './attendance-import.controller';
import { DailyAttendanceModule } from '../evaluation/daily-attendance.module';
import { BackupVaultModule } from '../../backup-vault/backup-vault.module';

/**
 * Attendance Data Control (Phase 4).
 *
 * Upload, validate, preview, approve, apply. The importer stages and reviews;
 * the authoritative write stays where it has always been, and nothing
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
  providers: [AttendanceImportService, AttendanceImportApplyService],
  exports: [AttendanceImportService, AttendanceImportApplyService],
})
export class AttendanceImportModule {}
