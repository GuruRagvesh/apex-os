import { Module } from '@nestjs/common';
import { PunchEvidenceService } from './punch-evidence.service';
import { PunchEvidenceController } from './punch-evidence.controller';
import { DailyContextModule } from '../context/daily-context.module';
import { SettingsModule } from '../../settings/settings.module';

/**
 * Punch Evidence (PE-1).
 *
 * The first attendance module with a controller, because it is the first that
 * an employee's device actually calls. Everything it exposes is scoped to the
 * authenticated employee, and the feature flag defaults OFF.
 */
@Module({
  imports: [DailyContextModule, SettingsModule],
  controllers: [PunchEvidenceController],
  providers: [PunchEvidenceService],
  exports: [PunchEvidenceService],
})
export class PunchEvidenceModule {}
