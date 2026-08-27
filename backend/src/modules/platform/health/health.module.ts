import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaModule } from '../../../prisma/prisma.module';
import { PunchPhotoStorageModule } from '../attendance/punch/punch-photo-storage.module';

@Module({
  imports: [PrismaModule, PunchPhotoStorageModule],
  controllers: [HealthController],
})
export class HealthModule {}
