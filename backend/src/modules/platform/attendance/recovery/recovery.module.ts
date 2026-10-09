import { Module } from '@nestjs/common';
import { SettingsModule } from '../../settings/settings.module';
import { RecoveryFlagsService } from './recovery-flags';
import { RecoveryReadService } from './recovery-read.service';
import { DataHealthService, DataManagerController } from './data-manager.controller';
import { AttendanceRecoveryVault } from './recovery-vault.service';

/**
 * Attendance recovery — Phase 3.
 *
 *   GET /api/attendance/data-manager/health   (HR / ADMIN / SUPER_ADMIN), read-only
 *   AttendanceRecoveryVault                    dedicated, environment-bound recovery
 *                                              vault client; no caller writes yet
 *
 * No scheduler, cron, interval or background worker. The vault opens no
 * connection at startup, so a missing or broken vault cannot stop the app.
 * The vault is NOT exported: nothing outside this module can reach it.
 * TVAService, PrismaService and AccessPolicyService arrive through the global
 * CommonModule.
 */
@Module({
  imports: [SettingsModule],
  controllers: [DataManagerController],
  providers: [
    RecoveryFlagsService,
    RecoveryReadService,
    DataHealthService,
    {
      provide: AttendanceRecoveryVault,
      useFactory: (flags: RecoveryFlagsService) => new AttendanceRecoveryVault(flags, process.env),
      inject: [RecoveryFlagsService],
    },
  ],
  exports: [RecoveryFlagsService, RecoveryReadService],
})
export class AttendanceRecoveryModule {}
