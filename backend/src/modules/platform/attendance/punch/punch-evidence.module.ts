import { Module } from '@nestjs/common';
import { PunchEvidenceService } from './punch-evidence.service';
import { PunchPhotoService } from './punch-photo.service';
import { PunchPhotoStorageModule } from './punch-photo-storage.module';
import { PunchEvidenceController } from './punch-evidence.controller';
import { PunchPhotoController } from './punch-photo.controller';
import { DailyContextModule } from '../context/daily-context.module';
import { SettingsModule } from '../../settings/settings.module';
import { WorkdayModule } from '../../workday/workday.module';

/**
 * Punch Evidence (PE-1).
 *
 * The first attendance module with a controller, because it is the first that
 * an employee's device actually calls. Everything it exposes is scoped to the
 * authenticated employee, and the feature flag defaults OFF.
 */
@Module({
  imports: [DailyContextModule, SettingsModule, WorkdayModule, PunchPhotoStorageModule],
  controllers: [PunchEvidenceController, PunchPhotoController],
  providers: [PunchEvidenceService, PunchPhotoService],
  exports: [PunchEvidenceService, PunchPhotoService],
})
export class PunchEvidenceModule {}
