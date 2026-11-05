import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { EmailModule } from '../email/email.module';
import { PolicyCenterService } from './policy-center.service';

@Module({
  imports: [EmailModule],
  controllers: [SettingsController],
  providers: [SettingsService, PolicyCenterService],
  exports: [SettingsService],
})
export class SettingsModule {}
